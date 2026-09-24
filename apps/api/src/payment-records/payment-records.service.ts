import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  PaymentAllocationState,
  PaymentRecordDirection,
  PaymentRecordStatus,
  SupplierOrderStatus,
  DifferenceDisposalStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type { DifferenceDisposalItem, PaymentAllocation, PaymentRecord, Shipment, SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type PaymentDirection = 'STORE_TO_COMPANY' | 'COMPANY_TO_SUPPLIER';
export type PaymentChannel = 'COMPANY';
export type SettlementItemKind = 'STORE_RECEIVABLE' | 'SUPPLIER_PAYABLE';

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

@Injectable()
export class PaymentRecordsService {
  constructor(private readonly database: DatabaseService) {}

  async list(input: ListPaymentRecordsInput): Promise<PaymentRecordView[]> {
    const payments = await this.database.client.paymentRecord.findMany({
      where: {
        direction: input.direction,
        status: input.status,
        storeId: input.storeId,
        supplierId: input.supplierId,
      },
      include: { allocations: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return payments.map(toPaymentRecordView);
  }

  async get(id: string): Promise<PaymentRecordView> {
    const payment = await this.database.client.paymentRecord.findUnique({
      where: { id },
      include: { allocations: { orderBy: { createdAt: 'asc' } } },
    });
    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_RECORD_NOT_FOUND',
        message: 'Payment record was not found',
      });
    }

    return toPaymentRecordView(payment);
  }

  async preview(settlementItemIds: string[]): Promise<PaymentPreviewView> {
    const uniqueIds = [...new Set(settlementItemIds)];
    const decoded = uniqueIds.map((id) => ({ id, decoded: decodeSettlementItemId(id) }));
    const supplierOrderIds = decoded.map((item) => item.decoded.supplierOrderId);
    const orders = await this.database.client.supplierOrder.findMany({
      where: { id: { in: supplierOrderIds } },
      include: { shipments: true, request: { select: { shortfallAmount: true } } },
    });
    const ordersById = new Map(orders.map((order) => [order.id, order]));
    const storeReceivableIds = decoded.flatMap(({ decoded: item }) => {
      const order = ordersById.get(item.supplierOrderId);
      return item.kind === 'SUPPLIER_PAYABLE' && order?.settlementMode === 'COMPANY_TERM'
        ? [encodeSettlementItemId('STORE_RECEIVABLE', item.supplierOrderId)]
        : [];
    });
    const allocations = await this.database.client.paymentAllocation.findMany({
      where: {
        settlementItemId: { in: [...uniqueIds, ...storeReceivableIds] },
        state: { in: [PaymentAllocationState.RESERVED, PaymentAllocationState.CONFIRMED] },
      },
    });
    const allocationSummary = summarizeAllocations(allocations);
    const offsetItems = await this.database.client.differenceDisposalItem.findMany({
      where: {
        targetDebitItemId: { in: uniqueIds },
        disposal: { status: DifferenceDisposalStatus.CONFIRMED },
      },
    });
    const confirmedOffsetSummary = summarizeOffsets(offsetItems);
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
      items.push(toPreviewItem(item.id, item.decoded.kind, order, allocationSummary.get(item.id), confirmedOffsetSummary.get(item.id)));
    }

    if (items.length === 0) {
      throw new NotFoundException({
        code: 'PAYMENT_PREVIEW_EMPTY',
        message: 'No payable settlement items were found',
        details: { blockedItems },
      });
    }

    const direction = directionForKind(items[0]!.kind);
    const storeId = direction === 'STORE_TO_COMPANY' ? items[0]!.storeId : null;
    const supplierId = direction === 'COMPANY_TO_SUPPLIER' ? items[0]!.supplierId : null;
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

    const totalPayableAmount = items.reduce((sum, item) => sum.plus(item.payableAmount), new Decimal(0));
    const totalPendingPaymentAmount = items.reduce((sum, item) => sum.plus(item.pendingPaymentAmount), new Decimal(0));
    const totalConfirmedPaidAmount = items.reduce((sum, item) => sum.plus(item.confirmedPaidAmount), new Decimal(0));
    return {
      direction,
      channel: 'COMPANY',
      storeId,
      supplierId,
      totalPayableAmount: totalPayableAmount.toFixed(2),
      totalPendingPaymentAmount: totalPendingPaymentAmount.toFixed(2),
      totalConfirmedPaidAmount: totalConfirmedPaidAmount.toFixed(2),
      items,
      blockedItems,
    };
  }

  async create(input: CreatePaymentRecordInput): Promise<PaymentRecordView> {
    const preview = await this.preview(input.items.map((item) => item.settlementItemId));
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
    const payment = await this.database.client.paymentRecord.create({
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
  }

  async confirm(id: string, expectedVersion: number): Promise<PaymentRecordView> {
    const payment = await this.database.client.paymentRecord.findUnique({
      where: { id },
      include: { allocations: { orderBy: { createdAt: 'asc' } } },
    });
    if (!payment) {
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

    const confirmed = await this.database.client.paymentRecord.update({
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

    return toPaymentRecordView(confirmed);
  }

  async reject(id: string, expectedVersion: number, reason: string): Promise<PaymentRecordView> {
    const payment = await this.database.client.paymentRecord.findUnique({
      where: { id },
      include: { allocations: { orderBy: { createdAt: 'asc' } } },
    });
    if (!payment) {
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

  async cancel(id: string, expectedVersion: number, reason: string): Promise<PaymentRecordView> {
    const payment = await this.database.client.paymentRecord.findUnique({
      where: { id },
      include: { allocations: { orderBy: { createdAt: 'asc' } } },
    });
    if (!payment) {
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

function toPreviewItem(
  settlementItemId: string,
  kind: SettlementItemKind,
  order: PreviewOrder,
  allocationSummary: { pendingAmount: Decimal; confirmedAmount: Decimal } | undefined,
  confirmedOffsetAmount: Decimal | undefined,
): PaymentPreviewItemView {
  const goodsAmount = kind === 'STORE_RECEIVABLE' ? new Decimal(order.salesGoodsAmount) : new Decimal(order.supplyGoodsAmount);
  const freightAmount = order.shipments.reduce((sum, shipment) => sum.plus(shipment.freight), new Decimal(0));
  const grossAmount = goodsAmount.plus(freightAmount);
  const pendingAmount = allocationSummary?.pendingAmount ?? new Decimal(0);
  const confirmedAmount = allocationSummary?.confirmedAmount ?? new Decimal(0);
  const offsetAmount = confirmedOffsetAmount ?? new Decimal(0);
  const payableAmount = Decimal.max(grossAmount.minus(pendingAmount).minus(confirmedAmount).minus(offsetAmount), 0);
  return {
    settlementItemId,
    kind,
    supplierOrderId: order.id,
    supplierOrderNo: order.supplierOrderNo,
    storeId: order.storeId,
    supplierId: order.supplierId,
    sourceVersion: order.version,
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
  return kind === 'STORE_RECEIVABLE' ? PaymentRecordDirection.STORE_TO_COMPANY : PaymentRecordDirection.COMPANY_TO_SUPPLIER;
}

function decodeSettlementItemId(id: string): DecodedSettlementItemId {
  try {
    const parsed = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as {
      kind?: unknown;
      supplierOrderId?: unknown;
    };
    if (
      (parsed.kind === 'STORE_RECEIVABLE' || parsed.kind === 'SUPPLIER_PAYABLE') &&
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
    channel: 'COMPANY',
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
