import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DiscrepancyActionType,
  DiscrepancyStatus,
  FulfillmentStatus,
  ReplenishmentGapStatus,
  SupplierOrderStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type { Discrepancy, DiscrepancyReturn, ReplenishmentGap } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { resolveSupplierOrderFulfillmentStatus } from '../supplier-orders/fulfillment-status.js';

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
  returnRecord: DiscrepancyReturnView | null;
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

export type DiscrepancyReturnView = {
  id: string;
  discrepancyId: string;
  orderItemId: string;
  quantity: string;
  reason: string | null;
  createdAt: string;
};

@Injectable()
export class DiscrepanciesService {
  constructor(private readonly database: DatabaseService) {}

  async resolve(id: string, input: ResolveDiscrepancyInput): Promise<DiscrepancyView> {
    const discrepancy = await this.database.client.discrepancy.findUnique({
      where: { id },
      include: { replenishmentGap: true, returnRecord: true },
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
      if (input.action === DiscrepancyActionType.RETURN) {
        await tx.discrepancyReturn.create({
          data: {
            discrepancyId: discrepancy.id,
            orderItemId: discrepancy.orderItemId,
            quantity: discrepancy.missingQuantity,
            reason: input.reason,
          },
        });
      }

      const updated = await tx.discrepancy.update({
        where: { id: discrepancy.id },
        data: {
          status: input.action === DiscrepancyActionType.REPLENISH ? DiscrepancyStatus.REPLENISH_PENDING : DiscrepancyStatus.RESOLVED,
          resolvedAt: input.action !== DiscrepancyActionType.REPLENISH ? new Date() : undefined,
          version: { increment: 1 },
        },
        include: { replenishmentGap: true, returnRecord: true },
      });

      const orderItem = await tx.orderItem.findUniqueOrThrow({
        where: { id: discrepancy.orderItemId },
        select: { supplierOrderId: true },
      });
      const orderItems = await tx.orderItem.findMany({
        where: { supplierOrderId: orderItem.supplierOrderId },
        include: {
          shipmentItems: true,
          discrepancies: { include: { replenishmentGap: true } },
        },
      });
      const nextFulfillmentStatus = resolveSupplierOrderFulfillmentStatus(orderItems);
      await tx.supplierOrder.update({
        where: { id: orderItem.supplierOrderId },
        data: {
          fulfillmentStatus: nextFulfillmentStatus,
          status: nextFulfillmentStatus === FulfillmentStatus.COMPLETED ? SupplierOrderStatus.COMPLETED : undefined,
          version: { increment: 1 },
        },
      });

      return updated;
    });

    return toDiscrepancyView(resolved);
  }
}

function toDiscrepancyView(
  discrepancy: Discrepancy & { replenishmentGap?: ReplenishmentGap | null; returnRecord?: DiscrepancyReturn | null },
): DiscrepancyView {
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
    returnRecord: discrepancy.returnRecord ? toDiscrepancyReturnView(discrepancy.returnRecord) : null,
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

function toDiscrepancyReturnView(returnRecord: DiscrepancyReturn): DiscrepancyReturnView {
  return {
    id: returnRecord.id,
    discrepancyId: returnRecord.discrepancyId,
    orderItemId: returnRecord.orderItemId,
    quantity: returnRecord.quantity.toString(),
    reason: returnRecord.reason,
    createdAt: returnRecord.createdAt.toISOString(),
  };
}
