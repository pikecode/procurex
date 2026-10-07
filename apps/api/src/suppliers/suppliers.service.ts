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

export type SupplierView = Pick<Supplier, 'address' | 'bankName' | 'bankAccountName' | 'bankAccount' | 'taxpayerId' | 'invoiceTitle' | 'requiresFreight' | 'supplierType' | 'settlementCycleDescription' | 'remark'> & {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
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
};

export type CreateSupplierInput = SupplierProfile & {
  code?: string;
  name: string;
  deliveryMode: DeliveryMode;
  defaultSettlementMode: SettlementMode;
  defaultSettlementCycle: string;
  contactName?: string;
  contactPhone?: string;
};

export type UpdateSupplierInput = SupplierProfile & {
  expectedVersion: number;
  name?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  deliveryMode?: DeliveryMode;
  defaultSettlementMode?: SettlementMode;
  defaultSettlementCycle?: string;
  status?: SupplierStatus;
};

@Injectable()
export class SuppliersService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService = new AuditService(database)) {}

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
      data: { ...input, code: input.code ?? `GYS${randomUUID().replaceAll('-', '').toUpperCase()}` },
    }));

    return toSupplierView(supplier);
  }

  async getSupplierProducts(id: string): Promise<SupplierProductsView> {
    const supplier = await this.database.client.supplier.findUnique({ where: { id }, include: {
      products: { where: { supplyEnabled: true }, orderBy: { productId: 'asc' }, select: { productId: true } },
    } });
    if (!supplier) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Supplier was not found' });
    return { supplierId: id, productIds: supplier.products.map(product => product.productId), version: supplierVersion(supplier) };
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

    const version = supplierVersion(existing);
    if (version !== input.expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Supplier version has changed',
        details: { expectedVersion: input.expectedVersion, currentVersion: version },
      });
    }

    const updated = await auditedMasterDataTransaction(this.database, this.audit, context, 'supplier.update', 'Supplier', async tx => {
    const changed = await tx.supplier.updateMany({
      where: { id, updatedAt: { gte: new Date(version), lt: new Date(version + 1) } },
      data: {
        name: input.name,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        deliveryMode: input.deliveryMode,
        defaultSettlementMode: input.defaultSettlementMode,
        defaultSettlementCycle: input.defaultSettlementCycle,
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
    return tx.supplier.findUniqueOrThrow({ where: { id } });
    });

    return toSupplierView(updated);
  }

  async replaceSupplierProducts(id: string, expectedVersion: number, productIds: string[], context?: MasterDataAuditContext): Promise<SupplierProductsView> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'supplier.products.replace', 'Supplier', async tx => {
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
    const previousProducts = await tx.supplierProduct.findMany({ where: { supplierId: id }, select: { productId: true } });
    const products = await tx.product.findMany({
      where: { id: { in: uniqueProductIds } },
      select: { id: true },
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
    for (const productId of uniqueProductIds) {
      await tx.supplierProduct.upsert({
          where: { supplierId_productId: { supplierId: id, productId } },
          update: { supplyEnabled: true },
          create: { supplierId: id, productId },
        });
    }

    // Product-side editors must observe association changes made from the supplier side.
    await tx.$executeRaw`UPDATE "Product" SET "updatedAt" = GREATEST(clock_timestamp(), "updatedAt" + interval '1 millisecond') WHERE "id" = ANY(${[...new Set([...uniqueProductIds, ...previousProducts.map(row => row.productId)])]}::uuid[])`;

    const current = await tx.supplierProduct.findMany({
      where: { supplierId: id, supplyEnabled: true },
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
