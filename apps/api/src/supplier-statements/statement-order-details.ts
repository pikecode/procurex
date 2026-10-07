import { Decimal } from 'decimal.js';
import type { Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import { effectiveOrderItemQuantity } from '../supplier-orders/fulfillment-status.js';
import { displaySalesUnitName, readUnitDisplayNames, readUnitSnapshot } from '../catalog/transaction-units.js';

export type StatementProductView = {
  orderItemId: string;
  productId: string;
  sku: string | null;
  productName: string;
  specification: string | null;
  unitName: string;
  unitBasis: 'TRANSACTION_SNAPSHOT' | 'LEGACY_UNKNOWN';
  orderedQuantity: string;
  effectiveQuantity: string;
  receivedQuantity: string;
  supplyUnitPrice: string;
  supplyLineAmount: string;
};

export type StatementOrderDetails = {
  storeName: string;
  productAmountBasis: 'CURRENT_ORDER';
  productGoodsAmount: string;
  goodsReconciliationAmount: string;
  products: StatementProductView[];
};

export async function enrichStatementLines<T extends { supplierOrderId: string; goodsAmount: string }>(
  client: Prisma.TransactionClient,
  lines: T[],
): Promise<Array<T & StatementOrderDetails>> {
  if (!lines.length) return [];
  const orders = await client.supplierOrder.findMany({
    where: { id: { in: lines.map(line => line.supplierOrderId) } },
    include: { store: { select: { name: true } }, items: { orderBy: { id: 'asc' }, include: {
      product: { include: { baseUnit: true } }, shipmentItems: true, discrepancies: { include: { returnRecord: true } },
    } } },
  });
  const names = await readUnitDisplayNames(client, orders.flatMap(order => order.items.map(item => item.unitSnapshot)));
  const byId = new Map(orders.map(order => [order.id, order]));
  return lines.map(line => {
    const order = byId.get(line.supplierOrderId);
    const products = (order?.items ?? []).map(item => ({ orderItemId: item.id, productId: item.productId,
      sku: item.product.sku, productName: item.product.name, specification: item.product.specification,
      unitName: displaySalesUnitName(item.unitSnapshot, names) ?? item.product.baseUnit.name,
      unitBasis: readUnitSnapshot(item.unitSnapshot) ? 'TRANSACTION_SNAPSHOT' as const : 'LEGACY_UNKNOWN' as const,
      orderedQuantity: item.quantity.toFixed(6),
      effectiveQuantity: effectiveOrderItemQuantity(item).toFixed(6), receivedQuantity: item.receivedQuantity.toFixed(6),
      supplyUnitPrice: item.supplyUnitPrice.toFixed(6), supplyLineAmount: item.supplyLineAmount.toFixed(2) }));
    const goods = products.reduce((sum, item) => sum.plus(item.supplyLineAmount), new Decimal(0));
    return { ...line, storeName: order?.store?.name ?? '', productAmountBasis: 'CURRENT_ORDER' as const,
      productGoodsAmount: goods.toFixed(2), goodsReconciliationAmount: new Decimal(line.goodsAmount).minus(goods).toFixed(2), products };
  });
}
