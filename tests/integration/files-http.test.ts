import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../packages/domain/src/password.js';
import { DeliveryMode, SettlementMode } from '../../packages/backend/generated/prisma/enums.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });

test('private payment evidence uploads, completes and downloads only for its owner', async () => {
  const suffix = Date.now();
  const username = `it_file_${suffix}`;
  const [role, supplierRole] = await Promise.all([
    prisma.role.upsert({ where: { code: 'STORE' }, update: {}, create: { code: 'STORE', name: 'Store' } }),
    prisma.role.upsert({ where: { code: 'SUPPLIER' }, update: {}, create: { code: 'SUPPLIER', name: 'Supplier' } }),
  ]);
  const supplier = await prisma.supplier.create({ data: { code: `ITFILE${suffix}`, name: 'Evidence supplier', deliveryMode: DeliveryMode.SELF, defaultSettlementMode: SettlementMode.SUPPLIER_TERM, defaultSettlementCycle: 'MONTHLY' } });
  const otherSupplier = await prisma.supplier.create({ data: { code: `ITFILEOTHER${suffix}`, name: 'Other evidence supplier', deliveryMode: DeliveryMode.SELF, defaultSettlementMode: SettlementMode.SUPPLIER_TERM, defaultSettlementCycle: 'MONTHLY' } });
  const user = await prisma.user.create({ data: { username, displayName: username, passwordHash: await hashPassword('correct-password'), roles: { create: [{ roleId: role.id }] } } });
  const supplierUsername = `it_file_supplier_${suffix}`;
  const supplierUser = await prisma.user.create({ data: { username: supplierUsername, displayName: supplierUsername, passwordHash: await hashPassword('correct-password'), roles: { create: [{ roleId: supplierRole.id }] }, scopes: { create: { scopeType: 'SUPPLIER', supplierId: supplier.id } } } });
  const app: INestApplication = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  try {
    await app.listen(0, '127.0.0.1');
    const url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    const login = await fetch(`${url}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-password', client: 'web' }) });
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
    const sessionResponse = await fetch(`${url}/files/upload-sessions`, { method: 'POST', headers, body: JSON.stringify({ purpose: 'PAYMENT', filename: 'proof.jpg', mimeType: 'image/jpeg', sizeBytes: bytes.length }) });
    assert.equal(sessionResponse.status, 201);
    const session = ((await sessionResponse.json()) as { data: { id: string; uploadToken: string } }).data;
    const uploaded = await fetch(`${url}/files/${session.id}/content`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-upload-token': session.uploadToken }, body: bytes });
    assert.equal(uploaded.status, 201);
    const complete = await fetch(`${url}/files/${session.id}/complete`, { method: 'POST', headers });
    assert.equal(complete.status, 201);
    assert.equal(((await complete.json()) as { data: { status: string } }).data.status, 'READY');
    const download = await fetch(`${url}/files/${session.id}/download`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    const stored = await prisma.fileObject.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(stored.status, 'READY');
    assert.equal(stored.checksum?.length, 64);
    const payment = await prisma.paymentRecord.create({ data: { paymentNo: `ITFILEPAY${suffix}`, direction: 'COMPANY_TO_SUPPLIER', supplierId: supplier.id, amount: '5.00', businessDate: new Date('2026-09-27') } });
    await prisma.fileObject.update({ where: { id: session.id }, data: { paymentId: payment.id } });
    const supplierLogin = await fetch(`${url}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: supplierUsername, password: 'correct-password', client: 'web' }) });
    const supplierToken = ((await supplierLogin.json()) as { data: { accessToken: string } }).data.accessToken;
    const supplierDownload = await fetch(`${url}/files/${session.id}/download`, { headers: { authorization: `Bearer ${supplierToken}` } });
    assert.equal(supplierDownload.status, 200);
    assert.deepEqual(Buffer.from(await supplierDownload.arrayBuffer()), bytes);
    const otherSupplierUsername = `it_file_other_supplier_${suffix}`;
    const otherSupplierUser = await prisma.user.create({ data: { username: otherSupplierUsername, displayName: otherSupplierUsername, passwordHash: await hashPassword('correct-password'), roles: { create: [{ roleId: supplierRole.id }] }, scopes: { create: { scopeType: 'SUPPLIER', supplierId: otherSupplier.id } } } });
    const otherLogin = await fetch(`${url}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: otherSupplierUsername, password: 'correct-password', client: 'web' }) });
    const otherToken = ((await otherLogin.json()) as { data: { accessToken: string } }).data.accessToken;
    const deniedDownload = await fetch(`${url}/files/${session.id}/download`, { headers: { authorization: `Bearer ${otherToken}` } });
    assert.equal(deniedDownload.status, 404);
    await prisma.user.delete({ where: { id: otherSupplierUser.id } });
    await prisma.paymentRecord.delete({ where: { id: payment.id } });
  } finally {
    await app.close();
    const file = await prisma.fileObject.findFirst({ where: { ownerId: user.id } });
    if (file) await rm(join(resolve(process.env.PRIVATE_FILE_DIR ?? 'var/private-files'), file.objectKey), { force: true });
    await prisma.fileObject.deleteMany({ where: { ownerId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.user.delete({ where: { id: supplierUser.id } });
    await prisma.supplier.delete({ where: { id: supplier.id } });
    await prisma.supplier.delete({ where: { id: otherSupplier.id } });
    await prisma.$disconnect();
  }
});
