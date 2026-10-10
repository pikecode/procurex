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
import { PricingService } from '../pricing/pricing.service.js';

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
  salesPrice?: string;
  productId: string;
  sortOrder?: number;
  suppliers: Array<{ supplierId: string; priority: number; salesPrice?: string }>;
};

export type TemplateItemsView = {
  templateId: string;
  items: Array<{ productId: string; sortOrder: number; initialSalesPrice: string | null; isEnabled: boolean; minOrderQty: string | null; orderMultiple: string | null; suppliers: Array<{ supplierId: string; priority: number; salesPrice: string | null }> }>;
  removedCycleOverrides: Array<{ storeId: string; supplierId: string; settlementCycle: string }>;
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
  storeIds?: string[];
  confirmStoreReassignment?: boolean;
};

@Injectable()
export class TemplatesService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService = new AuditService(database), private readonly pricing: PricingService = new PricingService(database)) {}

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
      const { storeIds = [], confirmStoreReassignment = false, ...metadata } = input;
      if (storeIds.length) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.template-store-binding'))`;
        const stores = await tx.store.findMany({ where: { id: { in: storeIds } }, select: { id: true } });
        if (stores.length !== storeIds.length) throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'One or more stores were not found' });
        const conflicts = await tx.storeTemplateBinding.findMany({ where: { storeId: { in: storeIds }, expiredAt: null }, select: { storeId: true, templateId: true } });
        if (conflicts.length && !confirmStoreReassignment) throw new ConflictException({ code: 'STORE_ALREADY_BOUND', message: 'One or more stores already have an active template', details: { bindings: conflicts } });
        if (conflicts.length) {
          const reassignedAt = new Date();
          await tx.storeTemplateBinding.updateMany({ where: { storeId: { in: conflicts.map(row => row.storeId) }, expiredAt: null }, data: { expiredAt: reassignedAt } });
          await tx.templateStoreSupplierCycle.deleteMany({ where: { OR: conflicts.map(row => ({ templateId: row.templateId, storeId: row.storeId })) } });
        }
      }
      return toTemplateView(await tx.orderTemplate.create({ data: { ...metadata, code: metadata.code ?? `MB${randomUUID().replaceAll('-', '').toUpperCase()}`,
        bindings: storeIds.length ? { create: storeIds.map(storeId => ({ storeId })) } : undefined } }));
    });
  }

  async updateTemplate(id: string, expectedVersion: number, input: { name?: string; tag?: string; remark?: string | null }, context?: MasterDataAuditContext, transaction?: Prisma.TransactionClient): Promise<TemplateView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'template.update', 'OrderTemplate', async tx => {
      // All name-changing commands use the same lock before locking an individual template.
      if (input.name !== undefined) await this.requireUniqueName(tx, input.name, id);
      await this.lockTemplate(tx, id, expectedVersion);
      return toTemplateView(await tx.orderTemplate.update({ where: { id }, data: { ...input, updatedAt: new Date(Math.max(Date.now(), expectedVersion + 1)) } }));
    }, transaction);
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
      } });
      const copiedAt = new Date();
      for (const item of source.items) for (const supplier of item.suppliers) {
        const quote = await effectivePriceVersion(tx, item.productId, supplier.supplierId, copiedAt, id);
        if (!quote || item.initialSalesPrice === null) continue;
        const salesPrice = quote.scope.templateKey === id.toLowerCase() ? quote.salesPrice : item.initialSalesPrice;
        await tx.priceScope.create({ data: { productId: item.productId, supplierId: supplier.supplierId, templateKey: copy.id,
          versions: { create: { salesPrice, supplyPrice: quote.supplyPrice, supplySourceVersionId: quote.supplyVersionId,
            effectiveAt: copiedAt, reason: '复制订货模板销售价', revision: 1 } } } });
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
      await tx.templateStoreSupplierCycle.deleteMany({ where: { templateId: id } });
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
        cycleOverrides: { orderBy: [{ storeId: 'asc' }, { supplierId: 'asc' }] },
      },
    });
    if (!template) throw new NotFoundException({ code: 'TEMPLATE_NOT_FOUND', message: 'Template was not found' });
    return {
      ...toTemplateView(template),
      storeIds: template.bindings.map(binding => binding.storeId),
      items: await Promise.all(template.items.map(async item => ({ productId: item.productId, sortOrder: item.sortOrder, isEnabled: item.isEnabled,
        minOrderQty: item.minOrderQty?.toString() ?? null, orderMultiple: item.orderMultiple?.toString() ?? null,
        initialSalesPrice: item.initialSalesPrice?.toString() ?? null,
        salesPrice: item.initialSalesPrice?.toString() ?? null,
        suppliers: await Promise.all(item.suppliers.map(async supplier => {
          const price = await effectivePriceVersion(this.database.client, item.productId, supplier.supplierId, new Date(), id);
          return { supplierId: supplier.supplierId, priority: supplier.priority, salesPrice: price?.salesPrice.toString() ?? item.initialSalesPrice?.toString() ?? null, supplyPrice: price?.supplyPrice.toString() ?? null };
        })) }))),
      settings: template.settings.map(setting => ({ supplierId: setting.supplierId, settlementMode: setting.settlementMode, settlementCycle: setting.settlementCycle })),
      cycleOverrides: template.cycleOverrides.map(row => ({ storeId: row.storeId, supplierId: row.supplierId, settlementCycle: row.settlementCycle })),
    };
  }

  async replaceTemplateStores(templateId: string, expectedVersion: number, storeIds: string[], context?: MasterDataAuditContext, transaction?: Prisma.TransactionClient, confirmStoreReassignment = false): Promise<TemplateStoresView> {
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

    const conflictingBindings = await tx.storeTemplateBinding.findMany({
      where: {
        storeId: { in: uniqueStoreIds },
        expiredAt: null,
        templateId: { not: templateId },
      },
    });
    if (conflictingBindings.length && !confirmStoreReassignment) {
      throw new ConflictException({
        code: 'STORE_ALREADY_BOUND',
        message: 'One or more stores already have an active template',
        details: { bindings: conflictingBindings.map(row => ({ storeId: row.storeId, templateId: row.templateId })) },
      });
    }

    if (conflictingBindings.length) {
      const reassignedAt = new Date();
      await tx.storeTemplateBinding.updateMany({ where: { id: { in: conflictingBindings.map(row => row.id) } }, data: { expiredAt: reassignedAt } });
      await tx.templateStoreSupplierCycle.deleteMany({ where: { OR: conflictingBindings.map(row => ({ templateId: row.templateId, storeId: row.storeId })) } });
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
    await tx.templateStoreSupplierCycle.deleteMany({ where: { templateId, storeId: { notIn: uniqueStoreIds } } });

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
    }, transaction);
  }

  async replaceSettlementCycles(templateId: string, expectedVersion: number, rows: { storeId: string; supplierId: string; settlementCycle: string }[], context?: MasterDataAuditContext, transaction?: Prisma.TransactionClient) {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'template.settlement-cycles.replace', 'OrderTemplate', async tx => {
      await lockCatalog(tx);
      await this.lockTemplate(tx, templateId, expectedVersion);
      const bindings = await tx.storeTemplateBinding.findMany({ where: { templateId, expiredAt: null }, select: { storeId: true } });
      const links = await tx.templateItemSupplier.findMany({ where: { templateItem: { templateId, isEnabled: true } }, include: { supplier: true } });
      const keys = new Set<string>();
      for (const row of rows) {
        const key = `${row.storeId}:${row.supplierId}`;
        const supplier = links.find(link => link.supplierId === row.supplierId)?.supplier;
        if (keys.has(key) || !bindings.some(binding => binding.storeId === row.storeId) || !supplier || supplier.isArchived ||
          !['SUPPLIER_TERM', 'COMPANY_TERM'].includes(supplier.defaultSettlementMode) || !['IMMEDIATE', 'WEEKLY', 'HALF_MONTHLY', 'MONTHLY'].includes(row.settlementCycle)) {
          throw new ConflictException({ code: 'TEMPLATE_CYCLE_INVALID', message: '请选择已绑定门店和商品涉及的账期供应商，周期不能重复或无效' });
        }
        keys.add(key);
      }
      await tx.templateStoreSupplierCycle.deleteMany({ where: { templateId } });
      if (rows.length) await tx.templateStoreSupplierCycle.createMany({ data: rows.map(row => ({ ...row, templateId })) });
      const updated = await this.touchTemplate(tx, templateId, expectedVersion);
      return { templateId, version: templateVersion(updated), cycleOverrides: rows };
    }, transaction);
  }

  async replaceTemplateItems(templateId: string, expectedVersion: number, items: TemplateItemInput[], context?: MasterDataAuditContext, confirmCycleOverrideRemoval = false, transaction?: Prisma.TransactionClient): Promise<TemplateItemsView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'template.items.replace', 'OrderTemplate', async tx => {
    await lockPricePublication(tx, true);
    await lockCatalog(tx);
    await this.lockTemplate(tx, templateId, expectedVersion);
    const previousItems = await tx.templateItem.findMany({ where: { templateId }, include: { suppliers: { select: { supplierId: true } } } });
    const initialPrices = new Map(previousItems.map(item => [item.productId, item.initialSalesPrice]));
    const previousSupplierKeys = new Set(previousItems.flatMap(item => item.suppliers.map(link => `${item.productId}:${link.supplierId}`)));
    if (new Set(items.map(item => item.productId)).size !== items.length || items.some(item => new Set(item.suppliers.map(supplier => supplier.supplierId)).size !== item.suppliers.length)) {
      throw new ConflictException({ code: 'DUPLICATE_TEMPLATE_ITEM', message: 'Template products and their suppliers must be unique' });
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    const supplierIds = [...new Set(items.flatMap((item) => item.suppliers.map((supplier) => supplier.supplierId)))];
    const [products, suppliers] = await Promise.all([
      tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, defaultSalesPrice: true } }),
      tx.supplier.findMany({ where: { id: { in: supplierIds }, isArchived: false }, select: { id: true, name: true } }),
    ]);

    if (products.length !== productIds.length) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'One or more products were not found' });
    }
    if (suppliers.length !== supplierIds.length) {
      throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'One or more suppliers were not found' });
    }
      const retainedSupplierIds = items.filter(item => item.isEnabled).flatMap(item => item.suppliers.map(link => link.supplierId));
      // Dropping a supplier's products would silently revert its per-store settlement cycle to the supplier default.
      const removedCycleOverrides = await tx.templateStoreSupplierCycle.findMany({
        where: { templateId, supplierId: { notIn: retainedSupplierIds } },
        select: { storeId: true, supplierId: true, settlementCycle: true },
        orderBy: [{ storeId: 'asc' }, { supplierId: 'asc' }],
      });
      if (removedCycleOverrides.length && !confirmCycleOverrideRemoval) {
        throw new ConflictException({
          code: 'TEMPLATE_CYCLE_OVERRIDE_REMOVAL_UNCONFIRMED',
          message: '移除商品会同时清除这些门店的账期覆盖，确认后将以供应商默认账期结算',
          details: { overrides: removedCycleOverrides },
        });
      }
      if (removedCycleOverrides.length) {
        await tx.templateStoreSupplierCycle.deleteMany({ where: { templateId, supplierId: { notIn: retainedSupplierIds } } });
      }
      await tx.templateItem.deleteMany({ where: { templateId } });
      for (const item of items) {
        const templateSalesPrice = item.salesPrice ?? initialPrices.get(item.productId)?.toString() ?? products.find(product => product.id === item.productId)!.defaultSalesPrice!.toString();
        await tx.templateItem.create({
          data: {
            templateId,
            productId: item.productId,
            isEnabled: item.isEnabled ?? previousItems.find(previous => previous.productId === item.productId)?.isEnabled ?? true,
            minOrderQty: item.minOrderQty === undefined ? previousItems.find(previous => previous.productId === item.productId)?.minOrderQty : item.minOrderQty,
            orderMultiple: item.orderMultiple === undefined ? previousItems.find(previous => previous.productId === item.productId)?.orderMultiple : item.orderMultiple,
            initialSalesPrice: templateSalesPrice,
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
    await this.touchTemplate(tx, templateId, expectedVersion);
    const effectiveAt = new Date();
    for (const item of items) for (const supplier of item.suppliers) {
      const current = await effectivePriceVersion(tx, item.productId, supplier.supplierId, effectiveAt, templateId);
      if (!current) {
        const product = products.find(row => row.id === item.productId);
        const supplierRecord = suppliers.find(row => row.id === supplier.supplierId);
        throw new ConflictException({ code: 'PRICE_VERSION_NOT_FOUND', message: `“${product?.name ?? '商品'}”尚未维护“${supplierRecord?.name ?? '供应商'}”的供货价`,
          details: { productId: item.productId, productName: product?.name, supplierId: supplier.supplierId, supplierName: supplierRecord?.name } });
      }
      const wasLinked = previousSupplierKeys.has(`${item.productId}:${supplier.supplierId}`);
      const templateSalesPrice = supplier.salesPrice ?? item.salesPrice ?? (wasLinked ? current.salesPrice.toString() : current.supplyPrice.toString());
      if (current.salesPrice.equals(templateSalesPrice) && current.scope.templateKey === templateId.toLowerCase()) continue;
      await this.pricing.publishPrice({ productId: item.productId, supplierId: supplier.supplierId, templateId,
        salesPrice: templateSalesPrice, supplyPrice: current.supplyPrice.toString(), effectiveAt, reason: '订货模板维护门店销售价' }, tx);
    }
    // Keep the legacy item-level price aligned with the default supplier. Supplier prices remain authoritative.
    for (const item of items) {
      const primary = [...item.suppliers].sort((left, right) => left.priority - right.priority || left.supplierId.localeCompare(right.supplierId))[0];
      const primaryPrice = primary ? await effectivePriceVersion(tx, item.productId, primary.supplierId, effectiveAt, templateId) : null;
      const primarySalesPrice = primaryPrice?.salesPrice.toString() ?? item.salesPrice ?? initialPrices.get(item.productId)?.toString() ?? products.find(product => product.id === item.productId)!.defaultSalesPrice!.toString();
      await tx.templateItem.update({ where: { templateId_productId: { templateId, productId: item.productId } }, data: { initialSalesPrice: primarySalesPrice } });
    }
    const updated = await tx.orderTemplate.findUniqueOrThrow({ where: { id: templateId } });
    const currentItems = await tx.templateItem.findMany({
      where: { templateId },
      orderBy: [{ sortOrder: 'asc' }, { productId: 'asc' }],
      include: { suppliers: { orderBy: [{ priority: 'asc' }, { supplierId: 'asc' }] } },
    });

    return {
      templateId,
      items: await Promise.all(currentItems.map(async (item) => ({
        isEnabled: item.isEnabled, minOrderQty: item.minOrderQty?.toString() ?? null, orderMultiple: item.orderMultiple?.toString() ?? null,
        initialSalesPrice: item.initialSalesPrice?.toString() ?? null,
        productId: item.productId,
        sortOrder: item.sortOrder,
        suppliers: await Promise.all(item.suppliers.map(async (supplier) => ({ supplierId: supplier.supplierId, priority: supplier.priority,
          salesPrice: (await effectivePriceVersion(tx, item.productId, supplier.supplierId, new Date(), templateId))?.salesPrice.toString() ?? item.initialSalesPrice?.toString() ?? null }))),
      }))),
      removedCycleOverrides,
      version: templateVersion(updated),
    };
    }, transaction);
  }

  async replaceConfiguration(id: string, expectedVersion: number, input: { name: string; tag: string; remark?: string | null; storeIds: string[]; items: TemplateItemInput[]; rows: { storeId: string; supplierId: string; settlementCycle: string }[]; confirmStoreReassignment: boolean; confirmCycleOverrideRemoval: boolean }, context?: MasterDataAuditContext) {
    return this.database.client.$transaction(async tx => {
      // Follow the publication/catalog/name/binding lock order before touching the template.
      await lockPricePublication(tx, true);
      await lockCatalog(tx);
      await this.requireUniqueName(tx, input.name, id);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.template-store-binding'))`;
      const metadata = await this.updateTemplate(id, expectedVersion, { name: input.name, tag: input.tag, remark: input.remark }, context, tx);
      const stores = await this.replaceTemplateStores(id, metadata.version, input.storeIds, context, tx, input.confirmStoreReassignment);
      const items = await this.replaceTemplateItems(id, stores.version, input.items, context, input.confirmCycleOverrideRemoval, tx);
      return this.replaceSettlementCycles(id, items.version, input.rows, context, tx);
    }, { timeout: 30000 });
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
