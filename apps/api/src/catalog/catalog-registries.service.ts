import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { auditedMasterDataTransaction, type MasterDataAuditContext } from '../audit/master-data-audit.js';

export function lockCatalog(tx: Prisma.TransactionClient, shared = false) {
  return shared
    ? tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('procurex.catalog-registry'))`
    : tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.catalog-registry'))`;
}

export function assertRegistryVersion(row: { version: number } | null, expectedVersion: number) {
  if (!row) throw new NotFoundException({ code: 'CATALOG_RECORD_NOT_FOUND', message: 'Catalog record was not found' });
  if (row.version !== expectedVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Catalog record version has changed' });
}

export async function requireUniqueUnitName(tx: Prisma.TransactionClient, name: string, excludeId?: string) {
  const normalized = name.trim();
  const rows = await tx.unit.findMany({ select: { id: true, name: true } });
  if (rows.some(row => row.id !== excludeId && row.name.trim() === normalized)) {
    throw new ConflictException({ code: 'UNIT_NAME_EXISTS', message: '单位名称已存在，请使用已有单位' });
  }
  return normalized;
}

export async function validateCategoryParent(tx: Prisma.TransactionClient, parentId?: string | null, id?: string) {
  if (!parentId) return;
  const parent = await tx.category.findUnique({ where: { id: parentId } });
  if (!parent) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Parent category was not found' });
  if (parent.id === id || parent.parentId) throw new ConflictException({ code: 'CATEGORY_DEPTH_EXCEEDED', message: 'Only two category levels are supported' });
  if (id && await tx.category.count({ where: { parentId: id } })) throw new ConflictException({ code: 'CATEGORY_HAS_CHILDREN', message: 'A category with children cannot become a child category' });
}

@Injectable()
export class CatalogRegistriesService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService = new AuditService(database)) {}

  async listBrands() {
    const rows = await this.database.client.brand.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  async createBrand(name: string, context?: MasterDataAuditContext) {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'brand.create', 'Brand', async tx => {
      await lockCatalog(tx);
      if (await tx.brand.findUnique({ where: { name } })) throw new ConflictException({ code: 'BRAND_NAME_EXISTS', message: 'Brand name already exists' });
      return tx.brand.create({ data: { name } });
    });
  }

  async updateCategory(id: string, expectedVersion: number, input: { name?: string; parentId?: string | null; sortOrder?: number }, context?: MasterDataAuditContext) {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'category.update', 'Category', async tx => {
      await lockCatalog(tx);
      const row = await tx.category.findUnique({ where: { id } });
      assertRegistryVersion(row, expectedVersion);
      await validateCategoryParent(tx, input.parentId, id);
      return tx.category.update({ where: { id }, data: { ...input, version: { increment: 1 } } });
    });
  }

  async updateUnit(id: string, expectedVersion: number, name: string, context?: MasterDataAuditContext) {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'unit.update', 'Unit', async tx => {
      await lockCatalog(tx);
      const row = await tx.unit.findUnique({ where: { id } });
      assertRegistryVersion(row, expectedVersion);
      name = await requireUniqueUnitName(tx, name, id);
      // Unsnapshotted historical lines still depend on current unit names.
      if (row!.name !== name && await tx.product.count({ where: {
        AND: [{ OR: [{ baseUnitId: id }, { conversion: { is: { OR: [{ fromUnitId: id }, { toUnitId: id }] } } }] },
          { OR: [{ requestItems: { some: { unitSnapshot: { equals: Prisma.AnyNull } } } }, { orderItems: { some: { unitSnapshot: { equals: Prisma.AnyNull } } } }] }],
      } })) throw new ConflictException({ code: 'UNIT_HISTORY_SNAPSHOT_REQUIRED', message: 'Historical transactions require unit snapshots before this unit can be renamed' });
      const updated = await tx.unit.update({ where: { id }, data: { name, version: { increment: 1 } } });
      if (row!.name !== name) await tx.$executeRaw`UPDATE "Product" SET "updatedAt" = GREATEST(clock_timestamp(), "updatedAt" + interval '1 millisecond') WHERE "baseUnitId" = ${id}::uuid OR "id" IN (SELECT "productId" FROM "ProductUnitConversion" WHERE "fromUnitId" = ${id}::uuid OR "toUnitId" = ${id}::uuid)`;
      return updated;
    });
  }

  async updateBrand(id: string, expectedVersion: number, name: string, context?: MasterDataAuditContext) {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'brand.update', 'Brand', async tx => {
      await lockCatalog(tx);
      const row = await tx.brand.findUnique({ where: { id } });
      assertRegistryVersion(row, expectedVersion);
      if (await tx.brand.findFirst({ where: { name, id: { not: id } } })) throw new ConflictException({ code: 'BRAND_NAME_EXISTS', message: 'Brand name already exists' });
      const updated = await tx.brand.update({ where: { id }, data: { name, version: { increment: 1 } } });
      // Keep legacy text readers synchronized and invalidate stale product edits, never prices.
      await tx.$executeRaw`UPDATE "Product" SET "brand" = ${name}, "brandId" = ${id}::uuid, "updatedAt" = GREATEST(clock_timestamp(), "updatedAt" + interval '1 millisecond') WHERE "brandId" = ${id}::uuid OR ("brandId" IS NULL AND btrim("brand") = ${row!.name})`;
      return updated;
    });
  }

  async remove(resource: 'categories' | 'units' | 'brands', id: string, expectedVersion: number, context?: MasterDataAuditContext) {
    const type = { categories: 'Category', units: 'Unit', brands: 'Brand' }[resource];
    return auditedMasterDataTransaction(this.database, this.audit, context, `${type.toLowerCase()}.delete`, type, async tx => {
      await lockCatalog(tx);
      if (resource === 'categories') {
        assertRegistryVersion(await tx.category.findUnique({ where: { id } }), expectedVersion);
        if (await tx.category.count({ where: { parentId: id } })) throw new ConflictException({ code: 'CATEGORY_HAS_CHILDREN', message: 'Remove child categories first' });
        if (await tx.product.count({ where: { categoryId: id } })) throw new ConflictException({ code: 'CATALOG_RECORD_IN_USE', message: 'Category is referenced by products' });
        await tx.category.delete({ where: { id } });
      } else if (resource === 'units') {
        assertRegistryVersion(await tx.unit.findUnique({ where: { id } }), expectedVersion);
        if (await tx.product.count({ where: { baseUnitId: id } }) || await tx.productUnitConversion.count({ where: { OR: [{ fromUnitId: id }, { toUnitId: id }] } })) throw new ConflictException({ code: 'CATALOG_RECORD_IN_USE', message: 'Unit is referenced by products or conversions' });
        await tx.unit.delete({ where: { id } });
      } else {
        const row = await tx.brand.findUnique({ where: { id } });
        assertRegistryVersion(row, expectedVersion);
        const used = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Product" WHERE "brandId" = ${id}::uuid OR ("brandId" IS NULL AND btrim("brand") = ${row!.name}) LIMIT 1`;
        if (used.length) throw new ConflictException({ code: 'CATALOG_RECORD_IN_USE', message: 'Brand is referenced by products' });
        await tx.brand.delete({ where: { id } });
      }
      return { id, deleted: true };
    });
  }
}
