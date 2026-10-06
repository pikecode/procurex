import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { readUnitSnapshot } from '../catalog/transaction-units.js';
import {
  DiscrepancyStatus,
  FulfillmentStatus,
  SupplierOrderStatus,
  UserScopeType,
  UserStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type { FileObject, Prisma, Receipt, ReceiptItem, Shipment, ShipmentItem, SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { resolveSupplierOrderFulfillmentStatus } from '../supplier-orders/fulfillment-status.js';
import { lockFundingRequest, synchronizeRequestFunding } from '../purchase-requests/request-funding.js';
import { applyEffectiveOrderPrices, lockPricePublication } from '../pricing/price-checkpoint.js';

export type CreateReceiptInput = {
  expectedOrderVersion: number;
  expectedReceiptRevision: number;
  items: ReceiptItemInput[];
  evidenceFileIds?: string[];
};

export type ReceiptItemInput = {
  shipmentItemId: string;
  receivedQuantity: string;
};

export type ReceiptView = {
  id: string;
  receiptNo: string;
  shipmentId: string;
  revision: number;
  isCurrent: boolean;
  submittedAt: string;
  items: ReceiptItemView[];
  evidenceFiles: ReceiptEvidenceView[];
};

type ReceiptEvidenceView = { id: string; filename: string; mimeType: string; sizeBytes: string };

export type ReceiptItemView = {
  id: string;
  shipmentItemId: string;
  receivedQuantity: string;
};

export type ShipmentDetailView = {
  id: string;
  shipmentNo: string;
  supplierOrderId: string;
  supplierOrderNo: string;
  supplierOrderVersion: number;
  kind: string;
  shippedAt: string;
  trackingNo: string | null;
  currentReceiptRevision: number;
  evidenceFiles: ReceiptEvidenceView[];
  items: ShipmentDetailItemView[];
};

export type ShipmentDetailItemView = {
  unitName: string | null;
  id: string;
  orderItemId: string;
  productId: string;
  productName: string;
  shippedQuantity: string;
  currentReceivedQuantity: string | null;
  receiptLocked: boolean;
  salesPriceSnapshot: string;
  supplyPriceSnapshot: string;
};

@Injectable()
export class ShipmentsService {
  constructor(private readonly database: DatabaseService) {}

  async get(id: string, scope?: { type: string; storeId?: string }): Promise<ShipmentDetailView> {
    const shipment = await this.database.client.shipment.findUnique({
      where: {
        id,
        supplierOrder: scope?.type === 'STORE' || scope?.type === 'STORE_FINANCE' ? { storeId: scope?.storeId } : undefined,
      },
      include: {
        supplierOrder: true,
        items: { include: { orderItem: { include: { product: true } }, receiptItems: { include: { discrepancy: { include: { returnRecord: true } } } } }, orderBy: { createdAt: 'asc' } },
        receipts: {
          where: { isCurrent: true },
          orderBy: { revision: 'desc' },
          take: 1,
          include: { items: true, evidenceFiles: true },
        },
      },
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: 'Shipment was not found',
      });
    }

    return toShipmentDetailView(shipment);
  }

  async createReceipt(shipmentId: string, input: CreateReceiptInput, scope?: { type: string; storeId?: string }, actorUserId?: string, transaction?: Prisma.TransactionClient): Promise<ReceiptView> {
    const shipment = await this.database.client.shipment.findUnique({
      where: {
        id: shipmentId,
        supplierOrder: scope?.type === 'STORE' || scope?.type === 'STORE_FINANCE' ? { storeId: scope?.storeId } : undefined,
      },
      include: {
        supplierOrder: { include: { items: { include: { shipmentItems: true } } } },
        items: { orderBy: { createdAt: 'asc' }, include: { receiptItems: { include: { discrepancy: { include: { returnRecord: true } } } } } },
        receipts: {
          where: { isCurrent: true },
          include: { items: { include: { discrepancy: true } } },
          orderBy: { revision: 'desc' },
        },
      },
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: 'Shipment was not found',
      });
    }

    if (shipment.supplierOrder.version !== input.expectedOrderVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Supplier order version has changed',
        details: { expectedVersion: input.expectedOrderVersion, currentVersion: shipment.supplierOrder.version },
      });
    }

    const currentReceipt = shipment.receipts[0];
    const currentRevision = currentReceipt?.revision ?? 0;
    if (input.expectedReceiptRevision !== currentRevision) {
      throw new ConflictException({
        code: 'RECEIPT_REVISION_CONFLICT',
        message: 'Receipt revision has changed',
        details: { expectedReceiptRevision: input.expectedReceiptRevision, currentRevision },
      });
    }
    if (currentReceipt && shipment.items.every(item => isReceiptItemLocked(item.receiptItems))) {
      throw new ConflictException({
        code: 'RECEIPT_REVISION_NOT_REPLACEABLE',
        message: 'Receipt has no open or returned discrepancies to revise',
      });
    }

    const shipmentItemsById = new Map(shipment.items.map((item) => [item.id, item]));
    const inputIds = new Set(input.items.map((item) => item.shipmentItemId));
    if (inputIds.size !== input.items.length || inputIds.size !== shipment.items.length) {
      throw new ConflictException({
        code: 'INVALID_RECEIPT_ITEMS',
        message: 'Receipt items must cover each shipment item exactly once',
      });
    }

    for (const shipmentItem of shipment.items) {
      if (!inputIds.has(shipmentItem.id)) {
        throw new ConflictException({
          code: 'INVALID_RECEIPT_ITEMS',
          message: 'Receipt items must cover each shipment item exactly once',
          details: { shipmentItemId: shipmentItem.id },
        });
      }
    }

    const receiptItems = input.items.map((item) => {
      const shipmentItem = shipmentItemsById.get(item.shipmentItemId);
      if (!shipmentItem) {
        throw new ConflictException({
          code: 'SHIPMENT_ITEM_NOT_FOUND',
          message: 'Receipt item does not belong to the shipment',
          details: { shipmentItemId: item.shipmentItemId },
        });
      }

      const receivedQuantity = new Decimal(item.receivedQuantity);
      if (receivedQuantity.lt(0) || receivedQuantity.gt(shipmentItem.quantity)) {
        throw new ConflictException({
          code: 'INVALID_RECEIVED_QUANTITY',
          message: 'Received quantity must be between zero and shipped quantity',
          details: { shipmentItemId: shipmentItem.id, shippedQuantity: shipmentItem.quantity.toString() },
        });
      }

      const receiptLocked = Boolean(currentReceipt) && isReceiptItemLocked(shipmentItem.receiptItems);
      const previous = currentReceipt?.items.find(item => item.shipmentItemId === shipmentItem.id);
      if (receiptLocked && (!previous || !receivedQuantity.eq(previous.receivedQuantity))) {
        throw new ConflictException({ code: 'RECEIPT_REVISION_NOT_REPLACEABLE', message: 'Resolved or replenishment receipt quantities cannot be changed', details: { shipmentItemId: shipmentItem.id } });
      }
      return { shipmentItem, receivedQuantity, receiptLocked };
    });

    const execute = async (tx: Prisma.TransactionClient) => {
      await lockPricePublication(tx);
      await lockFundingRequest(tx, shipment.supplierOrder.storeId, shipment.supplierOrder.requestId);
      const lockedOrder = await tx.supplierOrder.findUniqueOrThrow({ where: { id: shipment.supplierOrderId } });
      if (lockedOrder.version !== input.expectedOrderVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Supplier order changed before receipt submission' });
      if (input.evidenceFileIds !== undefined) {
        if (!actorUserId || input.evidenceFileIds.length < 1 || input.evidenceFileIds.length > 6 || new Set(input.evidenceFileIds).size !== input.evidenceFileIds.length) {
          throw new ConflictException({ code: 'RECEIPT_EVIDENCE_INVALID', message: 'Provide one to six completed receipt images owned by the current user' });
        }
      }
      if (currentReceipt) {
        await tx.receipt.update({
          where: { id: currentReceipt.id },
          data: { isCurrent: false },
        });
        await tx.discrepancy.updateMany({
          where: {
            receiptItem: { shipmentItemId: { in: receiptItems.filter(item => !item.receiptLocked).map(item => item.shipmentItem.id) } },
            OR: [{ status: DiscrepancyStatus.OPEN }, { status: DiscrepancyStatus.RESOLVED, returnRecord: { isNot: null } }],
          },
          data: { status: DiscrepancyStatus.SUPERSEDED },
        });
      }
      const oldReceiptItemsByShipmentItemId = new Map(
        currentReceipt?.items.map((item) => [item.shipmentItemId, item]) ?? [],
      );
      const created = await tx.receipt.create({
        data: {
          receiptNo: makeReceiptNo(),
          shipmentId: shipment.id,
          revision: currentRevision + 1,
        },
      });
      if (input.evidenceFileIds?.length) {
        const attached = await tx.fileObject.updateMany({
          where: { id: { in: input.evidenceFileIds }, ownerId: actorUserId, purpose: 'RECEIPT', status: 'READY', mimeType: { in: ['image/jpeg', 'image/png'] }, receiptId: null, paymentId: null },
          data: { receiptId: created.id },
        });
        if (attached.count !== input.evidenceFileIds.length) throw new ConflictException({ code: 'RECEIPT_EVIDENCE_INVALID', message: 'Receipt images are unavailable, incomplete, already linked or owned by another user' });
      }

      const discrepancyIds: string[] = [];
      for (const item of receiptItems) {
        const createdReceiptItem = await tx.receiptItem.create({
          data: {
            receiptId: created.id,
            shipmentItemId: item.shipmentItem.id,
            receivedQuantity: item.receivedQuantity.toDecimalPlaces(6).toString(),
          },
        });
        const missingQuantity = new Decimal(item.shipmentItem.quantity).minus(item.receivedQuantity);
        if (missingQuantity.gt(0) && !item.receiptLocked) {
          const discrepancy = await tx.discrepancy.create({
            data: {
              receiptItemId: createdReceiptItem.id,
              orderItemId: item.shipmentItem.orderItemId,
              missingQuantity: missingQuantity.toDecimalPlaces(6).toString(),
            },
          });
          discrepancyIds.push(discrepancy.id);
        }
        const oldReceivedQuantity = oldReceiptItemsByShipmentItemId.get(item.shipmentItem.id)?.receivedQuantity ?? new Decimal(0);
        const receivedDelta = item.receivedQuantity.minus(oldReceivedQuantity);
        await tx.orderItem.update({
          where: { id: item.shipmentItem.orderItemId },
          data: {
            receivedQuantity: { increment: receivedDelta.toDecimalPlaces(6).toString() },
          },
        });
      }

      const orderItems = await tx.orderItem.findMany({
        where: { supplierOrderId: shipment.supplierOrderId },
        include: {
          shipmentItems: true,
          discrepancies: { include: { replenishmentGap: true, returnRecord: true } },
        },
      });
      const nextFulfillmentStatus = resolveSupplierOrderFulfillmentStatus(orderItems);
      if (nextFulfillmentStatus === FulfillmentStatus.COMPLETED && lockedOrder.firstShippedAt) {
        const repriced = await applyEffectiveOrderPrices(tx, lockedOrder.id, lockedOrder.firstShippedAt, { deferCreditShortfall: true });
        if (repriced.changed && !repriced.fundingHandled) await synchronizeRequestFunding(tx, lockedOrder.requestId, { sourceId: created.id, deferCreditShortfall: true });
      }
      await tx.supplierOrder.update({
        where: { id: shipment.supplierOrderId },
        data: {
          fulfillmentStatus: nextFulfillmentStatus,
          status: nextFulfillmentStatus === FulfillmentStatus.COMPLETED ? SupplierOrderStatus.COMPLETED : SupplierOrderStatus.PARTIAL_SHIPPED,
          completedAt: nextFulfillmentStatus === FulfillmentStatus.COMPLETED ? new Date() : null,
          version: { increment: 1 },
        },
      });
      const fundingRequest = await tx.purchaseRequest.findUniqueOrThrow({ where: { id: lockedOrder.requestId } });
      if (fundingRequest.storedValueOnReceipt) await synchronizeRequestFunding(tx, lockedOrder.requestId, { requireFull: true, sourceId: created.id, deferCreditShortfall: true });

      if (discrepancyIds.length) {
        const recipients = await tx.user.findMany({
          where: {
            status: UserStatus.ACTIVE,
            scopes: { some: { scopeType: UserScopeType.SUPPLIER, supplierId: shipment.supplierOrder.supplierId } },
            roles: { some: { role: { code: 'SUPPLIER' } } },
          },
          select: { id: true },
        });
        if (recipients.length) {
          await tx.notification.createMany({
            data: recipients.map((recipient) => ({
              recipientId: recipient.id,
              eventKey: `RECEIPT_DISCREPANCY:${created.id}`,
              channel: 'IN_APP',
              title: '收货差异待处理',
              body: `供应商订单 ${shipment.supplierOrder.supplierOrderNo} 收货存在差异，请处理。`,
              payload: {
                type: 'RECEIPT_DISCREPANCY',
                route: '/main-flow-demo.html',
                supplierOrderId: shipment.supplierOrderId,
                shipmentId: shipment.id,
                receiptId: created.id,
                discrepancyIds,
              },
            })),
            skipDuplicates: true,
          });
        }
      }

      return tx.receipt.findUniqueOrThrow({
        where: { id: created.id },
        include: { items: { orderBy: { createdAt: 'asc' } }, evidenceFiles: true },
      });
    };
    const receipt = transaction ? await execute(transaction) : await this.database.client.$transaction(execute);
    return toReceiptView(receipt);
  }
}

