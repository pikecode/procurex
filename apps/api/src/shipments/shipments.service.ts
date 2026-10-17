import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { displaySalesUnitName, readUnitDisplayNames } from '../catalog/transaction-units.js';
import {
  DiscrepancyStatus,
  FulfillmentStatus,
  SupplierOrderStatus,
  UserScopeType,
  UserStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type { FileObject, Prisma, Receipt, ReceiptItem, Shipment, ShipmentItem, SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { remainingNormalShipmentQuantity, resolveSupplierOrderFulfillmentStatus } from '../supplier-orders/fulfillment-status.js';
import { lockFundingRequest, synchronizeRequestFunding } from '../purchase-requests/request-funding.js';
import { applyEffectiveOrderPrices, lockPricePublication } from '../pricing/price-checkpoint.js';
import { assignedStoreIds, type BusinessScope } from '../auth/store-scope.js';
import { pendingReceiptKind } from './receipt-progress.js';

export type CreateReceiptInput = {
  hasException?: boolean;
  note?: string;
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
  exceptionStatus: string | null;
  hasException: boolean;
  note: string | null;
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
  receiptExceptionStatus: string | null;
  receiptHasException: boolean;
  receiptNote: string | null;
  deliveryState?: string | null;
  id: string;
  shipmentNo: string;
  supplierOrderId: string;
  supplierOrderNo: string;
  supplierOrderVersion: number;
  kind: string;
  shippedAt: string;
  trackingNo: string | null;
  carrierName: string | null;
  deliveryModeSnapshot: string | null;
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

  async pendingReceipts(scope?: BusinessScope) {
    const storeIds = assignedStoreIds(scope);
    const supplierOrder: Prisma.SupplierOrderWhereInput = {
      ...(storeIds ? { storeId: { in: storeIds } } : ['STORE', 'STORE_FINANCE'].includes(scope?.type ?? '') ? { storeId: scope?.storeId ?? '' }
        : scope?.type === 'SUPPLIER' ? { supplierId: scope.supplierId ?? '' } : {}),
      status: { notIn: ['COMPLETED', 'REJECTED', 'CANCELED'] },
    };
    const batches = await this.database.client.shipment.findMany({
      where: { supplierOrder, OR: [{ receipts: { none: { isCurrent: true } } },
        { receipts: { some: { isCurrent: true, items: { some: { discrepancy: { is: { status: 'RESOLVED', returnRecord: { isNot: null } } } } } } } }] },
      orderBy: [{ shippedAt: 'asc' }, { id: 'asc' }],
      include: { supplierOrder: { include: { supplier: { select: { name: true } }, store: { select: { name: true } } } },
        receipts: { where: { isCurrent: true }, include: { items: { include: { discrepancy: { include: { returnRecord: true } } } } } },
        _count: { select: { items: true } } },
    });
    return batches.flatMap(batch => {
      const kind = pendingReceiptKind(batch.supplierOrder, batch);
      return kind ? [{ id: batch.id, shipmentNo: batch.shipmentNo, supplierOrderId: batch.supplierOrderId,
        supplierOrderNo: batch.supplierOrder.supplierOrderNo, supplierName: batch.supplierOrder.supplier.name, storeName: batch.supplierOrder.store.name,
        shippedAt: batch.shippedAt.toISOString(), itemCount: batch._count.items, returned: kind === 'RETURNED' }] : [];
    });
  }

  async get(id: string, scope?: BusinessScope): Promise<ShipmentDetailView> {
    const storeIds = assignedStoreIds(scope);
    const shipment = await this.database.client.shipment.findUnique({
      where: {
        id,
        supplierOrder: storeIds ? { storeId: { in: storeIds } } : scope?.type === 'STORE' || scope?.type === 'STORE_FINANCE' ? { storeId: scope?.storeId } : scope?.type === 'SUPPLIER' ? { supplierId: scope.supplierId } : undefined,
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

    const names = await readUnitDisplayNames(this.database.client as Prisma.TransactionClient, shipment.items.map(item => item.orderItem.unitSnapshot));
    return toShipmentDetailView(shipment, names);
  }

  async createReceipt(shipmentId: string, input: CreateReceiptInput, scope?: { type: string; storeId?: string }, actorUserId?: string, transaction?: Prisma.TransactionClient): Promise<ReceiptView> {
    if (input.hasException === true && !input.note?.trim()) throw new ConflictException({ code: 'RECEIPT_NOTE_REQUIRED', message: '请填写异常收货备注' });
    if (input.hasException === true && !input.evidenceFileIds?.length) throw new ConflictException({ code: 'RECEIPT_EVIDENCE_INVALID', message: '异常收货请上传收货凭证' });
    if (input.note !== undefined && (typeof input.note !== 'string' || input.note.trim().length > 500)) throw new ConflictException({ code: 'INVALID_RECEIPT_NOTE', message: '收货备注最多500字' });
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
    if (currentReceipt?.exceptionStatus) throw new ConflictException({ code: 'RECEIPT_EXCEPTION_OPEN', message: '本批异常已提交，收货记录已锁定，请在订单详情继续处理' });
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

    const hasException = input.hasException === true || receiptItems.some(item => item.receivedQuantity.lt(item.shipmentItem.quantity));
    if (hasException && !input.note?.trim()) {
      throw new ConflictException({ code: 'RECEIPT_NOTE_REQUIRED', message: '请填写异常收货备注' });
    }
    if (hasException && !input.evidenceFileIds?.length) throw new ConflictException({ code: 'RECEIPT_EVIDENCE_INVALID', message: '异常收货请上传收货凭证' });

    const execute = async (tx: Prisma.TransactionClient) => {
      await lockPricePublication(tx);
      await lockFundingRequest(tx, shipment.supplierOrder.storeId, shipment.supplierOrder.requestId);
      const lockedOrder = await tx.supplierOrder.findUniqueOrThrow({ where: { id: shipment.supplierOrderId } });
      const reviewDate = (lockedOrder.deliveryReview as { requestedAt?: string } | null)?.requestedAt;
      if (reviewDate && shipment.shippedAt <= new Date(reviewDate)) throw new ConflictException({ code: 'RECEIPT_ALREADY_REVIEWED', message: '本批实收已用于整单异议，请在订单详情继续处理' });
      if (['DISPUTED', 'DECLINED', 'COMPLETED'].includes(lockedOrder.deliveryState ?? '')) throw new ConflictException({ code: 'RECEIPT_NOT_EDITABLE', message: '订单正在处理异议或已完成，请在订单详情继续处理' });
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
          note: input.note?.trim() || null,
          hasException,
          exceptionStatus: hasException ? 'SUBMITTED' : null,
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

      const refreshedOrderItems = await tx.orderItem.findMany({
        where: { supplierOrderId: shipment.supplierOrderId },
        include: { shipmentItems: true, discrepancies: { include: { replenishmentGap: true, returnRecord: true } } },
      });
      const deliveryState = lockedOrder.deliveryState || (created.exceptionStatus === 'SUBMITTED' ? refreshedOrderItems.some(item => remainingNormalShipmentQuantity(item).gt(0)) ? 'IN_PROGRESS' : 'FINISHED' : undefined);
      let nextFulfillmentStatus = resolveSupplierOrderFulfillmentStatus(refreshedOrderItems, deliveryState);
      if (created.exceptionStatus === 'SUBMITTED' && nextFulfillmentStatus === FulfillmentStatus.COMPLETED) nextFulfillmentStatus = FulfillmentStatus.SHIPPED;
      if (nextFulfillmentStatus === FulfillmentStatus.COMPLETED && lockedOrder.firstShippedAt) {
        const repriced = await applyEffectiveOrderPrices(tx, lockedOrder.id, lockedOrder.firstShippedAt, { deferCreditShortfall: true });
        if (repriced.changed && !repriced.fundingHandled) await synchronizeRequestFunding(tx, lockedOrder.requestId, { sourceId: created.id, deferCreditShortfall: true });
      }
      await tx.supplierOrder.update({
        where: { id: shipment.supplierOrderId },
        data: {
          fulfillmentStatus: nextFulfillmentStatus,
          ...(created.exceptionStatus === 'SUBMITTED' && !lockedOrder.deliveryState ? { deliveryState, deliveryCompletedAt: deliveryState === 'FINISHED' ? new Date() : null } : {}),
          status: nextFulfillmentStatus === FulfillmentStatus.COMPLETED ? SupplierOrderStatus.COMPLETED : nextFulfillmentStatus === FulfillmentStatus.SHIPPED ? SupplierOrderStatus.SHIPPED : SupplierOrderStatus.PARTIAL_SHIPPED,
          completedAt: nextFulfillmentStatus === FulfillmentStatus.COMPLETED ? new Date() : null,
          version: { increment: 1 },
        },
      });
      const fundingRequest = await tx.purchaseRequest.findUniqueOrThrow({ where: { id: lockedOrder.requestId } });
      if (fundingRequest.storedValueOnReceipt) await synchronizeRequestFunding(tx, lockedOrder.requestId, { requireFull: true, sourceId: created.id, deferCreditShortfall: true });

      if (discrepancyIds.length || created.exceptionStatus === 'SUBMITTED') {
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
              title: '收货异常待处理',
              body: `供应商订单 ${shipment.supplierOrder.supplierOrderNo} 收货存在差异，请处理。`,
              payload: {
                type: created.exceptionStatus === 'SUBMITTED' ? 'ORDER_DELIVERY' : 'RECEIPT_DISCREPANCY',
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
}, names: ReadonlyMap<string, string>): ShipmentDetailView {
  return {
    id: shipment.id,
    shipmentNo: shipment.shipmentNo,
    supplierOrderId: shipment.supplierOrderId,
    supplierOrderNo: shipment.supplierOrder.supplierOrderNo,
    supplierOrderVersion: shipment.supplierOrder.version,
    deliveryState: shipment.supplierOrder.deliveryState,
    kind: shipment.kind,
    shippedAt: shipment.shippedAt.toISOString(),
    trackingNo: shipment.trackingNo,
    carrierName: shipment.carrierName,
    deliveryModeSnapshot: shipment.deliveryModeSnapshot,
    currentReceiptRevision: shipment.receipts[0]?.revision ?? 0,
    receiptNote: shipment.receipts[0]?.note ?? null,
    receiptHasException: shipment.receipts[0]?.hasException ?? false,
    receiptExceptionStatus: shipment.receipts[0]?.exceptionStatus ?? null,
    evidenceFiles: (shipment.receipts[0]?.evidenceFiles ?? []).map(toEvidenceView),
    items: shipment.items.map((item) => ({
      id: item.id,
      orderItemId: item.orderItemId,
      productId: item.orderItem.productId,
      productName: item.orderItem.product.name,
      unitName: displaySalesUnitName(item.orderItem.unitSnapshot, names),
      shippedQuantity: item.quantity.toString(),
      currentReceivedQuantity: shipment.receipts[0]?.items.find(receiptItem => receiptItem.shipmentItemId === item.id)?.receivedQuantity.toString() ?? null,
      receiptLocked: Boolean(shipment.receipts[0]?.exceptionStatus) || Boolean((shipment.supplierOrder.deliveryReview as { requestedAt?: string } | null)?.requestedAt && shipment.shippedAt <= new Date((shipment.supplierOrder.deliveryReview as { requestedAt: string }).requestedAt)) || ['DISPUTED', 'DECLINED', 'COMPLETED'].includes(shipment.supplierOrder.deliveryState ?? '') || (Boolean(shipment.receipts[0]) && isReceiptItemLocked(item.receiptItems)),
      salesPriceSnapshot: item.salesPriceSnapshot.toString(),
      supplyPriceSnapshot: item.supplyPriceSnapshot.toString(),
    })),
  };
}

export function isReceiptItemLocked(history: Array<{ discrepancy: { status: DiscrepancyStatus; returnRecord?: unknown } | null }>): boolean {
  if (history.some(item => item.discrepancy === null)) return true;
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
    note: receipt.note ?? null,
    hasException: receipt.hasException ?? false,
    exceptionStatus: receipt.exceptionStatus ?? null,
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
