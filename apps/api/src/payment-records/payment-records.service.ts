import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  PaymentAllocationState,
  PaymentRecordDirection,
  PaymentRecordStatus,
  SupplierOrderStatus,
  DifferenceDisposalStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import { Prisma, type DifferenceDisposalItem, type Overpayment, type PaymentAllocation, type PaymentRecord, type Shipment, type SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type PaymentDirection = 'STORE_TO_COMPANY' | 'COMPANY_TO_SUPPLIER';
export type PaymentChannel = 'COMPANY' | 'DIRECT';
export type SettlementItemKind = 'STORE_RECEIVABLE' | 'SUPPLIER_PAYABLE' | 'DIRECT' | 'ADJUSTMENT';

export type PaymentPreviewView = {
  direction: PaymentRecordDirection;
  channel: PaymentChannel;
  storeId: string | null;
  supplierId: string | null;
  totalPayableAmount: string;
  totalPendingPaymentAmount: string;
  totalConfirmedPaidAmount: string;
  items: PaymentPreviewItemView[];
  blockedItems: PaymentPreviewBlockedItemView[];
};

export type CreatePaymentRecordInput = {
  direction: PaymentRecordDirection;
  items: CreatePaymentRecordItemInput[];
  businessDate: Date;
  remark?: string;
  evidenceFileIds?: string[];
};

export type ListPaymentRecordsInput = {
  direction?: PaymentRecordDirection;
  status?: PaymentRecordStatus;
  storeId?: string;
  supplierId?: string;
};

export type PaymentScope = { type?: string; storeId?: string; supplierId?: string; userId?: string };

export type CreatePaymentRecordItemInput = {
  settlementItemId: string;
  expectedVersion: number;
  expectedAmount: string;
};

export type PaymentRecordView = {
  id: string;
  paymentNo: string;
  direction: PaymentRecordDirection;
  channel: PaymentChannel;
  storeId: string | null;
  supplierId: string | null;
  amount: string;
  businessDate: string;
  status: PaymentRecordStatus;
  remark: string | null;
  rejectedReason: string | null;
  cancelledReason: string | null;
  version: number;
  createdAt: string;
  allocations: PaymentAllocationView[];
  overpaymentAmount: string;
  overpayments: OverpaymentView[];
  evidenceFileIds: string[];
};

export type OverpaymentView = {
  id: string;
  storeId: string;
  supplierId: string;
  amount: string;
  sourceRevision: number;
  createdAt: string;
};

export type PaymentAllocationView = {
  id: string;
  settlementItemId: string;
  supplierOrderId: string;
  amount: string;
  sourceVersion: number;
  state: PaymentAllocationState;
  createdAt: string;
};

export type PaymentPreviewItemView = {
  settlementItemId: string;
  kind: SettlementItemKind;
  adjustmentSide?: 'STORE' | 'SUPPLIER';
  supplierOrderId: string;
  supplierOrderNo: string;
  storeId: string;
  supplierId: string;
  sourceVersion: number;
  payableAmount: string;
  pendingPaymentAmount: string;
  confirmedPaidAmount: string;
};

export type PaymentPreviewBlockedItemView = {
  settlementItemId: string;
  code: string;
  message: string;
};

type DecodedSettlementItemId = {
  kind: SettlementItemKind;
  supplierOrderId: string;
  adjustmentDocumentId?: string;
  adjustmentSide?: 'STORE' | 'SUPPLIER';
};

type PreviewOrder = SupplierOrder & { shipments: Shipment[] };

function matchesPaymentScope(value: { storeId: string | null; supplierId: string | null }, scope?: PaymentScope): boolean {
  if (isStoreScope(scope?.type)) return value.storeId === scope?.storeId;
  if (scope?.type === 'SUPPLIER') return value.supplierId === scope.supplierId;
  return true;
}

@Injectable()
export class PaymentRecordsService {
  constructor(private readonly database: DatabaseService) {}

  async list(input: ListPaymentRecordsInput, scope?: PaymentScope): Promise<PaymentRecordView[]> {
    const payments = await this.database.client.paymentRecord.findMany({
      where: {
        direction: input.direction,
        status: input.status,
        storeId: isStoreScope(scope?.type) ? scope?.storeId : input.storeId,
        supplierId: scope?.type === 'SUPPLIER' ? scope.supplierId : input.supplierId,
      },
      include: { allocations: { orderBy: { createdAt: 'asc' } }, overpayments: { orderBy: { createdAt: 'asc' } }, evidenceFiles: { select: { id: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return payments.map(toPaymentRecordView);
  }

  async get(id: string, scope?: PaymentScope): Promise<PaymentRecordView> {
    const payment = await this.database.client.paymentRecord.findUnique({
      where: { id },
      include: { allocations: { orderBy: { createdAt: 'asc' } }, overpayments: { orderBy: { createdAt: 'asc' } }, evidenceFiles: { select: { id: true } } },
    });
    if (!payment || !matchesPaymentScope(payment, scope)) {
      throw new NotFoundException({
        code: 'PAYMENT_RECORD_NOT_FOUND',
        message: 'Payment record was not found',
      });
    }

    return toPaymentRecordView(payment);
  }

  async preview(settlementItemIds: string[], client: DatabaseService['client'] | Prisma.TransactionClient = this.database.client, scope?: PaymentScope): Promise<PaymentPreviewView> {
    const uniqueIds = [...new Set(settlementItemIds)];
    const decoded = uniqueIds.map((id) => ({ id, decoded: decodeSettlementItemId(id) }));
    const supplierOrderIds = decoded.map((item) => item.decoded.supplierOrderId);
    const orders = await client.supplierOrder.findMany({
      where: { id: { in: supplierOrderIds } },
      include: { shipments: true, request: { select: { shortfallAmount: true } } },
    });
    const snapshots = await client.settlementItemSnapshot.findMany({
      where: { settlementItemId: { in: uniqueIds } },
    });
    const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.settlementItemId, snapshot]));
    const ordersById = new Map(orders.map((order) => [order.id, order]));
    const adjustmentDocumentIds = decoded.flatMap(({ decoded: item }) => item.adjustmentDocumentId ? [item.adjustmentDocumentId] : []);
    const adjustmentDocuments = await client.adjustmentDocument.findMany({ where: { id: { in: adjustmentDocumentIds } } });
    const adjustmentDocumentsById = new Map(adjustmentDocuments.map((document) => [document.id, document]));
    const storeReceivableOrderIds = [...new Set(decoded.flatMap(({ decoded: item }) => {
      const order = ordersById.get(item.supplierOrderId);
      return (item.kind === 'SUPPLIER_PAYABLE' || (item.kind === 'ADJUSTMENT' && item.adjustmentSide === 'SUPPLIER')) && order?.settlementMode === 'COMPANY_TERM'
        ? [item.supplierOrderId]
        : [];
    }))];
    const storeAdjustmentDocuments = await client.adjustmentDocument.findMany({
      where: { supplierOrderId: { in: storeReceivableOrderIds }, side: 'STORE' },
    });
    const storeReceivableIds = decoded.flatMap(({ decoded: item }) => {
      const order = ordersById.get(item.supplierOrderId);
      return (item.kind === 'SUPPLIER_PAYABLE' || (item.kind === 'ADJUSTMENT' && item.adjustmentSide === 'SUPPLIER')) && order?.settlementMode === 'COMPANY_TERM'
        ? [encodeSettlementItemId('STORE_RECEIVABLE', item.supplierOrderId)]
        : [];
    });
    const storeAdjustmentIds = storeAdjustmentDocuments
      .filter((document) => new Decimal(document.amount).gt(0))
      .map((document) => encodeAdjustmentSettlementItemId(document.id, document.supplierOrderId, 'STORE'));
    const allocations = await client.paymentAllocation.findMany({
      where: {
        settlementItemId: { in: [...uniqueIds, ...storeReceivableIds, ...storeAdjustmentIds] },
        state: { in: [PaymentAllocationState.RESERVED, PaymentAllocationState.CONFIRMED] },
      },
    });
    const allocationSummary = summarizeAllocations(allocations);
    const offsetItems = await client.differenceDisposalItem.findMany({
      where: {
        targetDebitItemId: { in: uniqueIds },
        disposal: { status: { in: [DifferenceDisposalStatus.PENDING, DifferenceDisposalStatus.CONFIRMED] } },
      },
    });
    const reservedOffsetSummary = summarizeOffsets(offsetItems);
    const items: PaymentPreviewItemView[] = [];
    const blockedItems: PaymentPreviewBlockedItemView[] = [];

    for (const item of decoded) {
      const order = ordersById.get(item.decoded.supplierOrderId);
      if (!order) {
        blockedItems.push({
          settlementItemId: item.id,
          code: 'SETTLEMENT_ITEM_NOT_FOUND',
          message: 'Settlement item source order was not found',
        });
        continue;
      }
      if (order.status !== SupplierOrderStatus.COMPLETED || !order.firstShippedAt) {
        blockedItems.push({
          settlementItemId: item.id,
          code: 'SETTLEMENT_ITEM_NOT_PAYABLE',
          message: 'Settlement item source order is not completed',
        });
        continue;
      }
      const adjustment = item.decoded.adjustmentDocumentId ? adjustmentDocumentsById.get(item.decoded.adjustmentDocumentId) : undefined;
      if (item.decoded.kind === 'ADJUSTMENT' && (!adjustment || adjustment.supplierOrderId !== order.id || adjustment.side !== item.decoded.adjustmentSide)) {
        blockedItems.push({ settlementItemId: item.id, code: 'ADJUSTMENT_NOT_FOUND', message: 'Adjustment document was not found' });
        continue;
      }
      if (item.decoded.kind === 'ADJUSTMENT' && (!adjustment || new Decimal(adjustment.amount).lte(0))) {
        blockedItems.push({ settlementItemId: item.id, code: 'ADJUSTMENT_CREDIT_NOT_PAYABLE', message: 'Negative adjustments must be disposed through difference handling' });
        continue;
      }
      if (item.decoded.kind !== 'ADJUSTMENT' && (item.decoded.kind === 'DIRECT') !== (order.settlementMode === 'SUPPLIER_TERM')) {
        blockedItems.push({ settlementItemId: item.id, code: 'SETTLEMENT_CHANNEL_MISMATCH', message: 'Settlement item does not match its order settlement mode' });
        continue;
      }
      if (new Decimal(order.request.shortfallAmount).greaterThan(0)) {
        blockedItems.push({
          settlementItemId: item.id,
          code: 'UNRESOLVED_FUNDING_SHORTFALL',
          message: 'Purchase request has an unresolved funding shortfall',
        });
        continue;
      }
      if ((item.decoded.kind === 'SUPPLIER_PAYABLE' || (item.decoded.kind === 'ADJUSTMENT' && item.decoded.adjustmentSide === 'SUPPLIER')) && order.settlementMode === 'COMPANY_TERM') {
        const receivableId = encodeSettlementItemId('STORE_RECEIVABLE', order.id);
        const storeAmount = new Decimal(order.salesGoodsAmount).plus(order.shipments.reduce((sum, shipment) => sum.plus(shipment.freight), new Decimal(0)));
        const storeAdjustmentAmount = storeAdjustmentDocuments
          .filter((document) => document.supplierOrderId === order.id && new Decimal(document.amount).gt(0))
          .reduce((sum, document) => sum.plus(document.amount), new Decimal(0));
        const confirmedStoreAdjustments = storeAdjustmentDocuments
          .filter((document) => document.supplierOrderId === order.id && new Decimal(document.amount).gt(0))
          .reduce((sum, document) => sum.plus(allocationSummary.get(encodeAdjustmentSettlementItemId(document.id, order.id, 'STORE'))?.confirmedAmount ?? new Decimal(0)), new Decimal(0));
        if ((allocationSummary.get(receivableId)?.confirmedAmount ?? new Decimal(0)).plus(confirmedStoreAdjustments).lessThan(storeAmount.plus(storeAdjustmentAmount))) {
          blockedItems.push({
            settlementItemId: item.id,
            code: 'STORE_RECEIVABLE_UNSETTLED',
            message: 'Store receivable for this company-term order is not fully settled',
          });
          continue;
        }
      }
      items.push(toPreviewItem(item.id, item.decoded.kind, order, allocationSummary.get(item.id), reservedOffsetSummary.get(item.id), snapshotsById.get(item.id), adjustment, item.decoded.adjustmentSide));
    }

    if (items.some((item) => !matchesPaymentScope(item, scope))) {
      throw new NotFoundException({ code: 'PAYMENT_RECORD_NOT_FOUND', message: 'Payment items were not found' });
    }

    if (items.length === 0) {
      throw new NotFoundException({
        code: 'PAYMENT_PREVIEW_EMPTY',
        message: 'No payable settlement items were found',
        details: { blockedItems },
      });
    }

    const direction = directionForItem(items[0]!, ordersById);
    const storeId = direction !== 'COMPANY_TO_SUPPLIER' ? items[0]!.storeId : null;
    const supplierId = direction !== 'STORE_TO_COMPANY' ? items[0]!.supplierId : null;
    for (const item of items) {
      if (directionForItem(item, ordersById) !== direction) {
        throw new ConflictException({
          code: 'PAYMENT_DIRECTION_MISMATCH',
          message: 'Settlement items must share the same payment direction',
        });
      }
      if (storeId && item.storeId !== storeId) {
        throw new ConflictException({
          code: 'PAYMENT_PAYER_MISMATCH',
          message: 'Store payment items must share the same store',
        });
      }
      if (supplierId && item.supplierId !== supplierId) {
        throw new ConflictException({
          code: 'PAYMENT_PAYEE_MISMATCH',
          message: 'Supplier payment items must share the same supplier',
        });
      }
    }
    if (direction === PaymentRecordDirection.STORE_TO_SUPPLIER && items.some((item) => item.storeId !== storeId || item.supplierId !== supplierId)) {
      throw new ConflictException({ code: 'PAYMENT_PARTICIPANT_MISMATCH', message: 'Direct payment items must share the same store and supplier' });
    }

    const totalPayableAmount = items.reduce((sum, item) => sum.plus(item.payableAmount), new Decimal(0));
    const totalPendingPaymentAmount = items.reduce((sum, item) => sum.plus(item.pendingPaymentAmount), new Decimal(0));
    const totalConfirmedPaidAmount = items.reduce((sum, item) => sum.plus(item.confirmedPaidAmount), new Decimal(0));
    return {
      direction,
      channel: direction === PaymentRecordDirection.STORE_TO_SUPPLIER ? 'DIRECT' : 'COMPANY',
      storeId,
      supplierId,
      totalPayableAmount: totalPayableAmount.toFixed(2),
      totalPendingPaymentAmount: totalPendingPaymentAmount.toFixed(2),
      totalConfirmedPaidAmount: totalConfirmedPaidAmount.toFixed(2),
      items,
      blockedItems,
    };
  }

  async create(input: CreatePaymentRecordInput, scope?: PaymentScope): Promise<PaymentRecordView> {
    return this.database.client.$transaction(async (tx) => {
    const settlementItemIds = input.items.map((item) => item.settlementItemId);
    for (const id of [...settlementItemIds].sort()) {
      await waitForSettlementLock(tx, id);
    }
    const preview = await this.preview(settlementItemIds, tx, scope);
    if (input.evidenceFileIds?.length) {
      const files = await tx.fileObject.findMany({ where: { id: { in: input.evidenceFileIds }, ownerId: scope?.userId, purpose: 'PAYMENT', status: 'READY', paymentId: null } });
      if (files.length !== input.evidenceFileIds.length || new Set(input.evidenceFileIds).size !== files.length) {
        throw new ConflictException({ code: 'PAYMENT_EVIDENCE_INVALID', message: 'Payment evidence must be completed files owned by the current user' });
      }
    }
    if (preview.blockedItems.length > 0) {
      throw new ConflictException({
        code: 'PAYMENT_PREVIEW_BLOCKED',
        message: 'Some settlement items cannot be paid',
        details: { blockedItems: preview.blockedItems },
      });
    }
    if (preview.direction !== input.direction) {
      throw new ConflictException({
        code: 'PAYMENT_DIRECTION_MISMATCH',
        message: 'Payment direction does not match selected settlement items',
      });
    }

    const previewItemsById = new Map(preview.items.map((item) => [item.settlementItemId, item]));
    for (const item of input.items) {
      const previewItem = previewItemsById.get(item.settlementItemId);
      if (!previewItem) {
        throw new ConflictException({
          code: 'SETTLEMENT_ITEM_NOT_FOUND',
          message: 'Settlement item was not found in payment preview',
        });
      }
      if (previewItem.sourceVersion !== item.expectedVersion) {
        throw new ConflictException({
          code: 'SETTLEMENT_ITEM_VERSION_CONFLICT',
          message: 'Settlement item source version has changed',
          details: { settlementItemId: item.settlementItemId, expectedVersion: item.expectedVersion, currentVersion: previewItem.sourceVersion },
        });
      }
      if (!new Decimal(previewItem.payableAmount).eq(item.expectedAmount)) {
        throw new ConflictException({
          code: 'SETTLEMENT_ITEM_AMOUNT_CHANGED',
          message: 'Settlement item payable amount has changed',
          details: { settlementItemId: item.settlementItemId, expectedAmount: item.expectedAmount, currentAmount: previewItem.payableAmount },
        });
      }
      if (new Decimal(item.expectedAmount).lte(0)) {
        throw new ConflictException({
          code: 'SETTLEMENT_ITEM_NOT_PAYABLE',
          message: 'Settlement item has no payable amount',
        });
      }
    }

    const amount = input.items.reduce((sum, item) => sum.plus(item.expectedAmount), new Decimal(0));
    const payment = await tx.paymentRecord.create({
      data: {
        paymentNo: makePaymentNo(),
        direction: input.direction,
        storeId: preview.storeId,
        supplierId: preview.supplierId,
        amount: amount.toFixed(2),
        businessDate: input.businessDate,
        remark: input.remark,
        evidenceFiles: input.evidenceFileIds?.length ? { connect: input.evidenceFileIds.map((id) => ({ id })) } : undefined,
        allocations: {
          create: input.items.map((item) => {
            const previewItem = previewItemsById.get(item.settlementItemId)!;
            return {
              settlementItemId: item.settlementItemId,
              supplierOrderId: previewItem.supplierOrderId,
              amount: item.expectedAmount,
              sourceVersion: item.expectedVersion,
            };
          }),
        },
      },
      include: { allocations: { orderBy: { createdAt: 'asc' } }, evidenceFiles: { select: { id: true } } },
    });

    return toPaymentRecordView(payment);
    });
  }

  async confirm(id: string, expectedVersion: number, scope?: PaymentScope): Promise<PaymentRecordView> {
    const payment = await this.database.client.paymentRecord.findUnique({
      where: { id },
      include: { allocations: { orderBy: { createdAt: 'asc' } }, evidenceFiles: { select: { id: true } } },
    });
    if (!payment || !matchesPaymentScope(payment, scope)) {
      throw new NotFoundException({
        code: 'PAYMENT_RECORD_NOT_FOUND',
        message: 'Payment record was not found',
      });
    }
    if (payment.version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Payment record version has changed',
        details: { expectedVersion, currentVersion: payment.version },
      });
    }
    if (payment.status !== PaymentRecordStatus.PENDING) {
      throw new ConflictException({
        code: 'PAYMENT_RECORD_NOT_CONFIRMABLE',
        message: 'Payment record cannot be confirmed in its current status',
        details: { status: payment.status },
      });
    }

    const confirmed = await this.database.client.$transaction(async (tx) => {
      const changed = await tx.paymentRecord.updateMany({
        where: { id, version: expectedVersion, status: PaymentRecordStatus.PENDING },
        data: {
          status: PaymentRecordStatus.CONFIRMED,
          confirmedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Payment record has already changed' });
      await tx.paymentAllocation.updateMany({ where: { paymentId: id, state: PaymentAllocationState.RESERVED }, data: { state: PaymentAllocationState.CONFIRMED } });
      const result = await tx.paymentRecord.findUniqueOrThrow({ where: { id }, include: { allocations: { orderBy: { createdAt: 'asc' } }, evidenceFiles: { select: { id: true } } } });
      const orderIds = [...new Set(result.allocations.map((allocation) => allocation.supplierOrderId))];
      const orders = await tx.supplierOrder.findMany({ where: { id: { in: orderIds } }, include: { shipments: true } });
      const ordersById = new Map(orders.map((order) => [order.id, order]));
      const overpayments = new Map<string, { paymentId: string; storeId: string; supplierId: string; amount: Decimal; sourceRevision: number }>();
      for (const allocation of result.allocations) {
        const order = ordersById.get(allocation.supplierOrderId)!;
        const decoded = decodeSettlementItemId(allocation.settlementItemId);
        if (decoded.kind === 'ADJUSTMENT') continue;
        const kind = decoded.kind;
        const goodsAmount = kind !== 'SUPPLIER_PAYABLE' ? new Decimal(order.salesGoodsAmount) : new Decimal(order.supplyGoodsAmount);
        const currentAmount = goodsAmount.plus(order.shipments.reduce((sum, shipment) => sum.plus(shipment.freight), new Decimal(0)));
        const excess = new Decimal(allocation.amount).minus(currentAmount);
        if (excess.gt(0)) {
          const key = `${order.storeId}:${order.supplierId}:${allocation.sourceVersion}`;
          const current = overpayments.get(key);
          overpayments.set(key, current ? { ...current, amount: current.amount.plus(excess) } : {
            paymentId: id,
            storeId: order.storeId,
            supplierId: order.supplierId,
            amount: excess,
            sourceRevision: allocation.sourceVersion,
          });
        }
      }
      if (overpayments.size > 0) {
        await tx.overpayment.createMany({ data: [...overpayments.values()].map((item) => ({ ...item, amount: item.amount.toFixed(2) })) });
      }
      await tx.settlementItemSnapshot.createMany({
        data: result.allocations.filter((allocation) => decodeSettlementItemId(allocation.settlementItemId).kind !== 'ADJUSTMENT').map((allocation) => {
          const order = ordersById.get(allocation.supplierOrderId)!;
          const kind = decodeSettlementItemId(allocation.settlementItemId).kind;
          const goodsAmount = kind !== 'SUPPLIER_PAYABLE' ? new Decimal(order.salesGoodsAmount) : new Decimal(order.supplyGoodsAmount);
          const freightAmount = order.shipments.reduce((sum, shipment) => sum.plus(shipment.freight), new Decimal(0));
          return {
            settlementItemId: allocation.settlementItemId,
            supplierOrderId: order.id,
            kind,
            goodsAmount: goodsAmount.toFixed(2),
            freightAmount: freightAmount.toFixed(2),
            totalAmount: goodsAmount.plus(freightAmount).toFixed(2),
            sourceVersion: allocation.sourceVersion,
          };
        }),
        skipDuplicates: true,
      });
      return tx.paymentRecord.findUniqueOrThrow({ where: { id }, include: { allocations: { orderBy: { createdAt: 'asc' } }, overpayments: { orderBy: { createdAt: 'asc' } }, evidenceFiles: { select: { id: true } } } });
    });

    return toPaymentRecordView(confirmed);
  }

  async reject(id: string, expectedVersion: number, reason: string, scope?: PaymentScope): Promise<PaymentRecordView> {
    const payment = await this.database.client.paymentRecord.findUnique({
      where: { id },
      include: { allocations: { orderBy: { createdAt: 'asc' } }, overpayments: { orderBy: { createdAt: 'asc' } }, evidenceFiles: { select: { id: true } } },
    });
    if (!payment || !matchesPaymentScope(payment, scope)) {
      throw new NotFoundException({
        code: 'PAYMENT_RECORD_NOT_FOUND',
        message: 'Payment record was not found',
      });
    }
    if (payment.version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Payment record version has changed',
        details: { expectedVersion, currentVersion: payment.version },
      });
    }
    if (payment.status !== PaymentRecordStatus.PENDING) {
      throw new ConflictException({
        code: 'PAYMENT_RECORD_NOT_REJECTABLE',
        message: 'Payment record cannot be rejected in its current status',
        details: { status: payment.status },
      });
    }

    const rejected = await this.database.client.$transaction(async (tx) => {
      const changed = await tx.paymentRecord.updateMany({
        where: { id, version: expectedVersion, status: PaymentRecordStatus.PENDING },
      data: {
        status: PaymentRecordStatus.REJECTED,
        rejectedAt: new Date(),
        rejectedReason: reason,
        version: { increment: 1 },
      },
      });
      if (changed.count !== 1) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Payment record has already changed' });
      await tx.paymentAllocation.updateMany({ where: { paymentId: id, state: PaymentAllocationState.RESERVED }, data: { state: PaymentAllocationState.RELEASED } });
      return tx.paymentRecord.findUniqueOrThrow({ where: { id }, include: { allocations: { orderBy: { createdAt: 'asc' } }, evidenceFiles: { select: { id: true } } } });
    });

    return toPaymentRecordView(rejected);
  }

  async cancel(id: string, expectedVersion: number, reason: string, scope?: PaymentScope): Promise<PaymentRecordView> {
    const payment = await this.database.client.paymentRecord.findUnique({
      where: { id },
      include: { allocations: { orderBy: { createdAt: 'asc' } }, evidenceFiles: { select: { id: true } } },
    });
    if (!payment || !matchesPaymentScope(payment, scope)) {
      throw new NotFoundException({
        code: 'PAYMENT_RECORD_NOT_FOUND',
        message: 'Payment record was not found',
      });
    }
    if (payment.version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Payment record version has changed',
        details: { expectedVersion, currentVersion: payment.version },
      });
    }
    if (payment.status !== PaymentRecordStatus.PENDING) {
      throw new ConflictException({
        code: 'PAYMENT_RECORD_NOT_CANCELLABLE',
        message: 'Payment record cannot be cancelled in its current status',
        details: { status: payment.status },
      });
    }

    const cancelled = await this.database.client.$transaction(async (tx) => {
      const changed = await tx.paymentRecord.updateMany({
        where: { id, version: expectedVersion, status: PaymentRecordStatus.PENDING },
      data: {
        status: PaymentRecordStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledReason: reason,
        version: { increment: 1 },
      },
      });
      if (changed.count !== 1) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Payment record has already changed' });
      await tx.paymentAllocation.updateMany({ where: { paymentId: id, state: PaymentAllocationState.RESERVED }, data: { state: PaymentAllocationState.RELEASED } });
      return tx.paymentRecord.findUniqueOrThrow({ where: { id }, include: { allocations: { orderBy: { createdAt: 'asc' } }, evidenceFiles: { select: { id: true } } } });
    });

    return toPaymentRecordView(cancelled);
  }
}

