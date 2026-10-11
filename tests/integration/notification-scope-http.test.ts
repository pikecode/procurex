import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import type { User, Notification } from '../../packages/backend/generated/prisma/client.js';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../../packages/domain/src/password.js';

test('notification HTTP scope follows current database authorization and protects read operations', async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const prefix = `NOTICE_SCOPE_${Date.now()}`;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  try {
    const template = await db.orderTemplate.create({ data: { code: prefix, name: prefix } });
    const supplier = await db.supplier.create({ data: { code: prefix, name: prefix, deliveryMode: 'SELF', defaultSettlementMode: 'CREDIT', defaultSettlementCycle: 'MONTHLY' } });
    const stores = [];
    const orders = [];
    for (const suffix of ['A', 'B', 'C']) {
      const store = await db.store.create({ data: { code: `${prefix}${suffix}`, name: `${prefix}${suffix}` } });
      stores.push(store);
      const request = await db.purchaseRequest.create({ data: { requestNo: `${prefix}${suffix}`, storeId: store.id, templateId: template.id } });
      orders.push(await db.supplierOrder.create({ data: {
        supplierOrderNo: `${prefix}${suffix}`, requestId: request.id, storeId: store.id, supplierId: supplier.id, settlementMode: 'CREDIT',
      } }));
    }
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    const password = 'notice-scope-test-password';
    for (const code of ['REGION_MANAGER', 'PURCHASE_FOLLOWER', 'REGION_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER', 'ADMIN', 'PURCHASER', 'HQ_FINANCE', 'UNKNOWN_NOTICE_ROLE']) {
      const role = await db.role.upsert({ where: { code }, update: {}, create: { code, name: code } });
      const multi = ['REGION_MANAGER', 'PURCHASE_FOLLOWER', 'REGION_FINANCE'].includes(code);
      const user: User = await db.user.create({ data: {
        username: `${prefix}_${code}`, displayName: prefix, passwordHash: await hashPassword(password),
        roles: { create: { roleId: role.id } },
        scopes: { create: {
          scopeType: multi ? 'MULTI_STORE' : code === 'SUPPLIER' ? 'SUPPLIER' : code.startsWith('STORE') ? 'STORE' : 'COMPANY',
          ...(multi ? { stores: { create: stores.slice(0, 2).map(store => ({ storeId: store.id })) } } : {}),
          ...(code.startsWith('STORE') ? { storeId: stores[0]!.id } : {}),
          ...(code === 'SUPPLIER' ? { supplierId: supplier.id } : {}),
        } },
      } });
      const notices: Notification[] = [];
      for (const order of orders) notices.push(await db.notification.create({ data: {
        recipientId: user.id, eventKey: `${prefix}:${order.id}`, title: '待收货', body: '订单提醒',
        payload: { supplierOrderId: order.id, storeId: stores[0]!.id },
      } }));
      const login: Response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: user.username, password, client: 'WEB' }) });
      assert.equal(login.status, 201);
      const token = (await login.json() as any).data.accessToken;
      const call = (path: string, method = 'GET') => fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
      const list = async () => {
        const response = await call('/notifications');
        assert.equal(response.status, 200);
        return (await response.json() as any).data;
      };
      const expected = multi ? 2 : code.startsWith('STORE') ? 1 : code === 'UNKNOWN_NOTICE_ROLE' ? 0 : 3;
      assert.equal((await list()).notifications.length, expected, code);
      if (multi) {
        const scope = await db.userScope.findUniqueOrThrow({ where: { userId: user.id } });
        await db.userScopeStore.deleteMany({ where: { scopeId: scope.id, storeId: stores[1]!.id } });
        assert.equal((await list()).notifications.length, 1, 'authorization shrink hides old messages');
      }
      if (multi || code.startsWith('STORE') || code === 'UNKNOWN_NOTICE_ROLE') {
        assert.equal((await call(`/notifications/${notices[2]!.id}/read`, 'POST')).status, 404);
        const readAll = await call('/notifications/read-all', 'POST');
        assert.equal(readAll.status, 200);
        assert.equal((await readAll.json() as any).data.updatedCount, code === 'UNKNOWN_NOTICE_ROLE' ? 0 : 1);
        assert.equal((await db.notification.findUniqueOrThrow({ where: { id: notices[2]!.id } })).status, 'UNREAD');
      }
    }
  } finally {
    await db.notification.deleteMany({ where: { recipient: { username: { startsWith: prefix } } } });
    await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await db.supplierOrder.deleteMany({ where: { supplierOrderNo: { startsWith: prefix } } });
    await db.purchaseRequest.deleteMany({ where: { requestNo: { startsWith: prefix } } });
    await db.store.deleteMany({ where: { code: { startsWith: prefix } } });
    await db.supplier.deleteMany({ where: { code: prefix } });
    await db.orderTemplate.deleteMany({ where: { code: prefix } });
    await db.role.deleteMany({ where: { code: 'UNKNOWN_NOTICE_ROLE', users: { none: {} } } });
    await app.close();
    await db.$disconnect();
  }
});
