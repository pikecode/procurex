import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, StoreGroup } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { auditedMasterDataTransaction, type MasterDataAuditContext } from '../audit/master-data-audit.js';

export function lockStoreGroups(tx: Prisma.TransactionClient) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.store-groups'))`;
}

export async function validateStoreGroup(tx: Prisma.TransactionClient, name?: string | null, previous?: string | null) {
  if (!name) return;
  const group = await tx.storeGroup.findUnique({ where: { name } });
  if (!group) throw new NotFoundException({ code: 'STORE_GROUP_NOT_FOUND', message: 'Store group was not found' });
  if (group.status !== 'ACTIVE' && name !== previous) throw new ConflictException({ code: 'STORE_GROUP_DISABLED', message: 'Store group is disabled' });
}

function assertVersion(row: StoreGroup | null, version: number): asserts row is StoreGroup {
  if (!row) throw new NotFoundException({ code: 'STORE_GROUP_NOT_FOUND', message: 'Store group was not found' });
  if (row.version !== version) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Store group has changed' });
}

@Injectable()
export class StoreGroupsService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService) {}

  async list() {
    const rows = await this.database.client.storeGroup.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], include: { _count: { select: { stores: true } } } });
    return rows.map(({ _count, createdAt, ...row }) => ({ ...row, createdAt: createdAt.toISOString(), storeCount: _count.stores }));
  }

  create(name: string, context: MasterDataAuditContext) {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'store-group.create', 'StoreGroup', async tx => {
      await lockStoreGroups(tx);
      if (await tx.storeGroup.findUnique({ where: { name } })) throw new ConflictException({ code: 'STORE_GROUP_NAME_EXISTS', message: 'Store group name already exists' });
      return tx.storeGroup.create({ data: { name } });
    });
  }

  update(id: string, expectedVersion: number, input: { name?: string; status?: 'ACTIVE' | 'DISABLED' }, context: MasterDataAuditContext) {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'store-group.update', 'StoreGroup', async tx => {
      await lockStoreGroups(tx);
      const row = await tx.storeGroup.findUnique({ where: { id } });
      assertVersion(row, expectedVersion);
      if (input.name && await tx.storeGroup.findFirst({ where: { name: input.name, id: { not: id } } })) throw new ConflictException({ code: 'STORE_GROUP_NAME_EXISTS', message: 'Store group name already exists' });
      const updated = await tx.storeGroup.update({ where: { id }, data: { ...input, version: { increment: 1 } } });
      // The FK cascades names; invalidate stale store forms without changing orders or funds.
      if (updated.name !== row.name) await tx.$executeRaw`UPDATE "Store" SET "updatedAt" = GREATEST(clock_timestamp(), "updatedAt" + interval '1 millisecond') WHERE "groupName" = ${updated.name}`;
      return updated;
    });
  }

  remove(id: string, expectedVersion: number, context: MasterDataAuditContext) {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'store-group.delete', 'StoreGroup', async tx => {
      await lockStoreGroups(tx);
      const row = await tx.storeGroup.findUnique({ where: { id } });
      assertVersion(row, expectedVersion);
      if (await tx.store.count({ where: { groupName: row.name } })) throw new ConflictException({ code: 'STORE_GROUP_IN_USE', message: 'Store group is referenced by stores' });
      await tx.storeGroup.delete({ where: { id } });
      return { id, deleted: true };
    });
  }
}
