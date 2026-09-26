import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { settlementPeriod, type SettlementCycle } from '../../../../packages/domain/src/settlement-period.js';
import { PaymentAllocationState, SettlementMode, SupplierOrderStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import type { Shipment, Supplier, SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { summarizeAllocations } from '../payment-records/payment-records.service.js';

export type ListDirectStatementsInput = {
  storeId?: string;
  supplierId?: string;
  cycle?: SettlementCycle;
  settlementStatus?: 'OPEN' | 'SETTLED';
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
  priceAdjustments: Array<{ id: string; runId: string; orderItemId: string; salesDelta: string; supplyDelta: string; createdAt: string }>;
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
  settlementStatus: 'OPEN' | 'SETTLED';
  goodsAmount: string;
  freightAmount: string;
  totalAmount: string;
  confirmedPaidAmount: string;
  pendingPaymentAmount: string;
  payableAmount: string;
  adjustmentAmount: string;
  adjustmentSettlementItemIds: string[];
  lineCount: number;
};

export type DirectStatementDetailView = DirectStatementSummaryView & { lines: DirectStatementLineView[] };

type StatementOrder = SupplierOrder & { supplier: Supplier; shipments: Shipment[]; priceChangeRuns: Array<{ runId: string; adjustment: { id: string; orderItemId: string; salesDelta: import('decimal.js').Decimal; supplyDelta: import('decimal.js').Decimal; createdAt: Date } | null }> };
type StatementGroup = Omit<DirectStatementSummaryView, 'settlementStatus' | 'goodsAmount' | 'freightAmount' | 'totalAmount' | 'confirmedPaidAmount' | 'pendingPaymentAmount' | 'payableAmount' | 'adjustmentAmount' | 'adjustmentSettlementItemIds' | 'lineCount'> & { lines: DirectStatementLineView[]; paymentSummary: { pendingAmount: Decimal; confirmedAmount: Decimal }; adjustmentAmount: Decimal; adjustmentSettlementItemIds: string[] };

@Injectable()
export class DirectStatementsService {
  constructor(private readonly database: DatabaseService) {}

  async list(input: ListDirectStatementsInput): Promise<DirectStatementSummaryView[]> {
    return (await this.loadGroups(input)).map(toSummaryView);
  }

  async get(id: string, scope?: { type?: string; storeId?: string; supplierId?: string }): Promise<DirectStatementDetailView> {
    const key = decodeStatementId(id);
    const group = (await this.loadGroups({ ...key, storeId: scope?.type === 'STORE' || scope?.type === 'STORE_FINANCE' ? scope.storeId : key.storeId, supplierId: scope?.type === 'SUPPLIER' ? scope.supplierId : key.supplierId })).find((item) => item.id === id);
    if (!group) {
      throw new NotFoundException({ code: 'DIRECT_STATEMENT_NOT_FOUND', message: 'Direct statement was not found' });
    }
    return { ...toSummaryView(group), lines: group.lines };
  }

  private async loadGroups(input: ListDirectStatementsInput): Promise<StatementGroup[]> {
    const orders = await this.database.client.supplierOrder.findMany({
      where: {
        storeId: input.storeId,
        supplierId: input.supplierId,
        status: SupplierOrderStatus.COMPLETED,
        firstShippedAt: { not: null },
        settlementMode: SettlementMode.SUPPLIER_TERM,
      },
      include: { supplier: true, shipments: true, priceChangeRuns: { include: { adjustment: true }, where: { status: 'SUCCEEDED' } } },
      orderBy: [{ firstShippedAt: 'desc' }, { id: 'desc' }],
    });
    const snapshots = await this.database.client.settlementItemSnapshot?.findMany({
      where: { settlementItemId: { in: orders.map((order) => encodeSettlementItemId(order.id)) } },
    }) ?? [];
    const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.settlementItemId, snapshot]));
    const groups = new Map<string, StatementGroup>();
    for (const order of orders) {
      if (!order.firstShippedAt) continue;
      const cycle = normalizeCycle(order.settlementCycleSnapshot);
      if (input.cycle && input.cycle !== cycle) continue;
      const period = settlementPeriod(cycle, order.firstShippedAt);
      const periodEndExclusive = addOneDay(period.endDate);
      const periodKey = `${cycle}:${period.startDate}:${periodEndExclusive}`;
      const key = `${order.storeId}:${order.supplierId}:${periodKey}${cycle === 'IMMEDIATE' ? `:${order.id}` : ''}`;
      const group = groups.get(key) ?? {
        id: encodeStatementId({ storeId: order.storeId, supplierId: order.supplierId, cycle, periodStart: period.startDate, periodEndExclusive, orderId: cycle === 'IMMEDIATE' ? order.id : undefined }),
        type: 'DIRECT', storeId: order.storeId, supplierId: order.supplierId, cycle, periodKey,
        periodStart: period.startDate, periodEndExclusive, lines: [], paymentSummary: { pendingAmount: new Decimal(0), confirmedAmount: new Decimal(0) }, adjustmentAmount: new Decimal(0), adjustmentSettlementItemIds: [],
      };
      group.lines.push(toLineView(order, snapshotsById.get(encodeSettlementItemId(order.id))));
      groups.set(key, group);
    }
    const adjustmentDocuments = await this.database.client.adjustmentDocument?.findMany({ where: { storeId: input.storeId, supplierId: input.supplierId, side: 'STORE' } }) ?? [];
    for (const document of adjustmentDocuments) {
      const period = parsePeriodKey(document.settlementPeriodKey);
      if (!period || (input.cycle && input.cycle !== period.cycle)) continue;
      const key = `${document.storeId}:${document.supplierId}:${document.settlementPeriodKey}${period.cycle === 'IMMEDIATE' ? `:${document.supplierOrderId}` : ''}`;
      const group = groups.get(key) ?? {
        id: encodeStatementId({ storeId: document.storeId, supplierId: document.supplierId, cycle: period.cycle, periodStart: period.periodStart, periodEndExclusive: period.periodEndExclusive, orderId: period.cycle === 'IMMEDIATE' ? document.supplierOrderId : undefined }),
        type: 'DIRECT', storeId: document.storeId, supplierId: document.supplierId, cycle: period.cycle, periodKey: document.settlementPeriodKey,
        periodStart: period.periodStart, periodEndExclusive: period.periodEndExclusive, lines: [], paymentSummary: { pendingAmount: new Decimal(0), confirmedAmount: new Decimal(0) }, adjustmentAmount: new Decimal(0), adjustmentSettlementItemIds: [],
      };
      group.adjustmentAmount = group.adjustmentAmount.plus(document.amount);
      group.adjustmentSettlementItemIds.push(encodeAdjustmentSettlementItemId(document.id, document.supplierOrderId, 'STORE'));
      groups.set(key, group);
    }
    const allGroups = [...groups.values()];
    const allocations = await this.database.client.paymentAllocation?.findMany({ where: { settlementItemId: { in: allGroups.flatMap((group) => [...group.lines.map((line) => line.settlementItemId), ...group.adjustmentSettlementItemIds]) }, state: { in: [PaymentAllocationState.RESERVED, PaymentAllocationState.CONFIRMED] } } }) ?? [];
    const byItem = summarizeAllocations(allocations);
    for (const group of allGroups) for (const itemId of [...group.lines.map((line) => line.settlementItemId), ...group.adjustmentSettlementItemIds]) { const summary = byItem.get(itemId); if (summary) { group.paymentSummary.pendingAmount = group.paymentSummary.pendingAmount.plus(summary.pendingAmount); group.paymentSummary.confirmedAmount = group.paymentSummary.confirmedAmount.plus(summary.confirmedAmount); } }
    return allGroups.filter((group) => !input.settlementStatus || toSettlementStatus(group) === input.settlementStatus).sort((a, b) => b.periodStart.localeCompare(a.periodStart) || a.storeId.localeCompare(b.storeId));
  }
}

