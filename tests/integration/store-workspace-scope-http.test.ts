import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../packages/domain/src/password.js';

test('formal Store APIs deny missing/mismatched scopes and foreign orders/catalog/shipments; finance cannot write', async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
  const prefix = `ITSW${Date.now()}`;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  try {
    await app.listen(0, '127.0.0.1'); const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    const stores = await Promise.all(['A', 'B'].map(suffix => db.store.create({ data: { code: `${prefix}${suffix}`, name: suffix } })));
    const supplier = await db.supplier.create({ data: { code: prefix, name: prefix, deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY' } });
    const template = await db.orderTemplate.create({ data: { code: prefix, name: prefix, tag: 'Scope' } });
    const requests = await Promise.all(stores.map(store => db.purchaseRequest.create({ data: { requestNo: `${prefix}${store.code}`, storeId: store.id, templateId: template.id } })));
    const sent = [];
    for (const request of requests) {
      const order = await db.supplierOrder.create({ data: { supplierOrderNo: `${prefix}${request.id}`, requestId: request.id, storeId: request.storeId, supplierId: supplier.id } });
      sent.push(await db.shipment.create({ data: { shipmentNo: `${prefix}${order.id}`, supplierOrderId: order.id, sequence: 1, kind: 'INITIAL' } }));
    }
    for (const roleCode of ['STORE', 'STORE_FINANCE']) {
      const role = await db.role.upsert({ where: { code: roleCode }, update: {}, create: { code: roleCode, name: roleCode } });
      const user = await db.user.create({ data: { username: `${prefix}${roleCode}`, displayName: prefix, passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } } } });
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user.username, password: 'correct-password', client: 'WEB' }) });
      assert.equal(login.status, 201); const token = (await login.json() as any).data.accessToken;
      const call = async (path: string, body?: object) => {
        const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json() as any };
      };
      for (const path of ['/purchase-requests', `/stores/${stores[0]!.id}/catalog`, `/shipments/${sent[0]!.id}`, `/stores/${stores[0]!.id}/account`, `/stores/${stores[0]!.id}/ledgers`, `/stores/${stores[0]!.id}/credit-items`, '/adjustments', `/difference-disposals/${sent[0]!.id}`]) {
        const denied = await call(path); assert.equal(denied.status, 403); assert.equal(denied.body.code, 'SCOPE_REQUIRED');
      }
      await db.userScope.create({ data: { userId: user.id, scopeType: 'SUPPLIER', supplierId: supplier.id } });
      assert.equal((await call('/purchase-requests')).status, 403);
      assert.equal((await call(`/stores/${stores[0]!.id}/account`)).status, 403);
      assert.equal((await call(`/stores/${stores[0]!.id}/ledgers`)).status, 403);
      assert.equal((await call('/adjustments')).status, 403);
      assert.equal((await call(`/difference-disposals/${sent[0]!.id}`)).status, 403);
      await db.userScope.update({ where: { userId: user.id }, data: { scopeType: 'STORE', storeId: stores[0]!.id, supplierId: null } });
      const list = await call('/purchase-requests'); assert.equal(list.status, 200);
      assert.deepEqual(list.body.data.map((item: any) => item.id), [requests[0]!.id]);
      assert.equal((await call(`/purchase-requests/${requests[1]!.id}`)).status, 404);
      assert.equal((await call(`/stores/${stores[1]!.id}/catalog`)).status, 403);
      assert.equal((await call(`/shipments/${sent[0]!.id}`)).status, 200);
      assert.equal((await call(`/shipments/${sent[1]!.id}`)).status, 404);
      assert.equal((await call(`/stores/${stores[0]!.id}/account`)).status, 200);
      assert.equal((await call(`/stores/${stores[0]!.id}/ledgers`)).status, 200);
      assert.equal((await call(`/stores/${stores[1]!.id}/account`)).status, 403);
      assert.equal((await call(`/stores/${stores[1]!.id}/ledgers`)).status, 403);
      assert.equal((await call(`/stores/${stores[0]!.id}/credit-items`)).status, 200);
      assert.equal((await call(`/stores/${stores[1]!.id}/credit-items`)).status, 403);
      if (roleCode === 'STORE_FINANCE') {
        assert.equal((await call('/purchase-requests', { storeId: stores[0]!.id, items: [] })).status, 403);
        assert.equal((await call(`/shipments/${sent[0]!.id}/receipts`, {})).status, 403);
      }
    }
  } finally {
    await app.close();
    await db.userScope.deleteMany({ where: { user: { username: { startsWith: prefix } } } });
    await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await db.shipment.deleteMany({ where: { supplierOrder: { supplier: { code: prefix } } } });
    await db.supplierOrder.deleteMany({ where: { supplier: { code: prefix } } });
    await db.purchaseRequest.deleteMany({ where: { requestNo: { startsWith: prefix } } });
    await db.orderTemplate.deleteMany({ where: { code: prefix } });
    await db.supplier.deleteMany({ where: { code: prefix } });
    await db.store.deleteMany({ where: { code: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
