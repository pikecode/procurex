import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { lineAmount, toMoney } from '../../../../packages/domain/src/money.js';
import { effectiveOrderItemQuantity } from '../supplier-orders/fulfillment-status.js';
import { lockFundingRequest, requestFundingWhere, synchronizeRequestFunding } from '../purchase-requests/request-funding.js';
import { SupplierOrderStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import { Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { lockPricePublication } from './price-checkpoint.js';
import { createFrozenPriceDocuments } from './frozen-price-adjustments.js';
import { effectivePriceVersion } from './effective-price.js';

export type PriceQuote = {
  supplyVersionId: string | null;
  templateId: string | null;
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
  templateId?: string;
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
    await this.requireTemplatePair(this.database.client, input);
    const scope = await this.database.client.priceScope.findUnique({
      where: { productId_supplierId_templateKey: { productId: input.productId, supplierId: input.supplierId, templateKey: input.templateId ?? '' } },
      include: { versions: { orderBy: [{ effectiveAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] } },
    });
    const nextVersion = scope?.versions.find((version) => version.effectiveAt > input.effectiveAt);
    const orders = await this.database.client.supplierOrder.findMany({
      where: {
        supplierId: input.supplierId,
        status: { notIn: [SupplierOrderStatus.COMPLETED, SupplierOrderStatus.CANCELED, SupplierOrderStatus.REJECTED] },
        items: { some: { productId: input.productId } },
      },
      include: {
        request: { select: { submittedAt: true, templateId: true } },
        items: { where: { productId: input.productId }, include: { shipmentItems: true, discrepancies: { include: { returnRecord: true } } } },
      },
    });
    const impacted = (await Promise.all(orders.map(async (order) => {
      const baseline = order.firstShippedAt ?? order.request.submittedAt;
      if (baseline < input.effectiveAt || (nextVersion && baseline >= nextVersion.effectiveAt)) return [];
      if (input.templateId && order.request.templateId !== input.templateId) return [];
      const current = await effectivePriceVersion(this.database.client, input.productId, input.supplierId, baseline, order.request.templateId);
      const item = order.items[0];
      if (!item) return [];
      const salesPrice = input.templateId || !current?.scope.templateKey ? input.salesPrice : current.salesPrice;
      const supplyPrice = input.templateId ? current?.supplyPrice ?? input.supplyPrice : input.supplyPrice;
      if (!input.templateId && current?.scope.templateKey && lineAmount(effectiveOrderItemQuantity(item), salesPrice).eq(item.salesLineAmount) && lineAmount(effectiveOrderItemQuantity(item), supplyPrice).eq(item.supplyLineAmount)) return [];
      if (order.settlementMode === 'SUPPLIER_TERM' && !new Decimal(salesPrice).equals(supplyPrice)) throw new ConflictException({ code: 'DIRECT_TERM_PRICES_MUST_MATCH', message: 'Historical direct supplier-term orders require equal prices' });
      return [{
        supplierOrderId: order.id,
        supplierOrderNo: order.supplierOrderNo,
        salesDelta: lineAmount(effectiveOrderItemQuantity(item), salesPrice).minus(item.salesLineAmount).toFixed(2),
        supplyDelta: lineAmount(effectiveOrderItemQuantity(item), supplyPrice).minus(item.supplyLineAmount).toFixed(2),
      }];
    }))).flat();
    return {
      scopeId: scope?.id ?? '',
      effectiveAt: input.effectiveAt.toISOString(),
      affectedOrderCount: impacted.length,
      salesDelta: impacted.reduce((sum, order) => sum.plus(order.salesDelta), toMoney(0)).toFixed(2),
      supplyDelta: impacted.reduce((sum, order) => sum.plus(order.supplyDelta), toMoney(0)).toFixed(2),
      orders: impacted,
    };
  }

  async publishPrice(input: PublishPriceInput, transaction?: Prisma.TransactionClient): Promise<PriceQuote> {
    const execute = async (tx: Prisma.TransactionClient) => {
      await lockPricePublication(tx, true);
      await this.requireTemplatePair(tx, input);
      if (input.templateId) await tx.$queryRaw`SELECT id FROM "OrderTemplate" WHERE id = ${input.templateId}::uuid FOR UPDATE`;
      const scope = await tx.priceScope.upsert({
        where: { productId_supplierId_templateKey: { productId: input.productId, supplierId: input.supplierId, templateKey: input.templateId ?? '' } },
        update: {},
        create: { productId: input.productId, supplierId: input.supplierId, templateKey: input.templateId ?? '' },
      });
      if (!new Decimal(input.salesPrice).equals(input.supplyPrice)) {
        const supplier = await tx.supplier.findUnique({
          where: { id: input.supplierId },
          select: { defaultSettlementMode: true, templateSupplierSettings: { select: { settlementMode: true } } },
        });
        const setting = input.templateId ? await tx.templateSupplierSetting.findUnique({ where: { templateId_supplierId: { templateId: input.templateId, supplierId: input.supplierId } } }) : null;
        const hasDirectSettlement = input.templateId ? (setting?.settlementMode ?? supplier?.defaultSettlementMode) === 'SUPPLIER_TERM'
          : supplier?.defaultSettlementMode === 'SUPPLIER_TERM';
        if (hasDirectSettlement) {
          throw new ConflictException({
            code: 'DIRECT_TERM_PRICES_MUST_MATCH',
            message: 'Direct supplier-term sales and supply prices must be equal',
          });
        }
      }
      const latest = await tx.priceVersion.findFirst({ where: { scopeId: scope.id }, orderBy: { revision: 'desc' }, select: { revision: true } });
      const supplySource = input.templateId ? await effectivePriceVersion(tx, input.productId, input.supplierId, input.effectiveAt) : null;
      const version = await tx.priceVersion.create({
        data: {
          supplySourceVersionId: supplySource?.supplyVersionId,
          scopeId: scope.id,
          salesPrice: input.salesPrice,
          supplyPrice: input.supplyPrice,
          effectiveAt: input.effectiveAt,
          reason: input.reason,
          revision: (latest?.revision ?? 0) + 1,
        },
      });
      await this.requireDirectSchedulesCompatible(tx, input);
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
        include: { request: { select: { submittedAt: true, templateId: true } }, items: { where: { productId: input.productId }, include: { shipmentItems: true, discrepancies: { include: { returnRecord: true } } } } },
      });
      const impacted = (await Promise.all(orders.map(async (order) => {
        const baseline = order.firstShippedAt ?? order.request.submittedAt;
        const item = order.items[0];
        if (!item || baseline < input.effectiveAt || (nextVersion && baseline >= nextVersion.effectiveAt)) return [];
        if (input.templateId && order.request.templateId !== input.templateId) return [];
        const current = await effectivePriceVersion(tx, input.productId, input.supplierId, baseline, order.request.templateId);
        const salesPrice = input.templateId || !current?.scope.templateKey ? input.salesPrice : current.salesPrice;
        const supplyPrice = input.templateId ? current?.supplyPrice ?? input.supplyPrice : input.supplyPrice;
        if (!input.templateId && current?.scope.templateKey && lineAmount(effectiveOrderItemQuantity(item), salesPrice).eq(item.salesLineAmount) && lineAmount(effectiveOrderItemQuantity(item), supplyPrice).eq(item.supplyLineAmount)) return [];
        if (order.settlementMode === 'SUPPLIER_TERM' && !new Decimal(salesPrice).equals(supplyPrice)) throw new ConflictException({ code: 'DIRECT_TERM_PRICES_MUST_MATCH', message: 'Historical direct supplier-term orders require equal prices' });
        return [{
          supplierOrderId: order.id,
          salesDelta: lineAmount(effectiveOrderItemQuantity(item), salesPrice).minus(item.salesLineAmount).toFixed(2),
          supplyDelta: lineAmount(effectiveOrderItemQuantity(item), supplyPrice).minus(item.supplyLineAmount).toFixed(2),
        }];
      }))).flat();
      const run = await tx.priceChangeRun.create({
        data: {
          affectedOrderCount: impacted.length,
          salesDelta: impacted.reduce((sum, order) => sum.plus(order.salesDelta), toMoney(0)).toFixed(2),
          supplyDelta: impacted.reduce((sum, order) => sum.plus(order.supplyDelta), toMoney(0)).toFixed(2),
          versions: { create: { priceVersionId: version.id } },
          orders: { create: impacted },
        },
      });
      if (input.templateId) {
        const template = await tx.orderTemplate.findUniqueOrThrow({ where: { id: input.templateId }, select: { updatedAt: true } });
        await tx.orderTemplate.update({ where: { id: input.templateId }, data: { updatedAt: new Date(Math.max(Date.now(), template.updatedAt.getTime() + 1)) } });
      }
      return {
        supplyVersionId: input.templateId ? version.supplySourceVersionId : version.id,
        templateId: scope.templateKey || null,
        scopeId: scope.id, versionId: version.id, productId: scope.productId, supplierId: scope.supplierId,
        salesPrice: version.salesPrice.toString(), supplyPrice: version.supplyPrice.toString(),
        effectiveAt: version.effectiveAt.toISOString(), reason: version.reason, revision: version.revision, runId: run.id,
      };
    };
    return transaction ? execute(transaction) : this.database.client.$transaction(execute);
  }

  async getRun(id: string, transaction?: Prisma.TransactionClient): Promise<PriceChangeRunView> {
    const run = await (transaction ?? (this.database.client as Prisma.TransactionClient)).priceChangeRun.findUnique({
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

  async processRun(id: string, transaction?: Prisma.TransactionClient): Promise<PriceChangeRunView> {
    const execute = async (tx: Prisma.TransactionClient) => {
      await lockPricePublication(tx);
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
        await lockSupplierOrder(tx, runOrder.supplierOrderId);
        const lockedRunOrder = await tx.priceChangeRunOrder.findUniqueOrThrow({ where: {
          runId_supplierOrderId: { runId: id, supplierOrderId: runOrder.supplierOrderId },
        } });
        if (lockedRunOrder.status !== 'PENDING') continue;
        const order = await tx.supplierOrder.findUnique({
          where: { id: runOrder.supplierOrderId },
          include: { items: { where: { productId: version.scope.productId }, include: { shipmentItems: true, discrepancies: { include: { returnRecord: true } } } }, request: { select: { submittedAt: true, templateId: true } } },
        });
        const item = order?.items[0];
        if (!order || !item || order.status === SupplierOrderStatus.COMPLETED || order.status === SupplierOrderStatus.CANCELED || order.status === SupplierOrderStatus.REJECTED) {
          await tx.priceChangeRunOrder.update({ where: { runId_supplierOrderId: { runId: id, supplierOrderId: runOrder.supplierOrderId } }, data: { status: 'FAILED' } });
          continue;
        }
        const baseline = order.firstShippedAt ?? order.request.submittedAt;
        const currentVersion = await effectivePriceVersion(tx, item.productId, order.supplierId, baseline, order.request.templateId);
        if (!currentVersion || (version.scope.templateKey ? currentVersion.id : currentVersion.supplyVersionId) !== version.id) {
          await tx.priceChangeRunOrder.update({
            where: { runId_supplierOrderId: { runId: id, supplierOrderId: runOrder.supplierOrderId } },
            data: { status: 'SUCCEEDED', salesDelta: 0, supplyDelta: 0 },
          });
          continue;
        }
        const quantity = effectiveOrderItemQuantity(item);
        const salesDelta = lineAmount(quantity, currentVersion.salesPrice).minus(item.salesLineAmount);
        const supplyDelta = lineAmount(quantity, currentVersion.supplyPrice).minus(item.supplyLineAmount);
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            salesPriceVersionId: currentVersion.id, supplyPriceVersionId: currentVersion.supplyVersionId,
            salesUnitPrice: currentVersion.salesPrice,
            supplyUnitPrice: currentVersion.supplyPrice,
            salesLineAmount: lineAmount(quantity, currentVersion.salesPrice),
            supplyLineAmount: lineAmount(quantity, currentVersion.supplyPrice),
          },
        });
        await tx.supplierOrder.update({
          where: { id: order.id },
          data: { salesGoodsAmount: { increment: salesDelta }, supplyGoodsAmount: { increment: supplyDelta }, version: { increment: 1 } },
        });
        const request = await tx.purchaseRequest.update({
          where: { id: order.requestId },
          data: { salesGoodsAmount: { increment: salesDelta }, supplyGoodsAmount: { increment: supplyDelta }, version: { increment: 1 } },
        });
        await tx.requestItem.updateMany({ where: { requestId: request.id, supplierId: order.supplierId, productId: item.productId }, data: {
          priceVersionId: currentVersion.id, supplyPriceVersionId: currentVersion.supplyVersionId, salesUnitPrice: currentVersion.salesPrice, supplyUnitPrice: currentVersion.supplyPrice,
          salesLineAmount: lineAmount(quantity, currentVersion.salesPrice), supplyLineAmount: lineAmount(quantity, currentVersion.supplyPrice),
        } });
        const adjustment = await tx.priceChangeAdjustment.create({
          data: {
            runId: id,
            supplierOrderId: order.id,
            orderItemId: item.id,
            previousSalesPrice: item.salesUnitPrice,
            newSalesPrice: currentVersion.salesPrice,
            previousSupplyPrice: item.supplyUnitPrice,
            newSupplyPrice: currentVersion.supplyPrice,
            salesDelta,
            supplyDelta,
          },
        });
        const hasFunding = await tx.fundingAllocation.count({ where: requestFundingWhere(request.id) });
        if (hasFunding) {
          await synchronizeRequestFunding(tx, request.id, { sourceId: adjustment.id, priceAdjustmentId: adjustment.id });
        } else {
          // Legacy orders without booked funds must not acquire fictional payment through repricing.
          await tx.purchaseRequest.update({ where: { id: request.id }, data: {
            shortfallAmount: order.settlementMode === 'STORED_VALUE' ? Decimal.max(0, new Decimal(request.salesGoodsAmount).minus(request.paidAmount)) : 0,
          } });
        }
        await createFrozenPriceDocuments(tx, { order, baseline, adjustmentId: adjustment.id, itemId: item.id, quantity,
          salesDelta, supplyDelta, salesPrice: new Decimal(currentVersion.salesPrice), supplyPrice: new Decimal(currentVersion.supplyPrice) });
        await tx.priceChangeRunOrder.update({
          where: { runId_supplierOrderId: { runId: id, supplierOrderId: order.id } },
          data: { status: 'SUCCEEDED', salesDelta, supplyDelta },
        });
      }
      const failedOrders = await tx.priceChangeRunOrder.count({ where: { runId: id, status: 'FAILED' } });
      await tx.priceChangeRun.update({ where: { id }, data: { status: failedOrders ? 'FAILED' : 'SUCCEEDED' } });
      return this.getRun(id, tx);
    };
    return transaction ? execute(transaction) : this.database.client.$transaction(execute);
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

  async getEffectivePrice(productId: string, supplierId: string, at: Date, templateId?: string, transaction?: Prisma.TransactionClient): Promise<PriceQuote> {
    const client = transaction ?? (this.database.client as Prisma.TransactionClient);
    const version = await effectivePriceVersion(client, productId, supplierId, at, templateId);

    if (!version) {
      throw new NotFoundException({
        code: 'PRICE_VERSION_NOT_FOUND',
        message: 'No effective price was found',
      });
    }

    return {
      supplyVersionId: version.supplyVersionId,
      templateId: version.scope.templateKey || null,
      scopeId: version.scopeId,
      versionId: version.id,
      productId: version.scope.productId,
      supplierId: version.scope.supplierId,
      salesPrice: version.salesPrice.toString(),
      supplyPrice: version.supplyPrice.toString(),
      effectiveAt: version.effectiveAt.toISOString(),
      reason: version.reason,
      revision: version.revision,
    };
  }

  async quotePrice(input: { productId: string; supplierId: string; effectiveAt: Date; templateId?: string }): Promise<PriceQuote> {
    await this.requireTemplatePair(this.database.client, input);
    return this.getEffectivePrice(input.productId, input.supplierId, input.effectiveAt, input.templateId);
  }

  private async requireDirectSchedulesCompatible(tx: Prisma.TransactionClient, input: PublishPriceInput) {
    const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: input.supplierId } });
    const items = await tx.templateItem.findMany({ where: { productId: input.productId, template: { isArchived: false }, suppliers: { some: { supplierId: input.supplierId } } },
      include: { template: { include: { settings: { where: { supplierId: input.supplierId } } } } } });
    const start = new Date(Math.max(Date.now(), input.effectiveAt.getTime()));
    for (const item of items) {
      if (input.templateId && item.templateId !== input.templateId) continue;
      if ((item.template.settings[0]?.settlementMode ?? supplier.defaultSettlementMode) !== 'SUPPLIER_TERM') continue;
      const future = await tx.priceVersion.findMany({ where: { scope: { productId: input.productId, supplierId: input.supplierId, templateKey: { in: ['', item.templateId] } }, effectiveAt: { gt: start } }, select: { effectiveAt: true } });
      for (const at of [start, ...future.map(version => version.effectiveAt)]) {
        const quote = await effectivePriceVersion(tx, input.productId, input.supplierId, at, item.templateId);
        if (quote && !quote.salesPrice.equals(quote.supplyPrice)) throw new ConflictException({ code: 'DIRECT_TERM_PRICES_MUST_MATCH', message: 'Supplier cost change would unbalance a current or scheduled direct template price' });
      }
    }
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
      supplyVersionId: scope.templateKey ? version.supplySourceVersionId : version.id,
      templateId: scope.templateKey || null,
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

  private async requireTemplatePair(client: Prisma.TransactionClient, input: { templateId?: string; productId: string; supplierId: string; effectiveAt: Date; supplyPrice?: string }) {
    if (!input.templateId) return;
    const item = await client.templateItem.findFirst({ where: { templateId: input.templateId, productId: input.productId,
      template: { isArchived: false }, suppliers: { some: { supplierId: input.supplierId } } } });
    if (!item) throw new ConflictException({ code: 'TEMPLATE_PRICE_PAIR_NOT_ALLOWED', message: 'Product and supplier must be associated with an active template' });
    if (input.supplyPrice !== undefined) {
      const supply = await effectivePriceVersion(client, input.productId, input.supplierId, input.effectiveAt);
      if (!supply || !supply.supplyPrice.equals(input.supplyPrice)) throw new ConflictException({ code: 'TEMPLATE_SUPPLY_PRICE_READ_ONLY', message: 'Template prices must use the effective shared supplier cost; publish cost changes in the shared scope' });
    }
  }
}

async function lockSupplierOrder(tx: Prisma.TransactionClient, supplierOrderId: string): Promise<void> {
  const order = await tx.supplierOrder.findUniqueOrThrow({ where: { id: supplierOrderId }, select: { storeId: true, requestId: true } });
  await lockFundingRequest(tx, order.storeId, order.requestId);
  const ids = (['DIRECT', 'STORE_RECEIVABLE', 'SUPPLIER_PAYABLE'] as const).map(kind => settlementItemId(kind, supplierOrderId)).sort();
  for (const id of ids) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}::text, 0))`;
  await tx.$queryRaw`SELECT id FROM "SupplierOrder" WHERE id = ${supplierOrderId}::uuid FOR UPDATE`;
}

function settlementItemId(kind: 'STORE_RECEIVABLE' | 'SUPPLIER_PAYABLE' | 'DIRECT', supplierOrderId: string): string {
  return Buffer.from(JSON.stringify({ kind, supplierOrderId })).toString('base64url');
}
