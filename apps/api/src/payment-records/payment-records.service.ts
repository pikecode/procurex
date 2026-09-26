import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  PaymentAllocationState,
  PaymentRecordDirection,
  PaymentRecordStatus,
  SupplierOrderStatus,
  DifferenceDisposalStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import { Prisma, type DifferenceDisposalItem, type PaymentAllocation, type PaymentRecord, type Shipment, type SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type PaymentDirection = 'STORE_TO_COMPANY' | 'COMPANY_TO_SUPPLIER';
export type PaymentChannel = 'COMPANY' | 'DIRECT';
export type SettlementItemKind = 'STORE_RECEIVABLE' | 'SUPPLIER_PAYABLE' | 'DIRECT';

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
};

export type ListPaymentRecordsInput = {
  direction?: PaymentRecordDirection;
  status?: PaymentRecordStatus;
  storeId?: string;
  supplierId?: string;
};

export type PaymentScope = { type?: string; storeId?: string; supplierId?: string };

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
};

type PreviewOrder = SupplierOrder & { shipments: Shipment[] };

function matchesPaymentScope(value: { storeId: string | null; supplierId: string | null }, scope?: PaymentScope): boolean {
  if (scope?.type === 'STORE') return value.storeId === scope.storeId;
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
        storeId: scope?.type === 'STORE' ? scope.storeId : input.storeId,
        supplierId: scope?.type === 'SUPPLIER' ? scope.supplierId : input.supplierId,
      },
      include: { allocations: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return payments.map(toPaymentRecordView);
  }

  async get(id: string, scope?: PaymentScope): Promise<PaymentRecordView> {
    const payment = await this.database.client.paymentRecord.findUnique({
      where: { id },
      include: { allocations: { orderBy: { createdAt: 'asc' } } },
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
    const storeReceivableIds = decoded.flatMap(({ decoded: item }) => {
      const order = ordersById.get(item.supplierOrderId);
      return item.kind === 'SUPPLIER_PAYABLE' && order?.settlementMode === 'COMPANY_TERM'
        ? [encodeSettlementItemId('STORE_RECEIVABLE', item.supplierOrderId)]
        : [];
    });
    const allocations = await client.paymentAllocation.findMany({
      where: {
        settlementItemId: { in: [...uniqueIds, ...storeReceivableIds] },
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
      if ((item.decoded.kind === 'DIRECT') !== (order.settlementMode === 'SUPPLIER_TERM')) {
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
      if (item.decoded.kind === 'SUPPLIER_PAYABLE' && order.settlementMode === 'COMPANY_TERM') {
        const receivableId = encodeSettlementItemId('STORE_RECEIVABLE', order.id);
        const storeAmount = new Decimal(order.salesGoodsAmount).plus(order.shipments.reduce((sum, shipment) => sum.plus(shipment.freight), new Decimal(0)));
        if ((allocationSummary.get(receivableId)?.confirmedAmount ?? new Decimal(0)).lessThan(storeAmount)) {
          blockedItems.push({
            settlementItemId: item.id,
            code: 'STORE_RECEIVABLE_UNSETTLED',
            message: 'Store receivable for this company-term order is not fully settled',
          });
          continue;
        }
      }
      items.push(toPreviewItem(item.id, item.decoded.kind, order, allocationSummary.get(item.id), reservedOffsetSummary.get(item.id), snapshotsById.get(item.id)));
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

    const direction = directionForKind(items[0]!.kind);
    const storeId = direction !== 'COMPANY_TO_SUPPLIER' ? items[0]!.storeId : null;
    const supplierId = direction !== 'STORE_TO_COMPANY' ? items[0]!.supplierId : null;
    for (const item of items) {
      if (directionForKind(item.kind) !== direction) {
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
      include: { allocations: { orderBy: { createdAt: 'asc' } } },
    });

    return toPaymentRecordView(payment);
    });
  }

  async confirm(id: string, expectedVersion: number, scope?: PaymentScope): Promise<PaymentRecordView> {
    const payment = await this.database.client.paymentRecord.findUnique({
      where: { id },
      include: { allocations: { orderBy: { createdAt: 'asc' } } },
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
      const result = await tx.paymentRecord.update({
        where: { id },
        data: {
          status: PaymentRecordStatus.CONFIRMED,
          confirmedAt: new Date(),
          version: { increment: 1 },
          allocations: {
            updateMany: {
              where: { state: PaymentAllocationState.RESERVED },
              data: { state: PaymentAllocationState.CONFIRMED },
            },
          },
        },
        include: { allocations: { orderBy: { createdAt: 'asc' } } },
      });
      const orderIds = [...new Set(result.allocations.map((allocation) => allocation.supplierOrderId))];
      const orders = await tx.supplierOrder.findMany({ where: { id: { in: orderIds } }, include: { shipments: true } });
      const ordersById = new Map(orders.map((order) => [order.id, order]));
      await tx.settlementItemSnapshot.createMany({
        data: result.allocations.map((allocation) => {
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
      return result;
    });

    return toPaymentRecordView(confirmed);
  }

  async reject(id: string, expectedVersion: number, reason: string, scope?: PaymentScope): Promise<PaymentRecordView> {
    const payment = await this.database.client.paymentRecord.findUnique({
      where: { id },
      include: { allocations: { orderBy: { createdAt: 'asc' } } },
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

    const rejected = await this.database.client.paymentRecord.update({
      where: { id },
      data: {
        status: PaymentRecordStatus.REJECTED,
        rejectedAt: new Date(),
        rejectedReason: reason,
        version: { increment: 1 },
        allocations: {
          updateMany: {
            where: { state: PaymentAllocationState.RESERVED },
            data: { state: PaymentAllocationState.RELEASED },
          },
        },
      },
      include: { allocations: { orderBy: { createdAt: 'asc' } } },
    });

    return toPaymentRecordView(rejected);
  }

  async cancel(id: string, expectedVersion: number, reason: string, scope?: PaymentScope): Promise<PaymentRecordView> {
    const payment = await this.database.client.paymentRecord.findUnique({
      where: { id },
      include: { allocations: { orderBy: { createdAt: 'asc' } } },
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

    const cancelled = await this.database.client.paymentRecord.update({
      where: { id },
      data: {
        status: PaymentRecordStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledReason: reason,
        version: { increment: 1 },
        allocations: {
          updateMany: {
            where: { state: PaymentAllocationState.RESERVED },
            data: { state: PaymentAllocationState.RELEASED },
          },
        },
      },
      include: { allocations: { orderBy: { createdAt: 'asc' } } },
    });

    return toPaymentRecordView(cancelled);
  }
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
): PaymentPreviewItemView {
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

function summarizeAllocations(allocations: PaymentAllocation[]): Map<string, { pendingAmount: Decimal; confirmedAmount: Decimal }> {
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

function toPaymentRecordView(payment: PaymentRecord & { allocations: PaymentAllocation[] }): PaymentRecordView {
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
