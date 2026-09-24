import { Injectable, NotFoundException } from '@nestjs/common';
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
  runId: string;
};

export type PriceChangeRunView = {
  id: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  affectedOrderCount: number;
  salesDelta: string;
  supplyDelta: string;
  priceVersionIds: string[];
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
      const run = await tx.priceChangeRun.create({
        data: {
          versions: { create: { priceVersionId: version.id } },
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
      include: { versions: { select: { priceVersionId: true } } },
    });
    if (!run) throw new NotFoundException({ code: 'PRICE_CHANGE_RUN_NOT_FOUND', message: 'Price change run was not found' });
    return {
      id: run.id,
      status: run.status,
      affectedOrderCount: run.affectedOrderCount,
      salesDelta: run.salesDelta.toString(),
      supplyDelta: run.supplyDelta.toString(),
      priceVersionIds: run.versions.map((version) => version.priceVersionId),
      createdAt: run.createdAt.toISOString(),
    };
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
      runId: '',
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
      runId: '',
    }));
  }
}
