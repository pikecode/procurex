import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DiscrepancyActionType,
  DiscrepancyStatus,
  ReplenishmentGapStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type { Discrepancy, ReplenishmentGap } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type ResolveDiscrepancyInput = {
  expectedVersion: number;
  action: DiscrepancyActionType;
  reason?: string;
};

export type DiscrepancyView = {
  id: string;
  receiptItemId: string;
  orderItemId: string;
  missingQuantity: string;
  status: DiscrepancyStatus;
  version: number;
  resolvedAt: string | null;
  createdAt: string;
  replenishmentGap: ReplenishmentGapView | null;
};

export type ReplenishmentGapView = {
  id: string;
  discrepancyId: string;
  orderItemId: string;
  quantity: string;
  remainingQuantity: string;
  status: ReplenishmentGapStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class DiscrepanciesService {
  constructor(private readonly database: DatabaseService) {}

  async resolve(id: string, input: ResolveDiscrepancyInput): Promise<DiscrepancyView> {
    const discrepancy = await this.database.client.discrepancy.findUnique({
      where: { id },
      include: { replenishmentGap: true },
    });
    if (!discrepancy) {
      throw new NotFoundException({
        code: 'DISCREPANCY_NOT_FOUND',
        message: 'Discrepancy was not found',
      });
    }

    if (discrepancy.version !== input.expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Discrepancy version has changed',
        details: { expectedVersion: input.expectedVersion, currentVersion: discrepancy.version },
      });
    }

    if (discrepancy.status === DiscrepancyStatus.RESOLVED) {
      return toDiscrepancyView(discrepancy);
    }

    if (discrepancy.status !== DiscrepancyStatus.OPEN) {
      throw new ConflictException({
        code: 'DISCREPANCY_NOT_RESOLVABLE',
        message: 'Discrepancy cannot be resolved in its current status',
        details: { status: discrepancy.status },
      });
    }

    if (input.action === DiscrepancyActionType.RETURN) {
      throw new ConflictException({
        code: 'DISCREPANCY_ACTION_NOT_SUPPORTED',
        message: 'RETURN discrepancy resolution is not supported in this version',
        details: { action: input.action },
      });
    }

    const resolved = await this.database.client.$transaction(async (tx) => {
      await tx.discrepancyAction.create({
        data: {
          discrepancyId: discrepancy.id,
          action: input.action,
          reason: input.reason,
        },
      });

      if (input.action === DiscrepancyActionType.REPLENISH) {
        await tx.replenishmentGap.create({
          data: {
            discrepancyId: discrepancy.id,
            orderItemId: discrepancy.orderItemId,
            quantity: discrepancy.missingQuantity,
            remainingQuantity: discrepancy.missingQuantity,
          },
        });
      }

      return tx.discrepancy.update({
        where: { id: discrepancy.id },
        data: {
          status: input.action === DiscrepancyActionType.REPLENISH ? DiscrepancyStatus.REPLENISH_PENDING : DiscrepancyStatus.RESOLVED,
          resolvedAt: input.action === DiscrepancyActionType.ACCEPT ? new Date() : undefined,
          version: { increment: 1 },
        },
        include: { replenishmentGap: true },
      });
    });

    return toDiscrepancyView(resolved);
  }
}

function toDiscrepancyView(discrepancy: Discrepancy & { replenishmentGap?: ReplenishmentGap | null }): DiscrepancyView {
  return {
    id: discrepancy.id,
    receiptItemId: discrepancy.receiptItemId,
    orderItemId: discrepancy.orderItemId,
    missingQuantity: discrepancy.missingQuantity.toString(),
    status: discrepancy.status,
    version: discrepancy.version,
    resolvedAt: discrepancy.resolvedAt?.toISOString() ?? null,
    createdAt: discrepancy.createdAt.toISOString(),
    replenishmentGap: discrepancy.replenishmentGap ? toReplenishmentGapView(discrepancy.replenishmentGap) : null,
  };
}

function toReplenishmentGapView(gap: ReplenishmentGap): ReplenishmentGapView {
  return {
    id: gap.id,
    discrepancyId: gap.discrepancyId,
    orderItemId: gap.orderItemId,
    quantity: gap.quantity.toString(),
    remainingQuantity: gap.remainingQuantity.toString(),
    status: gap.status,
    version: gap.version,
    createdAt: gap.createdAt.toISOString(),
    updatedAt: gap.updatedAt.toISOString(),
  };
}
