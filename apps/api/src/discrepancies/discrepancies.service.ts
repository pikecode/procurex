import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DiscrepancyActionType, DiscrepancyStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import type { Discrepancy } from '../../../../packages/backend/generated/prisma/client.js';
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
};

@Injectable()
export class DiscrepanciesService {
  constructor(private readonly database: DatabaseService) {}

  async resolve(id: string, input: ResolveDiscrepancyInput): Promise<DiscrepancyView> {
    const discrepancy = await this.database.client.discrepancy.findUnique({ where: { id } });
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

    if (input.action !== DiscrepancyActionType.ACCEPT) {
      throw new ConflictException({
        code: 'DISCREPANCY_ACTION_NOT_SUPPORTED',
        message: 'Only ACCEPT discrepancy resolution is supported in this version',
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

      return tx.discrepancy.update({
        where: { id: discrepancy.id },
        data: {
          status: DiscrepancyStatus.RESOLVED,
          resolvedAt: new Date(),
          version: { increment: 1 },
        },
      });
    });

    return toDiscrepancyView(resolved);
  }
}

function toDiscrepancyView(discrepancy: Discrepancy): DiscrepancyView {
  return {
    id: discrepancy.id,
    receiptItemId: discrepancy.receiptItemId,
    orderItemId: discrepancy.orderItemId,
    missingQuantity: discrepancy.missingQuantity.toString(),
    status: discrepancy.status,
    version: discrepancy.version,
    resolvedAt: discrepancy.resolvedAt?.toISOString() ?? null,
    createdAt: discrepancy.createdAt.toISOString(),
  };
}
