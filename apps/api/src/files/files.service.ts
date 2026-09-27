import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

const MAX_BYTES = 10 * 1024 * 1024;
const root = resolve(process.env.PRIVATE_FILE_DIR ?? 'var/private-files');
const mimeTypes = new Set(['image/jpeg', 'image/png', 'application/pdf']);

@Injectable()
export class FilesService {
  constructor(private readonly database: DatabaseService) {}

  async create(ownerId: string, input: { filename: string; mimeType: string; sizeBytes: number; purpose: string }) {
    if (input.purpose !== 'PAYMENT' || !input.filename.trim() || !mimeTypes.has(input.mimeType) || !Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_BYTES || input.filename.length > 255) {
      throw new ConflictException({ code: 'FILE_METADATA_INVALID', message: 'Payment evidence must be a JPEG, PNG, or PDF no larger than 10 MiB' });
    }
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    await this.database.client.fileObject.create({ data: { id, filename: input.filename, mimeType: input.mimeType, sizeBytes: BigInt(input.sizeBytes), objectKey: randomUUID(), uploadTokenHash: createHash('sha256').update(token).digest('hex'), purpose: input.purpose, ownerId } });
    return { id, uploadToken: token, uploadPath: `/api/v1/files/${id}/content`, completePath: `/api/v1/files/${id}/complete` };
  }

  async upload(ownerId: string, id: string, token: string, bytes: Buffer) {
    if (!token) throw new NotFoundException();
    const file = await this.database.client.fileObject.findFirst({ where: { id, ownerId, status: 'UPLOADING', createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
    if (!file) throw new NotFoundException();
    if (createHash('sha256').update(token).digest('hex') !== file.uploadTokenHash) throw new NotFoundException();
    if (!bytes.length || bytes.length > MAX_BYTES || bytes.length !== Number(file.sizeBytes)) throw new ConflictException({ code: 'FILE_SIZE_MISMATCH', message: 'Uploaded file size does not match session metadata' });
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
    await writeFile(join(root, file.objectKey), bytes, { flag: 'wx', mode: 0o600 });
    return { id, uploaded: true };
  }

  async complete(ownerId: string, id: string) {
    const file = await this.database.client.fileObject.findFirst({ where: { id, ownerId, status: 'UPLOADING', createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
    if (!file) throw new NotFoundException();
    const bytes = await readFile(join(root, file.objectKey)).catch(() => null);
    const valid = bytes && ((file.mimeType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) || (file.mimeType === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ) || (file.mimeType === 'application/pdf' && bytes.subarray(0, 5).toString() === '%PDF-'));
    if (!valid) {
      await this.database.client.fileObject.update({ where: { id }, data: { status: 'REJECTED' } });
      throw new ConflictException({ code: 'FILE_CONTENT_INVALID', message: 'File content does not match its declared type' });
    }
    await this.database.client.fileObject.update({ where: { id }, data: { status: 'READY', checksum: createHash('sha256').update(bytes).digest('hex') } });
    return { id, status: 'READY' };
  }

  async download(ownerId: string, id: string, scope?: { type?: string; storeId?: string; supplierId?: string }, roles: string[] = []) {
    const file = await this.database.client.fileObject.findFirst({ where: { id, status: 'READY' }, include: { payment: { select: { storeId: true, supplierId: true } } } });
    if (!file) throw new NotFoundException();
    const allowed = file.ownerId === ownerId || roles.some((role) => role === 'ADMIN' || role === 'HQ_FINANCE') || (scope?.type === 'STORE' || scope?.type === 'STORE_FINANCE') && file.payment?.storeId === scope.storeId || scope?.type === 'SUPPLIER' && file.payment?.supplierId === scope.supplierId;
    if (!allowed) throw new NotFoundException();
    return { file, bytes: await readFile(join(root, file.objectKey)) };
  }
}
