import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SettlementMode } from '../../../../packages/backend/generated/prisma/enums.js';
import type { OrderTemplate } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type TemplateView = {
  id: string;
  code: string;
  name: string;
  isArchived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TemplateStoresView = {
  templateId: string;
  storeIds: string[];
  version: number;
};

export type TemplateItemInput = {
  productId: string;
  sortOrder?: number;
  suppliers: Array<{ supplierId: string; priority: number }>;
};

export type TemplateItemsView = {
  templateId: string;
  items: Array<{ productId: string; sortOrder: number; suppliers: Array<{ supplierId: string; priority: number }> }>;
  version: number;
};

export type TemplateSupplierSettingView = {
  templateId: string;
  supplierId: string;
  settlementMode: SettlementMode;
  settlementCycle: string;
  version: number;
};

export type CreateTemplateInput = {
  code: string;
  name: string;
};

@Injectable()
export class TemplatesService {
  constructor(private readonly database: DatabaseService) {}

  async listTemplates(): Promise<TemplateView[]> {
    const templates = await this.database.client.orderTemplate.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return templates.map(toTemplateView);
  }

  async createTemplate(input: CreateTemplateInput): Promise<TemplateView> {
    const template = await this.database.client.orderTemplate.create({ data: input });
    return toTemplateView(template);
  }

  async replaceTemplateStores(templateId: string, expectedVersion: number, storeIds: string[]): Promise<TemplateStoresView> {
    const template = await this.database.client.orderTemplate.findUnique({ where: { id: templateId } });
    if (!template || template.isArchived) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: 'Template was not found',
      });
    }

    const version = templateVersion(template);
    if (version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Template version has changed',
        details: { expectedVersion, currentVersion: version },
      });
    }

    const uniqueStoreIds = [...new Set(storeIds)];
    const stores = await this.database.client.store.findMany({
      where: { id: { in: uniqueStoreIds } },
      select: { id: true },
    });
    if (stores.length !== uniqueStoreIds.length) {
      throw new NotFoundException({
        code: 'STORE_NOT_FOUND',
        message: 'One or more stores were not found',
      });
    }

    const conflictingBinding = await this.database.client.storeTemplateBinding.findFirst({
      where: {
        storeId: { in: uniqueStoreIds },
        expiredAt: null,
        templateId: { not: templateId },
      },
    });
    if (conflictingBinding) {
      throw new ConflictException({
        code: 'STORE_ALREADY_BOUND',
        message: 'One or more stores already have an active template',
        details: { storeId: conflictingBinding.storeId, templateId: conflictingBinding.templateId },
      });
    }

    await this.database.client.$transaction([
      this.database.client.storeTemplateBinding.updateMany({
        where: {
          templateId,
          expiredAt: null,
        },
        data: { expiredAt: new Date() },
      }),
      this.database.client.storeTemplateBinding.createMany({
        data: uniqueStoreIds.map((storeId) => ({ templateId, storeId })),
      }),
    ]);

    const activeBindings = await this.database.client.storeTemplateBinding.findMany({
      where: { templateId, expiredAt: null },
      orderBy: { storeId: 'asc' },
      select: { storeId: true },
    });
    const updated = await this.database.client.orderTemplate.update({ where: { id: templateId }, data: {} });

    return {
      templateId,
      storeIds: activeBindings.map((binding) => binding.storeId),
      version: templateVersion(updated),
    };
  }

  async replaceTemplateItems(templateId: string, expectedVersion: number, items: TemplateItemInput[]): Promise<TemplateItemsView> {
    const template = await this.requireActiveTemplate(templateId);
    this.assertTemplateVersion(template, expectedVersion);

    const productIds = [...new Set(items.map((item) => item.productId))];
    const supplierIds = [...new Set(items.flatMap((item) => item.suppliers.map((supplier) => supplier.supplierId)))];
    const [products, suppliers] = await Promise.all([
      this.database.client.product.findMany({ where: { id: { in: productIds } }, select: { id: true } }),
      this.database.client.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true } }),
    ]);

    if (products.length !== productIds.length) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'One or more products were not found' });
    }
    if (suppliers.length !== supplierIds.length) {
      throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'One or more suppliers were not found' });
    }

    await this.database.client.$transaction(async (tx) => {
      await tx.templateItem.deleteMany({ where: { templateId } });
      for (const item of items) {
        await tx.templateItem.create({
          data: {
            templateId,
            productId: item.productId,
            sortOrder: item.sortOrder ?? 0,
            suppliers: {
              create: item.suppliers.map((supplier) => ({
                supplierId: supplier.supplierId,
                priority: supplier.priority,
              })),
            },
          },
        });
      }
    });

    const updated = await this.database.client.orderTemplate.update({ where: { id: templateId }, data: {} });
    const currentItems = await this.database.client.templateItem.findMany({
      where: { templateId },
      orderBy: [{ sortOrder: 'asc' }, { productId: 'asc' }],
      include: { suppliers: { orderBy: [{ priority: 'asc' }, { supplierId: 'asc' }] } },
    });

    return {
      templateId,
      items: currentItems.map((item) => ({
        productId: item.productId,
        sortOrder: item.sortOrder,
        suppliers: item.suppliers.map((supplier) => ({ supplierId: supplier.supplierId, priority: supplier.priority })),
      })),
      version: templateVersion(updated),
    };
  }

  async setSupplierSetting(
    templateId: string,
    supplierId: string,
    expectedVersion: number,
    settlementMode: SettlementMode,
    settlementCycle: string,
  ): Promise<TemplateSupplierSettingView> {
    const template = await this.requireActiveTemplate(templateId);
    this.assertTemplateVersion(template, expectedVersion);

    const supplier = await this.database.client.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) {
      throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Supplier was not found' });
    }

    if (settlementMode === SettlementMode.SUPPLIER_TERM) {
      const items = await this.database.client.templateItem.findMany({ where: { templateId }, select: { productId: true } });
      const scopes = await this.database.client.priceScope.findMany({
        where: { supplierId, productId: { in: items.map((item) => item.productId) } },
        include: { versions: { orderBy: [{ effectiveAt: 'desc' }, { revision: 'desc' }], take: 1 } },
      });
      if (scopes.some((scope) => scope.versions[0] && !scope.versions[0].salesPrice.equals(scope.versions[0].supplyPrice))) {
        throw new ConflictException({
          code: 'DIRECT_TERM_PRICES_MUST_MATCH',
          message: 'Direct supplier-term sales and supply prices must be equal',
        });
      }
    }

    const setting = await this.database.client.templateSupplierSetting.upsert({
      where: { templateId_supplierId: { templateId, supplierId } },
      update: { settlementMode, settlementCycle },
      create: { templateId, supplierId, settlementMode, settlementCycle },
    });
    const updated = await this.database.client.orderTemplate.update({ where: { id: templateId }, data: {} });

    return {
      templateId: setting.templateId,
      supplierId: setting.supplierId,
      settlementMode: setting.settlementMode,
      settlementCycle: setting.settlementCycle,
      version: templateVersion(updated),
    };
  }

  private async requireActiveTemplate(templateId: string): Promise<OrderTemplate> {
    const template = await this.database.client.orderTemplate.findUnique({ where: { id: templateId } });
    if (!template || template.isArchived) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: 'Template was not found',
      });
    }
    return template;
  }

  private assertTemplateVersion(template: OrderTemplate, expectedVersion: number): void {
    const version = templateVersion(template);
    if (version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Template version has changed',
        details: { expectedVersion, currentVersion: version },
      });
    }
  }
}

function toTemplateView(template: OrderTemplate): TemplateView {
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    isArchived: template.isArchived,
    version: templateVersion(template),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

function templateVersion(template: Pick<OrderTemplate, 'updatedAt'>): number {
  return template.updatedAt.getTime();
}
