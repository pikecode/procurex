import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DiscrepancyActionType,
  DiscrepancyStatus,
  FulfillmentStatus,
  ReplenishmentGapStatus,
  SupplierOrderStatus,
  UserScopeType,
  UserStatus,
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

  async resolve(id: string, input: ResolveDiscrepancyInput, scope?: { type: string; supplierId?: string }): Promise<DiscrepancyView> {
    const discrepancy = await this.database.client.discrepancy.findUnique({
      where: {
        id,
        orderItem: scope?.type === 'SUPPLIER' ? { supplierOrder: { supplierId: scope?.supplierId } } : undefined,
      },
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
        select: {
          supplierOrderId: true,
          supplierOrder: { select: { supplierOrderNo: true, storeId: true, supplierId: true } },
        },
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
          completedAt: nextFulfillmentStatus === FulfillmentStatus.COMPLETED ? new Date() : undefined,
          version: { increment: 1 },
        },
      });

      const recipients = await tx.user.findMany({
        where: {
          status: UserStatus.ACTIVE,
          scopes: { some: { scopeType: UserScopeType.STORE, storeId: orderItem.supplierOrder.storeId } },
          roles: { some: { role: { code: { in: ['STORE', 'STORE_FINANCE'] } } } },
        },
        select: { id: true },
      });
      if (recipients.length) {
        const { title, body } = discrepancyResolutionMessage(input.action, orderItem.supplierOrder.supplierOrderNo);
        await tx.notification.createMany({
          data: recipients.map((recipient) => ({
            recipientId: recipient.id,
            eventKey: `DISCREPANCY_RESOLVED:${discrepancy.id}:${input.action}`,
            channel: 'IN_APP',
            title,
            body,
            payload: {
              type: 'DISCREPANCY_RESOLVED',
              action: input.action,
              route: '/main-flow-demo.html',
              supplierOrderId: orderItem.supplierOrderId,
              storeId: orderItem.supplierOrder.storeId,
              supplierId: orderItem.supplierOrder.supplierId,
              discrepancyId: discrepancy.id,
            },
          })),
          skipDuplicates: true,
        });
      }

      return updated;
    });

    return toDiscrepancyView(resolved);
  }
}

function discrepancyResolutionMessage(action: DiscrepancyActionType, supplierOrderNo: string): { title: string; body: string } {
  if (action === DiscrepancyActionType.REPLENISH) {
    return {
      title: '差异已安排补发',
      body: `供应商订单 ${supplierOrderNo} 的收货差异已安排补发，请跟进后续到货。`,
    };
  }
  if (action === DiscrepancyActionType.RETURN) {
    return {
      title: '差异退回待确认',
      body: `供应商订单 ${supplierOrderNo} 的收货差异已退回，请重新核对收货。`,
    };
  }
  return {
    title: '差异已同意少收',
    body: `供应商订单 ${supplierOrderNo} 的收货差异已同意少收，系统将按差异结果继续履约。`,
  };
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
