import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { SettlementMode, SupplierOrderStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import { DatabaseService } from '../database/database.service.js';

export type ReportFilters = { from?: string; to?: string; storeId?: string; supplierId?: string; productId?: string };
const currency = 'CNY';

@Injectable()
export class ReportsService {
  constructor(private readonly database: DatabaseService) {}

  async orderAmounts(filters: ReportFilters) {
    const orders = await this.database.client.supplierOrder.findMany({ where: where(filters, 'completedAt'), include: { shipments: true, items: true }, orderBy: [{ completedAt: 'desc' }, { id: 'desc' }] });
    const months = new Map<string, { orderCount: number; goodsAmount: Decimal; freightAmount: Decimal }>();
    const rows = orders.map((order) => {
      const goodsAmount = sum(order.items.map((item) => new Decimal(item.receivedQuantity).mul(item.salesUnitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)));
      const freightAmount = sum(order.shipments.map((shipment) => shipment.freight));
      const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(order.completedAt!);
      const total = months.get(month) ?? { orderCount: 0, goodsAmount: new Decimal(0), freightAmount: new Decimal(0) };
      total.orderCount += 1;
      total.goodsAmount = total.goodsAmount.plus(goodsAmount);
      total.freightAmount = total.freightAmount.plus(freightAmount);
      months.set(month, total);
      return { supplierOrderId: order.id, storeId: order.storeId, supplierId: order.supplierId, completedAt: order.completedAt!.toISOString(), goodsAmount, freightAmount, totalAmount: new Decimal(goodsAmount).plus(freightAmount).toFixed(2) };
    });
    return envelope('completedAt', 'Completed order sales goods amount plus freight, including every settlement mode.', {
      months: [...months.entries()].map(([month, totals]) => ({ month, orderCount: totals.orderCount, goodsAmount: totals.goodsAmount.toFixed(2), freightAmount: totals.freightAmount.toFixed(2), totalAmount: totals.goodsAmount.plus(totals.freightAmount).toFixed(2) })),
      orders: rows,
    });
  }

  async productQuantities(filters: ReportFilters) {
    const orders = await this.database.client.supplierOrder.findMany({ where: where(filters, 'completedAt'), include: { items: { where: filters.productId ? { productId: filters.productId } : undefined, include: { product: { include: { baseUnit: true } } } } } });
    const products = new Map<string, { productId: string; productName: string; unit: string; quantity: Decimal }>();
    for (const order of orders) for (const item of order.items) {
      const row = products.get(item.productId) ?? { productId: item.productId, productName: item.product.name, unit: item.product.baseUnit.name, quantity: new Decimal(0) };
      row.quantity = row.quantity.plus(item.receivedQuantity);
      products.set(item.productId, row);
    }
    return envelope('completedAt', 'Sum of final received quantities for completed orders, in each product base unit.', { products: [...products.values()].map((row) => ({ ...row, quantity: row.quantity.toFixed(6) })) });
  }

  async profit(filters: ReportFilters) {
    const orderWhere = where(filters, 'firstShippedAt');
    const orders = await this.database.client.supplierOrder.findMany({
      where: { ...orderWhere, settlementMode: { not: SettlementMode.SUPPLIER_TERM } },
      include: { shipments: true, items: { where: filters.productId ? { productId: filters.productId } : undefined, include: { product: { include: { baseUnit: true } } } } },
      orderBy: [{ firstShippedAt: 'desc' }, { id: 'desc' }],
    });
    const rows = orders.flatMap((order) => order.items.map((item) => {
      const quantity = new Decimal(item.receivedQuantity);
      const sales = quantity.mul(item.salesUnitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const supply = quantity.mul(item.supplyUnitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      return { supplierOrderId: order.id, storeId: order.storeId, supplierId: order.supplierId, productId: item.productId, productName: item.product.name, unit: item.product.baseUnit.name, firstShippedAt: order.firstShippedAt!.toISOString(), quantity: quantity.toFixed(6), salesGoodsAmount: sales.toFixed(2), supplyGoodsAmount: supply.toFixed(2), profit: sales.minus(supply).toFixed(2), freightAmount: '0.00' };
    }));
    const freightAmount = sum(orders.map((order) => sum(order.shipments.map((shipment) => shipment.freight))));
    const salesGoodsAmount = sum(rows.map((row) => row.salesGoodsAmount));
    const supplyGoodsAmount = sum(rows.map((row) => row.supplyGoodsAmount));
    return envelope('firstShippedAt', 'Completed non-direct orders only. Profit is final received quantity times sales/supply price delta; freight is separate and excluded from profit.', {
      totals: { salesGoodsAmount, supplyGoodsAmount, profit: new Decimal(salesGoodsAmount).minus(supplyGoodsAmount).toFixed(2), freightAmount }, rows,
    });
  }
}

function where(filters: ReportFilters, dateField: 'completedAt' | 'firstShippedAt') {
  return {
    status: SupplierOrderStatus.COMPLETED, storeId: filters.storeId, supplierId: filters.supplierId,
    ...(filters.from && filters.to ? { [dateField]: { gte: shanghaiMidnight(filters.from), lt: shanghaiMidnight(addDays(filters.to)) } } : {}),
    ...(filters.productId ? { items: { some: { productId: filters.productId } } } : {}),
  };
}

function envelope<T>(dateBasis: string, metric: string, data: T) { return { dateBasis, asOf: new Date().toISOString(), currency, metric, ...data }; }
function sum(values: Array<string | number | { toString(): string }>): string { return values.reduce<Decimal>((total, value) => total.plus(value.toString()), new Decimal(0)).toFixed(2); }
function addDays(value: string): string { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }
function shanghaiMidnight(value: string): Date { return new Date(`${value}T00:00:00.000+08:00`); }
