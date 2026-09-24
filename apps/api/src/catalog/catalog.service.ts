import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Category, Product, Unit } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { PricingService } from '../pricing/pricing.service.js';

export type CategoryView = {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  sortOrder: number;
  createdAt: string;
};

export type UnitView = {
  id: string;
  code: string;
  name: string;
  createdAt: string;
};

export type ProductView = {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  baseUnitId: string;
  minOrderQty: string;
  orderMultiple: string;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type StoreCatalogView = {
  storeId: string;
  templateId: string;
  items: Array<{
    product: ProductView;
    sortOrder: number;
    suppliers: Array<{
      supplierId: string;
      priority: number;
      salesPrice: string | null;
      supplyPrice: string | null;
      priceVersionId: string | null;
    }>;
  }>;
};

export type CreateCategoryInput = {
  code: string;
  name: string;
  parentId?: string;
  sortOrder?: number;
};

export type CreateUnitInput = {
  code: string;
  name: string;
};

export type CreateProductInput = {
  sku: string;
  name: string;
  categoryId: string;
  baseUnitId: string;
  minOrderQty: string;
  orderMultiple: string;
};

export type UpdateProductInput = {
  expectedVersion: number;
  name?: string;
  categoryId?: string;
  baseUnitId?: string;
  minOrderQty?: string;
  orderMultiple?: string;
  isActive?: boolean;
};

@Injectable()
export class CatalogService {
  constructor(
    private readonly database: DatabaseService,
    private readonly pricingService: PricingService,
  ) {}

  async listCategories(): Promise<CategoryView[]> {
    const categories = await this.database.client.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    return categories.map(toCategoryView);
  }

  async createCategory(input: CreateCategoryInput): Promise<CategoryView> {
    if (input.parentId) {
      await this.requireCategory(input.parentId);
    }

    const category = await this.database.client.category.create({ data: input });
    return toCategoryView(category);
  }

  async listUnits(): Promise<UnitView[]> {
    const units = await this.database.client.unit.findMany({ orderBy: { code: 'asc' } });
    return units.map(toUnitView);
  }

  async createUnit(input: CreateUnitInput): Promise<UnitView> {
    const unit = await this.database.client.unit.create({ data: input });
    return toUnitView(unit);
  }

  async listProducts(): Promise<ProductView[]> {
    const products = await this.database.client.product.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return products.map(toProductView);
  }

  async createProduct(input: CreateProductInput): Promise<ProductView> {
    await Promise.all([this.requireCategory(input.categoryId), this.requireUnit(input.baseUnitId)]);

    const product = await this.database.client.product.create({
      data: input,
    });
    return toProductView(product);
  }

  async updateProduct(id: string, input: UpdateProductInput): Promise<ProductView> {
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

    const updated = await this.database.client.product.update({
      where: { id },
      data: {
        name: input.name,
        categoryId: input.categoryId,
        baseUnitId: input.baseUnitId,
        minOrderQty: input.minOrderQty,
        orderMultiple: input.orderMultiple,
        isActive: input.isActive,
      },
    });
    return toProductView(updated);
  }

  async readStoreCatalog(storeId: string, at = new Date()): Promise<StoreCatalogView> {
    const binding = await this.database.client.storeTemplateBinding.findFirst({
      where: {
        storeId,
        expiredAt: null,
        template: { isArchived: false },
      },
      include: {
        template: {
          include: {
            items: {
              where: { isEnabled: true, product: { isActive: true } },
              orderBy: [{ sortOrder: 'asc' }, { productId: 'asc' }],
              include: {
                product: true,
                suppliers: {
                  orderBy: [{ priority: 'asc' }, { supplierId: 'asc' }],
                  include: { supplier: true },
                },
              },
            },
          },
        },
      },
    });

    if (!binding) {
      throw new NotFoundException({
        code: 'STORE_TEMPLATE_NOT_FOUND',
        message: 'Store does not have an active template',
      });
    }

    return {
      storeId,
      templateId: binding.templateId,
      items: await Promise.all(
        binding.template.items.map(async (item) => ({
          product: toProductView(item.product),
          sortOrder: item.sortOrder,
          suppliers: await Promise.all(
            item.suppliers.map(async (supplier) => {
              const price = await this.tryGetEffectivePrice(item.productId, supplier.supplierId, at);
              return {
                supplierId: supplier.supplierId,
                priority: supplier.priority,
                salesPrice: price?.salesPrice ?? null,
                supplyPrice: price?.supplyPrice ?? null,
                priceVersionId: price?.versionId ?? null,
              };
            }),
          ),
        })),
      ),
    };
  }

  private async tryGetEffectivePrice(productId: string, supplierId: string, at: Date): Promise<{ salesPrice: string; supplyPrice: string; versionId: string } | null> {
    try {
      return await this.pricingService.getEffectivePrice(productId, supplierId, at);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
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
    id: unit.id,
    code: unit.code,
    name: unit.name,
    createdAt: unit.createdAt.toISOString(),
  };
}

function toProductView(product: Product): ProductView {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
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
