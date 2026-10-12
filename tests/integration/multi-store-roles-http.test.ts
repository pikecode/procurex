import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../../packages/domain/src/password.js';

test('database assigned roles restrict store reads and revoke sessions on scope changes', async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
  const prefix = `it_multi_${Date.now()}`;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  const call = (path: string, token?: string, method = 'GET', body?: object) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const login = async (username: string) => {
    const response = await call('/auth/login', undefined, 'POST', { username, password: 'correct-password', client: 'web' });
    assert.equal(response.status, 201);
    return (await response.json()).data;
  };
  try {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    await prisma.user.create({ data: { username: `${prefix}_admin`, displayName: '多门店回归管理员', passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } } } });
    const adminToken = (await login(`${prefix}_admin`)).accessToken;
    const stores = [];
    for (const suffix of ['A', 'B', 'C']) stores.push(await prisma.store.create({ data: { code: `${prefix}_${suffix}`, name: `多门店回归${suffix}` } }));
    const [storeA, storeB, storeC] = stores;
    assert.ok(storeA && storeB && storeC);
    const supplier = await prisma.supplier.create({ data: { code: prefix, name: '范围回归供应商', deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY' } });
    const template = await prisma.orderTemplate.create({ data: { code: prefix, name: '范围回归模板' } });
    const shipments = [];
    const requests = [];
    for (const [index, store] of stores.entries()) {
      const request = await prisma.purchaseRequest.create({ data: { requestNo: `${prefix}_PR_${index}`, storeId: store.id, templateId: template.id } });
      requests.push(request);
      const order = await prisma.supplierOrder.create({ data: { supplierOrderNo: `${prefix}_SO_${index}`, requestId: request.id, storeId: store.id, supplierId: supplier.id, settlementMode: 'COMPANY_TERM', settlementCycleSnapshot: 'MONTHLY' } });
      shipments.push(await prisma.shipment.create({ data: { shipmentNo: `${prefix}_SH_${index}`, supplierOrderId: order.id, sequence: 1, kind: 'INITIAL' } }));
      await prisma.adjustmentDocument.create({ data: { supplierOrderId: order.id, storeId: store.id, supplierId: supplier.id, side: 'STORE', amount: '20', sourceRevision: 2, sourcePriceChangeId: randomUUID(), originalPeriodKey: 'MONTHLY:2026-09-01:2026-10-01', settlementPeriodKey: 'MONTHLY:2026-10-01:2026-11-01' } });
      await prisma.adjustmentDocument.create({ data: { supplierOrderId: order.id, storeId: store.id, supplierId: supplier.id, side: 'SUPPLIER', amount: '15', sourceRevision: 2, sourcePriceChangeId: randomUUID(), originalPeriodKey: 'MONTHLY:2026-09-01:2026-10-01', settlementPeriodKey: 'MONTHLY:2026-10-01:2026-11-01' } });
      const direct = await prisma.supplierOrder.create({ data: { supplierOrderNo: `${prefix}_DIRECT_${index}`, requestId: request.id, storeId: store.id, supplierId: supplier.id, settlementMode: 'SUPPLIER_TERM', settlementCycleSnapshot: 'MONTHLY' } });
      await prisma.adjustmentDocument.create({ data: { supplierOrderId: direct.id, storeId: store.id, supplierId: supplier.id, side: 'STORE', amount: '12', sourceRevision: 2, sourcePriceChangeId: randomUUID(), originalPeriodKey: 'MONTHLY:2026-09-01:2026-10-01', settlementPeriodKey: 'MONTHLY:2026-10-01:2026-11-01' } });
    }
    for (const roleCode of ['REGION_MANAGER', 'REGION_FINANCE', 'PURCHASE_FOLLOWER']) {
      const username = `${prefix}_${roleCode}`;
      const created = await call('/users', adminToken, 'POST', { username, displayName: '多门店回归账号', password: 'correct-password', role: roleCode, storeIds: [storeA.id, storeB.id] });
      assert.equal(created.status, 201, await created.clone().text());
      const user = (await created.json()).data;
      const session = await login(username);
      assert.deepEqual([...session.user.scope.storeIds].sort(), [storeA.id, storeB.id].sort());
      const list = await call('/stores', session.accessToken);
      assert.equal(list.status, 200);
      assert.deepEqual((await list.json()).data.map((entry: { id: string }) => entry.id).sort(), [storeA.id, storeB.id].sort());
      for (const index of [0, 1]) {
        assert.equal((await call(`/purchase-requests/${requests[index]!.id}`, session.accessToken)).status, 200);
        assert.equal((await call(`/stores/${stores[index]!.id}`, session.accessToken)).status, 200);
      }
      assert.equal((await call(`/purchase-requests/${requests[2]!.id}`, session.accessToken)).status, 404);
      assert.equal((await call(`/stores/${storeC.id}`, session.accessToken)).status, 403);
      assert.equal((await call(`/stores/${storeC.id}/account`, session.accessToken)).status, 403);
      assert.equal((await call('/products', session.accessToken)).status, 403);
      const statements = await call('/store-statements', session.accessToken);
      assert.equal(statements.status, 200);
      assert.deepEqual((await statements.json()).data.map((entry: { storeId: string }) => entry.storeId).sort(), [storeA.id, storeB.id].sort());
      for (const route of ['/direct-statements', '/supplier-store-statements']) {
        const response = await call(`${route}?supplierId=${supplier.id}`, session.accessToken);
        assert.equal(response.status, 200, await response.clone().text());
        const data = (await response.json()).data;
        assert.deepEqual(data.map((entry: { storeId: string }) => entry.storeId).sort(), [storeA.id, storeB.id].sort());
        assert.equal((await call(`${route}/${data[0].id}`, session.accessToken)).status, 200);
        assert.equal((await call(`${route}?storeId=${storeC.id}`, session.accessToken)).status, 403);
        const allResponse = await call(`${route}?supplierId=${supplier.id}`, adminToken);
        const foreign = (await allResponse.json()).data.find((entry: { storeId: string }) => entry.storeId === storeC.id);
        assert.ok(foreign);
        assert.equal((await call(`${route}/${foreign.id}`, session.accessToken)).status, 403);
        if (route === '/direct-statements') assert.ok(data.every((entry: { adjustmentAmount: string }) => entry.adjustmentAmount === '12.00'));
      }
      assert.equal((await call(`/shipments/${shipments[0]!.id}`, session.accessToken)).status, 200);
      assert.equal((await call(`/shipments/${shipments[2]!.id}`, session.accessToken)).status, 404);
      assert.equal((await call('/reports/order-amounts', session.accessToken)).status, 200);
      assert.equal((await call(`/reports/order-amounts?storeId=${storeC.id}`, session.accessToken)).status, 403);
      const update = await call(`/users/${user.id}`, adminToken, 'PATCH', { expectedVersion: user.version, scope: { type: 'MULTI_STORE', storeIds: [storeA.id] } });
      assert.equal(update.status, 200, await update.clone().text());
      assert.equal((await call('/stores', session.accessToken)).status, 401);
      assert.equal((await call(`/purchase-requests/${requests[1]!.id}`, session.accessToken)).status, 401);
      const fresh = await login(username);
      assert.deepEqual(fresh.user.scope.storeIds, [storeA.id]);
      assert.equal((await call(`/purchase-requests/${requests[0]!.id}`, fresh.accessToken)).status, 200);
      assert.equal((await call(`/purchase-requests/${requests[1]!.id}`, fresh.accessToken)).status, 404);
      assert.equal((await call(`/stores/${storeB.id}`, fresh.accessToken)).status, 403);
      assert.equal((await call(`/shipments/${shipments[1]!.id}`, fresh.accessToken)).status, 404);
    }
  } finally {
    await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
    const orders = await prisma.supplierOrder.findMany({ where: { supplierOrderNo: { startsWith: prefix } }, select: { id: true } });
    const orderIds = orders.map(order => order.id);
    await prisma.adjustmentDocument.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
    await prisma.shipmentRevisionItem.deleteMany({ where: { shipmentItem: { shipment: { supplierOrderId: { in: orderIds } } } } });
    await prisma.shipmentRevision.deleteMany({ where: { shipment: { supplierOrderId: { in: orderIds } } } });
    await prisma.shipmentItem.deleteMany({ where: { shipment: { supplierOrderId: { in: orderIds } } } });
    await prisma.shipment.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
    await prisma.supplierOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.purchaseRequest.deleteMany({ where: { requestNo: { startsWith: prefix } } });
    await prisma.orderTemplate.deleteMany({ where: { code: prefix } });
    await prisma.supplier.deleteMany({ where: { code: prefix } });
    await prisma.store.deleteMany({ where: { code: { startsWith: prefix } } });
    await app.close();
    await prisma.$disconnect();
  }
});