function toShipmentDetailView(shipment: Shipment & {
  supplierOrder: SupplierOrder;
  items: Array<ShipmentItem & { orderItem: { productId: string; unitSnapshot?: Prisma.JsonValue | null; product: { name: string } }; receiptItems: Array<{ discrepancy: { status: DiscrepancyStatus; returnRecord?: unknown } | null }> }>;
  receipts: Array<Receipt & { items: ReceiptItem[]; evidenceFiles?: FileObject[] }>;
}): ShipmentDetailView {
  return {
    id: shipment.id,
    shipmentNo: shipment.shipmentNo,
    supplierOrderId: shipment.supplierOrderId,
    supplierOrderNo: shipment.supplierOrder.supplierOrderNo,
    supplierOrderVersion: shipment.supplierOrder.version,
    kind: shipment.kind,
    shippedAt: shipment.shippedAt.toISOString(),
    trackingNo: shipment.trackingNo,
    currentReceiptRevision: shipment.receipts[0]?.revision ?? 0,
    evidenceFiles: (shipment.receipts[0]?.evidenceFiles ?? []).map(toEvidenceView),
    items: shipment.items.map((item) => ({
      id: item.id,
      orderItemId: item.orderItemId,
      productId: item.orderItem.productId,
      productName: item.orderItem.product.name,
      unitName: readUnitSnapshot(item.orderItem.unitSnapshot)?.salesUnitName ?? null,
      shippedQuantity: item.quantity.toString(),
      currentReceivedQuantity: shipment.receipts[0]?.items.find(receiptItem => receiptItem.shipmentItemId === item.id)?.receivedQuantity.toString() ?? null,
      receiptLocked: Boolean(shipment.receipts[0]) && isReceiptItemLocked(item.receiptItems),
      salesPriceSnapshot: item.salesPriceSnapshot.toString(),
      supplyPriceSnapshot: item.supplyPriceSnapshot.toString(),
    })),
  };
}

