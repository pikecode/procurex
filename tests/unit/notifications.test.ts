import assert from 'node:assert/strict';
import test from 'node:test';
import { NotificationsService } from '../../apps/api/src/notifications/notifications.service.js';
const companyUser = { roles: ['ADMIN'] };

const orderA = '00000000-0000-4000-8000-000000000001';
const orderB = '00000000-0000-4000-8000-000000000002';
function scopedFixture() {
  const rows = [orderA, orderB].map((id, index) => ({
    id: `n${index}`, channel: 'IN_APP', status: 'UNREAD', title: '待收货', body: '订单',
    payload: { supplierOrderId: id, storeId: 'forged' }, readAt: null, createdAt: new Date(),
  }));
  const updates: any[] = [];
  const orders: any[] = [];
  const service = new NotificationsService({ client: {
    notification: {
      findMany: async () => rows,
      findFirst: async (query: any) => query.where.recipientId === 'owner' ? rows.find(row => row.id === query.where.id) : null,
      update: async (query: any) => { updates.push(query); return { ...rows[0], ...query.data }; },
      updateMany: async (query: any) => { updates.push(query); return { count: query.where.id.in.length }; },
    },
    supplierOrder: { findMany: async (query: any) => {
      orders.push(query);
      const permitted = query.where.supplierId === 'supplierA' || query.where.storeId === 'storeA'
        || query.where.storeId?.in?.includes('storea');
      return permitted && query.where.id.in.includes(orderA) ? [{ id: orderA }] : [];
    } },
  } } as any);
  return { service, updates, orders, rows };
}

test('notifications use current assigned stores, not untrusted payload scope', async () => {
  const { service, updates, orders } = scopedFixture();
  const user = { roles: ['REGION_MANAGER'], scope: { type: 'MULTI_STORE', storeIds: ['storeA'] } };
  assert.deepEqual((await service.list('owner', user)).notifications.map(row => row.id), ['n0']);
  assert.deepEqual(orders[0].where.storeId, { in: ['storea'] });
  assert.equal(await service.markRead('n1', 'owner', user), null);
  assert.equal(await service.markRead('n0', 'other', user), null);
  assert.equal((await service.markAllRead('owner', user)).updatedCount, 1);
  assert.deepEqual(updates[0].where.id, { in: ['n0'] });
  const reduced = { ...user, scope: { type: 'MULTI_STORE', storeIds: ['storeB'] } };
  assert.equal((await service.list('owner', reduced)).notifications.length, 0);
  assert.equal(await service.markRead('n0', 'owner', reduced), null);
});

test('store and supplier notifications preserve their own order access', async () => {
  for (const user of [
    { roles: ['STORE'], scope: { type: 'STORE', storeId: 'storeA' } },
    { roles: ['STORE_FINANCE'], scope: { type: 'STORE_FINANCE', storeId: 'storeA' } },
    { roles: ['SUPPLIER'], scope: { type: 'SUPPLIER', supplierId: 'supplierA' } },
  ]) {
    const { service } = scopedFixture();
    assert.equal((await service.list('owner', user)).unreadCount, 1);
    assert.equal((await service.markRead('n0', 'owner', user))?.status, 'READ');
  }
});

test('unknown roles, missing scope and missing order cannot read notifications', async () => {
  const { service, rows } = scopedFixture();
  for (const user of [{ roles: ['UNKNOWN'] }, { roles: ['STORE'] }, { roles: ['REGION_FINANCE'] }]) {
    assert.equal((await service.list('owner', user)).notifications.length, 0);
    assert.equal(await service.markRead('n0', 'owner', user), null);
    assert.equal((await service.markAllRead('owner', user)).updatedCount, 0);
  }
  rows[0]!.payload.supplierOrderId = 'invalid';
  assert.equal((await service.list('owner', { roles: ['STORE'], scope: { type: 'STORE', storeId: 'storeA' } })).notifications.length, 0);
});

test('notification visibility is filtered before the fifty-row limit', async () => {
  const hidden = Array.from({ length: 100 }, (_, index) => ({ id: `hidden-${index}`, payload: { supplierOrderId: orderB } }));
  const visible = { id: 'visible', channel: 'IN_APP', status: 'UNREAD', title: '', body: '', payload: { supplierOrderId: orderA }, readAt: null, createdAt: new Date() };
  const queries: any[] = [];
  const service = new NotificationsService({ client: {
    notification: { findMany: async (query: any) => { queries.push(query); return query.cursor ? [visible] : hidden; } },
    supplierOrder: { findMany: async (query: any) => query.where.id.in.includes(orderA) ? [{ id: orderA }] : [] },
  } } as any);
  assert.deepEqual((await service.list('owner', { roles: ['PURCHASE_FOLLOWER'], scope: { type: 'MULTI_STORE', storeIds: ['storeA'] } })).notifications.map(row => row.id), ['visible']);
  assert.deepEqual(queries[1].cursor, { id: 'hidden-99' });
});

test('notifications list returns current user messages and unread count', async () => {
  const queries: any[] = [];
  const service = new NotificationsService({ client: { notification: {
    findMany: async (query: any) => {
      queries.push(query);
      return [
        { id: 'n2', channel: 'IN_APP', status: 'READ', title: '已读', body: 'done', payload: { route: '/done' }, readAt: new Date('2026-09-27T01:00:00.000Z'), createdAt: new Date('2026-09-27T00:01:00.000Z') },
        { id: 'n1', channel: 'IN_APP', status: 'UNREAD', title: '待处理', body: 'check', payload: { route: '/orders' }, readAt: null, createdAt: new Date('2026-09-27T00:00:00.000Z') },
      ];
    },
  } } } as any);
  const result = await service.list('user-1', companyUser);
  assert.equal(queries[0].where.recipientId, 'user-1');
  assert.equal(result.unreadCount, 1);
  assert.deepEqual(result.notifications.map((row) => row.id), ['n2', 'n1']);
  const first = result.notifications[0];
  assert.ok(first);
  assert.equal(first.readAt, '2026-09-27T01:00:00.000Z');
});

test('notifications can only be marked read by the recipient', async () => {
  const updates: any[] = [];
  const service = new NotificationsService({ client: { notification: {
    findFirst: async (query: any) => query.where.recipientId === 'owner'
      ? { id: 'n1', channel: 'IN_APP', status: 'UNREAD', title: '待处理', body: 'check', payload: {}, readAt: null, createdAt: new Date('2026-09-27T00:00:00.000Z') }
      : null,
    update: async (query: any) => {
      updates.push(query);
      return { id: 'n1', channel: 'IN_APP', status: 'READ', title: '待处理', body: 'check', payload: {}, readAt: query.data.readAt, createdAt: new Date('2026-09-27T00:00:00.000Z') };
    },
  } } } as any);
  assert.equal(await service.markRead('n1', 'other', companyUser), null);
  const read = await service.markRead('n1', 'owner', companyUser);
  assert.equal(read?.status, 'READ');
  assert.ok(read?.readAt);
  assert.equal(updates[0].where.id, 'n1');
});

test('notifications can mark all unread messages read for the recipient only', async () => {
  const updates: any[] = [];
  const service = new NotificationsService({ client: { notification: {
    updateMany: async (query: any) => {
      updates.push(query);
      return { count: 3 };
    },
  } } } as any);
  const result = await service.markAllRead('owner', companyUser);
  assert.equal(result.updatedCount, 3);
  assert.equal(updates[0].where.recipientId, 'owner');
  assert.equal(updates[0].where.status, 'UNREAD');
  assert.equal(updates[0].data.status, 'READ');
  assert.ok(updates[0].data.readAt instanceof Date);
});