function toLineView(order: StatementOrder, snapshot?: { goodsAmount: import('decimal.js').Decimal; freightAmount: import('decimal.js').Decimal; totalAmount: import('decimal.js').Decimal; sourceVersion: number }): DirectStatementLineView {
  const goodsAmount = snapshot?.goodsAmount ?? new Decimal(order.salesGoodsAmount);
  const freightAmount = snapshot?.freightAmount ?? order.shipments.reduce((sum, shipment) => sum.plus(shipment.freight), new Decimal(0));
  return {
    settlementItemId: encodeSettlementItemId(order.id), supplierOrderId: order.id, supplierOrderNo: order.supplierOrderNo,
    goodsAmount: goodsAmount.toFixed(2), freightAmount: freightAmount.toFixed(2), totalAmount: (snapshot?.totalAmount ?? goodsAmount.plus(freightAmount)).toFixed(2),
    sourceRevision: snapshot?.sourceVersion ?? order.version, firstShippedAt: order.firstShippedAt!.toISOString(),
    priceAdjustments: (order.priceChangeRuns ?? []).flatMap(({ runId, adjustment }) => adjustment ? [{ id: adjustment.id, runId, orderItemId: adjustment.orderItemId, salesDelta: adjustment.salesDelta.toFixed(2), supplyDelta: adjustment.supplyDelta.toFixed(2), createdAt: adjustment.createdAt.toISOString() }] : []),
  };
}

