import { Injectable } from '@nestjs/common';
import type { AuditLog, Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type AuditScope = {
  roles: string[];
  scope?: { type: string; storeId?: string; supplierId?: string };
};

export type RecordAuditInput = {
  actorUserId: string;
  activeScope: AuditScope;
  action: string;
  entityType: string;
  entityId: string;
  traceId: string;
  reason?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
};

export type AuditLogView = {
  id: string;
  actorUserId: string;
  actorName: string;
  activeScope: AuditScope;
  action: string;
  entityType: string;
  entityId: string;
  traceId: string;
  reason: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
};

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async record(input: RecordAuditInput): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        activeScope: input.activeScope,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        traceId: input.traceId,
        reason: input.reason,
        before: input.before === undefined ? undefined : input.before,
        after: input.after === undefined ? undefined : input.after,
      },
    });
  }

  async listRecent(): Promise<AuditLogView[]> {
    const rows = await this.database.client.auditLog.findMany({
      include: { actor: { select: { displayName: true, username: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return rows.map(auditLogView);
  }
}

function auditLogView(row: AuditLog & { actor: { displayName: string; username: string } }): AuditLogView {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    actorName: `${row.actor.displayName} (${row.actor.username})`,
    activeScope: row.activeScope as AuditScope,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    traceId: row.traceId,
    reason: row.reason,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt.toISOString(),
  };
}
