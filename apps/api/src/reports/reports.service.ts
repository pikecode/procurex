import { Injectable, OnModuleInit } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { SettlementMode, SupplierOrderStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import { DatabaseService } from '../database/database.service.js';

export type ReportFilters = { from?: string; to?: string; storeId?: string; supplierId?: string; productId?: string };
export type ReportType = 'order-amounts' | 'product-quantities' | 'profit';
const currency = 'CNY';
const exportProcessingLeaseMs = 10 * 60 * 1000;

@Injectable()
export class ReportsService implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  onModuleInit() {
    const timer = setInterval(() => { void this.processQueuedExports(); void this.expireExports(); }, 5000);
    timer.unref();
  }

  async createExport(userId: string, scope: unknown, reportType: ReportType, filters: ReportFilters) {
    const job = await this.database.client.exportJob.create({ data: { requestedById: userId, reportType, filters, permissionScope: (scope ?? {}) as object, asOf: new Date(), expiresAt: new Date(Date.now() + 7 * 86400000) } });
    setImmediate(() => { void this.processQueuedExports(); });
    return { jobId: job.id, status: job.status, createdAt: job.createdAt.toISOString() };
  }

  async exportStatus(id: string, userId: string, roles: string[], scope?: unknown) {
    const job = await this.database.client.exportJob.findFirst({ where: { id, requestedById: userId } });
    if (!job || job.expiresAt <= new Date()) return null;
    if (!authorizedExport(job, roles, scope)) return null;
    return { jobId: job.id, reportType: job.reportType, status: job.status, createdAt: job.createdAt.toISOString(), expiresAt: job.expiresAt.toISOString(), error: job.errorMessage };
  }

  async listExports(userId: string, roles: string[], scope?: unknown) {
    const jobs = await this.database.client.exportJob.findMany({
      where: { requestedById: userId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return jobs
      .filter((job) => authorizedExport(job, roles, scope))
      .map((job) => ({
        jobId: job.id,
        reportType: job.reportType,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        expiresAt: job.expiresAt.toISOString(),
        error: job.errorMessage,
      }));
  }

  async exportContent(id: string, userId: string, roles: string[], scope?: unknown) {
    const job = await this.database.client.exportJob.findFirst({ where: { id, requestedById: userId } });
    return !job || job.expiresAt <= new Date() || job.status !== 'READY' || !authorizedExport(job, roles, scope) ? null : job.csvContent;
  }

  private async processQueuedExports() {
    const staleBefore = new Date(Date.now() - exportProcessingLeaseMs);
    const jobs = await this.database.client.exportJob.findMany({
      where: { expiresAt: { gt: new Date() }, OR: [{ status: 'QUEUED' }, { status: 'PROCESSING', createdAt: { lte: staleBefore } }] },
      take: 5,
      orderBy: { createdAt: 'asc' },
    });
    await Promise.all(jobs.map(async (job) => {
      const claimWhere = job.status === 'PROCESSING' ? { id: job.id, status: 'PROCESSING' as const, createdAt: { lte: staleBefore } } : { id: job.id, status: 'QUEUED' as const };
      const claimed = await this.database.client.exportJob.updateMany({ where: claimWhere, data: { status: 'PROCESSING', errorMessage: null } });
      if (claimed.count === 1) await this.generateExport(job.id, job.reportType as ReportType, job.filters as ReportFilters);
    }));
  }

  private async expireExports() {
    await this.database.client.exportJob.updateMany({ where: { expiresAt: { lte: new Date() }, status: { in: ['QUEUED', 'PROCESSING', 'READY', 'FAILED'] } }, data: { status: 'FAILED', csvContent: null, errorMessage: 'Export expired' } });
  }

  private async generateExport(id: string, type: ReportType, filters: ReportFilters) {
    try {
      const data: any = type === 'order-amounts' ? await this.orderAmounts(filters) : type === 'product-quantities' ? await this.productQuantities(filters) : await this.profit(filters);
      const rows: unknown[][] = type === 'order-amounts' ? data.orders.map((r: any) => [r.supplierOrderId, r.storeId, r.supplierId, r.completedAt, r.goodsAmount, r.freightAmount, r.totalAmount])
        : type === 'product-quantities' ? data.products.map((r: any) => [r.productId, r.productName, r.unit, r.quantity])
          : data.rows.map((r: any) => [r.supplierOrderId, r.storeId, r.supplierId, r.productId, r.productName, r.firstShippedAt, r.quantity, r.salesGoodsAmount, r.supplyGoodsAmount, r.profit]);
      const headers = type === 'order-amounts' ? ['supplierOrderId','storeId','supplierId','completedAt','goodsAmount','freightAmount','totalAmount'] : type === 'product-quantities' ? ['productId','productName','unit','quantity'] : ['supplierOrderId','storeId','supplierId','productId','productName','firstShippedAt','quantity','salesGoodsAmount','supplyGoodsAmount','profit'];
      const csvContent = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
      await this.database.client.exportJob.update({ where: { id }, data: { status: 'READY', csvContent } });
    } catch (error) {
      await this.database.client.exportJob.update({ where: { id }, data: { status: 'FAILED', errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Export failed' } });
    }
  }

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

function authorizedExport(job: { reportType: string; permissionScope: unknown }, roles: string[], scope?: unknown) {
  if (job.reportType === 'profit' && !roles.some((role) => ['ADMIN', 'HQ_FINANCE', 'PURCHASER'].includes(role))) return false;
  const saved = job.permissionScope as { type?: string; storeId?: string; supplierId?: string };
  const current = (scope ?? {}) as { type?: string; storeId?: string; supplierId?: string };
  return saved.type === current.type && saved.storeId === current.storeId && saved.supplierId === current.supplierId;
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
