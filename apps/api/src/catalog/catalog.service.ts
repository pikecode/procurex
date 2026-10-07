import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Category, type FileObject, type Product, type Store, type Unit } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { auditedMasterDataTransaction, type MasterDataAuditContext } from '../audit/master-data-audit.js';
import { storeDestination } from '../common/master-data-profile.js';
import { PricingService } from '../pricing/pricing.service.js';
import { lockPricePublication } from '../pricing/price-checkpoint.js';
import { effectivePriceVersion } from '../pricing/effective-price.js';
import { Decimal } from 'decimal.js';
import { lockCatalog, requireUniqueUnitName, validateCategoryParent } from './catalog-registries.service.js';
import { purchaseUnitPrice, validatePurchaseUnitConversion } from '../../../../packages/domain/src/unit-conversion.js';
import type { ProductUnitConversion } from '../../../../packages/backend/generated/prisma/client.js';

const catalogTemplateInclude = {
  items: {
    where: { isEnabled: true, product: { isActive: true } },
    orderBy: [{ sortOrder: 'asc' }, { productId: 'asc' }],
    include: {
      product: { include: { category: true, baseUnit: true, imageFile: true, conversion: true } },
      suppliers: { where: { supplier: { status: 'ACTIVE', isArchived: false } },
        orderBy: [{ priority: 'asc' }, { supplierId: 'asc' }], include: { supplier: true } },
    },
  },
} satisfies Prisma.OrderTemplateInclude;

export type CategoryView = {
  version: number;
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  sortOrder: number;
  createdAt: string;
};

export type UnitView = {
  version: number;
  id: string;
  code: string;
  name: string;
  createdAt: string;
};

export type ProductView = {
  supplierPurchasePrices?: ProductPurchasePrice[];
  supplierIds: string[];
  defaultSalesPrice: string | null;
  purchaseUnitConversion: { purchaseUnitId: string; salesUnitId: string; salesUnitsPerPurchaseUnit: string } | null;
  brandId: string | null;
  barcode: string | null;
  id: string;
  sku: string | null;
  name: string;
  categoryId: string;
  baseUnitId: string;
  minOrderQty: string;
  orderMultiple: string;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  specification: string | null;
  brand: string | null;
  storageCondition: string | null;
  imageFileId: string | null;
  imageFile: { id: string; filename: string; mimeType: string; sizeBytes: string } | null;
};

export type StoreCatalogView = {
  storeId: string;
  store: { name: string; address: string | null; contactName: string | null; contactPhone: string | null };
  templateId: string;
  items: Array<{
    product: ProductView & { categoryName: string; unitName: string; purchaseUnitName: string | null };
    sortOrder: number;
    suppliers: Array<{
      supplierId: string;
      supplierName: string;
      priority: number;
      salesPrice: string | null;
      supplyPrice: string | null;
      priceVersionId: string | null;
      supplyPriceVersionId: string | null;
      purchaseSalesPrice: string | null;
      purchaseSupplyPrice: string | null;
    }>;
  }>;
};

export type CreateCategoryInput = {
  code?: string;
  name: string;
  parentId?: string;
  sortOrder?: number;
};

export type CreateUnitInput = {
  code?: string;
  name: string;
};

export type ProductPurchasePrice = { supplierId: string; supplyPrice: string; expectedVersionId: string | null };
export type CreateProductInput = {
  supplierPurchasePrices?: ProductPurchasePrice[];
  supplierIds?: string[];
  purchaseUnitConversion?: { purchaseUnitId: string; salesUnitsPerPurchaseUnit: string } | null;
  defaultSalesPrice: string;
  brandId?: string | null;
  barcode?: string | null;
  sku?: string | null;
  name: string;
  categoryId: string;
  baseUnitId: string;
  minOrderQty: string;
  orderMultiple: string;
  specification?: string | null;
  brand?: string | null;
  storageCondition?: string | null;
  imageFileId?: string | null;
};

