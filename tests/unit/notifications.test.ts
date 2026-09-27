import assert from 'node:assert/strict';
import test from 'node:test';
import { NotificationsService } from '../../apps/api/src/notifications/notifications.service.js';

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
  const result = await service.list('user-1');
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
  assert.equal(await service.markRead('n1', 'other'), null);
  const read = await service.markRead('n1', 'owner');
  assert.equal(read?.status, 'READ');
  assert.ok(read?.readAt);
  assert.equal(updates[0].where.id, 'n1');
});
