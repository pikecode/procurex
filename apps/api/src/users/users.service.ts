import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserScopeType, UserStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import type { User } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { auditedMasterDataTransaction, type MasterDataAuditContext } from '../audit/master-data-audit.js';

export type UserView = {
  id: string;
  username: string;
  displayName: string;
  phone: string | null;
  status: UserStatus;
  version: number;
  roles: string[];
  scope: { type: UserScopeType; storeId: string | null; supplierId: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateUserInput = {
  expectedVersion: number;
  status?: UserStatus;
  displayName?: string;
  scope?: { type: UserScopeType; storeId?: string; supplierId?: string };
};

@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService = new AuditService(database)) {}

  async listUsers(): Promise<UserView[]> {
    const users = await this.database.client.user.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { roles: { include: { role: true } }, scopes: true },
    });

    return users.map(toUserView);
  }

  async updateUser(id: string, input: UpdateUserInput, context?: MasterDataAuditContext): Promise<UserView> {
    const existing = await this.database.client.user.findUnique({
      where: { id },
      include: { roles: { include: { role: true } }, scopes: true },
    });

    if (!existing) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User was not found',
      });
    }

    const version = userVersion(existing);
    if (version !== input.expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'User version has changed',
        details: { expectedVersion: input.expectedVersion, currentVersion: version },
      });
    }

    const updated = await auditedMasterDataTransaction(this.database, this.audit, context, 'user.update', 'User', async tx => {
      const changed = await tx.user.updateMany({ where: { id, updatedAt: { gte: new Date(version), lt: new Date(version + 1) } },
        data: { status: input.status, displayName: input.displayName, updatedAt: new Date(Math.max(Date.now(), version + 1)) } });
      if (!changed.count) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'User version has changed' });
      if (input.scope) await tx.userScope.upsert({ where: { userId: id }, create: { userId: id, ...scopeData(input.scope) }, update: scopeData(input.scope) });
      return tx.user.findUniqueOrThrow({ where: { id }, include: { roles: { include: { role: true } }, scopes: true } });
    });

    return toUserView(updated);
  }
}

function toUserView(user: User & { roles: Array<{ role: { code: string } }>; scopes: Array<{ scopeType: UserScopeType; storeId: string | null; supplierId: string | null }> }): UserView {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    phone: user.phone,
    status: user.status,
    version: userVersion(user),
    roles: user.roles.map((entry) => entry.role.code).sort(),
    scope: user.scopes[0] ? { type: user.scopes[0].scopeType, storeId: user.scopes[0].storeId, supplierId: user.scopes[0].supplierId } : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function scopeData(scope: { type: UserScopeType; storeId?: string; supplierId?: string }) {
  return { scopeType: scope.type, storeId: scope.type === UserScopeType.STORE ? scope.storeId : null, supplierId: scope.type === UserScopeType.SUPPLIER ? scope.supplierId : null };
}

function userVersion(user: Pick<User, 'updatedAt'>): number {
  return user.updatedAt.getTime();
}
