import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { settlementPeriod, type SettlementCycle } from '../../../../packages/domain/src/settlement-period.js';
import { DifferenceDisposalStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import type {
  DifferenceDisposal,
  DifferenceDisposalItem,
  Discrepancy,
  DiscrepancyReturn,
  OrderItem,
  Product,
  Shipment,
  Supplier,
  SupplierOrder,
} from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type AdjustmentProcessingStatus = 'PENDING_DISPOSAL' | 'DISPOSED';
export type AdjustmentDirection = 'SUPPLIER_PAYABLE_DECREASE';
export type AdjustmentType = 'RETURN_SHORTAGE';

export type ListAdjustmentsInput = {
  storeId?: string;
  supplierId?: string;
  cycle?: SettlementCycle;
  periodStart?: string;
  periodEndExclusive?: string;
  processingStatus?: AdjustmentProcessingStatus;
};

export type AdjustmentSummaryView = {
  id: string;
  type: AdjustmentType;
  direction: AdjustmentDirection;
  storeId: string;
  supplierId: string;
  supplierOrderId: string;
  supplierOrderNo: string;
  sourceReturnId: string;
  sourceDiscrepancyId: string;
  originalStatementId: string;
  originalPeriodKey: string;
  originalPeriodStart: string;
  originalPeriodEndExclusive: string;
  actualPeriodKey: string;
  periodStart: string;
  periodEndExclusive: string;
  cycle: SettlementCycle;
  goodsAdjustmentAmount: string;
  freightAdjustmentAmount: string;
  adjustmentAmount: string;
  confirmedPaidAmount: string;
  pendingPaymentAmount: string;
  payableAmount: string;
  pendingReturnOrOffsetAmount: string;
  processingStatus: AdjustmentProcessingStatus;
  sourceRevision: number;
  createdAt: string;
};

export type AdjustmentDetailView = AdjustmentSummaryView & {
  lines: AdjustmentLineView[];
  disposal: AdjustmentDisposalView | null;
};

export type AdjustmentLineView = {
  orderItemId: string;
  productId: string;
  productName: string;
  quantity: string;
  unitSupplyPrice: string;
  supplyAdjustmentAmount: string;
  sourceRevision: number;
};

export type AdjustmentDisposalView = {
  disposalId: string;
  disposalNo: string;
  status: DifferenceDisposalStatus;
  amount: string;
  confirmedAt: string | null;
};

type ReturnWithRelations = DiscrepancyReturn & {
  discrepancy: Discrepancy;
  orderItem: OrderItem & { product: Product; supplierOrder: SupplierOrder & { supplier: Supplier; shipments: Shipment[] } };
  differenceDisposalItems: Array<DifferenceDisposalItem & { disposal: DifferenceDisposal }>;
};

@Injectable()
export class AdjustmentsService {
  constructor(private readonly database: DatabaseService) {}

  async list(input: ListAdjustmentsInput): Promise<AdjustmentSummaryView[]> {
    const rows = await this.loadRows(input);
    return rows.map(toSummaryView);
  }

  async get(id: string, scope?: { type?: string; storeId?: string; supplierId?: string }): Promise<AdjustmentDetailView> {
    const key = decodeAdjustmentId(id);
    const rows = await this.loadRows({ storeId: scope?.type === 'STORE' ? scope.storeId : key.storeId, supplierId: scope?.type === 'SUPPLIER' ? scope.supplierId : key.supplierId });
    const row = rows.find((item) => encodeAdjustmentId(item.id, item.orderItem.supplierOrder.storeId, item.orderItem.supplierOrder.supplierId) === id);
    if (!row) {
      throw new NotFoundException({
        code: 'ADJUSTMENT_NOT_FOUND',
        message: 'Adjustment was not found',
      });
    }
    return toDetailView(row);
  }

  private async loadRows(input: ListAdjustmentsInput): Promise<ReturnWithRelations[]> {
    const returns = await this.database.client.discrepancyReturn.findMany({
      where: {
        orderItem: {
          supplierOrder: {
            storeId: input.storeId,
            supplierId: input.supplierId,
            firstShippedAt: { not: null },
          },
        },
      },
      include: {
        discrepancy: true,
        differenceDisposalItems: { include: { disposal: true }, orderBy: { createdAt: 'asc' } },
        orderItem: {
          include: {
            product: true,
            supplierOrder: { include: { supplier: true, shipments: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return returns.filter((row) => {
      const order = row.orderItem.supplierOrder;
      if (!order.firstShippedAt) {
        return false;
      }
      const cycle = normalizeCycle(order.settlementCycleSnapshot);
      if (input.cycle && input.cycle !== cycle) {
        return false;
      }
      const actualPeriod = toPeriod(cycle, row.createdAt);
      if (input.periodStart && input.periodStart !== actualPeriod.periodStart) {
        return false;
      }
      if (input.periodEndExclusive && input.periodEndExclusive !== actualPeriod.periodEndExclusive) {
        return false;
      }
      if (input.processingStatus && input.processingStatus !== processingStatus(row)) {
        return false;
      }
      return true;
    });
  }
}

function toSummaryView(row: ReturnWithRelations): AdjustmentSummaryView {
  const order = row.orderItem.supplierOrder;
  const cycle = normalizeCycle(order.settlementCycleSnapshot);
  const originalPeriod = toPeriod(cycle, order.firstShippedAt!);
  const actualPeriod = toPeriod(cycle, row.createdAt);
  const amount = adjustmentAmount(row);
  const processing = processingStatus(row);
  return {
    id: encodeAdjustmentId(row.id, order.storeId, order.supplierId),
    type: 'RETURN_SHORTAGE',
    direction: 'SUPPLIER_PAYABLE_DECREASE',
    storeId: order.storeId,
    supplierId: order.supplierId,
    supplierOrderId: order.id,
    supplierOrderNo: order.supplierOrderNo,
    sourceReturnId: row.id,
    sourceDiscrepancyId: row.discrepancyId,
    originalStatementId: encodeSupplierStatementId({
      supplierId: order.supplierId,
      cycle,
      periodStart: originalPeriod.periodStart,
      periodEndExclusive: originalPeriod.periodEndExclusive,
    }),
    originalPeriodKey: originalPeriod.periodKey,
    originalPeriodStart: originalPeriod.periodStart,
    originalPeriodEndExclusive: originalPeriod.periodEndExclusive,
    actualPeriodKey: actualPeriod.periodKey,
    periodStart: actualPeriod.periodStart,
    periodEndExclusive: actualPeriod.periodEndExclusive,
    cycle,
    goodsAdjustmentAmount: amount.negated().toFixed(2),
    freightAdjustmentAmount: '0.00',
    adjustmentAmount: amount.negated().toFixed(2),
    confirmedPaidAmount: '0.00',
    pendingPaymentAmount: '0.00',
    payableAmount: amount.negated().toFixed(2),
    pendingReturnOrOffsetAmount: processing === 'DISPOSED' ? '0.00' : amount.toFixed(2),
    processingStatus: processing,
    sourceRevision: order.version,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetailView(row: ReturnWithRelations): AdjustmentDetailView {
  const summary = toSummaryView(row);
  const disposalItem = row.differenceDisposalItems[0];
  return {
    ...summary,
    lines: [
      {
        orderItemId: row.orderItemId,
        productId: row.orderItem.productId,
        productName: row.orderItem.product.name,
        quantity: row.quantity.toString(),
        unitSupplyPrice: row.orderItem.supplyUnitPrice.toFixed(2),
        supplyAdjustmentAmount: adjustmentAmount(row).negated().toFixed(2),
        sourceRevision: row.orderItem.supplierOrder.version,
      },
    ],
    disposal: disposalItem
      ? {
          disposalId: disposalItem.disposalId,
          disposalNo: disposalItem.disposal.disposalNo,
          status: disposalItem.disposal.status,
          amount: disposalItem.amount.toFixed(2),
          confirmedAt: disposalItem.disposal.confirmedAt?.toISOString() ?? null,
        }
      : null,
  };
}

function adjustmentAmount(row: ReturnWithRelations): Decimal {
  return new Decimal(row.quantity).mul(row.orderItem.supplyUnitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function processingStatus(row: ReturnWithRelations): AdjustmentProcessingStatus {
  return row.differenceDisposalItems.some((item) => item.disposal.status === DifferenceDisposalStatus.CONFIRMED)
    ? 'DISPOSED'
    : 'PENDING_DISPOSAL';
}

function toPeriod(cycle: SettlementCycle, value: Date): {
  periodKey: string;
  periodStart: string;
  periodEndExclusive: string;
} {
  const period = settlementPeriod(cycle, value);
  const periodEndExclusive = addOneDay(period.endDate);
  return {
    periodKey: `${cycle}:${period.startDate}:${periodEndExclusive}`,
    periodStart: period.startDate,
    periodEndExclusive,
  };
}

function normalizeCycle(value: string): SettlementCycle {
  if (value === 'WEEKLY' || value === 'HALF_MONTHLY' || value === 'MONTHLY' || value === 'IMMEDIATE') {
    return value;
  }
  return 'MONTHLY';
}

function addOneDay(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function encodeAdjustmentId(returnId: string, storeId: string, supplierId: string): string {
  return Buffer.from(JSON.stringify({ kind: 'RETURN_SHORTAGE', returnId, storeId, supplierId })).toString('base64url');
}

function decodeAdjustmentId(id: string): { returnId: string; storeId: string; supplierId: string } {
  try {
    const parsed = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as {
      kind?: unknown;
      returnId?: unknown;
      storeId?: unknown;
      supplierId?: unknown;
    };
    if (
      parsed.kind === 'RETURN_SHORTAGE' &&
      typeof parsed.returnId === 'string' &&
      typeof parsed.storeId === 'string' &&
      typeof parsed.supplierId === 'string'
    ) {
      return { returnId: parsed.returnId, storeId: parsed.storeId, supplierId: parsed.supplierId };
    }
  } catch {
    // Fall through to the uniform not found response.
  }
  throw new NotFoundException({
    code: 'ADJUSTMENT_NOT_FOUND',
    message: 'Adjustment was not found',
  });
}

function encodeSupplierStatementId(input: {
  supplierId: string;
  cycle: SettlementCycle;
  periodStart: string;
  periodEndExclusive: string;
}): string {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}
