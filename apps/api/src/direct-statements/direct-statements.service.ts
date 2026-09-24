import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { settlementPeriod, type SettlementCycle } from '../../../../packages/domain/src/settlement-period.js';
import { SettlementMode, SupplierOrderStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import type { Shipment, Supplier, SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type ListDirectStatementsInput = {
  storeId?: string;
  supplierId?: string;
  cycle?: SettlementCycle;
  settlementStatus?: 'OPEN';
};

export type DirectStatementLineView = {
  settlementItemId: string;
  supplierOrderId: string;
  supplierOrderNo: string;
  goodsAmount: string;
  freightAmount: string;
  totalAmount: string;
  sourceRevision: number;
  firstShippedAt: string;
};

export type DirectStatementSummaryView = {
  id: string;
  type: 'DIRECT';
  storeId: string;
  supplierId: string;
  cycle: SettlementCycle;
  periodKey: string;
  periodStart: string;
  periodEndExclusive: string;
  settlementStatus: 'OPEN';
  goodsAmount: string;
  freightAmount: string;
  totalAmount: string;
  confirmedPaidAmount: string;
  pendingPaymentAmount: string;
  payableAmount: string;
  lineCount: number;
};

export type DirectStatementDetailView = DirectStatementSummaryView & { lines: DirectStatementLineView[] };

type StatementOrder = SupplierOrder & { supplier: Supplier; shipments: Shipment[] };
type StatementGroup = Omit<DirectStatementSummaryView, 'settlementStatus' | 'goodsAmount' | 'freightAmount' | 'totalAmount' | 'confirmedPaidAmount' | 'pendingPaymentAmount' | 'payableAmount' | 'lineCount'> & { lines: DirectStatementLineView[] };

@Injectable()
export class DirectStatementsService {
  constructor(private readonly database: DatabaseService) {}

  async list(input: ListDirectStatementsInput): Promise<DirectStatementSummaryView[]> {
    return (await this.loadGroups(input)).map(toSummaryView);
  }

  async get(id: string): Promise<DirectStatementDetailView> {
    const key = decodeStatementId(id);
    const group = (await this.loadGroups({ ...key, settlementStatus: 'OPEN' })).find((item) => item.id === id);
    if (!group) {
      throw new NotFoundException({ code: 'DIRECT_STATEMENT_NOT_FOUND', message: 'Direct statement was not found' });
    }
    return { ...toSummaryView(group), lines: group.lines };
  }

  private async loadGroups(input: ListDirectStatementsInput): Promise<StatementGroup[]> {
    if (input.settlementStatus && input.settlementStatus !== 'OPEN') return [];
    const orders = await this.database.client.supplierOrder.findMany({
      where: {
        storeId: input.storeId,
        supplierId: input.supplierId,
        status: SupplierOrderStatus.COMPLETED,
        firstShippedAt: { not: null },
        supplier: { defaultSettlementMode: SettlementMode.SUPPLIER_TERM },
      },
      include: { supplier: true, shipments: true },
      orderBy: [{ firstShippedAt: 'desc' }, { id: 'desc' }],
    });
    const groups = new Map<string, StatementGroup>();
    for (const order of orders) {
      if (!order.firstShippedAt) continue;
      const cycle = normalizeCycle(order.supplier.defaultSettlementCycle);
      if (input.cycle && input.cycle !== cycle) continue;
      const period = settlementPeriod(cycle, order.firstShippedAt);
      const periodEndExclusive = addOneDay(period.endDate);
      const periodKey = `${cycle}:${period.startDate}:${periodEndExclusive}`;
      const key = `${order.storeId}:${order.supplierId}:${periodKey}`;
      const group = groups.get(key) ?? {
        id: encodeStatementId({ storeId: order.storeId, supplierId: order.supplierId, cycle, periodStart: period.startDate, periodEndExclusive }),
        type: 'DIRECT', storeId: order.storeId, supplierId: order.supplierId, cycle, periodKey,
        periodStart: period.startDate, periodEndExclusive, lines: [],
      };
      group.lines.push(toLineView(order));
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.periodStart.localeCompare(a.periodStart) || a.storeId.localeCompare(b.storeId));
  }
}

function toLineView(order: StatementOrder): DirectStatementLineView {
  const goodsAmount = new Decimal(order.salesGoodsAmount);
  const freightAmount = order.shipments.reduce((sum, shipment) => sum.plus(shipment.freight), new Decimal(0));
  return {
    settlementItemId: encodeSettlementItemId(order.id), supplierOrderId: order.id, supplierOrderNo: order.supplierOrderNo,
    goodsAmount: goodsAmount.toFixed(2), freightAmount: freightAmount.toFixed(2), totalAmount: goodsAmount.plus(freightAmount).toFixed(2),
    sourceRevision: order.version, firstShippedAt: order.firstShippedAt!.toISOString(),
  };
}

function toSummaryView(group: StatementGroup): DirectStatementSummaryView {
  const goodsAmount = group.lines.reduce((sum, line) => sum.plus(line.goodsAmount), new Decimal(0));
  const freightAmount = group.lines.reduce((sum, line) => sum.plus(line.freightAmount), new Decimal(0));
  const totalAmount = goodsAmount.plus(freightAmount).toFixed(2);
  return { ...group, settlementStatus: 'OPEN', goodsAmount: goodsAmount.toFixed(2), freightAmount: freightAmount.toFixed(2), totalAmount, confirmedPaidAmount: '0.00', pendingPaymentAmount: '0.00', payableAmount: totalAmount, lineCount: group.lines.length };
}

function normalizeCycle(value: string): SettlementCycle {
  return value === 'WEEKLY' || value === 'HALF_MONTHLY' || value === 'MONTHLY' || value === 'IMMEDIATE' ? value : 'MONTHLY';
}

function addOneDay(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function encodeSettlementItemId(supplierOrderId: string): string {
  return Buffer.from(JSON.stringify({ kind: 'DIRECT', supplierOrderId })).toString('base64url');
}

function encodeStatementId(input: { storeId: string; supplierId: string; cycle: SettlementCycle; periodStart: string; periodEndExclusive: string }): string {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

function decodeStatementId(id: string): { storeId: string; supplierId: string; cycle: SettlementCycle; periodStart: string; periodEndExclusive: string } {
  try {
    const value = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof value.storeId === 'string' && typeof value.supplierId === 'string' && typeof value.periodStart === 'string' && typeof value.periodEndExclusive === 'string' && (value.cycle === 'WEEKLY' || value.cycle === 'HALF_MONTHLY' || value.cycle === 'MONTHLY' || value.cycle === 'IMMEDIATE')) {
      return value as { storeId: string; supplierId: string; cycle: SettlementCycle; periodStart: string; periodEndExclusive: string };
    }
  } catch { /* use the same not-found response for malformed ids */ }
  throw new NotFoundException({ code: 'DIRECT_STATEMENT_NOT_FOUND', message: 'Direct statement was not found' });
}