function isStoreScope(type?: string): boolean {
  return type === 'STORE' || type === 'STORE_FINANCE';
}

async function waitForSettlementLock(tx: Prisma.TransactionClient, id: string): Promise<void> {
  for (;;) {
    const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${id}::text, 0)) AS locked`;
    if (rows[0]?.locked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function toPreviewItem(
  settlementItemId: string,
  kind: SettlementItemKind,
  order: PreviewOrder,
  allocationSummary: { pendingAmount: Decimal; confirmedAmount: Decimal } | undefined,
  reservedOffsetAmount: Decimal | undefined,
  snapshot?: { goodsAmount: import('decimal.js').Decimal; freightAmount: import('decimal.js').Decimal; totalAmount: import('decimal.js').Decimal; sourceVersion: number },
  adjustment?: { amount: import('decimal.js').Decimal; sourceRevision: number } | null,
  adjustmentSide?: 'STORE' | 'SUPPLIER',
): PaymentPreviewItemView {
  if (kind === 'ADJUSTMENT') {
    const pendingAmount = allocationSummary?.pendingAmount ?? new Decimal(0);
    const confirmedAmount = allocationSummary?.confirmedAmount ?? new Decimal(0);
    const offsetAmount = reservedOffsetAmount ?? new Decimal(0);
    const payableAmount = Decimal.max((adjustment?.amount ?? new Decimal(0)).minus(pendingAmount).minus(confirmedAmount).minus(offsetAmount), 0);
    return {
      settlementItemId, kind, adjustmentSide, supplierOrderId: order.id, supplierOrderNo: order.supplierOrderNo,
      storeId: order.storeId, supplierId: order.supplierId, sourceVersion: adjustment?.sourceRevision ?? order.version,
      payableAmount: payableAmount.toFixed(2), pendingPaymentAmount: pendingAmount.toFixed(2), confirmedPaidAmount: confirmedAmount.toFixed(2),
    };
  }
  const goodsAmount = snapshot?.goodsAmount ?? (kind !== 'SUPPLIER_PAYABLE' ? new Decimal(order.salesGoodsAmount) : new Decimal(order.supplyGoodsAmount));
  const freightAmount = snapshot?.freightAmount ?? order.shipments.reduce((sum, shipment) => sum.plus(shipment.freight), new Decimal(0));
  const grossAmount = snapshot?.totalAmount ?? goodsAmount.plus(freightAmount);
  const pendingAmount = allocationSummary?.pendingAmount ?? new Decimal(0);
  const confirmedAmount = allocationSummary?.confirmedAmount ?? new Decimal(0);
  // Pending offsets reserve payable balance; confirmed offsets consume it.
  const offsetAmount = reservedOffsetAmount ?? new Decimal(0);
  const payableAmount = Decimal.max(grossAmount.minus(pendingAmount).minus(confirmedAmount).minus(offsetAmount), 0);
  return {
    settlementItemId,
    kind,
    supplierOrderId: order.id,
    supplierOrderNo: order.supplierOrderNo,
    storeId: order.storeId,
    supplierId: order.supplierId,
    sourceVersion: snapshot?.sourceVersion ?? order.version,
    payableAmount: payableAmount.toFixed(2),
    pendingPaymentAmount: pendingAmount.toFixed(2),
    confirmedPaidAmount: confirmedAmount.toFixed(2),
  };
}

export function summarizeAllocations(allocations: PaymentAllocation[]): Map<string, { pendingAmount: Decimal; confirmedAmount: Decimal }> {
  const result = new Map<string, { pendingAmount: Decimal; confirmedAmount: Decimal }>();
  for (const allocation of allocations) {
    const current = result.get(allocation.settlementItemId) ?? {
      pendingAmount: new Decimal(0),
      confirmedAmount: new Decimal(0),
    };
    if (allocation.state === PaymentAllocationState.RESERVED) {
      current.pendingAmount = current.pendingAmount.plus(allocation.amount);
    }
    if (allocation.state === PaymentAllocationState.CONFIRMED) {
      current.confirmedAmount = current.confirmedAmount.plus(allocation.amount);
    }
    result.set(allocation.settlementItemId, current);
  }
  return result;
}

function summarizeOffsets(items: DifferenceDisposalItem[]): Map<string, Decimal> {
  const result = new Map<string, Decimal>();
  for (const item of items) {
    if (!item.targetDebitItemId) {
      continue;
    }
    result.set(item.targetDebitItemId, (result.get(item.targetDebitItemId) ?? new Decimal(0)).plus(item.amount));
  }
  return result;
}

function directionForKind(kind: SettlementItemKind): PaymentRecordDirection {
  return kind === 'STORE_RECEIVABLE' ? PaymentRecordDirection.STORE_TO_COMPANY : kind === 'DIRECT' ? PaymentRecordDirection.STORE_TO_SUPPLIER : PaymentRecordDirection.COMPANY_TO_SUPPLIER;
}

function directionForItem(item: PaymentPreviewItemView, ordersById: Map<string, PreviewOrder>): PaymentRecordDirection {
  if (item.kind !== 'ADJUSTMENT') return directionForKind(item.kind);
  const order = ordersById.get(item.supplierOrderId)!;
  return item.adjustmentSide === 'STORE' && order.settlementMode !== 'SUPPLIER_TERM'
    ? PaymentRecordDirection.STORE_TO_COMPANY
    : order.settlementMode === 'SUPPLIER_TERM'
      ? PaymentRecordDirection.STORE_TO_SUPPLIER
      : PaymentRecordDirection.COMPANY_TO_SUPPLIER;
}

function decodeSettlementItemId(id: string): DecodedSettlementItemId {
  try {
    const parsed = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as {
      kind?: unknown;
      supplierOrderId?: unknown;
    };
    if (
      (parsed.kind === 'STORE_RECEIVABLE' || parsed.kind === 'SUPPLIER_PAYABLE' || parsed.kind === 'DIRECT') &&
      typeof parsed.supplierOrderId === 'string'
    ) {
      return { kind: parsed.kind, supplierOrderId: parsed.supplierOrderId };
    }
    if (parsed.kind === 'ADJUSTMENT' && typeof parsed.supplierOrderId === 'string' && typeof (parsed as { adjustmentDocumentId?: unknown }).adjustmentDocumentId === 'string' && ((parsed as { adjustmentSide?: unknown }).adjustmentSide === 'STORE' || (parsed as { adjustmentSide?: unknown }).adjustmentSide === 'SUPPLIER')) {
      return { kind: 'ADJUSTMENT', supplierOrderId: parsed.supplierOrderId, adjustmentDocumentId: (parsed as { adjustmentDocumentId: string }).adjustmentDocumentId, adjustmentSide: (parsed as { adjustmentSide: 'STORE' | 'SUPPLIER' }).adjustmentSide };
    }
  } catch {
    // Fall through to uniform bad item handling.
  }
  throw new ConflictException({
    code: 'INVALID_SETTLEMENT_ITEM_ID',
    message: 'Settlement item id is invalid',
  });
}

function encodeSettlementItemId(kind: SettlementItemKind, supplierOrderId: string): string {
  return Buffer.from(JSON.stringify({ kind, supplierOrderId })).toString('base64url');
}

function encodeAdjustmentSettlementItemId(adjustmentDocumentId: string, supplierOrderId: string, adjustmentSide: 'STORE' | 'SUPPLIER'): string {
  return Buffer.from(JSON.stringify({ kind: 'ADJUSTMENT', adjustmentDocumentId, supplierOrderId, adjustmentSide })).toString('base64url');
}

function toPaymentRecordView(payment: PaymentRecord & { allocations: PaymentAllocation[]; overpayments?: Overpayment[]; evidenceFiles?: { id: string }[] }): PaymentRecordView {
  const overpayments = payment.overpayments ?? [];
  return {
    id: payment.id,
    paymentNo: payment.paymentNo,
    direction: payment.direction,
    channel: payment.direction === PaymentRecordDirection.STORE_TO_SUPPLIER ? 'DIRECT' : 'COMPANY',
    storeId: payment.storeId,
    supplierId: payment.supplierId,
    amount: payment.amount.toFixed(2),
    businessDate: payment.businessDate.toISOString().slice(0, 10),
    status: payment.status,
    remark: payment.remark,
    rejectedReason: payment.rejectedReason,
    cancelledReason: payment.cancelledReason,
    version: payment.version,
    createdAt: payment.createdAt.toISOString(),
    allocations: payment.allocations.map(toPaymentAllocationView),
    overpaymentAmount: overpayments.reduce((sum, item) => sum.plus(item.amount), new Decimal(0)).toFixed(2),
    overpayments: overpayments.map((item) => ({
      id: item.id,
      storeId: item.storeId,
      supplierId: item.supplierId,
      amount: item.amount.toFixed(2),
      sourceRevision: item.sourceRevision,
      createdAt: item.createdAt.toISOString(),
    })),
    evidenceFileIds: payment.evidenceFiles?.map((file) => file.id) ?? [],
  };
}

function toPaymentAllocationView(allocation: PaymentAllocation): PaymentAllocationView {
  return {
    id: allocation.id,
    settlementItemId: allocation.settlementItemId,
    supplierOrderId: allocation.supplierOrderId,
    amount: allocation.amount.toFixed(2),
    sourceVersion: allocation.sourceVersion,
    state: allocation.state,
    createdAt: allocation.createdAt.toISOString(),
  };
}

function makePaymentNo(): string {
  return `PAY-${Date.now()}-${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
}
