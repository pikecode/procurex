import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { lineAmount, toMoney } from '../../../../packages/domain/src/money.js';
import { SupplierOrderStatus } from '../../../../packages/backend/generated/prisma/enums.js';
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
  orders: Array<{ supplierOrderId: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED'; salesDelta: string; supplyDelta: string }>;
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
      include: { versions: { select: { priceVersionId: true } }, orders: { orderBy: { supplierOrderId: 'asc' } } },
    });
    if (!run) throw new NotFoundException({ code: 'PRICE_CHANGE_RUN_NOT_FOUND', message: 'Price change run was not found' });
    return {
      id: run.id,
      status: run.status,
      affectedOrderCount: run.affectedOrderCount,
      salesDelta: run.salesDelta.toString(),
      supplyDelta: run.supplyDelta.toString(),
      priceVersionIds: run.versions.map((version) => version.priceVersionId),
      orders: run.orders.map((order) => ({ supplierOrderId: order.supplierOrderId, status: order.status, salesDelta: order.salesDelta.toString(), supplyDelta: order.supplyDelta.toString() })),
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
          include: { items: { where: { productId: version.scope.productId } } },
        });
        const item = order?.items[0];
        if (!order || !item || order.status === SupplierOrderStatus.COMPLETED || order.status === SupplierOrderStatus.CANCELED || order.status === SupplierOrderStatus.REJECTED) {
          await tx.priceChangeRunOrder.update({ where: { runId_supplierOrderId: { runId: id, supplierOrderId: runOrder.supplierOrderId } }, data: { status: 'FAILED' } });
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
        await tx.purchaseRequest.update({
          where: { id: order.requestId },
          data: { salesGoodsAmount: { increment: salesDelta }, supplyGoodsAmount: { increment: supplyDelta } },
        });
        await tx.priceChangeAdjustment.create({
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
        await tx.priceChangeRunOrder.update({
          where: { runId_supplierOrderId: { runId: id, supplierOrderId: order.id } },
          data: { status: 'SUCCEEDED', salesDelta, supplyDelta },
        });
      }
      await tx.priceChangeRun.update({ where: { id }, data: { status: 'SUCCEEDED' } });
    });
    return this.getRun(id);
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
