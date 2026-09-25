import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserScopeType, UserStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import type { User } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

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
  constructor(private readonly database: DatabaseService) {}

  async listUsers(): Promise<UserView[]> {
    const users = await this.database.client.user.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { roles: { include: { role: true } }, scopes: true },
    });

    return users.map(toUserView);
  }

  async updateUser(id: string, input: UpdateUserInput): Promise<UserView> {
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

    const updated = await this.database.client.user.update({
      where: { id },
      data: { status: input.status, displayName: input.displayName, ...(input.scope ? { scopes: { upsert: { where: { userId: id }, create: scopeData(input.scope), update: scopeData(input.scope) } } } : {}) },
      include: { roles: { include: { role: true } }, scopes: true },
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
