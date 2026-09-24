import { NotFoundException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { settlementPeriod, type SettlementCycle } from '../../../../packages/domain/src/settlement-period.js';
import { SupplierOrderStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import type { Shipment, Supplier, SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type StoreStatementStatus = 'OPEN';

export type ListStoreStatementsInput = {
  storeId?: string;
  supplierId?: string;
  cycle?: SettlementCycle;
  settlementStatus?: StoreStatementStatus;
};

export type StoreStatementSummaryView = {
  id: string;
  type: 'STORE';
  storeId: string;
  supplierId: string;
  cycle: SettlementCycle;
  periodKey: string;
  periodStart: string;
  periodEndExclusive: string;
  settlementStatus: StoreStatementStatus;
  goodsAmount: string;
  freightAmount: string;
  totalAmount: string;
  confirmedPaidAmount: string;
  pendingPaymentAmount: string;
  payableAmount: string;
  lineCount: number;
};

export type StoreStatementDetailView = StoreStatementSummaryView & {
  lines: StoreStatementLineView[];
};

export type StoreStatementLineView = {
  supplierOrderId: string;
  supplierOrderNo: string;
  goodsAmount: string;
  freightAmount: string;
  totalAmount: string;
  sourceRevision: number;
  firstShippedAt: string;
};

type StatementOrder = SupplierOrder & { supplier: Supplier; shipments: Shipment[] };

type StatementGroup = {
  id: string;
  storeId: string;
  supplierId: string;
  cycle: SettlementCycle;
  periodKey: string;
  periodStart: string;
  periodEndExclusive: string;
  lines: StoreStatementLineView[];
};

@Injectable()
export class StoreStatementsService {
  constructor(private readonly database: DatabaseService) {}

  async list(input: ListStoreStatementsInput): Promise<StoreStatementSummaryView[]> {
    const groups = await this.loadGroups(input);
    return groups.map(toSummaryView);
  }

  async get(id: string): Promise<StoreStatementDetailView> {
    const key = decodeStatementId(id);
    const groups = await this.loadGroups({
      storeId: key.storeId,
      supplierId: key.supplierId,
      cycle: key.cycle,
      settlementStatus: 'OPEN',
    });
    const group = groups.find(
      (item) =>
        item.periodStart === key.periodStart &&
        item.periodEndExclusive === key.periodEndExclusive &&
        item.id === id,
    );
    if (!group) {
      throw new NotFoundException({
        code: 'STORE_STATEMENT_NOT_FOUND',
        message: 'Store statement was not found',
      });
    }
    return { ...toSummaryView(group), lines: group.lines };
  }

  private async loadGroups(input: ListStoreStatementsInput): Promise<StatementGroup[]> {
    if (input.settlementStatus && input.settlementStatus !== 'OPEN') {
      return [];
    }

    const orders = await this.database.client.supplierOrder.findMany({
      where: {
        storeId: input.storeId,
        supplierId: input.supplierId,
        status: SupplierOrderStatus.COMPLETED,
        firstShippedAt: { not: null },
      },
      include: {
        supplier: true,
        shipments: true,
      },
      orderBy: [{ firstShippedAt: 'desc' }, { id: 'desc' }],
    });

    const groups = new Map<string, StatementGroup>();
    for (const order of orders) {
      if (!order.firstShippedAt) {
        continue;
      }
      const cycle = normalizeCycle(order.supplier.defaultSettlementCycle);
      if (input.cycle && cycle !== input.cycle) {
        continue;
      }
      const period = settlementPeriod(cycle, order.firstShippedAt);
      const periodEndExclusive = addOneDay(period.endDate);
      const periodKey = `${cycle}:${period.startDate}:${periodEndExclusive}`;
      const key = `${order.storeId}:${order.supplierId}:${periodKey}`;
      const group =
        groups.get(key) ??
        {
          id: encodeStatementId({
            storeId: order.storeId,
            supplierId: order.supplierId,
            cycle,
            periodStart: period.startDate,
            periodEndExclusive,
          }),
          storeId: order.storeId,
          supplierId: order.supplierId,
          cycle,
          periodKey,
          periodStart: period.startDate,
          periodEndExclusive,
          lines: [],
        };
      group.lines.push(toLineView(order));
      groups.set(key, group);
    }

    return [...groups.values()].sort((left, right) => {
      const byPeriod = right.periodStart.localeCompare(left.periodStart);
      return byPeriod || left.supplierId.localeCompare(right.supplierId);
    });
  }
}

function toLineView(order: StatementOrder): StoreStatementLineView {
  const goodsAmount = new Decimal(order.salesGoodsAmount);
  const freightAmount = order.shipments.reduce((sum, shipment) => sum.plus(shipment.freight), new Decimal(0));
  return {
    supplierOrderId: order.id,
    supplierOrderNo: order.supplierOrderNo,
    goodsAmount: goodsAmount.toFixed(2),
    freightAmount: freightAmount.toFixed(2),
    totalAmount: goodsAmount.plus(freightAmount).toFixed(2),
    sourceRevision: order.version,
    firstShippedAt: order.firstShippedAt!.toISOString(),
  };
}

function toSummaryView(group: StatementGroup): StoreStatementSummaryView {
  const goodsAmount = group.lines.reduce((sum, line) => sum.plus(line.goodsAmount), new Decimal(0));
  const freightAmount = group.lines.reduce((sum, line) => sum.plus(line.freightAmount), new Decimal(0));
  const totalAmount = goodsAmount.plus(freightAmount);
  return {
    id: group.id,
    type: 'STORE',
    storeId: group.storeId,
    supplierId: group.supplierId,
    cycle: group.cycle,
    periodKey: group.periodKey,
    periodStart: group.periodStart,
    periodEndExclusive: group.periodEndExclusive,
    settlementStatus: 'OPEN',
    goodsAmount: goodsAmount.toFixed(2),
    freightAmount: freightAmount.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    confirmedPaidAmount: '0.00',
    pendingPaymentAmount: '0.00',
    payableAmount: totalAmount.toFixed(2),
    lineCount: group.lines.length,
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

function encodeStatementId(input: {
  storeId: string;
  supplierId: string;
  cycle: SettlementCycle;
  periodStart: string;
  periodEndExclusive: string;
}): string {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

function decodeStatementId(id: string): {
  storeId: string;
  supplierId: string;
  cycle: SettlementCycle;
  periodStart: string;
  periodEndExclusive: string;
} {
  try {
    const parsed = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as {
      storeId?: unknown;
      supplierId?: unknown;
      cycle?: unknown;
      periodStart?: unknown;
      periodEndExclusive?: unknown;
    };
    if (
      typeof parsed.storeId === 'string' &&
      typeof parsed.supplierId === 'string' &&
      (parsed.cycle === 'WEEKLY' || parsed.cycle === 'HALF_MONTHLY' || parsed.cycle === 'MONTHLY' || parsed.cycle === 'IMMEDIATE') &&
      typeof parsed.periodStart === 'string' &&
      typeof parsed.periodEndExclusive === 'string'
    ) {
      return {
        storeId: parsed.storeId,
        supplierId: parsed.supplierId,
        cycle: parsed.cycle,
        periodStart: parsed.periodStart,
        periodEndExclusive: parsed.periodEndExclusive,
      };
    }
  } catch {
    // Fall through to the uniform not found response.
  }
  throw new NotFoundException({
    code: 'STORE_STATEMENT_NOT_FOUND',
    message: 'Store statement was not found',
  });
}
