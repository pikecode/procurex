import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { evaluateStoredValueFunding } from '../../../../packages/domain/src/funding.js';
import { lineAmount, toMoney } from '../../../../packages/domain/src/money.js';
import { settlementPeriod } from '../../../../packages/domain/src/settlement-period.js';
import { PaymentStatus, SupplierOrderStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import { DatabaseService } from '../database/database.service.js';

export type PriceQuote = {
  scopeId: string;
  versionId: string;
  productId: string;
  supplierId: string;
  salesPrice: string;
  supplyPrice: string;
  effectiveAt: string;
  reason: string;
  revision: number;
  runId?: string;
};

export type PriceChangeRunView = {
  id: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  affectedOrderCount: number;
  salesDelta: string;
  supplyDelta: string;
  priceVersionIds: string[];
  orders: Array<{
    supplierOrderId: string;
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
    salesDelta: string;
    supplyDelta: string;
    adjustment: { id: string; previousSalesPrice: string; newSalesPrice: string; previousSupplyPrice: string; newSupplyPrice: string } | null;
  }>;
  createdAt: string;
};

export type PriceChangeAdjustmentView = {
  id: string;
  supplierOrderId: string;
  orderItemId: string;
  previousSalesPrice: string;
  newSalesPrice: string;
  previousSupplyPrice: string;
  newSupplyPrice: string;
  salesDelta: string;
  supplyDelta: string;
  createdAt: string;
};

export type PublishPriceInput = {
  productId: string;
  supplierId: string;
  salesPrice: string;
  supplyPrice: string;
  effectiveAt: Date;
  reason: string;
};

export type PriceImpactPreviewInput = Omit<PublishPriceInput, 'reason'>;

export type PriceImpactPreview = {
  scopeId: string;
  effectiveAt: string;
  affectedOrderCount: number;
  salesDelta: string;
  supplyDelta: string;
  orders: Array<{ supplierOrderId: string; supplierOrderNo: string; salesDelta: string; supplyDelta: string }>;
};

@Injectable()
export class PricingService {
  constructor(private readonly database: DatabaseService) {}

  async previewImpact(input: PriceImpactPreviewInput): Promise<PriceImpactPreview> {
    const scope = await this.database.client.priceScope.findUnique({
      where: { productId_supplierId: { productId: input.productId, supplierId: input.supplierId } },
      include: { versions: { orderBy: [{ effectiveAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!scope) {
      throw new NotFoundException({ code: 'PRICE_SCOPE_NOT_FOUND', message: 'Price scope was not found' });
    }

    const nextVersion = scope.versions.find((version) => version.effectiveAt > input.effectiveAt);
    const orders = await this.database.client.supplierOrder.findMany({
      where: {
        supplierId: input.supplierId,
        status: { notIn: [SupplierOrderStatus.COMPLETED, SupplierOrderStatus.CANCELED, SupplierOrderStatus.REJECTED] },
        items: { some: { productId: input.productId } },
      },
      include: {
        request: { select: { submittedAt: true } },
        items: { where: { productId: input.productId } },
      },
    });
    const impacted = orders.flatMap((order) => {
      const baseline = order.firstShippedAt ?? order.request.submittedAt;
      if (baseline < input.effectiveAt || (nextVersion && baseline >= nextVersion.effectiveAt)) return [];
      const item = order.items[0];
      if (!item) return [];
      return [{
        supplierOrderId: order.id,
        supplierOrderNo: order.supplierOrderNo,
        salesDelta: lineAmount(item.quantity, input.salesPrice).minus(item.salesLineAmount).toFixed(2),
        supplyDelta: lineAmount(item.quantity, input.supplyPrice).minus(item.supplyLineAmount).toFixed(2),
      }];
    });
    return {
      scopeId: scope.id,
      effectiveAt: input.effectiveAt.toISOString(),
      affectedOrderCount: impacted.length,
      salesDelta: impacted.reduce((sum, order) => sum.plus(order.salesDelta), toMoney(0)).toFixed(2),
      supplyDelta: impacted.reduce((sum, order) => sum.plus(order.supplyDelta), toMoney(0)).toFixed(2),
      orders: impacted,
    };
  }

  async publishPrice(input: PublishPriceInput): Promise<PriceQuote> {
    return this.database.client.$transaction(async (tx) => {
      const scope = await tx.priceScope.upsert({
        where: { productId_supplierId: { productId: input.productId, supplierId: input.supplierId } },
        update: {},
        create: { productId: input.productId, supplierId: input.supplierId },
      });
      if (input.salesPrice !== input.supplyPrice) {
        const supplier = await tx.supplier.findUnique({
          where: { id: input.supplierId },
          select: { defaultSettlementMode: true, templateSupplierSettings: { select: { settlementMode: true } } },
        });
        const hasDirectSettlement = supplier?.defaultSettlementMode === 'SUPPLIER_TERM'
          || supplier?.templateSupplierSettings.some((setting) => setting.settlementMode === 'SUPPLIER_TERM');
        if (hasDirectSettlement) {
          throw new ConflictException({
            code: 'DIRECT_TERM_PRICES_MUST_MATCH',
            message: 'Direct supplier-term sales and supply prices must be equal',
          });
        }
      }
      const latest = await tx.priceVersion.findFirst({ where: { scopeId: scope.id }, orderBy: { revision: 'desc' }, select: { revision: true } });
      const version = await tx.priceVersion.create({
        data: {
          scopeId: scope.id,
          salesPrice: input.salesPrice,
          supplyPrice: input.supplyPrice,
          effectiveAt: input.effectiveAt,
          reason: input.reason,
          revision: (latest?.revision ?? 0) + 1,
        },
      });
      const nextVersion = await tx.priceVersion.findFirst({
        where: { scopeId: scope.id, effectiveAt: { gt: input.effectiveAt } },
        orderBy: { effectiveAt: 'asc' },
      });
      const orders = await tx.supplierOrder.findMany({
        where: {
          supplierId: input.supplierId,
          status: { notIn: [SupplierOrderStatus.COMPLETED, SupplierOrderStatus.CANCELED, SupplierOrderStatus.REJECTED] },
          items: { some: { productId: input.productId } },
        },
        include: { request: { select: { submittedAt: true } }, items: { where: { productId: input.productId } } },
      });
      const impacted = orders.flatMap((order) => {
        const baseline = order.firstShippedAt ?? order.request.submittedAt;
        const item = order.items[0];
        if (!item || baseline < input.effectiveAt || (nextVersion && baseline >= nextVersion.effectiveAt)) return [];
        return [{
          supplierOrderId: order.id,
          salesDelta: lineAmount(item.quantity, input.salesPrice).minus(item.salesLineAmount).toFixed(2),
          supplyDelta: lineAmount(item.quantity, input.supplyPrice).minus(item.supplyLineAmount).toFixed(2),
        }];
      });
      const run = await tx.priceChangeRun.create({
        data: {
          affectedOrderCount: impacted.length,
          salesDelta: impacted.reduce((sum, order) => sum.plus(order.salesDelta), toMoney(0)).toFixed(2),
          supplyDelta: impacted.reduce((sum, order) => sum.plus(order.supplyDelta), toMoney(0)).toFixed(2),
          versions: { create: { priceVersionId: version.id } },
          orders: { create: impacted },
        },
      });
      return {
        scopeId: scope.id, versionId: version.id, productId: scope.productId, supplierId: scope.supplierId,
        salesPrice: version.salesPrice.toString(), supplyPrice: version.supplyPrice.toString(),
        effectiveAt: version.effectiveAt.toISOString(), reason: version.reason, revision: version.revision, runId: run.id,
      };
    });
  }

  async getRun(id: string): Promise<PriceChangeRunView> {
    const run = await this.database.client.priceChangeRun.findUnique({
      where: { id },
      include: {
        versions: { select: { priceVersionId: true } },
        orders: { orderBy: { supplierOrderId: 'asc' }, include: { adjustment: true } },
      },
    });
    if (!run) throw new NotFoundException({ code: 'PRICE_CHANGE_RUN_NOT_FOUND', message: 'Price change run was not found' });
    return {
      id: run.id,
      status: run.status,
      affectedOrderCount: run.affectedOrderCount,
      salesDelta: run.salesDelta.toString(),
      supplyDelta: run.supplyDelta.toString(),
      priceVersionIds: run.versions.map((version) => version.priceVersionId),
      orders: run.orders.map((order) => ({
        supplierOrderId: order.supplierOrderId,
        status: order.status,
        salesDelta: order.salesDelta.toString(),
        supplyDelta: order.supplyDelta.toString(),
        adjustment: order.adjustment
          ? {
              id: order.adjustment.id,
              previousSalesPrice: order.adjustment.previousSalesPrice.toString(),
              newSalesPrice: order.adjustment.newSalesPrice.toString(),
              previousSupplyPrice: order.adjustment.previousSupplyPrice.toString(),
              newSupplyPrice: order.adjustment.newSupplyPrice.toString(),
            }
          : null,
      })),
      createdAt: run.createdAt.toISOString(),
    };
  }

  async processRun(id: string): Promise<PriceChangeRunView> {
    await this.database.client.$transaction(async (tx) => {
      const run = await tx.priceChangeRun.findUnique({
        where: { id },
        include: {
          versions: { include: { priceVersion: { include: { scope: true } } } },
          orders: { where: { status: 'PENDING' } },
        },
      });
      if (!run) throw new NotFoundException({ code: 'PRICE_CHANGE_RUN_NOT_FOUND', message: 'Price change run was not found' });
      if (run.status !== 'PENDING') throw new ConflictException({ code: 'PRICE_CHANGE_RUN_ALREADY_PROCESSED', message: 'Price change run has already been processed' });
      const version = run.versions[0]?.priceVersion;
      if (!version) throw new ConflictException({ code: 'PRICE_CHANGE_RUN_INVALID', message: 'Price change run has no price version' });

      for (const runOrder of run.orders) {
        const order = await tx.supplierOrder.findUnique({
          where: { id: runOrder.supplierOrderId },
          include: { items: { where: { productId: version.scope.productId } }, request: { select: { submittedAt: true } } },
        });
        const item = order?.items[0];
        if (!order || !item || order.status === SupplierOrderStatus.COMPLETED || order.status === SupplierOrderStatus.CANCELED || order.status === SupplierOrderStatus.REJECTED) {
          await tx.priceChangeRunOrder.update({ where: { runId_supplierOrderId: { runId: id, supplierOrderId: runOrder.supplierOrderId } }, data: { status: 'FAILED' } });
          continue;
        }
        const baseline = order.firstShippedAt ?? order.request.submittedAt;
        const currentVersion = await tx.priceVersion.findFirst({
          where: { scopeId: version.scopeId, effectiveAt: { lte: baseline } },
          orderBy: [{ effectiveAt: 'desc' }, { revision: 'desc' }],
          select: { id: true },
        });
        if (currentVersion?.id !== version.id) {
          await tx.priceChangeRunOrder.update({
            where: { runId_supplierOrderId: { runId: id, supplierOrderId: runOrder.supplierOrderId } },
            data: { status: 'SUCCEEDED', salesDelta: 0, supplyDelta: 0 },
          });
          continue;
        }
        const salesDelta = lineAmount(item.quantity, version.salesPrice).minus(item.salesLineAmount);
        const supplyDelta = lineAmount(item.quantity, version.supplyPrice).minus(item.supplyLineAmount);
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            salesUnitPrice: version.salesPrice,
            supplyUnitPrice: version.supplyPrice,
            salesLineAmount: lineAmount(item.quantity, version.salesPrice),
            supplyLineAmount: lineAmount(item.quantity, version.supplyPrice),
          },
        });
        await tx.supplierOrder.update({
          where: { id: order.id },
          data: { salesGoodsAmount: { increment: salesDelta }, supplyGoodsAmount: { increment: supplyDelta }, version: { increment: 1 } },
        });
        const request = await tx.purchaseRequest.update({
          where: { id: order.requestId },
          data: { salesGoodsAmount: { increment: salesDelta }, supplyGoodsAmount: { increment: supplyDelta } },
        });
        const account = await tx.storeAccount.findUnique({ where: { storeId: request.storeId } });
        const funding = evaluateStoredValueFunding(toMoney(account?.balance ?? 0), request.salesGoodsAmount);
        await tx.purchaseRequest.update({
          where: { id: request.id },
          data: {
            paymentStatus: funding.canConfirm ? PaymentStatus.PAID : PaymentStatus.UNPAID,
            paidAmount: funding.paidAmount.toFixed(2),
            shortfallAmount: funding.shortfallAmount.toFixed(2),
          },
        });
        const adjustment = await tx.priceChangeAdjustment.create({
          data: {
            runId: id,
            supplierOrderId: order.id,
            orderItemId: item.id,
            previousSalesPrice: item.salesUnitPrice,
            newSalesPrice: version.salesPrice,
            previousSupplyPrice: item.supplyUnitPrice,
            newSupplyPrice: version.supplyPrice,
            salesDelta,
            supplyDelta,
          },
        });
        const snapshots = await tx.settlementItemSnapshot.findMany({
          where: { settlementItemId: { in: [
            settlementItemId(order.settlementMode === 'SUPPLIER_TERM' ? 'DIRECT' : 'STORE_RECEIVABLE', order.id),
            settlementItemId(order.settlementMode === 'SUPPLIER_TERM' ? 'DIRECT' : 'SUPPLIER_PAYABLE', order.id),
          ] } },
        });
        const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.settlementItemId));
        const originalPeriod = settlementPeriod(order.settlementCycleSnapshot as 'WEEKLY' | 'HALF_MONTHLY' | 'MONTHLY' | 'IMMEDIATE', order.firstShippedAt ?? order.request.submittedAt);
        const currentPeriod = settlementPeriod(order.settlementCycleSnapshot as 'WEEKLY' | 'HALF_MONTHLY' | 'MONTHLY' | 'IMMEDIATE', new Date());
        const originalPeriodKey = `${order.settlementCycleSnapshot}:${originalPeriod.startDate}:${addOneDay(originalPeriod.endDate)}`;
        const settlementPeriodKey = `${order.settlementCycleSnapshot}:${currentPeriod.startDate}:${addOneDay(currentPeriod.endDate)}`;
        const documents = [
          { side: 'STORE', amount: salesDelta, kind: order.settlementMode === 'SUPPLIER_TERM' ? 'DIRECT' : 'STORE_RECEIVABLE' },
          { side: 'SUPPLIER', amount: supplyDelta, kind: order.settlementMode === 'SUPPLIER_TERM' ? 'DIRECT' : 'SUPPLIER_PAYABLE' },
        ].filter(({ amount, kind }) => !amount.isZero() && snapshotIds.has(settlementItemId(kind as 'STORE_RECEIVABLE' | 'SUPPLIER_PAYABLE' | 'DIRECT', order.id)));
        for (const document of documents) {
          await tx.adjustmentDocument.create({
            data: {
              sourcePriceChangeId: adjustment.id,
              supplierOrderId: order.id,
              storeId: order.storeId,
              supplierId: order.supplierId,
              side: document.side,
              amount: document.amount.toFixed(2),
              originalPeriodKey,
              settlementPeriodKey,
              sourceRevision: order.version + 1,
              items: { create: { orderItemId: item.id, amount: document.amount.toFixed(2) } },
            },
          });
        }
        await tx.priceChangeRunOrder.update({
          where: { runId_supplierOrderId: { runId: id, supplierOrderId: order.id } },
          data: { status: 'SUCCEEDED', salesDelta, supplyDelta },
        });
      }
      const failedOrders = await tx.priceChangeRunOrder.count({ where: { runId: id, status: 'FAILED' } });
      await tx.priceChangeRun.update({ where: { id }, data: { status: failedOrders ? 'FAILED' : 'SUCCEEDED' } });
    });
    return this.getRun(id);
  }

  async listAdjustments(runId: string): Promise<PriceChangeAdjustmentView[]> {
    const run = await this.database.client.priceChangeRun.findUnique({ where: { id: runId }, select: { id: true } });
    if (!run) throw new NotFoundException({ code: 'PRICE_CHANGE_RUN_NOT_FOUND', message: 'Price change run was not found' });
    const adjustments = await this.database.client.priceChangeAdjustment.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
    return adjustments.map((adjustment) => ({
      id: adjustment.id,
      supplierOrderId: adjustment.supplierOrderId,
      orderItemId: adjustment.orderItemId,
      previousSalesPrice: adjustment.previousSalesPrice.toString(),
      newSalesPrice: adjustment.newSalesPrice.toString(),
      previousSupplyPrice: adjustment.previousSupplyPrice.toString(),
      newSupplyPrice: adjustment.newSupplyPrice.toString(),
      salesDelta: adjustment.salesDelta.toString(),
      supplyDelta: adjustment.supplyDelta.toString(),
      createdAt: adjustment.createdAt.toISOString(),
    }));
  }

  async getEffectivePrice(productId: string, supplierId: string, at: Date): Promise<PriceQuote> {
    const scope = await this.database.client.priceScope.findUnique({
      where: { productId_supplierId: { productId, supplierId } },
    });

    if (!scope) {
      throw new NotFoundException({
        code: 'PRICE_SCOPE_NOT_FOUND',
        message: 'Price scope was not found',
      });
    }

    const version = await this.database.client.priceVersion.findFirst({
      where: {
        scopeId: scope.id,
        effectiveAt: { lte: at },
      },
      orderBy: [{ effectiveAt: 'desc' }, { revision: 'desc' }],
    });

    if (!version) {
      throw new NotFoundException({
        code: 'PRICE_VERSION_NOT_FOUND',
        message: 'No effective price was found',
      });
    }

    return {
      scopeId: scope.id,
      versionId: version.id,
      productId: scope.productId,
      supplierId: scope.supplierId,
      salesPrice: version.salesPrice.toString(),
      supplyPrice: version.supplyPrice.toString(),
      effectiveAt: version.effectiveAt.toISOString(),
      reason: version.reason,
      revision: version.revision,
    };
  }

  async listVersions(scopeId: string): Promise<PriceQuote[]> {
    const scope = await this.database.client.priceScope.findUnique({ where: { id: scopeId } });
    if (!scope) {
      throw new NotFoundException({
        code: 'PRICE_SCOPE_NOT_FOUND',
        message: 'Price scope was not found',
      });
    }

    const versions = await this.database.client.priceVersion.findMany({
      where: { scopeId },
      orderBy: [{ effectiveAt: 'desc' }, { revision: 'desc' }],
    });

    return versions.map((version) => ({
      scopeId: scope.id,
      versionId: version.id,
      productId: scope.productId,
      supplierId: scope.supplierId,
      salesPrice: version.salesPrice.toString(),
      supplyPrice: version.supplyPrice.toString(),
      effectiveAt: version.effectiveAt.toISOString(),
      reason: version.reason,
      revision: version.revision,
    }));
  }
}

function settlementItemId(kind: 'STORE_RECEIVABLE' | 'SUPPLIER_PAYABLE' | 'DIRECT', supplierOrderId: string): string {
  return Buffer.from(JSON.stringify({ kind, supplierOrderId })).toString('base64url');
}

function addOneDay(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
