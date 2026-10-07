import { Decimal } from 'decimal.js';
import type { Prisma, SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
import { settlementPeriod, type SettlementCycle } from '../../../../packages/domain/src/settlement-period.js';

export async function createFrozenPriceDocuments(tx: Prisma.TransactionClient, input: {
  order: SupplierOrder; baseline: Date; adjustmentId: string; itemId: string; quantity: Decimal;
  salesDelta: Decimal; supplyDelta: Decimal; salesPrice: Decimal; supplyPrice: Decimal;
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
  for (const document of [
    { side: 'STORE', kind: 'STORE_RECEIVABLE', amount: input.salesDelta, price: input.salesPrice },
    { side: 'SUPPLIER', kind: 'SUPPLIER_PAYABLE', amount: input.supplyDelta, price: input.supplyPrice },
  ]) {
    if (document.side === 'STORE' && order.settlementMode === 'CREDIT' && document.amount.isNegative()) continue;
    const kind = order.settlementMode === 'SUPPLIER_TERM' ? 'DIRECT' : document.kind;
    if (document.amount.isZero() || !kinds.has(kind)) continue;
    await tx.adjustmentDocument.create({ data: {
      sourcePriceChangeId: input.adjustmentId, supplierOrderId: order.id, storeId: order.storeId, supplierId: order.supplierId,
      side: document.side, amount: document.amount, originalPeriodKey: periodKey(input.baseline), settlementPeriodKey: periodKey(new Date()),
      sourceRevision: order.version + 1,
      items: { create: { orderItemId: input.itemId, amount: document.amount, quantitySnapshot: input.quantity, unitPriceSnapshot: document.price } },
    } });
  }
}
