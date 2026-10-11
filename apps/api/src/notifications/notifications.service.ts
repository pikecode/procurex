import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { assignedStoreIds, isCompanyUser, type ScopeUser } from '../auth/store-scope.js';

export type NotificationView = {
  id: string;
  channel: string;
  status: string;
  title: string;
  body: string;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly database: DatabaseService) {}

  async list(recipientId: string, user: ScopeUser) {
    const rows = await this.visibleRows(recipientId, user, 50);
    return {
      unreadCount: rows.filter((row) => row.status === 'UNREAD').length,
      notifications: rows.map(notificationView),
    };
  }

  async markRead(id: string, recipientId: string, user: ScopeUser): Promise<NotificationView | null> {
    const existing = await this.database.client.notification.findFirst({ where: { id, recipientId } });
    if (!existing) return null;
    if (!(await this.filterVisible([existing], user)).length) return null;
    if (existing.status === 'READ') return notificationView(existing);
    const readAt = new Date();
    const updated = await this.database.client.notification.update({
      where: { id, recipientId },
      data: { status: 'READ', readAt },
    });
    return notificationView(updated);
  }

  async markAllRead(recipientId: string, user: ScopeUser): Promise<{ updatedCount: number }> {
    const ids = isCompanyUser(user) ? undefined : (await this.visibleRows(recipientId, user)).map(row => row.id);
    const readAt = new Date();
    const result = await this.database.client.notification.updateMany({
      where: { recipientId, status: 'UNREAD', ...(ids ? { id: { in: ids } } : {}) },
      data: { status: 'READ', readAt },
    });
    return { updatedCount: result.count };
  }

  private async visibleRows(recipientId: string, user: ScopeUser, limit = Infinity) {
    const visible = [];
    let cursor: string | undefined;
    // Scan bounded batches so inaccessible notices do not consume the visible list limit.
    while (visible.length < limit) {
      const rows = await this.database.client.notification.findMany({
        where: { recipientId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      visible.push(...await this.filterVisible(rows, user));
      if (rows.length < 100) break;
      cursor = rows[rows.length - 1]!.id;
    }
    return visible.slice(0, limit);
  }

  private async filterVisible<T extends { payload: unknown }>(rows: T[], user: ScopeUser): Promise<T[]> {
    if (isCompanyUser(user)) return rows;
    const scope = user.scope;
    let where;
    if (user.roles.some(role => ['REGION_MANAGER', 'PURCHASE_FOLLOWER', 'REGION_FINANCE'].includes(role)) && scope?.type === 'MULTI_STORE') {
      where = { storeId: { in: assignedStoreIds(scope) } };
    } else if (user.roles.some(role => ['STORE', 'STORE_FINANCE'].includes(role)) && ['STORE', 'STORE_FINANCE'].includes(scope?.type ?? '') && scope?.storeId) {
      where = { storeId: scope.storeId };
    } else if (user.roles.includes('SUPPLIER') && scope?.type === 'SUPPLIER' && scope.supplierId) {
      where = { supplierId: scope.supplierId };
    } else return [];
    const ids = [...new Set(rows.map(row => notificationOrderId(row.payload)).filter((id): id is string => !!id))];
    if (!ids.length) return [];
    const orders = await this.database.client.supplierOrder.findMany({
      where: { ...where, id: { in: ids } }, select: { id: true },
    });
    const allowed = new Set(orders.map(order => order.id));
    return rows.filter(row => allowed.has(notificationOrderId(row.payload) ?? ''));
  }
}

function notificationOrderId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || !('supplierOrderId' in payload)) return undefined;
  const id = payload.supplierOrderId;
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : undefined;
}

function notificationView(row: {
  id: string;
  channel: string;
  status: string;
  title: string;
  body: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
}): NotificationView {
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    title: row.title,
    body: row.body,
    payload: row.payload,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
