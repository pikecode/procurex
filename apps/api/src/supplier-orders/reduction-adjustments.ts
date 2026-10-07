import { Decimal } from 'decimal.js';
import type { Prisma, SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
import { settlementPeriod, type SettlementCycle } from '../../../../packages/domain/src/settlement-period.js';

export async function createReductionDocuments(tx: Prisma.TransactionClient, input: {
  order: SupplierOrder; shipmentId: string; baseline: Date;
  lines: Array<{ itemId: string; quantity: Decimal; salesChange: Decimal; supplyChange: Decimal; salesPrice: Decimal; supplyPrice: Decimal }>;
}): Promise<void> {
  const { order } = input;
  const snapshots = await tx.settlementItemSnapshot.findMany({ where: { supplierOrderId: order.id } });
  const kinds = new Set(snapshots.map(snapshot => snapshot.kind));
  const periodKey = (date: Date) => {
    const period = settlementPeriod(order.settlementCycleSnapshot as SettlementCycle, date);
    const end = new Date(`${period.endDate}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return `${order.settlementCycleSnapshot}:${period.startDate}:${end.toISOString().slice(0, 10)}`;
  };
  for (const side of ['STORE', 'SUPPLIER'] as const) {
    const kind = order.settlementMode === 'SUPPLIER_TERM' ? 'DIRECT' : side === 'STORE' ? 'STORE_RECEIVABLE' : 'SUPPLIER_PAYABLE';
    if (!kinds.has(kind)) continue;
    const lines = input.lines.map(line => ({ orderItemId: line.itemId, quantitySnapshot: line.quantity,
      amount: side === 'STORE' ? line.salesChange : line.supplyChange,
      unitPriceSnapshot: side === 'STORE' ? line.salesPrice : line.supplyPrice,
    })).filter(line => !line.amount.isZero());
    if (!lines.length) continue;
    await tx.adjustmentDocument.create({ data: {
      sourceShipmentId: input.shipmentId, shipmentAdjustmentKind: 'REDUCTION', supplierOrderId: order.id, storeId: order.storeId, supplierId: order.supplierId,
      side, amount: lines.reduce((sum, line) => sum.plus(line.amount), new Decimal(0)),
      originalPeriodKey: periodKey(input.baseline), settlementPeriodKey: periodKey(new Date()), sourceRevision: order.version + 1,
      items: { create: lines },
    } });
  }
}

export async function createFrozenFreightDocuments(tx: Prisma.TransactionClient, input: {
  order: SupplierOrder; shipmentId: string; baseline: Date; freight: Decimal;
}): Promise<void> {
  if (input.freight.isZero()) return;
  const snapshots = await tx.settlementItemSnapshot.findMany({ where: { supplierOrderId: input.order.id } });
  const kinds = new Set(snapshots.map(snapshot => snapshot.kind));
  const periodKey = (date: Date) => {
    const period = settlementPeriod(input.order.settlementCycleSnapshot as SettlementCycle, date);
    const end = new Date(`${period.endDate}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return `${input.order.settlementCycleSnapshot}:${period.startDate}:${end.toISOString().slice(0, 10)}`;
  };
  for (const side of ['STORE', 'SUPPLIER'] as const) {
    const kind = input.order.settlementMode === 'SUPPLIER_TERM' ? 'DIRECT' : side === 'STORE' ? 'STORE_RECEIVABLE' : 'SUPPLIER_PAYABLE';
    if (!kinds.has(kind)) continue;
    await tx.adjustmentDocument.create({ data: {
      sourceShipmentId: input.shipmentId, shipmentAdjustmentKind: 'FREIGHT', supplierOrderId: input.order.id,
      storeId: input.order.storeId, supplierId: input.order.supplierId, side, amount: input.freight,
      originalPeriodKey: periodKey(input.baseline), settlementPeriodKey: periodKey(new Date()), sourceRevision: input.order.version + 1,
    } });
  }
}
