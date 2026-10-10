import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryMode, SettlementMode, SupplierStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import { Prisma, type Supplier } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { auditedMasterDataTransaction, type MasterDataAuditContext } from '../audit/master-data-audit.js';
import type { SupplierProfile } from '../common/master-data-profile.js';
import { effectivePriceVersion } from '../pricing/effective-price.js';
import { lockCatalog } from '../catalog/catalog-registries.service.js';
import { lockPricePublication } from '../pricing/price-checkpoint.js';
import { PricingService } from '../pricing/pricing.service.js';

export type SupplierProductPrice = { productId: string; supplyPrice: string; expectedVersionId: string | null };

export type SupplierView = Pick<Supplier, 'address' | 'bankName' | 'bankAccountName' | 'bankAccount' | 'taxpayerId' | 'invoiceTitle' | 'requiresFreight' | 'supplierType' | 'settlementCycleDescription' | 'remark'> & {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  deliveryContactPhone: string | null;
  deliveryMode: DeliveryMode;
  defaultSettlementMode: SettlementMode;
  defaultSettlementCycle: string;
  status: SupplierStatus;
  isArchived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SupplierProductsView = {
  supplierId: string;
  productIds: string[];
  version: number;
  prices?: SupplierProductPrice[];
};

export type SupplierManagedProductView = {
  id: string;
  name: string;
  sku: string | null;
  specification: string | null;
  unitName: string;
  productActive: boolean;
  supplyEnabled: boolean;
  supplyPrice: string | null;
  version: number;
};

export type CreateSupplierInput = SupplierProfile & {
  code?: string;
  name: string;
  deliveryMode: DeliveryMode;
  defaultSettlementMode: SettlementMode;
  defaultSettlementCycle: string;
  contactName?: string;
  contactPhone?: string;
  deliveryContactPhone?: string;
};

export type UpdateSupplierInput = SupplierProfile & {
  expectedVersion: number;
  name?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  deliveryContactPhone?: string | null;
  deliveryMode?: DeliveryMode;
  defaultSettlementMode?: SettlementMode;
  defaultSettlementCycle?: string;
  status?: SupplierStatus;
};

@Injectable()
export class SuppliersService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService = new AuditService(database), private readonly pricing: PricingService = new PricingService(database)) {}

  async getSupplier(id: string): Promise<SupplierView> {
    const supplier = await this.database.client.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Supplier was not found' });
    return toSupplierView(supplier);
  }

  async getSupplierCatalog(id: string) {
    return this.database.client.$transaction(async tx => {
      const supplier = await tx.supplier.findUnique({ where: { id }, select: { id: true } });
      if (!supplier) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Supplier was not found' });
      const links = await tx.supplierProduct.findMany({ where: { supplierId: id, supplyEnabled: true }, orderBy: { productId: 'asc' },
        select: { product: { select: { id: true, name: true, sku: true, specification: true, isActive: true, baseUnit: { select: { name: true } } } } } });
      const at = new Date();
      return { supplierId: supplier.id, items: await Promise.all(links.map(async ({ product }) => {
        const price = await effectivePriceVersion(tx, product.id, id, at);
        return { id: product.id, name: product.name, sku: product.sku, specification: product.specification,
          isActive: product.isActive, unitName: product.baseUnit.name, supplyPrice: price?.supplyPrice.toString() ?? null,
          supplyPriceVersionId: price?.supplyVersionId ?? null };
      })) };
    });
  }

  async getManagedProducts(id: string): Promise<{ supplierId: string; items: SupplierManagedProductView[] }> {
    const supplier = await this.database.client.supplier.findUnique({ where: { id }, select: { id: true } });
    if (!supplier) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Supplier was not found' });
    const links = await this.database.client.supplierProduct.findMany({
      where: { supplierId: id }, orderBy: [{ product: { name: 'asc' } }, { productId: 'asc' }],
      include: { product: { include: { baseUnit: true } } },
    });
    const prices = new Map((await this.productPrices(this.database.client, id)).map(item => [item.productId, item.supplyPrice]));
    return { supplierId: id, items: links.map(link => ({
      id: link.productId, name: link.product.name, sku: link.product.sku, specification: link.product.specification,
      unitName: link.product.baseUnit.name, productActive: link.product.isActive, supplyEnabled: link.supplyEnabled,
      supplyPrice: prices.get(link.productId) ?? null, version: link.updatedAt.getTime(),
    })) };
  }

  async updateManagedProduct(supplierId: string, productId: string, supplyEnabled: boolean, expectedVersion: number,
    context?: MasterDataAuditContext): Promise<SupplierManagedProductView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, supplyEnabled ? 'supplier.product.list' : 'supplier.product.unlist', 'SupplierProduct', async tx => {
      await lockCatalog(tx);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplierProduct" WHERE "supplierId" = ${supplierId}::uuid AND "productId" = ${productId}::uuid FOR UPDATE`);
      const link = await tx.supplierProduct.findUnique({ where: { supplierId_productId: { supplierId, productId } }, include: { supplier: true, product: { include: { baseUnit: true } } } });
      if (!link) throw new NotFoundException({ code: 'SUPPLIER_PRODUCT_NOT_FOUND', message: 'Supplier product was not found' });
      if (link.supplier.isArchived || link.supplier.status !== SupplierStatus.ACTIVE) throw new ConflictException({ code: 'SUPPLIER_UNAVAILABLE', message: 'Supplier is unavailable' });
      if (link.updatedAt.getTime() !== expectedVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Supplier product status has changed' });
      const updated = link.supplyEnabled === supplyEnabled ? link : await tx.supplierProduct.update({
        where: { id: link.id }, data: { supplyEnabled, updatedAt: new Date(Math.max(Date.now(), expectedVersion + 1)) }, include: { product: { include: { baseUnit: true } } },
      });
      const price = await effectivePriceVersion(tx, productId, supplierId, new Date());
      return { supplierId, id: updated.productId, name: updated.product.name, sku: updated.product.sku,
        specification: updated.product.specification, unitName: updated.product.baseUnit.name,
        productActive: updated.product.isActive, supplyEnabled: updated.supplyEnabled,
        supplyPrice: price?.supplyPrice.toString() ?? null, version: updated.updatedAt.getTime() };
    });
  }

  async listSuppliers(): Promise<SupplierView[]> {
    const suppliers = await this.database.client.supplier.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return suppliers.map(toSupplierView);
  }

  async archiveSupplier(id: string, expectedVersion: number, context?: MasterDataAuditContext): Promise<SupplierView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'supplier.archive', 'Supplier', async tx => {
      await lockPricePublication(tx, true);
      await lockCatalog(tx);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Supplier" WHERE "id" = ${id}::uuid FOR UPDATE`);
      const supplier = await tx.supplier.findUnique({ where: { id } });
      if (!supplier) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Supplier was not found' });
      if (supplierVersion(supplier) !== expectedVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Supplier version has changed' });
      if (supplier.isArchived) return toSupplierView(supplier);
      const affected = await tx.templateItemSupplier.findMany({ where: { supplierId: id }, select: { templateItem: { select: { templateId: true } } } });
      const templateIds = [...new Set(affected.map(link => link.templateItem.templateId))].sort();
      for (const templateId of templateIds) {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "OrderTemplate" WHERE "id" = ${templateId}::uuid FOR UPDATE`);
        const template = await tx.orderTemplate.findUniqueOrThrow({ where: { id: templateId } });
        await tx.orderTemplate.update({ where: { id: templateId }, data: { updatedAt: new Date(Math.max(Date.now(), template.updatedAt.getTime() + 1)) } });
      }
      await tx.templateItemSupplier.deleteMany({ where: { supplierId: id } });
      await tx.templateSupplierSetting.deleteMany({ where: { supplierId: id } });
      await tx.$executeRaw`UPDATE "Product" SET "updatedAt" = GREATEST(clock_timestamp(), "updatedAt" + interval '1 millisecond') WHERE "id" IN (SELECT "productId" FROM "SupplierProduct" WHERE "supplierId" = ${id}::uuid)`;
      await tx.supplierProduct.deleteMany({ where: { supplierId: id } });
      return toSupplierView(await tx.supplier.update({ where: { id }, data: { isArchived: true, status: SupplierStatus.DISABLED, updatedAt: new Date(Math.max(Date.now(), expectedVersion + 1)) } }));
    });
  }

  async createSupplier(input: CreateSupplierInput, context?: MasterDataAuditContext): Promise<SupplierView> {
    const supplier = await auditedMasterDataTransaction(this.database, this.audit, context, 'supplier.create', 'Supplier', tx => tx.supplier.create({
      data: { ...input, defaultSettlementCycle: supplierSettlementCycle(input.defaultSettlementMode, input.defaultSettlementCycle), code: input.code ?? `GYS${randomUUID().replaceAll('-', '').toUpperCase()}` },
    }));

    return toSupplierView(supplier);
  }

  async getSupplierProducts(id: string): Promise<SupplierProductsView> {
    const supplier = await this.database.client.supplier.findUnique({ where: { id }, include: {
      products: { orderBy: { productId: 'asc' }, select: { productId: true } },
    } });
    if (!supplier) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Supplier was not found' });
    const productIds = supplier.products.map(product => product.productId);
    return { supplierId: id, productIds, version: supplierVersion(supplier), prices: await this.productPrices(this.database.client, id) };
  }

  private async productPrices(tx: Prisma.TransactionClient, supplierId: string): Promise<SupplierProductPrice[]> {
    const scopes = await tx.priceScope.findMany({ where: { supplierId, templateKey: '' }, include: { versions: { where: { effectiveAt: { lte: new Date() } }, orderBy: [{ effectiveAt: 'desc' }, { revision: 'desc' }], take: 1 } } });
    return scopes.filter(scope => scope.versions.length).map(scope => ({ productId: scope.productId, supplyPrice: scope.versions[0]!.supplyPrice.toString(), expectedVersionId: scope.versions[0]!.id }));
  }

  async updateSupplier(id: string, input: UpdateSupplierInput, context?: MasterDataAuditContext): Promise<SupplierView> {
    const existing = await this.database.client.supplier.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'SUPPLIER_NOT_FOUND',
        message: 'Supplier was not found',
      });
    }

    if (existing.isArchived) throw new ConflictException({ code: 'SUPPLIER_ARCHIVED', message: 'Archived supplier cannot be edited' });
    const settlementCycle = supplierSettlementCycle(input.defaultSettlementMode ?? existing.defaultSettlementMode,
      input.defaultSettlementCycle ?? (input.defaultSettlementMode && input.defaultSettlementMode !== existing.defaultSettlementMode ? undefined : existing.defaultSettlementCycle));

    const version = supplierVersion(existing);
    if (version !== input.expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Supplier version has changed',
        details: { expectedVersion: input.expectedVersion, currentVersion: version },
      });
    }

    const updated = await auditedMasterDataTransaction(this.database, this.audit, context, 'supplier.update', 'Supplier', async tx => {
    await lockCatalog(tx);
    const changed = await tx.supplier.updateMany({
      where: { id, updatedAt: { gte: new Date(version), lt: new Date(version + 1) } },
      data: {
        name: input.name,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        deliveryContactPhone: input.deliveryContactPhone,
        deliveryMode: input.deliveryMode,
        defaultSettlementMode: input.defaultSettlementMode,
        defaultSettlementCycle: settlementCycle,
        status: input.status,
        address: input.address,
        bankName: input.bankName,
        bankAccountName: input.bankAccountName,
        bankAccount: input.bankAccount,
        taxpayerId: input.taxpayerId,
        invoiceTitle: input.invoiceTitle,
        requiresFreight: input.requiresFreight,
        supplierType: input.supplierType,
        settlementCycleDescription: input.settlementCycleDescription,
        remark: input.remark,
        updatedAt: new Date(Math.max(Date.now(), version + 1)),
      },
    });
    if (!changed.count) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Supplier version has changed' });
    if (input.defaultSettlementMode && input.defaultSettlementMode !== existing.defaultSettlementMode) {
      await tx.templateStoreSupplierCycle.deleteMany({ where: { supplierId: id } });
    }
    return tx.supplier.findUniqueOrThrow({ where: { id } });
    });

    return toSupplierView(updated);
  }

  async replaceSupplierProducts(id: string, expectedVersion: number, productIds: string[], context?: MasterDataAuditContext, prices: SupplierProductPrice[] = []): Promise<SupplierProductsView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'supplier.products.replace', 'Supplier', async tx => {
    await lockPricePublication(tx, true);
    await lockCatalog(tx);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Supplier" WHERE "id" = ${id}::uuid FOR UPDATE`);
    const supplier = await tx.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new NotFoundException({
        code: 'SUPPLIER_NOT_FOUND',
        message: 'Supplier was not found',
      });
    }

    const version = supplierVersion(supplier);
    if (supplier.isArchived) throw new ConflictException({ code: 'SUPPLIER_ARCHIVED', message: 'Archived supplier cannot change product associations' });
    if (version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Supplier version has changed',
        details: { expectedVersion, currentVersion: version },
      });
    }

    const uniqueProductIds = [...new Set(productIds)];
    if (new Set(prices.map(price => price.productId)).size !== prices.length || prices.some(price => !uniqueProductIds.includes(price.productId) || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(price.supplyPrice))) {
      throw new ConflictException({ code: 'INVALID_SUPPLIER_PRICES', message: '供货价必须属于已选商品，且为最多两位小数的非负金额' });
    }
    const previousProducts = await tx.supplierProduct.findMany({ where: { supplierId: id }, select: { productId: true } });
    const products = await tx.product.findMany({
      where: { id: { in: uniqueProductIds } },
      select: { id: true, defaultSalesPrice: true },
    });
    if (products.length !== uniqueProductIds.length) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'One or more products were not found',
      });
    }

    await tx.supplierProduct.deleteMany({
        where: {
          supplierId: id,
          productId: { notIn: uniqueProductIds },
        },
      });
    const previousProductIds = new Set(previousProducts.map(item => item.productId));
    await tx.supplierProduct.createMany({
      data: uniqueProductIds.filter(productId => !previousProductIds.has(productId)).map(productId => ({ supplierId: id, productId, supplyEnabled: true })),
      skipDuplicates: true,
    });

    const at = new Date();
    const existingPrices = await this.productPrices(tx, id);
    const initialPrices: SupplierProductPrice[] = products.filter(product => product.defaultSalesPrice !== null && !existingPrices.some(price => price.productId === product.id) && !prices.some(price => price.productId === product.id))
      .map(product => ({ productId: product.id, supplyPrice: product.defaultSalesPrice!.toFixed(2), expectedVersionId: null }));
    for (const price of [...prices, ...initialPrices].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const currentPrice = await effectivePriceVersion(tx, price.productId, id, at);
      if ((currentPrice?.supplyVersionId ?? null) !== price.expectedVersionId) throw new ConflictException({ code: 'VERSION_CONFLICT', message: '供货价已变更，请重新打开商品配置后重试' });
      if (currentPrice?.supplyPrice.eq(price.supplyPrice)) continue;
      const product = await tx.product.findUniqueOrThrow({ where: { id: price.productId } });
      if (!currentPrice && product.defaultSalesPrice === null) throw new ConflictException({ code: 'SALES_PRICE_REQUIRED', message: '请先在商品资料中设置参考销售价' });
      await this.pricing.publishPrice({ productId: price.productId, supplierId: id, supplyPrice: price.supplyPrice,
        salesPrice: currentPrice?.salesPrice.toString() ?? product.defaultSalesPrice!.toString(),
        effectiveAt: at, reason: '供应商关联商品维护供货价' }, tx);
    }

    // Product-side editors must observe association changes made from the supplier side.
    await tx.$executeRaw`UPDATE "Product" SET "updatedAt" = GREATEST(clock_timestamp(), "updatedAt" + interval '1 millisecond') WHERE "id" = ANY(${[...new Set([...uniqueProductIds, ...previousProducts.map(row => row.productId)])]}::uuid[])`;

    const current = await tx.supplierProduct.findMany({
      where: { supplierId: id },
      orderBy: { productId: 'asc' },
      select: { productId: true },
    });
    const updatedSupplier = await tx.supplier.update({
      where: { id },
      data: { updatedAt: new Date(Math.max(Date.now(), expectedVersion + 1)) },
    });

    return {
      supplierId: id,
      productIds: current.map((item) => item.productId),
      version: supplierVersion(updatedSupplier),
      prices: await this.productPrices(tx, id),
    };
    });
  }
}

function toSupplierView(supplier: Supplier): SupplierView {
  return {
    address: supplier.address,
    bankName: supplier.bankName,
    bankAccountName: supplier.bankAccountName,
    bankAccount: supplier.bankAccount,
    taxpayerId: supplier.taxpayerId,
    invoiceTitle: supplier.invoiceTitle,
    requiresFreight: supplier.requiresFreight,
    supplierType: supplier.supplierType,
    settlementCycleDescription: supplier.settlementCycleDescription,
    remark: supplier.remark,
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    contactName: supplier.contactName,
    contactPhone: supplier.contactPhone,
    deliveryContactPhone: supplier.deliveryContactPhone,
    deliveryMode: supplier.deliveryMode,
    defaultSettlementMode: supplier.defaultSettlementMode,
    defaultSettlementCycle: supplier.defaultSettlementCycle,
    status: supplier.status,
    isArchived: supplier.isArchived,
    version: supplierVersion(supplier),
    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
  };
}

function supplierVersion(supplier: Pick<Supplier, 'updatedAt'>): number {
  return supplier.updatedAt.getTime();
}
import { supplierSettlementCycle } from './settlement-config.js';
