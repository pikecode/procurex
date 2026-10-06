import { Decimal } from 'decimal.js';
import type { Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import { lineAmount } from '../../../../packages/domain/src/money.js';
import { settlementPeriod } from '../../../../packages/domain/src/settlement-period.js';
import { effectiveOrderItemQuantity } from '../supplier-orders/fulfillment-status.js';
import { loadFundingPaymentStates, requestFundingWhere } from '../purchase-requests/request-funding.js';
import { recordCreditMovement } from '../stores/credit-movements.js';

// Caller holds the order row and settlement advisory locks for the entire resolution.
export async function adjustAcceptedShortage(tx: Prisma.TransactionClient, discrepancyId: string, itemId: string): Promise<void> {
  const item = await tx.orderItem.findUniqueOrThrow({ where: { id: itemId }, include: {
    shipmentItems: true, discrepancies: { include: { returnRecord: true } },
    supplierOrder: { include: { request: true, settlementItemSnapshots: true } },
  } });
  const order = item.supplierOrder;
  const quantity = effectiveOrderItemQuantity(item);
  const sales = lineAmount(quantity, item.salesUnitPrice);
  const supply = lineAmount(quantity, item.supplyUnitPrice);
  const salesDelta = sales.minus(item.salesLineAmount);
  const supplyDelta = supply.minus(item.supplyLineAmount);
  await tx.orderItem.update({ where: { id: itemId }, data: { salesLineAmount: sales, supplyLineAmount: supply } });
  await tx.supplierOrder.update({ where: { id: order.id }, data: {
    salesGoodsAmount: { increment: salesDelta }, supplyGoodsAmount: { increment: supplyDelta },
  } });
  await tx.requestItem.updateMany({ where: { requestId: order.requestId, productId: item.productId }, data: {
    salesLineAmount: { increment: salesDelta }, supplyLineAmount: { increment: supplyDelta },
  } });
  const request = await tx.purchaseRequest.update({ where: { id: order.requestId }, data: {
    salesGoodsAmount: { increment: salesDelta }, supplyGoodsAmount: { increment: supplyDelta }, version: { increment: 1 },
  }, include: { supplierOrders: { include: { shipments: true } } } });
  const cycle = order.settlementCycleSnapshot as 'WEEKLY' | 'HALF_MONTHLY' | 'MONTHLY' | 'IMMEDIATE';
  const periodKey = (date: Date) => {
    const period = settlementPeriod(cycle, date);
    const end = new Date(`${period.endDate}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return `${cycle}:${period.startDate}:${end.toISOString().slice(0, 10)}`;
  };
  for (const side of [{ side: 'STORE', kind: 'STORE_RECEIVABLE', amount: salesDelta }, { side: 'SUPPLIER', kind: 'SUPPLIER_PAYABLE', amount: supplyDelta }]) {
    if (side.side === 'STORE' && order.settlementMode === 'CREDIT') continue;
    const kind = order.settlementMode === 'SUPPLIER_TERM' ? 'DIRECT' : side.kind;
    if (side.amount.isZero() || !order.settlementItemSnapshots.some(snapshot => snapshot.kind === kind)) continue;
    const unitPrice = side.side === 'STORE' ? new Decimal(item.salesUnitPrice) : new Decimal(item.supplyUnitPrice);
    await tx.adjustmentDocument.create({ data: {
      sourceDiscrepancyId: discrepancyId, supplierOrderId: order.id, storeId: order.storeId, supplierId: order.supplierId,
      side: side.side, amount: side.amount, sourceRevision: order.version + 1,
      originalPeriodKey: periodKey(order.firstShippedAt ?? order.request.submittedAt), settlementPeriodKey: periodKey(new Date()),
      items: { create: { orderItemId: itemId, amount: side.amount, unitPriceSnapshot: unitPrice,
        quantitySnapshot: unitPrice.isZero() ? null : side.amount.abs().div(unitPrice).toDecimalPlaces(6, Decimal.ROUND_HALF_UP) } },
    } });
  }
  await tx.$queryRaw`SELECT id FROM "StoreAccount" WHERE "storeId" = ${order.storeId}::uuid FOR UPDATE`;
  const creditAccount = await tx.storeAccount.findUnique({ where: { storeId: order.storeId } });
  const allocations = await tx.fundingAllocation.findMany({ where: { ...requestFundingWhere(order.requestId), supplierOrderId: order.id }, orderBy: { id: 'asc' } });
  const paymentStates = await loadFundingPaymentStates(tx, allocations);
  let reduction = Decimal.max(0, salesDelta.negated());
  let refund = new Decimal(0);
  let releasedReserve = new Decimal(0);
  let releasedCredit = new Decimal(0);
  let clearedCreditAdjustment = new Decimal(0);
  for (const allocation of allocations) {
    const decrease = Decimal.min(reduction, allocation.targetAmount);
    const target = new Decimal(allocation.targetAmount).minus(decrease);
    if (allocation.method === 'CREDIT') clearedCreditAdjustment = clearedCreditAdjustment.plus(
      Decimal.max(0, paymentStates.get(allocation.id)!.effectivePaid.minus(target))
        .minus(Decimal.max(0, paymentStates.get(allocation.id)!.effectivePaid.minus(allocation.targetAmount))));
    const cash = allocation.method === 'STORED_VALUE' ? Decimal.min(decrease, Decimal.max(0, new Decimal(allocation.netPaid).minus(target))) : new Decimal(0);
    const credit = allocation.method === 'CREDIT' ? Decimal.min(decrease, allocation.creditOutstanding) : new Decimal(0);
    const reserve = allocation.method === 'STORED_VALUE' ? Decimal.min(decrease.minus(cash), allocation.reservedAmount) : new Decimal(0);
    await tx.fundingAllocation.update({ where: { id: allocation.id }, data: {
      targetAmount: target, netPaid: { decrement: cash }, reservedAmount: { decrement: reserve }, creditOutstanding: { decrement: credit }, version: { increment: 1 },
      ...(allocation.method === 'CREDIT' ? { active: new Decimal(allocation.creditOutstanding).minus(credit).gt(0) } : {}),
    } });
    if (credit.gt(0) && creditAccount) await recordCreditMovement(tx, {
      accountId: creditAccount.id, fundingAllocationId: allocation.id,
      before: allocation.creditOutstanding, after: new Decimal(allocation.creditOutstanding).minus(credit),
      sourceType: 'ADJUSTMENT', sourceId: discrepancyId,
    });
    reduction = reduction.minus(decrease);
    refund = refund.plus(cash);
    releasedReserve = releasedReserve.plus(reserve);
    releasedCredit = releasedCredit.plus(credit);
  }
  if (clearedCreditAdjustment.gt(0)) {
    const unitPrice = new Decimal(item.salesUnitPrice);
    await tx.adjustmentDocument.create({ data: {
      sourceDiscrepancyId: discrepancyId, supplierOrderId: order.id, storeId: order.storeId, supplierId: order.supplierId,
      side: 'STORE', amount: clearedCreditAdjustment.negated(), sourceRevision: order.version + 1,
      originalPeriodKey: periodKey(order.firstShippedAt ?? order.request.submittedAt), settlementPeriodKey: periodKey(new Date()),
      items: { create: { orderItemId: itemId, amount: clearedCreditAdjustment.negated(), unitPriceSnapshot: unitPrice,
        quantitySnapshot: unitPrice.isZero() ? null : clearedCreditAdjustment.div(unitPrice).toDecimalPlaces(6, Decimal.ROUND_HALF_UP) } },
    } });
  }
  if (!refund.isZero() || !releasedCredit.isZero() || !releasedReserve.isZero()) {
    const account = await tx.storeAccount.update({ where: { storeId: order.storeId }, data: {
      balance: { increment: refund }, reservedBalance: { decrement: releasedReserve }, creditUsed: { decrement: releasedCredit }, version: { increment: 1 },
    } });
    if (!refund.isZero()) await tx.accountLedger.create({ data: {
      accountId: account.id, requestId: order.requestId, direction: 'CREDIT', amount: refund, balanceAfter: account.balance,
      sourceType: 'ADJUSTMENT', sourceId: discrepancyId, note: 'Accepted receipt shortage refund',
    } });
  }
  const termSettlement = order.settlementMode === 'COMPANY_TERM' || order.settlementMode === 'SUPPLIER_TERM';
  const paid = allocations.length ? Decimal.max(0, new Decimal(request.paidAmount).minus(refund))
    : termSettlement ? new Decimal(request.paidAmount) : Decimal.min(request.paidAmount, request.salesGoodsAmount);
  const freight = request.supplierOrders.filter(row => row.status !== 'REJECTED' && row.status !== 'CANCELED')
    .reduce((sum, row) => sum.plus(row.shipments.reduce((total, shipment) => total.plus(shipment.freight), new Decimal(0))), new Decimal(0));
  await tx.purchaseRequest.update({ where: { id: request.id }, data: {
    paidAmount: paid, shortfallAmount: allocations.length
      ? Decimal.max(0, new Decimal(request.shortfallAmount).plus(salesDelta).plus(refund))
      : termSettlement ? new Decimal(request.shortfallAmount) : Decimal.max(0, new Decimal(request.salesGoodsAmount).minus(paid)),
    ...(allocations.length ? { paymentStatus: paid.gte(new Decimal(request.salesGoodsAmount).plus(freight)) ? 'PAID' : 'UNPAID' } : {}),
  } });
}
