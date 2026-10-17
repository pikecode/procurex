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
import type { Discrepancy, DiscrepancyReturn, ReplenishmentGap, Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { adjustAcceptedShortage } from './shortage-financials.js';
import { lockFundingRequest, synchronizeRequestFunding } from '../purchase-requests/request-funding.js';
import { applyEffectiveOrderPrices, lockPricePublication } from '../pricing/price-checkpoint.js';
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
  productName?: string;
  supplierOrderId?: string;
  supplierOrderNo?: string;
  deliveryState?: string | null;
  shipmentNo?: string;
  shippedQuantity?: string;
  receivedQuantity?: string;
  evidenceFiles?: Array<{ id: string; filename: string; mimeType: string; sizeBytes: string }>;
};

export type ReplenishmentGapView = {
  id: string;
  discrepancyId: string | null;
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

  async list(scope?: { type: string; supplierId?: string; storeId?: string }) {
    const rows = await this.database.client.discrepancy.findMany({
      where: { OR: [
        { status: DiscrepancyStatus.OPEN },
        { status: DiscrepancyStatus.REPLENISH_PENDING, replenishmentGap: { remainingQuantity: { gt: 0 } } },
      ],
        orderItem: { supplierOrder: { deliveryState: null,
          ...(scope?.type === 'SUPPLIER' ? { supplierId: scope.supplierId } : {}),
          ...(scope?.type === 'STORE' ? { storeId: scope.storeId } : {}) } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, status: true, version: true, missingQuantity: true, orderItem: { select: { product: { select: { name: true } }, supplierOrder: { select: { supplierOrderNo: true } } } } },
    });
    return rows.map(row => ({ id: row.id, status: row.status, version: row.version, missingQuantity: row.missingQuantity.toString(), productName: row.orderItem.product.name, supplierOrderNo: row.orderItem.supplierOrder.supplierOrderNo }));
  }

  async get(id: string, scope?: { type: string; supplierId?: string; storeId?: string }): Promise<DiscrepancyView> {
    const discrepancy = await this.database.client.discrepancy.findUnique({
      where: {
        id,
        orderItem: scope?.type === 'SUPPLIER' ? { supplierOrder: { supplierId: scope?.supplierId } } : scope?.type === 'STORE' ? { supplierOrder: { storeId: scope.storeId } } : undefined,
      },
      include: {
        replenishmentGap: true, returnRecord: true,
        orderItem: { include: { product: { select: { name: true } }, supplierOrder: { select: { id: true, supplierOrderNo: true, deliveryState: true } } } },
        receiptItem: { include: { receipt: { include: { evidenceFiles: true } }, shipmentItem: { include: { shipment: { select: { shipmentNo: true } } } } } },
      },
    });
    if (!discrepancy) {
      throw new NotFoundException({
        code: 'DISCREPANCY_NOT_FOUND',
        message: 'Discrepancy was not found',
      });
    }

    return { ...toDiscrepancyView(discrepancy), productName: discrepancy.orderItem.product.name,
      deliveryState: discrepancy.orderItem.supplierOrder.deliveryState,
      supplierOrderId: discrepancy.orderItem.supplierOrder.id, supplierOrderNo: discrepancy.orderItem.supplierOrder.supplierOrderNo,
      shipmentNo: discrepancy.receiptItem.shipmentItem.shipment.shipmentNo,
      evidenceFiles: discrepancy.receiptItem.receipt.evidenceFiles.map(file => ({ id: file.id, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes.toString() })),
      shippedQuantity: discrepancy.receiptItem.shipmentItem.quantity.toString(), receivedQuantity: discrepancy.receiptItem.receivedQuantity.toString() };
  }

  async resolve(id: string, input: ResolveDiscrepancyInput, scope?: { type: string; supplierId?: string; storeId?: string }, transaction?: Prisma.TransactionClient): Promise<DiscrepancyView> {
    const discrepancy = await this.database.client.discrepancy.findUnique({
      where: {
        id,
        orderItem: scope?.type === 'SUPPLIER' ? { supplierOrder: { supplierId: scope?.supplierId } } : scope?.type === 'STORE' ? { supplierOrder: { storeId: scope.storeId } } : undefined,
      },
      include: { replenishmentGap: true, returnRecord: true, receiptItem: { include: { shipmentItem: { include: { shipment: true } } } } },
    });
    if (!discrepancy) {
      throw new NotFoundException({
        code: 'DISCREPANCY_NOT_FOUND',
        message: 'Discrepancy was not found',
      });
    }

    if (scope?.type === 'SUPPLIER' && input.action !== DiscrepancyActionType.RETURN) {
      throw new ConflictException({ code: 'DISCREPANCY_ACTION_FORBIDDEN', message: '供应商只能退回收货差异供门店重新核对' });
    }
    if (scope?.type === 'STORE' && !['REPLENISH', 'ACCEPT'].includes(input.action)) {
      throw new ConflictException({ code: 'DISCREPANCY_ACTION_FORBIDDEN', message: '门店只能选择授权补发或按实收结算' });
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

    const execute = async (tx: Prisma.TransactionClient) => {
      await lockPricePublication(tx);
      const order = await tx.orderItem.findUniqueOrThrow({ where: { id: discrepancy.orderItemId }, select: { supplierOrderId: true, supplierOrder: { select: { storeId: true, requestId: true } } } });
      await lockFundingRequest(tx, order.supplierOrder.storeId, order.supplierOrder.requestId);
      const settlementIds = ['DIRECT', 'STORE_RECEIVABLE', 'SUPPLIER_PAYABLE'].map(kind => Buffer.from(JSON.stringify({ kind, supplierOrderId: order.supplierOrderId })).toString('base64url')).sort();
      for (const settlementId of settlementIds) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${settlementId}::text, 0))`;
      await tx.$queryRaw`SELECT id FROM "SupplierOrder" WHERE id = ${order.supplierOrderId}::uuid FOR UPDATE`;
      const current = await tx.discrepancy.findUniqueOrThrow({ where: { id } });
      if (current.version !== input.expectedVersion || current.status !== DiscrepancyStatus.OPEN) {
        throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Discrepancy changed during resolution' });
      }
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
          supplierOrder: { select: { supplierOrderNo: true, storeId: true, supplierId: true, requestId: true } },
        },
      });
      const orderItems = await tx.orderItem.findMany({
        where: { supplierOrderId: orderItem.supplierOrderId },
        include: {
          shipmentItems: true,
          discrepancies: { include: { replenishmentGap: true, returnRecord: true } },
        },
      });
      const deliveryOrder = await tx.supplierOrder.findUniqueOrThrow({ where: { id: orderItem.supplierOrderId } });
      if (deliveryOrder.deliveryState) throw new ConflictException({ code: 'ORDER_CONFIRMATION_REQUIRED', message: '请在订单详情处理异常，双方确认后才能完成订单' });
      const nextFulfillmentStatus = resolveSupplierOrderFulfillmentStatus(orderItems);
      if (input.action === DiscrepancyActionType.ACCEPT) await adjustAcceptedShortage(tx, discrepancy.id, discrepancy.orderItemId);
      if (nextFulfillmentStatus === FulfillmentStatus.COMPLETED) {
        const completingOrder = await tx.supplierOrder.findUniqueOrThrow({ where: { id: orderItem.supplierOrderId } });
        if (completingOrder.firstShippedAt) {
          const repriced = await applyEffectiveOrderPrices(tx, completingOrder.id, completingOrder.firstShippedAt, { deferCreditShortfall: true });
          if (repriced.changed && !repriced.fundingHandled) await synchronizeRequestFunding(tx, completingOrder.requestId, { sourceId: discrepancy.id, deferCreditShortfall: true });
        }
      }
      await tx.supplierOrder.update({
        where: { id: orderItem.supplierOrderId },
        data: {
          fulfillmentStatus: nextFulfillmentStatus,
          status: nextFulfillmentStatus === FulfillmentStatus.COMPLETED ? SupplierOrderStatus.COMPLETED : undefined,
          completedAt: nextFulfillmentStatus === FulfillmentStatus.COMPLETED ? new Date() : undefined,
          version: { increment: 1 },
        },
      });

      const fundingRequest = await tx.purchaseRequest.findUniqueOrThrow({ where: { id: orderItem.supplierOrder.requestId } });
      if (fundingRequest.storedValueOnReceipt) await synchronizeRequestFunding(tx, fundingRequest.id, { requireFull: true, sourceId: discrepancy.id, deferCreditShortfall: true });

      const notifySupplier = scope?.type === 'STORE';
      const recipients = await tx.user.findMany({
        where: {
          status: UserStatus.ACTIVE,
          scopes: { some: notifySupplier
            ? { scopeType: UserScopeType.SUPPLIER, supplierId: orderItem.supplierOrder.supplierId }
            : { scopeType: UserScopeType.STORE, storeId: orderItem.supplierOrder.storeId } },
          roles: { some: { role: { code: notifySupplier ? 'SUPPLIER' : { in: ['STORE', 'STORE_FINANCE'] } } } },
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
              shipmentId: discrepancy.receiptItem.shipmentItem.shipmentId,
              shipmentNo: discrepancy.receiptItem.shipmentItem.shipment.shipmentNo,
            },
          })),
          skipDuplicates: true,
        });
      }

      return updated;
    };
    const resolved = transaction ? await execute(transaction) : await this.database.client.$transaction(execute);
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