function toSummaryView(group: StatementGroup): DirectStatementSummaryView {
  const goodsAmount = group.lines.reduce((sum, line) => sum.plus(line.goodsAmount), new Decimal(0));
  const freightAmount = group.lines.reduce((sum, line) => sum.plus(line.freightAmount), new Decimal(0));
  const totalAmount = goodsAmount.plus(freightAmount).toFixed(2);
  return { ...group, settlementStatus: toSettlementStatus(group), goodsAmount: goodsAmount.toFixed(2), freightAmount: freightAmount.toFixed(2), totalAmount, adjustmentAmount: group.adjustmentAmount.toFixed(2), confirmedPaidAmount: group.paymentSummary.confirmedAmount.toFixed(2), pendingPaymentAmount: group.paymentSummary.pendingAmount.toFixed(2), payableAmount: Decimal.max(new Decimal(totalAmount).plus(Decimal.max(group.adjustmentAmount, 0)).minus(group.paymentSummary.confirmedAmount).minus(group.paymentSummary.pendingAmount), 0).toFixed(2), lineCount: group.lines.length };
}

function parsePeriodKey(value: string): { cycle: SettlementCycle; periodStart: string; periodEndExclusive: string } | null {
  const [cycle, periodStart, periodEndExclusive] = value.split(':');
  if ((cycle !== 'WEEKLY' && cycle !== 'HALF_MONTHLY' && cycle !== 'MONTHLY' && cycle !== 'IMMEDIATE') || !periodStart || !periodEndExclusive) return null;
  return { cycle, periodStart, periodEndExclusive };
}

function toSettlementStatus(group: StatementGroup): 'OPEN' | 'SETTLED' {
  const total = group.lines.reduce((sum, line) => sum.plus(line.totalAmount), new Decimal(0)).plus(Decimal.max(group.adjustmentAmount, 0));
  return group.paymentSummary.confirmedAmount.greaterThanOrEqualTo(total) ? 'SETTLED' : 'OPEN';
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

function encodeAdjustmentSettlementItemId(adjustmentDocumentId: string, supplierOrderId: string, adjustmentSide: 'STORE' | 'SUPPLIER'): string {
  return Buffer.from(JSON.stringify({ kind: 'ADJUSTMENT', supplierOrderId, adjustmentDocumentId, adjustmentSide })).toString('base64url');
}

function encodeStatementId(input: { storeId: string; supplierId: string; cycle: SettlementCycle; periodStart: string; periodEndExclusive: string; orderId?: string }): string {
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
