import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { settlementPeriod, type SettlementCycle } from '../../../../packages/domain/src/settlement-period.js';
import { DifferenceDisposalStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import type {
  AdjustmentDocument,
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

export function adjustmentDocumentViewId(document: Pick<AdjustmentDocument, 'id' | 'storeId' | 'supplierId' | 'side' | 'sourcePriceChangeId' | 'sourceShipmentId' | 'sourceDiscrepancyId' | 'shipmentAdjustmentKind'> & { sourceRejectedOrderId?: string | null }): string | undefined {
  if (document.sourcePriceChangeId) return Buffer.from(JSON.stringify({ kind: 'PRICE_DOCUMENT', documentId: document.id, storeId: document.storeId, supplierId: document.supplierId })).toString('base64url');
  if (!document.sourceShipmentId && !document.sourceDiscrepancyId && !document.sourceRejectedOrderId) return undefined;
  const kind = document.sourceRejectedOrderId ? 'ORDER_REJECTION' : document.shipmentAdjustmentKind === 'FREIGHT' ? 'FREIGHT_CHANGE' : document.sourceShipmentId ? 'PERMANENT_REDUCTION' : 'ACCEPTED_SHORTAGE';
  return Buffer.from(JSON.stringify({ kind, documentId: document.id, storeId: document.storeId, supplierId: document.supplierId })).toString('base64url');
}
import { DatabaseService } from '../database/database.service.js';

export type AdjustmentProcessingStatus = 'PENDING_DISPOSAL' | 'DISPOSED';
export type AdjustmentDirection =
  | 'SUPPLIER_PAYABLE_DECREASE'
  | 'SUPPLIER_PAYABLE_INCREASE'
  | 'STORE_RECEIVABLE_DECREASE'
  | 'STORE_RECEIVABLE_INCREASE';
export type AdjustmentType = 'RETURN_SHORTAGE' | 'PRICE_CHANGE' | 'ACCEPTED_SHORTAGE' | 'PERMANENT_REDUCTION' | 'FREIGHT_CHANGE' | 'ORDER_REJECTION';

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
  disposalCreditItemId?: string;
  offsetTargetItemId?: string;
  sourcePriceChangeId?: string;
  sourceShipmentId?: string;
  sourceRejectedOrderId?: string;
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
  version: number;
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

type PriceWithRelations = {
  id: string;
  supplierOrderId: string;
  orderItemId: string;
  salesDelta: Decimal;
  supplyDelta: Decimal;
  createdAt: Date;
  disposalBySide?: Partial<Record<'STORE' | 'SUPPLIER', AdjustmentDisposalView>>;
  disposalCreditItemIdBySide?: Partial<Record<'STORE' | 'SUPPLIER', string>>;
  disposalCreditAmountBySide?: Partial<Record<'STORE' | 'SUPPLIER', Decimal>>;
  offsetTargetItemIdBySide?: Partial<Record<'STORE' | 'SUPPLIER', string>>;
  fundingRefund?: Decimal;
  lineSnapshotBySide?: Partial<Record<'STORE' | 'SUPPLIER', { quantity: Decimal | null; price: Decimal | null }>>;
  orderItem: OrderItem & { product: Product; supplierOrder: SupplierOrder & { supplier: Supplier; shipments: Shipment[]; request: { submittedAt: Date } } };
};

@Injectable()
export class AdjustmentsService {
  constructor(private readonly database: DatabaseService) {}

  async list(input: ListAdjustmentsInput): Promise<AdjustmentSummaryView[]> {
    const [returns, prices, shortages] = await Promise.all([this.loadRows(input), this.loadPriceRows(input), this.loadShortageRows(input)]);
    return [...returns.map(toSummaryView), ...prices.flatMap(toPriceSummaryViews), ...shortages]
      .filter((view) => !input.processingStatus || view.processingStatus === input.processingStatus)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string, scope?: { type?: string; storeId?: string; supplierId?: string }): Promise<AdjustmentDetailView> {
    const key = decodeAdjustmentId(id);
    const filter = { storeId: isStoreScope(scope?.type) ? scope?.storeId : key.storeId, supplierId: scope?.type === 'SUPPLIER' ? scope?.supplierId : key.supplierId };
    if (key.documentId) {
      const documents = await this.database.client.adjustmentDocument.findMany({ where: { id: key.documentId, storeId: filter.storeId, supplierId: filter.supplierId } });
      const document = documents.find(item => adjustmentDocumentViewId(item) === id);
      if (document?.sourcePriceChangeId) {
        const prices = await this.loadPriceRows(filter, false);
        const price = prices.find(item => item.id === document.sourcePriceChangeId);
        const side = document.side === 'STORE' ? 'STORE' : 'SUPPLIER';
        const view = price && toPriceSummaryViews(price).find(item => item.direction.startsWith(`${side}_`));
        if (price && view) return { ...view, id, lines: [toPriceLine(price, view.direction)], disposal: price.disposalBySide?.[side] ?? null };
      }
      throw new NotFoundException({ code: 'ADJUSTMENT_NOT_FOUND', message: 'Adjustment was not found' });
    }
    const [rows, prices, shortages] = await Promise.all([this.loadRows(filter), this.loadPriceRows(filter), this.loadShortageRows(filter)]);
    const shortage = shortages.find(item => item.id === id);
    if (shortage) return shortage;
    const row = rows.find((item) => encodeAdjustmentId(item.id, item.orderItem.supplierOrder.storeId, item.orderItem.supplierOrder.supplierId) === id);
    if (row) return toDetailView(row);
    const price = prices.find((item) => toPriceSummaryViews(item).some((view) => view.id === id));
    if (price) {
      const view = toPriceSummaryViews(price).find((item) => item.id === id)!;
      return { ...view, lines: [toPriceLine(price, view.direction)], disposal: price.disposalBySide?.[view.direction.startsWith('STORE_') ? 'STORE' : 'SUPPLIER'] ?? null };
    }
    throw new NotFoundException({
      code: 'ADJUSTMENT_NOT_FOUND',
      message: 'Adjustment was not found',
    });
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
      // Preserve already-booked historical disposals, but review records are not new credits.
      if (!row.differenceDisposalItems.length) return false;
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

  private async loadShortageRows(input: ListAdjustmentsInput): Promise<AdjustmentDetailView[]> {
    const documents = await this.database.client.adjustmentDocument?.findMany({
      where: { OR: [{ sourceDiscrepancyId: { not: null } }, { sourceShipmentId: { not: null } }, { sourceRejectedOrderId: { not: null } }], storeId: input.storeId, supplierId: input.supplierId },
      include: { items: true, disposalItems: { include: { disposal: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }) ?? [];
    const sources = documents.filter(document => document.sourceDiscrepancyId || document.sourceShipmentId || document.sourceRejectedOrderId);
    if (!sources.length) return [];
    const refunds = await this.database.client.accountLedger.findMany({
      where: { sourceType: 'ADJUSTMENT', direction: 'CREDIT', sourceId: { in: sources.map(document => (document.sourceDiscrepancyId ?? document.sourceShipmentId ?? document.sourceRejectedOrderId)!) } },
    });
    const refundBySource = new Map(refunds.map(ledger => [ledger.sourceId, new Decimal(ledger.amount)]));
    const orders = await this.database.client.supplierOrder.findMany({
      where: { id: { in: sources.map(document => document.supplierOrderId) }, storeId: input.storeId, supplierId: input.supplierId },
      include: { items: { include: { product: true } }, request: { select: { submittedAt: true } } },
    });
    return sources.flatMap(document => {
      const order = orders.find(order => order.id === document.supplierOrderId);
      if (!order) return [];
      const cycle = normalizeCycle(order.settlementCycleSnapshot);
      const original = toPeriod(cycle, order.firstShippedAt ?? order.request.submittedAt);
      const current = toPeriod(cycle, document.createdAt);
      if ((input.cycle && input.cycle !== cycle) || (input.periodStart && input.periodStart !== current.periodStart) ||
        (input.periodEndExclusive && input.periodEndExclusive !== current.periodEndExclusive)) return [];
      const disposalItem = document.disposalItems.find(item => item.disposal.status === DifferenceDisposalStatus.CONFIRMED) ?? document.disposalItems[0];
      const side = document.side === 'STORE' ? 'STORE' : 'SUPPLIER';
      const amount = new Decimal(document.amount);
      const fundingRefund = side === 'STORE' ? refundBySource.get((document.sourceDiscrepancyId ?? document.sourceShipmentId ?? document.sourceRejectedOrderId)!) ?? new Decimal(0) : new Decimal(0);
      const remainingCredit = amount.isNegative() ? Decimal.max(0, amount.abs().minus(fundingRefund)) : new Decimal(0);
      const disposed = disposalItem?.disposal.status === DifferenceDisposalStatus.CONFIRMED || (amount.isNegative() && remainingCredit.isZero());
      const freight = document.shipmentAdjustmentKind === 'FREIGHT';
      const type = document.sourceRejectedOrderId ? 'ORDER_REJECTION' as const : freight ? 'FREIGHT_CHANGE' as const : document.sourceShipmentId ? 'PERMANENT_REDUCTION' as const : 'ACCEPTED_SHORTAGE' as const;
      const id = adjustmentDocumentViewId(document)!;
      return [{
        id, type, direction: side === 'STORE' ? (amount.isPositive() ? 'STORE_RECEIVABLE_INCREASE' as const : 'STORE_RECEIVABLE_DECREASE' as const) : (amount.isPositive() ? 'SUPPLIER_PAYABLE_INCREASE' as const : 'SUPPLIER_PAYABLE_DECREASE' as const),
        storeId: order.storeId, supplierId: order.supplierId, supplierOrderId: order.id, supplierOrderNo: order.supplierOrderNo,
        sourceReturnId: '', sourceDiscrepancyId: document.sourceDiscrepancyId ?? '', ...(document.sourceShipmentId ? { sourceShipmentId: document.sourceShipmentId } : {}),
        ...(document.sourceRejectedOrderId ? { sourceRejectedOrderId: document.sourceRejectedOrderId } : {}), ...(remainingCredit.isZero() ? {} : { disposalCreditItemId: document.id }),
        originalStatementId: encodeSupplierStatementId({ supplierId: order.supplierId, cycle, periodStart: original.periodStart, periodEndExclusive: original.periodEndExclusive }),
        originalPeriodKey: document.originalPeriodKey, originalPeriodStart: original.periodStart, originalPeriodEndExclusive: original.periodEndExclusive,
        actualPeriodKey: document.settlementPeriodKey, periodStart: current.periodStart, periodEndExclusive: current.periodEndExclusive, cycle,
        ...(amount.isPositive() ? { offsetTargetItemId: encodeAdjustmentSettlementItemId(document.id, order.id, side) } : {}),
        goodsAdjustmentAmount: freight ? '0.00' : amount.toFixed(2), freightAdjustmentAmount: freight ? amount.toFixed(2) : '0.00', adjustmentAmount: amount.toFixed(2),
        confirmedPaidAmount: '0.00', pendingPaymentAmount: '0.00', payableAmount: amount.toFixed(2),
        pendingReturnOrOffsetAmount: disposed ? '0.00' : remainingCredit.toFixed(2), processingStatus: disposed ? 'DISPOSED' as const : 'PENDING_DISPOSAL' as const,
        sourceRevision: document.sourceRevision, createdAt: document.createdAt.toISOString(),
        lines: document.items.flatMap(line => {
          const item = order.items.find(item => item.id === line.orderItemId);
          if (!item) return [];
          const price = new Decimal(line.unitPriceSnapshot ?? (side === 'STORE' ? item.salesUnitPrice : item.supplyUnitPrice));
          return [{ orderItemId: item.id, productId: item.productId, productName: item.product.name,
            quantity: line.quantitySnapshot?.toString() ?? (price.isZero() ? '0' : new Decimal(line.amount).abs().div(price).toString()), unitSupplyPrice: price.toFixed(2),
            supplyAdjustmentAmount: line.amount.toFixed(2), sourceRevision: document.sourceRevision }];
        }),
        disposal: disposalItem ? { disposalId: disposalItem.disposalId, version: disposalItem.disposal.version, disposalNo: disposalItem.disposal.disposalNo,
          status: disposalItem.disposal.status, amount: disposalItem.amount.toFixed(2), confirmedAt: disposalItem.disposal.confirmedAt?.toISOString() ?? null } : null,
      }];
    });
  }

  private async loadPriceRows(input: ListAdjustmentsInput, aggregate = true): Promise<PriceWithRelations[]> {
    const rows = await this.database.client.priceChangeAdjustment.findMany({
      where: { orderItem: { supplierOrder: { storeId: input.storeId, supplierId: input.supplierId } } },
      include: { orderItem: { include: { product: true, supplierOrder: { include: { supplier: true, shipments: true, request: { select: { submittedAt: true } } } } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const documents = await this.database.client.adjustmentDocument?.findMany({
      where: { sourcePriceChangeId: { in: rows.map((row) => row.id) } },
      include: { disposalItems: { include: { disposal: true } }, items: true },
      orderBy: { createdAt: 'desc' },
    }) ?? [];
    const documentsBySource = new Map<string, typeof documents>();
    const refunds = rows.length ? await this.database.client.accountLedger?.findMany({ where: {
      sourceType: 'ADJUSTMENT', direction: 'CREDIT', sourceId: { in: rows.map(row => row.id) },
    } }) ?? [] : [];
    const refundBySource = new Map(refunds.map(row => [row.sourceId, new Decimal(row.amount)]));
    for (const document of documents) {
      if (!document.sourcePriceChangeId) continue;
      const list = documentsBySource.get(document.sourcePriceChangeId) ?? [];
      list.push(document);
      documentsBySource.set(document.sourcePriceChangeId, list);
    }
    const settlementItemIds = rows.flatMap((row) => {
      const order = row.orderItem.supplierOrder;
      const kind = order.settlementMode === 'SUPPLIER_TERM' ? 'DIRECT' : 'STORE_RECEIVABLE';
      return [encodeSettlementItemId(kind, order.id), encodeSettlementItemId(order.settlementMode === 'SUPPLIER_TERM' ? 'DIRECT' : 'SUPPLIER_PAYABLE', order.id)];
    });
    const snapshots = await this.database.client.settlementItemSnapshot?.findMany({
      where: { settlementItemId: { in: settlementItemIds } },
    }) ?? [];
    const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.settlementItemId, snapshot]));
    const filtered = rows.flatMap((row) => {
      const order = row.orderItem.supplierOrder;
      const cycle = normalizeCycle(order.settlementCycleSnapshot);
      const period = toPeriod(cycle, row.createdAt);
      if ((input.cycle && input.cycle !== cycle) || (input.periodStart && input.periodStart !== period.periodStart) ||
        (input.periodEndExclusive && input.periodEndExclusive !== period.periodEndExclusive)) return [];
      const persisted = documentsBySource.get(row.id);
      if (persisted?.length) {
        const salesDelta = persisted.find((document) => document.side === 'STORE')?.amount ?? new Decimal(0);
        const supplyDelta = persisted.find((document) => document.side === 'SUPPLIER')?.amount ?? new Decimal(0);
        const disposalBySide = Object.fromEntries(persisted.flatMap((document) => {
          const disposal = document.disposalItems?.[0]?.disposal;
          return disposal ? [[document.side, {
            disposalId: disposal.id,
            version: disposal.version,
            disposalNo: disposal.disposalNo,
            status: disposal.status,
            amount: document.disposalItems?.[0]!.amount.toFixed(2) ?? '0.00',
            confirmedAt: disposal.confirmedAt?.toISOString() ?? null,
          }]] : [];
        })) as PriceWithRelations['disposalBySide'];
        const disposalCreditItemIdBySide = Object.fromEntries((['STORE', 'SUPPLIER'] as const).flatMap((side) => {
          const credits = persisted.filter((document) => document.side === side && new Decimal(document.amount).isNegative());
          return credits.length === 1 ? [[side, credits[0]!.id]] : [];
        })) as PriceWithRelations['disposalCreditItemIdBySide'];
        const disposalCreditAmountBySide = Object.fromEntries((['STORE', 'SUPPLIER'] as const).flatMap((side) => {
          const credit = persisted.find((document) => document.side === side && new Decimal(document.amount).isNegative());
          return credit ? [[side, new Decimal(credit.amount).abs()]] : [];
        })) as PriceWithRelations['disposalCreditAmountBySide'];
        const offsetTargetItemIdBySide = Object.fromEntries((['STORE', 'SUPPLIER'] as const).flatMap((side) => {
          const target = persisted.find((document) => document.side === side && new Decimal(document.amount).isPositive());
          const net = side === 'STORE' ? salesDelta : supplyDelta;
          return target && new Decimal(target.amount).eq(net)
            ? [[side, encodeAdjustmentSettlementItemId(target.id, row.supplierOrderId, side)]]
            : [];
        })) as PriceWithRelations['offsetTargetItemIdBySide'];
        const lineSnapshotBySide = Object.fromEntries(persisted.flatMap(document => {
          const line = document.items?.find(item => item.orderItemId === row.orderItemId);
          return line ? [[document.side, { quantity: line.quantitySnapshot, price: line.unitPriceSnapshot }]] : [];
        })) as PriceWithRelations['lineSnapshotBySide'];
        return salesDelta.isZero() && supplyDelta.isZero() ? [] : [{ ...row, salesDelta, supplyDelta, disposalBySide, disposalCreditItemIdBySide, disposalCreditAmountBySide, offsetTargetItemIdBySide, fundingRefund: refundBySource.get(row.id), lineSnapshotBySide }];
      }
      const storeKind = order.settlementMode === 'SUPPLIER_TERM' ? 'DIRECT' : 'STORE_RECEIVABLE';
      const storeSnapshot = snapshotsById.get(encodeSettlementItemId(storeKind, order.id));
      const supplierKind = order.settlementMode === 'SUPPLIER_TERM' ? 'DIRECT' : 'SUPPLIER_PAYABLE';
      const supplierSnapshot = snapshotsById.get(encodeSettlementItemId(supplierKind, order.id));
      const salesDelta = storeSnapshot && row.createdAt > storeSnapshot.createdAt ? row.salesDelta : new Decimal(0);
      const supplyDelta = supplierSnapshot && row.createdAt > supplierSnapshot.createdAt ? row.supplyDelta : new Decimal(0);
      return salesDelta.isZero() && supplyDelta.isZero() ? [] : [{ ...row, salesDelta, supplyDelta }];
    }) as PriceWithRelations[];
    // Cleared-credit refund sources stay individually actionable; other summaries retain existing netting.
    if (!aggregate) return filtered;
    const net = new Map<string, PriceWithRelations>();
    const actionableRows: PriceWithRelations[] = [];
    for (const row of filtered) {
      if (row.orderItem.supplierOrder.settlementMode === 'CREDIT' && row.disposalCreditItemIdBySide?.STORE) {
        actionableRows.push(row);
        continue;
      }
      const current = net.get(row.orderItemId);
      if (!current) {
        net.set(row.orderItemId, row);
        continue;
      }
      current.salesDelta = current.salesDelta.plus(row.salesDelta);
      current.supplyDelta = current.supplyDelta.plus(row.supplyDelta);
      current.fundingRefund = new Decimal(current.fundingRefund ?? 0).plus(row.fundingRefund ?? 0);
      current.disposalCreditItemIdBySide = {};
      current.offsetTargetItemIdBySide = {};
      if (row.createdAt > current.createdAt) current.createdAt = row.createdAt;
    }
    return [...actionableRows, ...net.values()];
  }
}

function isStoreScope(type?: string): boolean {
  return type === 'STORE' || type === 'STORE_FINANCE';
}

function encodeSettlementItemId(kind: 'STORE_RECEIVABLE' | 'SUPPLIER_PAYABLE' | 'DIRECT', supplierOrderId: string): string {
  return Buffer.from(JSON.stringify({ kind, supplierOrderId })).toString('base64url');
}

function encodeAdjustmentSettlementItemId(adjustmentDocumentId: string, supplierOrderId: string, adjustmentSide: 'STORE' | 'SUPPLIER'): string {
  return Buffer.from(JSON.stringify({ kind: 'ADJUSTMENT', supplierOrderId, adjustmentDocumentId, adjustmentSide })).toString('base64url');
}

function toPriceSummaryViews(row: PriceWithRelations): AdjustmentSummaryView[] {
  const order = row.orderItem.supplierOrder;
  const cycle = normalizeCycle(order.settlementCycleSnapshot);
  const originalPeriod = toPeriod(cycle, order.firstShippedAt ?? order.request.submittedAt);
  const actualPeriod = toPeriod(cycle, row.createdAt);
  const views: AdjustmentSummaryView[] = [];
  if (!row.salesDelta.isZero()) views.push(toPriceSummary(row, 'STORE', row.salesDelta, originalPeriod, actualPeriod, cycle));
  if (!row.supplyDelta.isZero()) views.push(toPriceSummary(row, 'SUPPLIER', row.supplyDelta, originalPeriod, actualPeriod, cycle));
  return views;
}

function toPriceSummary(row: PriceWithRelations, side: 'STORE' | 'SUPPLIER', delta: Decimal, originalPeriod: ReturnType<typeof toPeriod>, actualPeriod: ReturnType<typeof toPeriod>, cycle: SettlementCycle): AdjustmentSummaryView {
  const order = row.orderItem.supplierOrder;
  const increase = delta.greaterThan(0);
  const remainingCredit = delta.isNegative() ? Decimal.max(0, delta.abs().minus(side === 'STORE' ? row.fundingRefund ?? 0 : 0)) : new Decimal(0);
  const disposed = row.disposalBySide?.[side]?.status === DifferenceDisposalStatus.CONFIRMED || (delta.isNegative() && remainingCredit.isZero());
  return {
    id: encodePriceAdjustmentId(row.id, order.storeId, order.supplierId, side), type: 'PRICE_CHANGE',
    direction: side === 'STORE' ? (increase ? 'STORE_RECEIVABLE_INCREASE' : 'STORE_RECEIVABLE_DECREASE') : (increase ? 'SUPPLIER_PAYABLE_INCREASE' : 'SUPPLIER_PAYABLE_DECREASE'),
    storeId: order.storeId, supplierId: order.supplierId, supplierOrderId: order.id, supplierOrderNo: order.supplierOrderNo,
    sourceReturnId: '', sourcePriceChangeId: row.id, sourceDiscrepancyId: '',
    ...(remainingCredit.gt(0) && row.disposalCreditItemIdBySide?.[side] && row.disposalCreditAmountBySide?.[side]?.eq(delta.abs()) ? { disposalCreditItemId: row.disposalCreditItemIdBySide[side] } : {}),
    ...(delta.isPositive() && row.offsetTargetItemIdBySide?.[side] ? { offsetTargetItemId: row.offsetTargetItemIdBySide[side] } : {}),
    originalStatementId: encodeSupplierStatementId({ supplierId: order.supplierId, cycle, periodStart: originalPeriod.periodStart, periodEndExclusive: originalPeriod.periodEndExclusive }),
    originalPeriodKey: originalPeriod.periodKey, originalPeriodStart: originalPeriod.periodStart, originalPeriodEndExclusive: originalPeriod.periodEndExclusive,
    actualPeriodKey: actualPeriod.periodKey, periodStart: actualPeriod.periodStart, periodEndExclusive: actualPeriod.periodEndExclusive, cycle,
    goodsAdjustmentAmount: delta.toFixed(2), freightAdjustmentAmount: '0.00', adjustmentAmount: delta.toFixed(2), confirmedPaidAmount: '0.00', pendingPaymentAmount: '0.00', payableAmount: delta.toFixed(2), pendingReturnOrOffsetAmount: disposed ? '0.00' : remainingCredit.toFixed(2), processingStatus: disposed ? 'DISPOSED' : 'PENDING_DISPOSAL', sourceRevision: order.version, createdAt: row.createdAt.toISOString(),
  };
}

function toPriceLine(row: PriceWithRelations, direction: AdjustmentDirection): AdjustmentLineView {
  const delta = direction.startsWith('STORE_') ? row.salesDelta : row.supplyDelta;
  const snapshot = row.lineSnapshotBySide?.[direction.startsWith('STORE_') ? 'STORE' : 'SUPPLIER'];
  const price = snapshot?.price ?? (direction.startsWith('STORE_') ? row.orderItem.salesUnitPrice : row.orderItem.supplyUnitPrice);
  return { orderItemId: row.orderItemId, productId: row.orderItem.productId, productName: row.orderItem.product.name, quantity: (snapshot?.quantity ?? row.orderItem.quantity).toString(), unitSupplyPrice: price.toFixed(2), supplyAdjustmentAmount: delta.toFixed(2), sourceRevision: row.orderItem.supplierOrder.version };
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
          version: disposalItem.disposal.version,
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

function encodePriceAdjustmentId(priceChangeId: string, storeId: string, supplierId: string, side: 'STORE' | 'SUPPLIER'): string {
  return Buffer.from(JSON.stringify({ kind: 'PRICE_CHANGE', priceChangeId, storeId, supplierId, side })).toString('base64url');
}

function decodeAdjustmentId(id: string): { storeId: string; supplierId: string; documentId?: string } {
  try {
    const parsed = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as {
      kind?: unknown;
      returnId?: unknown;
      priceChangeId?: unknown;
      documentId?: unknown;
      storeId?: unknown;
      supplierId?: unknown;
    };
    if (
      (parsed.kind === 'RETURN_SHORTAGE' || parsed.kind === 'PRICE_CHANGE' || parsed.kind === 'PRICE_DOCUMENT' || parsed.kind === 'ACCEPTED_SHORTAGE' || parsed.kind === 'PERMANENT_REDUCTION' || parsed.kind === 'FREIGHT_CHANGE' || parsed.kind === 'ORDER_REJECTION') &&
      (parsed.kind === 'PRICE_DOCUMENT' || parsed.kind === 'ACCEPTED_SHORTAGE' || parsed.kind === 'PERMANENT_REDUCTION' || parsed.kind === 'FREIGHT_CHANGE' || parsed.kind === 'ORDER_REJECTION' ? typeof parsed.documentId === 'string' : parsed.kind === 'PRICE_CHANGE' ? typeof parsed.priceChangeId === 'string' : typeof parsed.returnId === 'string') &&
      typeof parsed.storeId === 'string' &&
      typeof parsed.supplierId === 'string'
    ) {
      return { storeId: parsed.storeId, supplierId: parsed.supplierId, ...(parsed.kind === 'PRICE_DOCUMENT' ? { documentId: parsed.documentId as string } : {}) };
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
