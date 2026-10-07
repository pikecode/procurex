import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SettlementMode } from '../../../../packages/backend/generated/prisma/enums.js';
import { Prisma, type OrderTemplate } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { auditedMasterDataTransaction, type MasterDataAuditContext } from '../audit/master-data-audit.js';
import { lockCatalog } from '../catalog/catalog-registries.service.js';
import { lockPricePublication } from '../pricing/price-checkpoint.js';
import { effectivePriceVersion } from '../pricing/effective-price.js';

export type TemplateView = {
  tag: string | null;
  remark: string | null;
  id: string;
  code: string;
  name: string;
  isArchived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TemplateListView = TemplateView & { storeIds: string[] };

export type TemplateStoresView = {
  templateId: string;
  storeIds: string[];
  version: number;
};

export type TemplateItemInput = {
  isEnabled?: boolean;
  minOrderQty?: string | null;
  orderMultiple?: string | null;
  productId: string;
  sortOrder?: number;
  suppliers: Array<{ supplierId: string; priority: number }>;
};

export type TemplateItemsView = {
  templateId: string;
  items: Array<{ productId: string; sortOrder: number; initialSalesPrice: string | null; isEnabled: boolean; minOrderQty: string | null; orderMultiple: string | null; suppliers: Array<{ supplierId: string; priority: number }> }>;
  version: number;
};

export type TemplateSupplierSettingView = {
  templateId: string;
  supplierId: string;
  settlementMode: SettlementMode;
  settlementCycle: string;
  version: number;
};

export type TemplatePaymentSetting = { supplierId: string; settlementMode: SettlementMode; settlementCycle: string };

export type CreateTemplateInput = {
  code?: string;
  name: string;
  tag?: string;
  remark?: string | null;
};

@Injectable()
export class TemplatesService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService = new AuditService(database)) {}

  async listTemplates(): Promise<TemplateListView[]> {
    const templates = await this.database.client.orderTemplate.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { bindings: { where: { expiredAt: null }, select: { storeId: true } } },
    });
    return templates.map(template => ({ ...toTemplateView(template), storeIds: template.bindings.map(binding => binding.storeId) }));
  }

  async createTemplate(input: CreateTemplateInput, context?: MasterDataAuditContext): Promise<TemplateView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'template.create', 'OrderTemplate', async tx => {
      await this.requireUniqueName(tx, input.name);
      return toTemplateView(await tx.orderTemplate.create({ data: { ...input, code: input.code ?? `MB${randomUUID().replaceAll('-', '').toUpperCase()}` } }));
    });
  }

  async updateTemplate(id: string, expectedVersion: number, input: { name?: string; tag?: string; remark?: string | null }, context?: MasterDataAuditContext): Promise<TemplateView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'template.update', 'OrderTemplate', async tx => {
      // All name-changing commands use the same lock before locking an individual template.
      if (input.name !== undefined) await this.requireUniqueName(tx, input.name, id);
      await this.lockTemplate(tx, id, expectedVersion);
      return toTemplateView(await tx.orderTemplate.update({ where: { id }, data: { ...input, updatedAt: new Date(Math.max(Date.now(), expectedVersion + 1)) } }));
    });
  }

  async copyTemplate(id: string, expectedVersion: number, input: CreateTemplateInput, context?: MasterDataAuditContext): Promise<TemplateView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'template.copy', 'OrderTemplate', async tx => {
      await lockPricePublication(tx, true);
      await this.requireUniqueName(tx, input.name);
      await this.lockTemplate(tx, id, expectedVersion);
      const source = await tx.orderTemplate.findUniqueOrThrow({ where: { id }, include: { items: { include: { suppliers: true } }, settings: true } });
      const copy = await tx.orderTemplate.create({ data: {
        code: input.code ?? `MB${randomUUID().replaceAll('-', '').toUpperCase()}`, name: input.name, tag: input.tag ?? source.tag, remark: input.remark === undefined ? source.remark : input.remark,
        items: { create: source.items.map(item => ({ productId: item.productId, sortOrder: item.sortOrder, isEnabled: item.isEnabled, initialSalesPrice: item.initialSalesPrice, minOrderQty: item.minOrderQty, orderMultiple: item.orderMultiple,
          suppliers: { create: item.suppliers.map(supplier => ({ supplierId: supplier.supplierId, priority: supplier.priority })) } })) },
        settings: { create: source.settings.map(setting => ({ supplierId: setting.supplierId, settlementMode: setting.settlementMode, settlementCycle: setting.settlementCycle })) },
      } });
      const copiedAt = new Date();
      for (const item of source.items) for (const supplier of item.suppliers) {
        const scopes = await tx.priceScope.findMany({ where: { productId: item.productId, supplierId: supplier.supplierId, templateKey: { in: ['', source.id] } },
          include: { versions: { orderBy: [{ effectiveAt: 'asc' }, { revision: 'asc' }] } } });
        const times = [copiedAt, ...[...new Set(scopes.flatMap(scope => scope.versions.filter(version => version.effectiveAt > copiedAt).map(version => version.effectiveAt.toISOString())))].sort().map(time => new Date(time))];
        const versions: Array<{ salesPrice: Prisma.Decimal; supplyPrice: Prisma.Decimal; supplySourceVersionId: string; effectiveAt: Date; reason: string; revision: number }> = [];
        let previousSaleVersion: string | undefined;
        for (const at of times) {
          const quote = await effectivePriceVersion(tx, item.productId, supplier.supplierId, at, id);
          if (!quote || quote.id === previousSaleVersion) continue;
          versions.push({ salesPrice: quote.salesPrice, supplyPrice: quote.supplyPrice, supplySourceVersionId: quote.supplyVersionId, effectiveAt: at, reason: 'Copied template price', revision: versions.length + 1 });
          previousSaleVersion = quote.id;
        }
        if (!versions.length) continue;
        await tx.priceScope.create({ data: { productId: item.productId, supplierId: supplier.supplierId, templateKey: copy.id,
          versions: { create: versions } } });
      }
      return toTemplateView(copy);
    });
  }

  async archiveTemplate(id: string, expectedVersion: number, context?: MasterDataAuditContext): Promise<TemplateView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'template.archive', 'OrderTemplate', async tx => {
      await lockPricePublication(tx);
      await lockCatalog(tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.template-store-binding'))`;
      await this.lockTemplate(tx, id, expectedVersion);
      await tx.storeTemplateBinding.updateMany({ where: { templateId: id, expiredAt: null }, data: { expiredAt: new Date() } });
      await tx.templateItem.deleteMany({ where: { templateId: id } });
      await tx.templateSupplierSetting.deleteMany({ where: { templateId: id } });
      return toTemplateView(await tx.orderTemplate.update({ where: { id }, data: { isArchived: true, updatedAt: new Date(Math.max(Date.now(), expectedVersion + 1)) } }));
    });
  }

  async clearSupplierSetting(id: string, supplierId: string, expectedVersion: number, context?: MasterDataAuditContext) {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'template.supplier-setting.clear', 'OrderTemplate', async tx => {
      await lockPricePublication(tx);
      await this.lockTemplate(tx, id, expectedVersion);
      const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Supplier was not found' });
      if (supplier.defaultSettlementMode === SettlementMode.SUPPLIER_TERM) {
        await this.requireDirectPrices(tx, id, supplierId);
      }
      await tx.templateSupplierSetting.deleteMany({ where: { templateId: id, supplierId } });
      const updated = await this.touchTemplate(tx, id, expectedVersion);
      return { templateId: id, supplierId, settlementMode: supplier.defaultSettlementMode, settlementCycle: supplier.defaultSettlementCycle, usesDefault: true, version: templateVersion(updated) };
    });
  }

  private async requireUniqueName(tx: Prisma.TransactionClient, name: string, exceptId?: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.template-name'))`;
    const duplicate = await tx.orderTemplate.findFirst({ where: { name, id: exceptId ? { not: exceptId } : undefined } });
    if (duplicate) throw new ConflictException({ code: 'TEMPLATE_NAME_EXISTS', message: 'Template name already exists' });
  }

  async getTemplate(id: string) {
    const template = await this.database.client.orderTemplate.findUnique({
      where: { id },
      include: {
        bindings: { where: { expiredAt: null }, orderBy: { storeId: 'asc' }, select: { storeId: true } },
        items: { orderBy: [{ sortOrder: 'asc' }, { productId: 'asc' }], include: { suppliers: { orderBy: [{ priority: 'asc' }, { supplierId: 'asc' }] } } },
        settings: { orderBy: { supplierId: 'asc' } },
      },
    });
    if (!template) throw new NotFoundException({ code: 'TEMPLATE_NOT_FOUND', message: 'Template was not found' });
    return {
      ...toTemplateView(template),
      storeIds: template.bindings.map(binding => binding.storeId),
      items: await Promise.all(template.items.map(async item => ({ productId: item.productId, sortOrder: item.sortOrder, isEnabled: item.isEnabled,
        minOrderQty: item.minOrderQty?.toString() ?? null, orderMultiple: item.orderMultiple?.toString() ?? null,
        initialSalesPrice: item.initialSalesPrice?.toString() ?? null,
        suppliers: await Promise.all(item.suppliers.map(async supplier => {
          const price = await effectivePriceVersion(this.database.client, item.productId, supplier.supplierId, new Date(), id);
          return { supplierId: supplier.supplierId, priority: supplier.priority, salesPrice: price?.salesPrice.toString() ?? null, supplyPrice: price?.supplyPrice.toString() ?? null };
        })) }))),
      settings: template.settings.map(setting => ({ supplierId: setting.supplierId, settlementMode: setting.settlementMode, settlementCycle: setting.settlementCycle })),
    };
  }

  async replaceTemplateStores(templateId: string, expectedVersion: number, storeIds: string[], context?: MasterDataAuditContext): Promise<TemplateStoresView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'template.stores.replace', 'OrderTemplate', async tx => {
    // Binding changes across different templates must not claim the same store concurrently.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.template-store-binding'))`;
    await this.lockTemplate(tx, templateId, expectedVersion);
    const uniqueStoreIds = [...new Set(storeIds)];
    const stores = await tx.store.findMany({
      where: { id: { in: uniqueStoreIds } },
      select: { id: true },
    });
    if (stores.length !== uniqueStoreIds.length) {
      throw new NotFoundException({
        code: 'STORE_NOT_FOUND',
        message: 'One or more stores were not found',
      });
    }

    const conflictingBinding = await tx.storeTemplateBinding.findFirst({
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

    await tx.storeTemplateBinding.updateMany({
        where: {
          templateId,
          expiredAt: null,
        },
        data: { expiredAt: new Date() },
      });
    await tx.storeTemplateBinding.createMany({
        data: uniqueStoreIds.map((storeId) => ({ templateId, storeId })),
      });

    const activeBindings = await tx.storeTemplateBinding.findMany({
      where: { templateId, expiredAt: null },
      orderBy: { storeId: 'asc' },
      select: { storeId: true },
    });
    const updated = await this.touchTemplate(tx, templateId, expectedVersion);

    return {
      templateId,
      storeIds: activeBindings.map((binding) => binding.storeId),
      version: templateVersion(updated),
    };
    });
  }

  async replaceTemplateItems(templateId: string, expectedVersion: number, items: TemplateItemInput[], context?: MasterDataAuditContext): Promise<TemplateItemsView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'template.items.replace', 'OrderTemplate', async tx => {
    await lockPricePublication(tx);
    await lockCatalog(tx);
    await this.lockTemplate(tx, templateId, expectedVersion);
    const previousItems = await tx.templateItem.findMany({ where: { templateId } });
    const initialPrices = new Map(previousItems.map(item => [item.productId, item.initialSalesPrice]));
    if (new Set(items.map(item => item.productId)).size !== items.length || items.some(item => new Set(item.suppliers.map(supplier => supplier.supplierId)).size !== item.suppliers.length)) {
      throw new ConflictException({ code: 'DUPLICATE_TEMPLATE_ITEM', message: 'Template products and their suppliers must be unique' });
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    const supplierIds = [...new Set(items.flatMap((item) => item.suppliers.map((supplier) => supplier.supplierId)))];
    const [products, suppliers] = await Promise.all([
      tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, defaultSalesPrice: true } }),
      tx.supplier.findMany({ where: { id: { in: supplierIds }, isArchived: false }, select: { id: true } }),
    ]);

    if (products.length !== productIds.length) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'One or more products were not found' });
    }
    if (suppliers.length !== supplierIds.length) {
      throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'One or more suppliers were not found' });
    }

      await tx.templateItem.deleteMany({ where: { templateId } });
      for (const item of items) {
        await tx.templateItem.create({
          data: {
            templateId,
            productId: item.productId,
            isEnabled: item.isEnabled ?? previousItems.find(previous => previous.productId === item.productId)?.isEnabled ?? true,
            minOrderQty: item.minOrderQty === undefined ? previousItems.find(previous => previous.productId === item.productId)?.minOrderQty : item.minOrderQty,
            orderMultiple: item.orderMultiple === undefined ? previousItems.find(previous => previous.productId === item.productId)?.orderMultiple : item.orderMultiple,
            initialSalesPrice: initialPrices.has(item.productId) ? initialPrices.get(item.productId) : products.find(product => product.id === item.productId)!.defaultSalesPrice,
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
    const updated = await this.touchTemplate(tx, templateId, expectedVersion);
    const currentItems = await tx.templateItem.findMany({
      where: { templateId },
      orderBy: [{ sortOrder: 'asc' }, { productId: 'asc' }],
      include: { suppliers: { orderBy: [{ priority: 'asc' }, { supplierId: 'asc' }] } },
    });

    return {
      templateId,
      items: currentItems.map((item) => ({
        isEnabled: item.isEnabled, minOrderQty: item.minOrderQty?.toString() ?? null, orderMultiple: item.orderMultiple?.toString() ?? null,
        initialSalesPrice: item.initialSalesPrice?.toString() ?? null,
        productId: item.productId,
        sortOrder: item.sortOrder,
        suppliers: item.suppliers.map((supplier) => ({ supplierId: supplier.supplierId, priority: supplier.priority })),
      })),
      version: templateVersion(updated),
    };
    });
  }

  async replaceSupplierSettings(templateId: string, expectedVersion: number, settings: TemplatePaymentSetting[], context?: MasterDataAuditContext) {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'template.supplier-settings.replace', 'OrderTemplate', async tx => {
      await lockPricePublication(tx);
      await lockCatalog(tx);
      await this.lockTemplate(tx, templateId, expectedVersion);
      const links = await tx.templateItemSupplier.findMany({ where: { templateItem: { templateId } }, select: { supplierId: true } });
      const linkedIds = new Set(links.map(link => link.supplierId));
      if (settings.length !== linkedIds.size || new Set(settings.map(row => row.supplierId)).size !== settings.length || settings.some(row => !linkedIds.has(row.supplierId))) {
        throw new ConflictException({ code: 'SUPPLIER_NOT_IN_TEMPLATE', message: 'Settings must cover every linked supplier exactly once' });
      }
      for (const row of settings) {
        if (row.settlementMode === SettlementMode.SUPPLIER_TERM) await this.requireDirectPrices(tx, templateId, row.supplierId);
      }
      await tx.templateSupplierSetting.deleteMany({ where: { templateId } });
      if (settings.length) await tx.templateSupplierSetting.createMany({ data: settings.map(row => ({ ...row, templateId })) });
      const updated = await this.touchTemplate(tx, templateId, expectedVersion);
      return { templateId, version: templateVersion(updated), settings };
    });
  }

  async setSupplierSetting(
    templateId: string,
    supplierId: string,
    expectedVersion: number,
    settlementMode: SettlementMode,
    settlementCycle: string,
    context?: MasterDataAuditContext,
  ): Promise<TemplateSupplierSettingView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'template.supplier-setting.set', 'OrderTemplate', async tx => {
    await lockPricePublication(tx);
    await this.lockTemplate(tx, templateId, expectedVersion);

    const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) {
      throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Supplier was not found' });
    }

    if (settlementMode === SettlementMode.SUPPLIER_TERM) {
      await this.requireDirectPrices(tx, templateId, supplierId);
    }

    const linked = await tx.templateItemSupplier.findFirst({ where: { supplierId, templateItem: { templateId } } });
    if (!linked) throw new ConflictException({ code: 'SUPPLIER_NOT_IN_TEMPLATE', message: 'Supplier is not associated with template products' });
    const setting = await tx.templateSupplierSetting.upsert({
      where: { templateId_supplierId: { templateId, supplierId } },
      update: { settlementMode, settlementCycle },
      create: { templateId, supplierId, settlementMode, settlementCycle },
    });
    const updated = await this.touchTemplate(tx, templateId, expectedVersion);

    return {
      templateId: setting.templateId,
      supplierId: setting.supplierId,
      settlementMode: setting.settlementMode,
      settlementCycle: setting.settlementCycle,
      version: templateVersion(updated),
    };
    });
  }

  private async requireDirectPrices(tx: Prisma.TransactionClient, templateId: string, supplierId: string) {
    const items = await tx.templateItem.findMany({ where: { templateId, suppliers: { some: { supplierId } } }, select: { productId: true } });
    const now = new Date();
    for (const item of items) {
      const versions = await tx.priceVersion.findMany({ where: { scope: { productId: item.productId, supplierId, templateKey: { in: ['', templateId.toLowerCase()] } }, effectiveAt: { gt: now } }, select: { effectiveAt: true } });
      const times = new Set([now.toISOString(), ...versions.map(version => version.effectiveAt.toISOString())]);
      for (const time of times) {
        const price = await effectivePriceVersion(tx, item.productId, supplierId, new Date(time), templateId);
        if (price && !price.salesPrice.equals(price.supplyPrice)) throw new ConflictException({ code: 'DIRECT_TERM_PRICES_MUST_MATCH', message: 'Current and scheduled direct supplier-term prices must be equal' });
      }
    }
  }

  private async lockTemplate(tx: Prisma.TransactionClient, id: string, expectedVersion: number): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "OrderTemplate" WHERE "id" = ${id}::uuid FOR UPDATE`);
    const template = await tx.orderTemplate.findUnique({ where: { id } });
    if (!template || template.isArchived) throw new NotFoundException({ code: 'TEMPLATE_NOT_FOUND', message: 'Template was not found' });
    this.assertTemplateVersion(template, expectedVersion);
  }

  private touchTemplate(tx: Prisma.TransactionClient, id: string, version: number) {
    return tx.orderTemplate.update({ where: { id }, data: { updatedAt: new Date(Math.max(Date.now(), version + 1)) } });
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
    tag: template.tag,
    remark: template.remark,
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
