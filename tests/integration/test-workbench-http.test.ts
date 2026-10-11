import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../../packages/domain/src/password.js';

test('test identities preserve administrator audit attribution and enforce live database permissions', async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const prefix = `it_workbench_${Date.now()}`;
  const saved = { enabled: process.env.TEST_WORKBENCH_ENABLED, names: process.env.TEST_WORKBENCH_USERNAMES, environment: process.env.NODE_ENV };
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  const call = (path: string, token?: string, target?: string, method = 'GET', body?: object, key = 'workbench-command') => fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', 'idempotency-key': key, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(target ? { 'x-test-user-id': target } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const login = async (username: string) => {
    const response = await call('/auth/login', undefined, undefined, 'POST', { username, password: 'correct-password', client: 'MINIPROGRAM' });
    assert.equal(response.status, 201); return (await response.json()).data;
  };
  try {
    process.env.NODE_ENV = 'development'; delete process.env.TEST_WORKBENCH_ENABLED;
    const passwordHash = await hashPassword('correct-password');
    const users: Record<string, { id: string; username: string }> = {};
    for (const [suffix, code] of [['admin', 'ADMIN'], ['store', 'STORE'], ['finance', 'STORE_FINANCE'], ['supplier', 'SUPPLIER'], ['buyer', 'PURCHASER'], ['buyer2', 'PURCHASER'], ['hq', 'HQ_FINANCE'], ['unlisted', 'PURCHASER']]) {
      const role = await prisma.role.findUniqueOrThrow({ where: { code } });
      users[suffix!] = await prisma.user.create({ data: { username: `${prefix}_${suffix}`, displayName: `工作台测试${suffix}`, passwordHash, roles: { create: { roleId: role.id } } } });
    }
    const storeA = await prisma.store.create({ data: { code: `${prefix}_a`, name: '工作台测试门店A' } });
    const storeB = await prisma.store.create({ data: { code: `${prefix}_b`, name: '工作台测试门店B' } });
    const supplier = await prisma.supplier.create({ data: { code: prefix, name: '工作台测试供应商', deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY' } });
    for (const name of ['store', 'finance']) await prisma.userScope.create({ data: { userId: users[name]!.id, scopeType: 'STORE', storeId: storeA.id } });
    await prisma.userScope.create({ data: { userId: users.supplier!.id, scopeType: 'SUPPLIER', supplierId: supplier.id } });
    const admin = await login(users.admin!.username), ordinary = await login(users.store!.username);
    assert.equal(admin.user.testWorkbenchEnabled, undefined);
    assert.equal((await call('/auth/test-identities', admin.accessToken)).status, 403);
    assert.equal((await call('/me', admin.accessToken, users.buyer!.id)).status, 403);
    process.env.TEST_WORKBENCH_ENABLED = 'true';
    process.env.TEST_WORKBENCH_USERNAMES = Object.entries(users).filter(([key]) => !['admin', 'unlisted'].includes(key)).map(([, user]) => user.username).join(',');
    assert.equal((await call('/auth/test-identities', ordinary.accessToken)).status, 403);
    assert.equal((await call('/me', ordinary.accessToken, users.buyer!.id)).status, 403);
    assert.equal((await call('/me', admin.accessToken, users.admin!.id)).status, 403);
    assert.equal((await call('/me', admin.accessToken, users.unlisted!.id)).status, 403);
    const available = (await (await call('/auth/test-identities', admin.accessToken)).json()).data;
    assert.equal(available.length, 6);
    assert.ok(available.every((user: object) => !('passwordHash' in user)));
    for (const name of ['store', 'finance', 'supplier', 'buyer', 'hq']) {
      const response = await call('/auth/test-identity', admin.accessToken, undefined, 'POST', { userId: users[name]!.id });
      assert.equal(response.status, 201); const user = (await response.json()).data.user;
      assert.equal(user.id, users[name]!.id); assert.equal(user.actorUserId, users.admin!.id);
      assert.equal(user.testIdentity.userId, users[name]!.id); assert.ok(!user.roles.includes('ADMIN'));
      const me = (await (await call('/me', admin.accessToken, user.id)).json()).data.user;
      assert.deepEqual(me, user);
      assert.equal((await call('/users', admin.accessToken, user.id)).status, 403);
    }
    assert.equal((await call(`/stores/${storeA.id}`, admin.accessToken, users.store!.id)).status, 200);
    assert.equal((await call(`/stores/${storeB.id}`, admin.accessToken, users.store!.id)).status, 403);
    assert.equal((await call('/products', admin.accessToken, users.supplier!.id)).status, 403);
    const template = await prisma.orderTemplate.create({ data: { code: prefix, name: '工作台测试模板' } });
    for (const name of ['buyer', 'buyer2']) {
      const request = await prisma.purchaseRequest.create({ data: { requestNo: `${prefix}_${name}`, storeId: storeA.id, templateId: template.id, status: 'PENDING_PROCUREMENT' } });
      const body = { expectedVersion: request.version, reason: '测试身份审计验证' };
      const response = await call(`/purchase-requests/${request.id}/reject`, admin.accessToken, users[name]!.id, 'POST', body);
      assert.equal(response.status, 201, await response.clone().text());
      assert.equal((await call(`/purchase-requests/${request.id}/reject`, admin.accessToken, users[name]!.id, 'POST', body)).status, 201);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: request.id, actorUserId: users.admin!.id } });
      const scope = audit.activeScope as { roles: string[]; scope: { testUserId: string } };
      assert.deepEqual(scope.roles, ['PURCHASER']); assert.equal(scope.scope.testUserId, users[name]!.id);
    }
    assert.equal(await prisma.commandRecord.count({ where: { actorUserId: users.admin!.id, action: 'purchase-request.reject' } }), 2);
    const collection = await prisma.collectionAccount.create({ data: { name: prefix, bankName: '测试银行', accountName: '测试公司', accountNo: prefix } });
    const proof = await prisma.fileObject.create({ data: { filename: '充值凭证.png', mimeType: 'image/png', sizeBytes: 20n,
      objectKey: prefix, uploadTokenHash: prefix, purpose: 'RECHARGE', status: 'READY', ownerId: users.hq!.id } });
    const recharge = await call(`/stores/${storeA.id}/recharges`, admin.accessToken, users.hq!.id, 'POST',
      { amount: '10.00', businessDate: '2026-10-11', collectionAccountId: collection.id, evidenceFileIds: [proof.id] }, 'recharge-proof');
    assert.equal(recharge.status, 201, await recharge.clone().text());
    const document = (await recharge.json()).data;
    assert.equal((await prisma.fileObject.findUniqueOrThrow({ where: { id: proof.id } })).rechargeId, document.id);
    assert.equal((await prisma.storeAccount.findUniqueOrThrow({ where: { storeId: storeA.id } })).balance.toFixed(2), '10.00');
    assert.equal((await prisma.auditLog.findFirstOrThrow({ where: { entityId: document.id } })).actorUserId, users.admin!.id);
    await prisma.user.update({ where: { id: users.store!.id }, data: { status: 'DISABLED' } });
    assert.equal((await call('/me', admin.accessToken, users.store!.id)).status, 403);
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'HQ_FINANCE' } });
    await prisma.userRole.deleteMany({ where: { userId: users.buyer!.id } });
    await prisma.userRole.create({ data: { userId: users.buyer!.id, roleId: role.id } });
    assert.deepEqual((await (await call('/me', admin.accessToken, users.buyer!.id)).json()).data.user.roles, ['HQ_FINANCE']);
    process.env.NODE_ENV = 'production';
    assert.equal((await call('/auth/test-identities', admin.accessToken)).status, 403);
    assert.equal((await call('/me', admin.accessToken, users.hq!.id)).status, 403);
    process.env.NODE_ENV = 'development';
    await prisma.userSession.updateMany({ where: { userId: users.admin!.id }, data: { revokedAt: new Date() } });
    assert.equal((await call('/me', admin.accessToken, users.hq!.id)).status, 401);
  } finally {
    await app.close();
    for (const [name, value] of [['TEST_WORKBENCH_ENABLED', saved.enabled], ['TEST_WORKBENCH_USERNAMES', saved.names], ['NODE_ENV', saved.environment]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
    await prisma.auditLog.deleteMany({ where: { actor: { username: { startsWith: prefix } } } });
    await prisma.commandRecord.deleteMany({ where: { actor: { username: { startsWith: prefix } } } });
    await prisma.purchaseRequest.deleteMany({ where: { requestNo: { startsWith: prefix } } });
    await prisma.orderTemplate.deleteMany({ where: { code: prefix } });
    await prisma.fileObject.deleteMany({ where: { objectKey: prefix } });
    await prisma.accountLedger.deleteMany({ where: { account: { store: { code: { startsWith: prefix } } } } });
    await prisma.rechargeDocument.deleteMany({ where: { store: { code: { startsWith: prefix } } } });
    await prisma.collectionAccount.deleteMany({ where: { name: prefix } });
    await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await prisma.storeAccount.deleteMany({ where: { store: { code: { startsWith: prefix } } } });
    await prisma.store.deleteMany({ where: { code: { startsWith: prefix } } });
    await prisma.supplier.deleteMany({ where: { code: prefix } });
    await prisma.$disconnect();
  }
});
