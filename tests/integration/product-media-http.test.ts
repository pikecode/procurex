import assert from 'node:assert/strict';
import test from 'node:test';
import { AddressInfo } from 'node:net';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../packages/domain/src/password.js';

test('product images and metadata preserve scoped access, atomic versions and upload ownership', async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
  const prefix = `ITMEDIA${Date.now()}`;
  const users: string[] = [];
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  try {
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    const userToken = async (name: string, roleCode: string, scope?: { scopeType: 'STORE' | 'SUPPLIER'; storeId?: string; supplierId?: string }) => {
      const role = await db.role.upsert({ where: { code: roleCode }, update: {}, create: { code: roleCode, name: roleCode } });
      const user = await db.user.create({ data: { username: `${prefix}${name}`, displayName: name, passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } }, ...(scope ? { scopes: { create: scope } } : {}) } });
      users.push(user.id);
      const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user.username, password: 'correct-password', client: 'WEB' }) });
      assert.equal(response.status, 201); return (await response.json() as { data: { accessToken: string } }).data.accessToken;
    };
    const editor = await userToken('editor', 'PURCHASER'), otherEditor = await userToken('other-editor', 'PURCHASER');
    const store = await db.store.create({ data: { code: prefix, name: 'Media store' } });
    const otherStore = await db.store.create({ data: { code: `${prefix}OTHER`, name: 'Unrelated store' } });
    const storeToken = await userToken('store', 'STORE', { scopeType: 'STORE', storeId: store.id });
    const otherStoreToken = await userToken('other-store', 'STORE', { scopeType: 'STORE', storeId: otherStore.id });
    const supplier = await db.supplier.create({ data: { code: prefix, name: 'Media supplier', deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY' } });
    const supplierToken = await userToken('supplier', 'SUPPLIER', { scopeType: 'SUPPLIER', supplierId: supplier.id });
    const category = await db.category.create({ data: { code: prefix, name: 'Media category' } });
    const unit = await db.unit.create({ data: { code: prefix, name: 'bottle' } });
    const headers = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#169265' } }).png().toBuffer();
    const upload = async (content = bytes, complete = true) => {
      const response = await fetch(`${base}/files/upload-sessions`, { method: 'POST', headers: headers(editor), body: JSON.stringify({ purpose: 'PRODUCT', filename: 'product.png', mimeType: 'image/png', sizeBytes: content.length }) });
      assert.equal(response.status, 201);
      const file = (await response.json() as { data: { id: string; uploadToken: string } }).data;
      assert.equal((await fetch(`${base}/files/${file.id}/content`, { method: 'POST', headers: { authorization: `Bearer ${editor}`, 'content-type': 'application/octet-stream', 'x-upload-token': file.uploadToken }, body: content })).status, 201);
      if (complete) assert.equal((await fetch(`${base}/files/${file.id}/complete`, { method: 'POST', headers: headers(editor) })).status, 201);
      return file.id;
    };
    for (const [token, purpose] of [[storeToken, 'PRODUCT'], [editor, 'PAYMENT']] as const) {
      const response = await fetch(`${base}/files/upload-sessions`, { method: 'POST', headers: headers(token), body: JSON.stringify({ purpose, filename: 'image.png', mimeType: 'image/png', sizeBytes: bytes.length }) });
      assert.equal(response.status, 403);
    }
    const oversized = await fetch(`${base}/files/upload-sessions`, { method: 'POST', headers: headers(editor), body: JSON.stringify({ purpose: 'PRODUCT', filename: 'image.png', mimeType: 'image/png', sizeBytes: 2 * 1024 * 1024 + 1 }) });
    assert.equal(oversized.status, 409);
    const nonSquare = await upload(await sharp({ create: { width: 64, height: 32, channels: 3, background: '#169265' } }).png().toBuffer(), false);
    assert.equal((await fetch(`${base}/files/${nonSquare}/complete`, { method: 'POST', headers: headers(editor) })).status, 409);
    assert.equal((await db.fileObject.findUniqueOrThrow({ where: { id: nonSquare } })).status, 'REJECTED');
    const imageFileId = await upload();
    const input = { sku: `${prefix}SKU`, name: 'Bottled water', defaultSalesPrice: '12', categoryId: category.id, baseUnitId: unit.id, specification: '500 mL', brand: `${prefix}Test brand`, storageCondition: 'AMBIENT', imageFileId };
    const foreign = await fetch(`${base}/products`, { method: 'POST', headers: headers(otherEditor), body: JSON.stringify(input) });
    assert.equal(foreign.status, 409); assert.equal(await db.product.count({ where: { sku: input.sku } }), 0);
    const response = await fetch(`${base}/products`, { method: 'POST', headers: headers(editor), body: JSON.stringify(input) });
    assert.equal(response.status, 201);
    const product = (await response.json() as { data: { id: string; version: number; imageFileId: string; specification: string; imageFile: { id: string } } }).data;
    assert.equal(product.imageFileId, imageFileId); assert.equal(product.specification, '500 mL'); assert.equal(product.imageFile.id, imageFileId);
    const reused = await fetch(`${base}/products`, { method: 'POST', headers: headers(editor), body: JSON.stringify({ ...input, sku: `${prefix}REUSE` }) });
    assert.equal(reused.status, 409);
    const template = await db.orderTemplate.create({ data: { code: prefix, name: 'Media template' } });
    const item = await db.templateItem.create({ data: { templateId: template.id, productId: product.id } });
    await db.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } });
    await db.supplierProduct.create({ data: { supplierId: supplier.id, productId: product.id } });
    for (const token of [storeToken, supplierToken, otherEditor]) {
      const download = await fetch(`${base}/files/${imageFileId}/download`, { headers: headers(token) });
      assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    }
    assert.equal((await fetch(`${base}/files/${imageFileId}/download`, { headers: headers(otherStoreToken) })).status, 404);
    await db.templateItem.update({ where: { id: item.id }, data: { isEnabled: false } });
    assert.equal((await fetch(`${base}/files/${imageFileId}/download`, { headers: headers(storeToken) })).status, 404);
    await db.templateItem.update({ where: { id: item.id }, data: { isEnabled: true } });
    const catalog = await fetch(`${base}/stores/${store.id}/catalog`, { headers: headers(storeToken) });
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json() as { data: { items: Array<{ product: { imageFileId: string; brand: string } }> } }).data.items[0]!.product.imageFileId, imageFileId);
    const contenders = await Promise.all(['first', 'second'].map(brand => fetch(`${base}/products/${product.id}`, { method: 'PATCH', headers: headers(editor), body: JSON.stringify({ expectedVersion: product.version, brand: `${prefix}${brand}` }) })));
    assert.deepEqual(contenders.map(result => result.status).sort(), [200, 409]);
    const current = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(current.specification, '500 mL'); assert.equal(await db.priceVersion.count({ where: { scope: { productId: product.id } } }), 0);
    const cleared = await fetch(`${base}/products/${product.id}`, { method: 'PATCH', headers: headers(editor), body: JSON.stringify({ expectedVersion: current.updatedAt.getTime(), specification: null, brand: '', storageCondition: null, imageFileId: null }) });
    assert.equal(cleared.status, 200);
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).imageFileId, null);
    assert.equal((await fetch(`${base}/files/${imageFileId}/download`, { headers: headers(storeToken) })).status, 404);
    const invalidStorage = await fetch(`${base}/products/${product.id}`, { method: 'PATCH', headers: headers(editor), body: JSON.stringify({ expectedVersion: Date.now(), storageCondition: 'UNSUPPORTED' }) });
    assert.equal(invalidStorage.status, 400);
  } finally {
    await app.close();
    await db.storeTemplateBinding.deleteMany({ where: { template: { code: prefix } } });
    await db.orderTemplate.deleteMany({ where: { code: prefix } });
    await db.supplierProduct.deleteMany({ where: { supplier: { code: prefix } } });
    await db.product.deleteMany({ where: { sku: { startsWith: prefix } } });
    await db.brand.deleteMany({ where: { name: { startsWith: prefix } } });
    const files = await db.fileObject.findMany({ where: { ownerId: { in: users } } });
    for (const file of files) await rm(resolve(process.env.PRIVATE_FILE_DIR ?? 'var/private-files', file.objectKey), { force: true });
    await db.fileObject.deleteMany({ where: { ownerId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.supplier.deleteMany({ where: { code: prefix } });
    await db.store.deleteMany({ where: { code: { startsWith: prefix } } });
    await db.category.deleteMany({ where: { code: prefix } });
    await db.unit.deleteMany({ where: { code: prefix } });
    await db.$disconnect();
  }
});
