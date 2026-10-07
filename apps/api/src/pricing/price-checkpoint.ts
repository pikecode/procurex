import { ConflictException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import { lineAmount } from '../../../../packages/domain/src/money.js';
import { effectiveOrderItemQuantity } from '../supplier-orders/fulfillment-status.js';
import { requestFundingWhere, synchronizeRequestFunding } from '../purchase-requests/request-funding.js';
import { createFrozenPriceDocuments } from './frozen-price-adjustments.js';
import { effectivePriceVersion } from './effective-price.js';

// Publication is exclusive; completion/checkpoints share this lock before taking account/order locks.
export async function lockPricePublication(tx: Prisma.TransactionClient, exclusive = false): Promise<void> {
  if (exclusive) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('PRICE_PUBLICATION', 0))`;
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('PRICE_PUBLICATION', 0))`;
}

export async function applyEffectiveOrderPrices(tx: Prisma.TransactionClient, orderId: string, at: Date,
  options: { deferCreditShortfall?: boolean } = {}): Promise<{ changed: boolean; fundingHandled: boolean }> {
  const order = await tx.supplierOrder.findUniqueOrThrow({ where: { id: orderId }, include: { request: { select: { templateId: true } }, items: { include: {
    shipmentItems: true, discrepancies: { include: { returnRecord: true } },
  } } } });
  let salesDelta = new Decimal(0);
  let supplyDelta = new Decimal(0);
  let changed = false;
  const frozen = await tx.settlementItemSnapshot.count({ where: { supplierOrderId: order.id } }) > 0;
  for (const item of order.items) {
    const version = await effectivePriceVersion(tx, item.productId, order.supplierId, at, order.request.templateId);
    if (!version || (new Decimal(item.salesUnitPrice).eq(version.salesPrice) && new Decimal(item.supplyUnitPrice).eq(version.supplyPrice))) continue;
    if (order.settlementMode === 'SUPPLIER_TERM' && !new Decimal(version.salesPrice).eq(version.supplyPrice)) {
      throw new ConflictException({ code: 'DIRECT_TERM_PRICES_MUST_MATCH', message: 'Checkpoint prices must match for direct supplier terms' });
    }
    const source = frozen ? await tx.priceChangeRunVersion.findFirst({ where: { priceVersionId: { in: [version.id, version.supplyVersionId] }, run: { orders: { some: { supplierOrderId: order.id, status: 'PENDING', adjustment: null } } } },
      include: { run: { include: { orders: { where: { supplierOrderId: order.id }, include: { adjustment: true } } } } },
    }) : null;
    const sourceOrder = source?.run.orders[0];
    if (frozen && (!sourceOrder || sourceOrder.status !== 'PENDING' || sourceOrder.adjustment)) {
      throw new ConflictException({ code: 'FROZEN_PRICE_CHECKPOINT_RECONCILIATION_REQUIRED', message: 'Frozen repricing requires an unapplied published price-run source for this order' });
    }
    const quantity = effectiveOrderItemQuantity(item);
    const sales = lineAmount(quantity, version.salesPrice);
    const supply = lineAmount(quantity, version.supplyPrice);
    const itemSalesDelta = sales.minus(item.salesLineAmount);
    const itemSupplyDelta = supply.minus(item.supplyLineAmount);
    salesDelta = salesDelta.plus(itemSalesDelta);
    supplyDelta = supplyDelta.plus(itemSupplyDelta);
    await tx.orderItem.update({ where: { id: item.id }, data: {
      salesPriceVersionId: version.id, supplyPriceVersionId: version.supplyVersionId,
      salesUnitPrice: version.salesPrice, supplyUnitPrice: version.supplyPrice, salesLineAmount: sales, supplyLineAmount: supply,
    } });
    await tx.requestItem.updateMany({ where: { requestId: order.requestId, supplierId: order.supplierId, productId: item.productId }, data: {
      priceVersionId: version.id, supplyPriceVersionId: version.supplyVersionId, salesUnitPrice: version.salesPrice, supplyUnitPrice: version.supplyPrice, salesLineAmount: sales, supplyLineAmount: supply,
    } });
    if (frozen && sourceOrder) {
      await tx.supplierOrder.update({ where: { id: order.id }, data: { salesGoodsAmount: { increment: itemSalesDelta }, supplyGoodsAmount: { increment: itemSupplyDelta } } });
      const request = await tx.purchaseRequest.update({ where: { id: order.requestId }, data: {
        salesGoodsAmount: { increment: itemSalesDelta }, supplyGoodsAmount: { increment: itemSupplyDelta }, version: { increment: 1 },
      } });
      const adjustment = await tx.priceChangeAdjustment.create({ data: {
        runId: sourceOrder.runId, supplierOrderId: order.id, orderItemId: item.id,
        previousSalesPrice: item.salesUnitPrice, newSalesPrice: version.salesPrice,
        previousSupplyPrice: item.supplyUnitPrice, newSupplyPrice: version.supplyPrice,
        salesDelta: itemSalesDelta, supplyDelta: itemSupplyDelta,
      } });
      const hasFunding = await tx.fundingAllocation.count({ where: requestFundingWhere(request.id) });
      if (hasFunding) await synchronizeRequestFunding(tx, request.id, { sourceId: adjustment.id, priceAdjustmentId: adjustment.id, ...options });
      else if (order.settlementMode === 'STORED_VALUE') await tx.purchaseRequest.update({ where: { id: request.id }, data: {
        shortfallAmount: Decimal.max(0, new Decimal(request.salesGoodsAmount).minus(request.paidAmount)),
      } });
      await createFrozenPriceDocuments(tx, { order, baseline: at, adjustmentId: adjustment.id, itemId: item.id, quantity,
        salesDelta: itemSalesDelta, supplyDelta: itemSupplyDelta, salesPrice: new Decimal(version.salesPrice), supplyPrice: new Decimal(version.supplyPrice) });
      await tx.priceChangeRunOrder.update({ where: { runId_supplierOrderId: { runId: sourceOrder.runId, supplierOrderId: order.id } }, data: {
        status: 'SUCCEEDED', salesDelta: itemSalesDelta, supplyDelta: itemSupplyDelta,
      } });
    }
    changed = true;
  }
  if (changed && !frozen) {
    await tx.supplierOrder.update({ where: { id: order.id }, data: { salesGoodsAmount: { increment: salesDelta }, supplyGoodsAmount: { increment: supplyDelta } } });
    await tx.purchaseRequest.update({ where: { id: order.requestId }, data: { salesGoodsAmount: { increment: salesDelta }, supplyGoodsAmount: { increment: supplyDelta }, version: { increment: 1 } } });
  }
  return { changed, fundingHandled: frozen };
}