export function isReceiptItemLocked(history: Array<{ discrepancy: { status: DiscrepancyStatus; returnRecord?: unknown } | null }>): boolean {
  const active = history.flatMap(item => item.discrepancy && item.discrepancy.status !== DiscrepancyStatus.SUPERSEDED ? [item.discrepancy] : []);
  return active.some(item => item.status !== DiscrepancyStatus.OPEN && !(item.status === DiscrepancyStatus.RESOLVED && item.returnRecord));
}

function toEvidenceView(file: FileObject): ReceiptEvidenceView {
  return { id: file.id, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes.toString() };
}

function toReceiptView(receipt: Receipt & { items: ReceiptItem[]; evidenceFiles?: FileObject[] }): ReceiptView {
  return {
    id: receipt.id,
    receiptNo: receipt.receiptNo,
    shipmentId: receipt.shipmentId,
    revision: receipt.revision,
    isCurrent: receipt.isCurrent,
    submittedAt: receipt.submittedAt.toISOString(),
    evidenceFiles: (receipt.evidenceFiles ?? []).map(toEvidenceView),
    items: receipt.items.map((item) => ({
      id: item.id,
      shipmentItemId: item.shipmentItemId,
      receivedQuantity: item.receivedQuantity.toString(),
    })),
  };
}

function makeReceiptNo(): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  return `RC${stamp}${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
}
