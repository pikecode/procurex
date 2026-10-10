import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { DatabaseService } from '../database/database.service.js';
import { PrivateStorage } from './private-storage.js';

const MAX_BYTES = 10 * 1024 * 1024;
const mimeTypes = new Set(['image/jpeg', 'image/png', 'application/pdf']);

@Injectable()
export class FilesService {
  private readonly storage = new PrivateStorage();
  constructor(private readonly database: DatabaseService) {}

  async create(ownerId: string, input: { filename: string; mimeType: string; sizeBytes: number; purpose: string }, roles?: string[]) {
    if (roles && ['RECHARGE', 'CLEARING'].includes(input.purpose) && !roles.some(role => ['ADMIN', 'HQ_FINANCE'].includes(role))) throw new ForbiddenException({ code: 'FILE_PURPOSE_FORBIDDEN', message: 'Account document evidence requires central finance' });
    if (roles && !(input.purpose === 'PRODUCT' ? roles.some(role => ['ADMIN', 'PURCHASER'].includes(role)) : roles.some(role => ['ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE'].includes(role)))) throw new ForbiddenException({ code: 'FILE_PURPOSE_FORBIDDEN', message: 'File purpose is not allowed for the current role' });
    if (!['PAYMENT', 'RECEIPT', 'PRODUCT', 'RECHARGE', 'CLEARING'].includes(input.purpose) || typeof input.filename !== 'string' || !input.filename.trim() || !mimeTypes.has(input.mimeType) || (['RECEIPT', 'PRODUCT', 'RECHARGE', 'CLEARING'].includes(input.purpose) && !input.mimeType.startsWith('image/')) || !Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > (input.purpose === 'PRODUCT' ? 2 * 1024 * 1024 : MAX_BYTES) || input.filename.length > 255) {
      throw new ConflictException({ code: 'FILE_METADATA_INVALID', message: 'Evidence must be a supported file no larger than 10 MiB; receipt evidence requires JPEG or PNG' });
    }
    await this.removeExpiredUploads();
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    await this.database.client.fileObject.create({ data: { id, filename: input.filename, mimeType: input.mimeType, sizeBytes: BigInt(input.sizeBytes), objectKey: this.storage.newKey(), uploadTokenHash: createHash('sha256').update(token).digest('hex'), purpose: input.purpose, ownerId } });
    return { id, uploadToken: token, uploadPath: `/api/v1/files/${id}/content`, completePath: `/api/v1/files/${id}/complete` };
  }

  async upload(ownerId: string, id: string, token: string, bytes: Buffer) {
    if (!token) throw new NotFoundException();
    const file = await this.database.client.fileObject.findFirst({ where: { id, ownerId, status: 'UPLOADING', createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
    if (!file) throw new NotFoundException();
    if (createHash('sha256').update(token).digest('hex') !== file.uploadTokenHash) throw new NotFoundException();
    if (!bytes.length || bytes.length > MAX_BYTES || bytes.length !== Number(file.sizeBytes)) throw new ConflictException({ code: 'FILE_SIZE_MISMATCH', message: 'Uploaded file size does not match session metadata' });
    await this.storage.put(file.objectKey, bytes, file.mimeType);
    return { id, uploaded: true };
  }

  async complete(ownerId: string, id: string) {
    const file = await this.database.client.fileObject.findFirst({ where: { id, ownerId, status: 'UPLOADING', createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
    if (!file) throw new NotFoundException();
    const bytes = await this.storage.get(file.objectKey).catch((error: { code?: string }) => {
      if (error.code === 'ENOENT' || error.code === 'NoSuchKey') return null;
      throw error;
    });
    let valid = Boolean(bytes && ((file.mimeType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) || (file.mimeType === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ) || (file.mimeType === 'application/pdf' && bytes.subarray(0, 5).toString() === '%PDF-')));
    if (valid && bytes && file.purpose === 'PRODUCT') {
      try {
        const image = sharp(bytes, { limitInputPixels: 4096 * 4096 });
        const metadata = await image.metadata();
        valid = metadata.width === metadata.height && !!metadata.width && metadata.width <= 4096 && (metadata.pages ?? 1) === 1
          && (file.mimeType === 'image/jpeg' ? metadata.format === 'jpeg' : metadata.format === 'png');
        if (valid) await image.raw().toBuffer();
      } catch { valid = false; }
    }
    if (!valid) {
      await this.storage.remove(file.objectKey);
      await this.database.client.fileObject.update({ where: { id }, data: { status: 'REJECTED' } });
      throw new ConflictException({ code: 'FILE_CONTENT_INVALID', message: 'File content does not match its declared type' });
    }
    await this.database.client.fileObject.update({ where: { id }, data: { status: 'READY', checksum: createHash('sha256').update(bytes!).digest('hex') } });
    return { id, status: 'READY' };
  }

  async download(ownerId: string, id: string, scope?: { type?: string; storeId?: string; supplierId?: string }, roles: string[] = []) {
    const file = await this.database.client.fileObject.findFirst({ where: { id, status: 'READY' }, include: { payment: { select: { storeId: true, supplierId: true, direction: true } }, receipt: { select: { shipment: { select: { supplierOrder: { select: { storeId: true, supplierId: true } } } } } }, recharge: { select: { storeId: true } }, clearing: { select: { storeId: true } } } });
    if (!file) throw new NotFoundException();
    const accountDocument = file.recharge ?? file.clearing;
    const document = file.payment ?? file.receipt?.shipment.supplierOrder;
    let productAllowed = false;
    if (file.purpose === 'PRODUCT') {
      if (roles.includes('PURCHASER')) productAllowed = await this.database.client.product.count({ where: { imageFileId: id } }) > 0;
      else if (['STORE', 'STORE_FINANCE'].includes(scope?.type ?? '') && scope?.storeId) productAllowed = await this.database.client.product.count({ where: { imageFileId: id, isActive: true, templateItems: { some: { isEnabled: true, template: { isArchived: false, bindings: { some: { storeId: scope.storeId, expiredAt: null } } } } } } }) > 0;
      else if (scope?.type === 'SUPPLIER' && scope.supplierId) productAllowed = await this.database.client.product.count({ where: { imageFileId: id, isActive: true, suppliers: { some: { supplierId: scope.supplierId } } } }) > 0;
    }
    const allowed = productAllowed || file.ownerId === ownerId || roles.some((role) => role === 'ADMIN' || role === 'HQ_FINANCE') || (scope?.type === 'STORE' || scope?.type === 'STORE_FINANCE') && !!scope.storeId && file.payment?.direction !== 'COMPANY_TO_SUPPLIER' && (document?.storeId === scope.storeId || accountDocument?.storeId === scope.storeId) || scope?.type === 'SUPPLIER' && !!scope.supplierId && file.payment?.direction !== 'STORE_TO_COMPANY' && document?.supplierId === scope.supplierId;
    if (!allowed) throw new NotFoundException();
    return { file, bytes: await this.storage.get(file.objectKey) };
  }

  private async removeExpiredUploads() {
    const expired = await this.database.client.fileObject.findMany({ where: { status: 'UPLOADING', createdAt: { lte: new Date(Date.now() - 86_400_000) }, paymentId: null, receiptId: null }, take: 100 });
    // Preserve records belonging to an unavailable storage backend for later cleanup.
    const accessible = expired.filter(file => this.storage.canAccess(file.objectKey));
    for (const file of accessible) await this.storage.remove(file.objectKey);
    if (accessible.length) await this.database.client.fileObject.deleteMany({ where: { id: { in: accessible.map(({ id }) => id) }, status: 'UPLOADING', paymentId: null, receiptId: null } });
  }
}
