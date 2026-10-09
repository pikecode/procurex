import { UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { getOrCreateTraceId } from '../common/request-context.js';
import type { DatabaseService } from '../database/database.service.js';
import type { Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import { AuditService, type RecordAuditInput } from './audit.service.js';

export type MasterDataAuditContext = Pick<RecordAuditInput, 'actorUserId' | 'activeScope' | 'traceId'>;

export function masterDataAuditContext(request: AuthenticatedRequest): MasterDataAuditContext {
  if (!request.auth) throw new UnauthorizedException({ code: 'MISSING_AUTH_TOKEN', message: 'Authentication is required' });
  return { actorUserId: request.auth.user.id,
    activeScope: { roles: request.auth.user.roles, scope: request.auth.user.scope },
    traceId: getOrCreateTraceId(request) };
}

type ResourceResult = { id?: string; templateId?: string; supplierId?: string; version?: number; updatedAt?: Date | string; deleted?: boolean;
  storeIds?: string[]; productIds?: string[]; items?: unknown[]; removedCycleOverrides?: Array<{ storeId: string; supplierId: string; settlementCycle: string }> };

// The audit is part of the existing business transaction; project only non-sensitive result metadata.
export function auditedMasterDataTransaction<T extends ResourceResult>(
  database: DatabaseService, audit: AuditService, context: MasterDataAuditContext | undefined,
  action: string, entityType: string, work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return database.client.$transaction(async tx => {
    const result = await work(tx);
    if (context) {
      const entityId = result.id ?? result.templateId ?? result.supplierId;
      if (!entityId) throw new Error('Master-data audit requires a resource ID');
      await audit.record({ ...context, action, entityType, entityId,
        after: { result: result.deleted ? 'DELETED' : 'SUCCEEDED',
          ...(result.version === undefined && !result.updatedAt ? {} : { version: result.version ?? new Date(result.updatedAt!).getTime() }),
          ...(result.storeIds ? { storeCount: result.storeIds.length } : {}),
          ...(result.productIds ? { productCount: result.productIds.length } : {}),
          ...(result.items ? { itemCount: result.items.length } : {}),
          ...(result.templateId && result.supplierId ? { supplierId: result.supplierId } : {}),
          // Settlement cycle changes payment timing, so record which store/supplier overrides a product removal dropped.
          ...(result.removedCycleOverrides ? { removedCycleOverrides: result.removedCycleOverrides } : {}) } }, tx);
    }
    return result;
  });
}
