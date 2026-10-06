import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../../packages/domain/src/password.js';
import type { AddressInfo } from 'node:net';

test('store finance: scoped overview, account registry, stale edits and selected-only clearing', async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
  const prefix = `SF${randomUUID().slice(0, 12)}`;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  const tokens = new Map<string, string>();
  try {
    for (const roleCode of ['ADMIN', 'HQ_FINANCE', 'STORE', 'SUPPLIER', 'PURCHASER']) {
      const role = await db.role.upsert({ where: { code: roleCode }, update: {}, create: { code: roleCode, name: roleCode } });
      await db.user.create({ data: { username: `${prefix}${roleCode}`, displayName: '财务验收用户', passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } } } });
      const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: `${prefix}${roleCode}`, password: 'correct-password', client: 'WEB' }) });
      assert.equal(response.status, 201); tokens.set(roleCode, (await response.json()).data.accessToken);
    }
    const call = async (role: string, path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${tokens.get(role)}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    for (const role of ['STORE', 'SUPPLIER', 'PURCHASER']) {
      for (const path of ['/stores/finance-overview', '/collection-accounts']) assert.equal((await call(role, path)).status, 403);
      assert.equal((await call(role, '/collection-accounts', 'POST', {})).status, 403);
    }
    const accountBody = { name: prefix, bankName: '测试银行', accountName: '测试公司', accountNo: '1234567890', status: 'ACTIVE' };
    const collection = await call('HQ_FINANCE', '/collection-accounts', 'POST', accountBody);
    assert.equal(collection.status, 201); const collectionId = collection.body.data.id;
    assert.equal((await call('ADMIN', '/collection-accounts', 'POST', accountBody)).status, 409);
    const edited = await call('HQ_FINANCE', `/collection-accounts/${collectionId}`, 'PATCH', { ...accountBody, expectedVersion: 1, status: 'DISABLED' });
    assert.equal(edited.status, 200);
    assert.equal((await call('HQ_FINANCE', `/collection-accounts/${collectionId}`, 'PATCH', { ...accountBody, expectedVersion: 1 })).status, 409);
    const store = await db.store.create({ data: { code: prefix, name: '门店财务测试门店' } });
    const limit = await call('ADMIN', `/stores/${store.id}/credit-limit`, 'PATCH', { expectedVersion: 0, limit: '100', reason: '初始授权' });
    assert.equal(limit.status, 200);
    assert.equal((await call('ADMIN', `/stores/${store.id}/credit-limit`, 'PATCH', { expectedVersion: 0, limit: '100', reason: '重复授权' })).status, 409);
    for (const id of [collectionId, randomUUID(), 'arbitrary-reference']) {
      assert.equal((await call('HQ_FINANCE', `/stores/${store.id}/recharges`, 'POST', { amount: '10', businessDate: '2026-10-06', collectionAccountId: id })).status, 409);
    }
    assert.equal(await db.rechargeDocument.count({ where: { storeId: store.id } }), 0);
    assert.equal((await call('ADMIN', `/collection-accounts/${collectionId}`, 'PATCH', { ...accountBody, expectedVersion: 2 })).status, 200);
    assert.equal((await call('HQ_FINANCE', `/stores/${store.id}/recharges`, 'POST', { amount: '10', businessDate: '2026-10-06', collectionAccountId: collectionId })).status, 201);
    await db.storeAccount.update({ where: { storeId: store.id }, data: { creditUsed: '50', creditCumulative: '50' } });
    const first = await db.fundingAllocation.create({ data: { storeId: store.id, method: 'CREDIT', targetAmount: '20', creditOutstanding: '20' } });
    const second = await db.fundingAllocation.create({ data: { storeId: store.id, method: 'CREDIT', targetAmount: '30', creditOutstanding: '30' } });
    const items = await call('HQ_FINANCE', `/stores/${store.id}/credit-items`);
    assert.equal(items.status, 200); assert.equal(items.body.data.length, 2);
    assert.ok(items.body.data.every((item: { occurredAt: string; supplierName: string | null }) => Number.isFinite(Date.parse(item.occurredAt)) && item.supplierName === null));
    const clearing = await call('HQ_FINANCE', `/stores/${store.id}/clearings`, 'POST', { businessDate: '2026-10-06', items: [{ fundingAllocationId: first.id, expectedVersion: 1, expectedAmount: '20' }] });
    assert.equal(clearing.status, 201);
    assert.equal((await db.fundingAllocation.findUniqueOrThrow({ where: { id: second.id } })).creditOutstanding.toFixed(2), '30.00');
    const overview = await call('HQ_FINANCE', '/stores/finance-overview');
    assert.equal(overview.status, 200);
    const row = overview.body.data.find((item: { id: string }) => item.id === store.id);
    assert.equal(row.account.balance, '10.00'); assert.equal(row.account.creditUsed, '30.00');
    assert.equal(row.account.creditCumulative, '50.00'); assert.equal(row.account.creditAvailable, '70.00');
    const current = await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
    assert.equal((await call('ADMIN', `/stores/${store.id}/credit-limit`, 'PATCH', { expectedVersion: current.version, limit: '29', reason: '低于未清金额' })).status, 409);
  } finally {
    await app.close();
    const userWhere = { username: { startsWith: prefix } };
    const own = { store: { code: prefix } };
    await db.auditLog.deleteMany({ where: { actor: userWhere } }); await db.commandRecord.deleteMany({ where: { actor: userWhere } });
    await db.creditMovement.deleteMany({ where: { account: own } }); await db.accountLedger.deleteMany({ where: { account: own } });
    await db.clearingItem.deleteMany({ where: { clearing: own } }); await db.clearingDocument.deleteMany({ where: own });
    await db.rechargeDocument.deleteMany({ where: own }); await db.fundingAllocation.deleteMany({ where: { storeId: { in: (await db.store.findMany({ where: { code: prefix } })).map(row => row.id) } } });
    await db.storeAccount.deleteMany({ where: own }); await db.store.deleteMany({ where: { code: prefix } });
    await db.collectionAccount.deleteMany({ where: { name: prefix } });
    await db.userSession.deleteMany({ where: { user: userWhere } }); await db.userRole.deleteMany({ where: { user: userWhere } }); await db.user.deleteMany({ where: userWhere });
    await db.$disconnect();
  }
});
