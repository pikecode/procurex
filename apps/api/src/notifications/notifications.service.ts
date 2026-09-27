import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

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

  async list(recipientId: string) {
    const rows = await this.database.client.notification.findMany({
      where: { recipientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return {
      unreadCount: rows.filter((row) => row.status === 'UNREAD').length,
      notifications: rows.map(notificationView),
    };
  }

  async markRead(id: string, recipientId: string): Promise<NotificationView | null> {
    const existing = await this.database.client.notification.findFirst({ where: { id, recipientId } });
    if (!existing) return null;
    if (existing.status === 'READ') return notificationView(existing);
    const readAt = new Date();
    const updated = await this.database.client.notification.update({
      where: { id },
      data: { status: 'READ', readAt },
    });
    return notificationView(updated);
  }
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