export type UpdateProductInput = {
  supplierPurchasePrices?: ProductPurchasePrice[];
  supplierIds?: string[];
  purchaseUnitConversion?: { purchaseUnitId: string; salesUnitsPerPurchaseUnit: string } | null;
  defaultSalesPrice?: string;
  sku?: string | null;
  brandId?: string | null;
  barcode?: string | null;
  expectedVersion: number;
  name?: string;
  categoryId?: string;
  baseUnitId?: string;
  minOrderQty?: string;
  orderMultiple?: string;
  isActive?: boolean;
  specification?: string | null;
  brand?: string | null;
  storageCondition?: string | null;
  imageFileId?: string | null;
};

@Injectable()
export class CatalogService {
  constructor(
    private readonly database: DatabaseService,
    private readonly pricingService: PricingService,
    private readonly audit: AuditService = new AuditService(database),
  ) {}

  async listCategories(): Promise<CategoryView[]> {
    const categories = await this.database.client.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    return categories.map(toCategoryView);
  }

  async createCategory(input: CreateCategoryInput, context?: MasterDataAuditContext): Promise<CategoryView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'category.create', 'Category', async tx => {
      await lockCatalog(tx);
      await validateCategoryParent(tx, input.parentId);
      return toCategoryView(await tx.category.create({ data: { ...input, code: input.code ?? `FL${randomUUID().replaceAll('-', '').toUpperCase()}` } }));
    });
  }

  async listUnits(): Promise<UnitView[]> {
    const units = await this.database.client.unit.findMany({ orderBy: { code: 'asc' } });
    return units.map(toUnitView);
  }

  async createUnit(input: CreateUnitInput, context?: MasterDataAuditContext): Promise<UnitView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'unit.create', 'Unit', async tx => {
      await lockCatalog(tx);
      const name = await requireUniqueUnitName(tx, input.name);
      return toUnitView(await tx.unit.create({ data: { ...input, name, code: input.code ?? `DW${randomUUID().replaceAll('-', '').toUpperCase()}` } }));
    });
  }

  async listProducts(): Promise<ProductView[]> {
    const products = await this.database.client.product.findMany({ include: { suppliers: { where: { supplyEnabled: true } }, imageFile: true, brandRecord: true, conversion: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return this.withPurchasePrices(this.database.client, products.map(toProductView));
  }

  async createProduct(input: CreateProductInput, actorUserId?: string, context?: MasterDataAuditContext): Promise<ProductView> {
    await Promise.all([this.requireCategory(input.categoryId), this.requireUnit(input.baseUnitId)]);

    const product = await auditedMasterDataTransaction(this.database, this.audit, context, 'product.create', 'Product', async tx => {
      if (input.supplierPurchasePrices?.length) await lockPricePublication(tx, true);
      await lockCatalog(tx);
      await this.requireProductReferences(tx, input.categoryId, input.baseUnitId);
      await this.requireAvailableSku(tx, input.sku);
      await this.requireImage(tx, input.imageFileId, actorUserId);
      const brand = await this.resolveBrand(tx, input);
      const { supplierIds, purchaseUnitConversion, supplierPurchasePrices, ...fields } = input;
      const created = await tx.product.create({ data: { ...fields, ...brand } });
      await this.saveProductConfiguration(tx, created, supplierIds, purchaseUnitConversion);
      await this.savePurchasePrices(tx, created.id, supplierPurchasePrices);
      return tx.product.findUniqueOrThrow({ where: { id: created.id }, include: { suppliers: { where: { supplyEnabled: true } }, imageFile: true, brandRecord: true, conversion: true } });
    });
    return (await this.withPurchasePrices(this.database.client, [toProductView(product)]))[0]!;
  }

  async updateProduct(id: string, input: UpdateProductInput, actorUserId?: string, context?: MasterDataAuditContext): Promise<ProductView> {
    const existing = await this.database.client.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Product was not found',
      });
    }

    const version = productVersion(existing);
    if (version !== input.expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Product version has changed',
        details: { expectedVersion: input.expectedVersion, currentVersion: version },
      });
    }

    await Promise.all([input.categoryId ? this.requireCategory(input.categoryId) : undefined, input.baseUnitId ? this.requireUnit(input.baseUnitId) : undefined]);

    const updated = await auditedMasterDataTransaction(this.database, this.audit, context, 'product.update', 'Product', async tx => {
      if (input.supplierPurchasePrices?.length) await lockPricePublication(tx, true);
      await lockCatalog(tx);
      await this.requireProductReferences(tx, input.categoryId, input.baseUnitId);
      await this.requireAvailableSku(tx, input.sku, id);
      if (input.baseUnitId && input.baseUnitId !== existing.baseUnitId && (await tx.requestItem.count({ where: { productId: id } }) || await tx.orderItem.count({ where: { productId: id } }) || await tx.productUnitConversion.count({ where: { productId: id } }))) {
        throw new ConflictException({ code: 'UNIT_HISTORY_SNAPSHOT_REQUIRED', message: 'Cannot change the unit of a traded product without historical snapshots' });
      }
      const brand = await this.resolveBrand(tx, input);
      if (input.imageFileId !== existing.imageFileId) await this.requireImage(tx, input.imageFileId, actorUserId);
      const changed = await tx.product.updateMany({
        where: { id, updatedAt: { gte: new Date(version), lt: new Date(version + 1) } },
        data: {
          name: input.name,
          sku: input.sku,
          defaultSalesPrice: input.defaultSalesPrice,
          categoryId: input.categoryId,
          baseUnitId: input.baseUnitId,
          minOrderQty: input.minOrderQty,
          orderMultiple: input.orderMultiple,
          isActive: input.isActive,
          specification: input.specification,
          brand: input.brand,
          ...brand,
          barcode: input.barcode,
          storageCondition: input.storageCondition,
          imageFileId: input.imageFileId,
          updatedAt: new Date(Math.max(Date.now(), version + 1)),
        },
      });
      if (!changed.count) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Product version has changed' });
      await this.saveProductConfiguration(tx, { id, baseUnitId: input.baseUnitId ?? existing.baseUnitId }, input.supplierIds, input.purchaseUnitConversion);
      await this.savePurchasePrices(tx, id, input.supplierPurchasePrices);
      return tx.product.findUniqueOrThrow({ where: { id }, include: { suppliers: { where: { supplyEnabled: true } }, imageFile: true, brandRecord: true, conversion: true } });
    });
    return (await this.withPurchasePrices(this.database.client, [toProductView(updated)]))[0]!;
  }

  private async withPurchasePrices(tx: Prisma.TransactionClient, products: ProductView[]): Promise<ProductView[]> {
    const scopes = await tx.priceScope.findMany({ where: { productId: { in: products.map(row => row.id) }, templateKey: '' }, include: { versions: { where: { effectiveAt: { lte: new Date() } }, orderBy: [{ effectiveAt: 'desc' }, { revision: 'desc' }], take: 1 } } });
    return products.map(product => ({ ...product, supplierPurchasePrices: scopes.filter(scope => scope.productId === product.id && product.supplierIds.includes(scope.supplierId) && scope.versions.length).map(scope => ({ supplierId: scope.supplierId, supplyPrice: scope.versions[0]!.supplyPrice.toString(), expectedVersionId: scope.versions[0]!.id })) }));
  }

  private async savePurchasePrices(tx: Prisma.TransactionClient, productId: string, prices?: ProductPurchasePrice[]) {
    if (!prices?.length) return;
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    const at = new Date();
    for (const price of [...prices].sort((a, b) => a.supplierId.localeCompare(b.supplierId))) {
      const link = await tx.supplierProduct.findUnique({ where: { supplierId_productId: { supplierId: price.supplierId, productId } }, include: { supplier: true } });
      if (!link?.supplyEnabled || link.supplier.isArchived) throw new ConflictException({ code: 'SUPPLIER_UNAVAILABLE', message: '采购价仅可维护已关联供应商' });
      const current = await effectivePriceVersion(tx, productId, price.supplierId, at);
      if ((current?.supplyVersionId ?? null) !== price.expectedVersionId) throw new ConflictException({ code: 'VERSION_CONFLICT', message: '采购价已变更，请刷新商品后重试' });
      if (current && new Decimal(price.supplyPrice).eq(current.supplyPrice)) continue;
      await this.pricingService.publishPrice({ productId, supplierId: price.supplierId, supplyPrice: price.supplyPrice, salesPrice: link.supplier.defaultSettlementMode === 'SUPPLIER_TERM' ? price.supplyPrice : current?.salesPrice.toString() ?? product.defaultSalesPrice!.toString(), effectiveAt: at, reason: '商品资料维护采购价' }, tx);
    }
  }

  private async saveProductConfiguration(tx: Prisma.TransactionClient, product: { id: string; baseUnitId: string }, supplierIds?: string[], conversion?: { purchaseUnitId: string; salesUnitsPerPurchaseUnit: string } | null) {
    if (conversion !== undefined) {
      if (conversion) {
        await this.requireProductReferences(tx, undefined, conversion.purchaseUnitId);
        try { validatePurchaseUnitConversion({ ...conversion, salesUnitId: product.baseUnitId }); }
        catch { throw new ConflictException({ code: 'UNIT_CONVERSION_INVALID', message: 'Invalid purchase unit conversion' }); }
        const data = { fromUnitId: conversion.purchaseUnitId, toUnitId: product.baseUnitId, ratio: conversion.salesUnitsPerPurchaseUnit };
        await tx.productUnitConversion.upsert({ where: { productId: product.id }, create: { productId: product.id, ...data }, update: data });
      } else await tx.productUnitConversion.deleteMany({ where: { productId: product.id } });
    }
    if (supplierIds !== undefined) {
      const ids = [...new Set(supplierIds)].sort();
      const current = await tx.supplierProduct.findMany({ where: { productId: product.id }, select: { supplierId: true } });
      const affected = [...new Set([...ids, ...current.map(row => row.supplierId)])].sort();
      for (const id of affected) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Supplier" WHERE "id" = ${id}::uuid FOR UPDATE`);
      const valid = await tx.supplier.count({ where: { id: { in: ids }, isArchived: false, OR: [{ status: 'ACTIVE' }, { id: { in: current.map(row => row.supplierId) } }] } });
      if (valid !== ids.length) throw new ConflictException({ code: 'SUPPLIER_UNAVAILABLE', message: 'Selected supplier is unavailable' });
      await tx.supplierProduct.deleteMany({ where: { productId: product.id, supplierId: { notIn: ids } } });
      for (const supplierId of ids) await tx.supplierProduct.upsert({ where: { supplierId_productId: { supplierId, productId: product.id } }, create: { supplierId, productId: product.id }, update: { supplyEnabled: true } });
      for (const id of affected) {
        const supplier = await tx.supplier.findUniqueOrThrow({ where: { id } });
        await tx.supplier.update({ where: { id }, data: { updatedAt: new Date(Math.max(Date.now(), supplier.updatedAt.getTime() + 1)) } });
      }
    }
  }

  async setPurchaseUnitConversion(id: string, expectedVersion: number, input: { purchaseUnitId: string; salesUnitsPerPurchaseUnit: string } | null, context?: MasterDataAuditContext): Promise<ProductView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'product.purchase-unit.set', 'Product', async tx => {
      await lockCatalog(tx);
      const product = await tx.product.findUnique({ where: { id } });
      if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product was not found' });
      if (productVersion(product) !== expectedVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Product version has changed' });
      if (input) {
        await this.requireProductReferences(tx, undefined, input.purchaseUnitId);
        try { validatePurchaseUnitConversion({ ...input, salesUnitId: product.baseUnitId }); }
        catch (error) { throw new ConflictException({ code: 'UNIT_CONVERSION_INVALID', message: error instanceof Error ? error.message : 'Invalid conversion' }); }
        const data = { fromUnitId: input.purchaseUnitId, toUnitId: product.baseUnitId, ratio: input.salesUnitsPerPurchaseUnit };
        await tx.productUnitConversion.upsert({ where: { productId: id }, create: { productId: id, ...data }, update: data });
      } else await tx.productUnitConversion.deleteMany({ where: { productId: id } });
      const updated = await tx.product.update({ where: { id }, data: { updatedAt: new Date(Math.max(Date.now(), expectedVersion + 1)) }, include: { imageFile: true, conversion: true } });
      return toProductView(updated);
    });
  }

  async readStoreCatalog(storeId: string, at = new Date(), transaction?: Prisma.TransactionClient): Promise<StoreCatalogView> {
    const client = transaction ?? (this.database.client as Prisma.TransactionClient);
    const binding = await client.storeTemplateBinding.findFirst({
      where: {
        storeId,
        expiredAt: null,
        template: { isArchived: false },
      },
      include: {
        store: true,
        template: { include: catalogTemplateInclude },
      },
    });

    if (!binding) {
      throw new NotFoundException({
        code: 'STORE_TEMPLATE_NOT_FOUND',
        message: 'Store does not have an active template',
      });
    }

    return this.catalogView(storeId, binding.store, binding.template, at, transaction);
  }

  async readTemplateCatalog(storeId: string, templateId: string, at = new Date()): Promise<StoreCatalogView> {
    const store = await this.database.client.store.findUnique({ where: { id: storeId } });
    const template = await this.database.client.orderTemplate.findUnique({ where: { id: templateId }, include: catalogTemplateInclude });
    if (!store || !template || template.isArchived) throw new NotFoundException({ code: 'STORE_TEMPLATE_NOT_FOUND', message: 'Original template is no longer available' });
    return this.catalogView(storeId, store, template, at);
  }

  private async catalogView(storeId: string, store: Store, template: Prisma.OrderTemplateGetPayload<{ include: typeof catalogTemplateInclude }>, at: Date, transaction?: Prisma.TransactionClient): Promise<StoreCatalogView> {
    const client = transaction ?? (this.database.client as Prisma.TransactionClient);
    return {
      storeId,
      store: storeDestination(store),
      templateId: template.id,
      items: await Promise.all(
        template.items.map(async (item) => ({
          product: { ...toProductView(item.product), categoryName: item.product.category.name, unitName: item.product.baseUnit.name,
            minOrderQty: (item.minOrderQty ?? item.product.minOrderQty).toString(), orderMultiple: (item.orderMultiple ?? item.product.orderMultiple).toString(),
            purchaseUnitName: item.product.conversion ? (await client.unit.findUnique({ where: { id: item.product.conversion.fromUnitId } }))?.name ?? null : null },
          sortOrder: item.sortOrder,
          suppliers: await Promise.all(
            item.suppliers.map(async (supplier) => {
              const price = await this.tryGetEffectivePrice(item.productId, supplier.supplierId, at, template.id, transaction);
              const conversion = item.product.conversion && item.product.conversion.toUnitId === item.product.baseUnitId ? {
                salesUnitId: item.product.baseUnitId, purchaseUnitId: item.product.conversion.fromUnitId, salesUnitsPerPurchaseUnit: item.product.conversion.ratio.toString(),
              } : null;
              return {
                supplierId: supplier.supplierId,
                supplierName: supplier.supplier.name,
                priority: supplier.priority,
                salesPrice: price?.salesPrice ?? null,
                supplyPrice: price?.supplyPrice ?? null,
                priceVersionId: price?.versionId ?? null,
                supplyPriceVersionId: price?.supplyVersionId ?? null,
                purchaseSalesPrice: price && conversion ? purchaseUnitPrice(price.salesPrice, conversion).toString() : null,
                purchaseSupplyPrice: price && conversion ? purchaseUnitPrice(price.supplyPrice, conversion).toString() : null,
              };
            }),
          ),
        })),
      ),
    };
  }

  private async tryGetEffectivePrice(productId: string, supplierId: string, at: Date, templateId: string, transaction?: Prisma.TransactionClient): Promise<{ salesPrice: string; supplyPrice: string; versionId: string; supplyVersionId: string | null } | null> {
    try {
      return await this.pricingService.getEffectivePrice(productId, supplierId, at, templateId, transaction);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
  }

  private async requireImage(tx: Prisma.TransactionClient, id?: string | null, actorUserId?: string) {
    if (!id) return;
    if (!actorUserId) throw new ConflictException({ code: 'PRODUCT_IMAGE_INVALID', message: 'Product image must be uploaded by the current editor' });
    await tx.$queryRaw`SELECT "id" FROM "FileObject" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const file = await tx.fileObject.findFirst({ where: { id, ownerId: actorUserId, purpose: 'PRODUCT', status: 'READY', paymentId: null, receiptId: null, product: { is: null } } });
    if (!file) throw new ConflictException({ code: 'PRODUCT_IMAGE_INVALID', message: 'Product image is unavailable, incomplete, linked or owned by another editor' });
  }

  private async requireProductReferences(tx: Prisma.TransactionClient, categoryId?: string, unitId?: string) {
    if (categoryId && !await tx.category.findUnique({ where: { id: categoryId } })) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Category was not found' });
    if (unitId && !await tx.unit.findUnique({ where: { id: unitId } })) throw new NotFoundException({ code: 'UNIT_NOT_FOUND', message: 'Unit was not found' });
  }

  private async requireAvailableSku(tx: Prisma.TransactionClient, sku?: string | null, exceptId?: string) {
    if (!sku) return;
    if (await tx.product.findFirst({ where: { sku, id: exceptId ? { not: exceptId } : undefined } })) {
      throw new ConflictException({ code: 'PRODUCT_SKU_EXISTS', message: 'Product SKU already exists' });
    }
  }

  private async resolveBrand(tx: Prisma.TransactionClient, input: { brandId?: string | null; brand?: string | null }) {
    if (input.brandId === null || input.brand === null) return { brandId: null, brand: null };
    if (input.brandId) {
      const brand = await tx.brand.findUnique({ where: { id: input.brandId } });
      if (!brand) throw new NotFoundException({ code: 'BRAND_NOT_FOUND', message: 'Brand was not found' });
      return { brandId: brand.id, brand: brand.name };
    }
    if (input.brand !== undefined) {
      const brand = await tx.brand.upsert({ where: { name: input.brand }, update: {}, create: { name: input.brand } });
      return { brandId: brand.id, brand: brand.name };
    }
    return {};
  }

  private async requireCategory(id: string): Promise<void> {
    const category = await this.database.client.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException({
        code: 'CATEGORY_NOT_FOUND',
        message: 'Category was not found',
      });
    }
  }

  private async requireUnit(id: string): Promise<void> {
    const unit = await this.database.client.unit.findUnique({ where: { id } });
    if (!unit) {
      throw new NotFoundException({
        code: 'UNIT_NOT_FOUND',
        message: 'Unit was not found',
      });
    }
  }
}

function toCategoryView(category: Category): CategoryView {
  return {
    version: category.version,
    id: category.id,
    parentId: category.parentId,
    code: category.code,
    name: category.name,
    sortOrder: category.sortOrder,
    createdAt: category.createdAt.toISOString(),
  };
}

function toUnitView(unit: Unit): UnitView {
  return {
    version: unit.version,
    id: unit.id,
    code: unit.code,
    name: unit.name,
    createdAt: unit.createdAt.toISOString(),
  };
}

function toProductView(product: Product & { suppliers?: Array<{ supplierId: string }>; imageFile?: FileObject | null; conversion?: ProductUnitConversion | null }): ProductView {
  return {
    supplierIds: product.suppliers?.map(row => row.supplierId) ?? [],
    defaultSalesPrice: product.defaultSalesPrice?.toString() ?? null,
    purchaseUnitConversion: product.conversion ? { purchaseUnitId: product.conversion.fromUnitId, salesUnitId: product.conversion.toUnitId, salesUnitsPerPurchaseUnit: product.conversion.ratio.toString() } : null,
    brandId: product.brandId,
    barcode: product.barcode,
    id: product.id,
    sku: product.sku,
    name: product.name,
    specification: product.specification,
    brand: product.brand,
    storageCondition: product.storageCondition,
    imageFileId: product.imageFileId,
    imageFile: product.imageFile ? { id: product.imageFile.id, filename: product.imageFile.filename, mimeType: product.imageFile.mimeType, sizeBytes: product.imageFile.sizeBytes.toString() } : null,
    categoryId: product.categoryId,
    baseUnitId: product.baseUnitId,
    minOrderQty: product.minOrderQty.toString(),
    orderMultiple: product.orderMultiple.toString(),
    isActive: product.isActive,
    version: productVersion(product),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function productVersion(product: Pick<Product, 'updatedAt'>): number {
  return product.updatedAt.getTime();
}
