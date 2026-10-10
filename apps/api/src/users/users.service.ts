import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hashPassword, verifyPassword } from '../../../../packages/domain/src/password.js';
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
  lastLoginAt: string | null;
};

export type UpdateUserInput = {
  expectedVersion: number;
  status?: UserStatus;
  displayName?: string;
  scope?: { type: UserScopeType; storeId?: string; supplierId?: string };
  role?: string;
};

@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService = new AuditService(database)) {}

  async createUser(input: { username: string; password: string; displayName: string; role: string; scope: { type: UserScopeType; storeId?: string; supplierId?: string } }, context: MasterDataAuditContext): Promise<UserView> {
    const passwordHash = await hashPassword(input.password);
    try {
      const created = await auditedMasterDataTransaction(this.database, this.audit, context, 'user.create', 'User', async tx => {
        const role = await tx.role.findUnique({ where: { code: input.role } });
        if (!role) throw new BadRequestException({ code: 'INVALID_ROLE', message: '角色不存在' });
        if (input.scope.type === UserScopeType.STORE && !await tx.store.findFirst({ where: { id: input.scope.storeId, status: 'ACTIVE' } })) throw new BadRequestException({ code: 'INVALID_STORE', message: '请选择启用的门店' });
        if (input.scope.type === UserScopeType.SUPPLIER && !await tx.supplier.findFirst({ where: { id: input.scope.supplierId, status: 'ACTIVE', isArchived: false } })) throw new BadRequestException({ code: 'INVALID_SUPPLIER', message: '请选择启用的供应商' });
        return tx.user.create({ data: { username: input.username, displayName: input.displayName, passwordHash,
          roles: { create: { roleId: role.id } }, scopes: { create: scopeData(input.scope) } }, include: { roles: { include: { role: true } }, scopes: true } });
      });
      return toUserView(created);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException({ code: 'USERNAME_EXISTS', message: '账号已存在' });
      throw error;
    }
  }

  async listUsers(): Promise<UserView[]> {
    const users = await this.database.client.user.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { roles: { include: { role: true } }, scopes: true, sessions: { take: 1, orderBy: { createdAt: 'desc' }, select: { createdAt: true } } },
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

    const updated = await this.database.client.$transaction(async tx => {
      // Serialize administrator changes so concurrent demotions cannot remove every administrator.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(810081)`;
      const current = await tx.user.findUniqueOrThrow({ where: { id }, include: { roles: { include: { role: true } }, scopes: true } });
      const before = accountAuditSnapshot(current);
      const currentRoles = current.roles.map(entry => entry.role.code);
      const nextRoles = input.role ? [input.role] : currentRoles;
      const nextStatus = input.status ?? current.status;
      if (context?.actorUserId === id && (nextStatus !== UserStatus.ACTIVE || (currentRoles.includes('ADMIN') && !nextRoles.includes('ADMIN')))) {
        throw new BadRequestException({ code: 'SELF_ADMIN_CHANGE', message: '不能停用自己或移除自己的管理员权限' });
      }
      if (current.status === UserStatus.ACTIVE && currentRoles.includes('ADMIN') && (nextStatus !== UserStatus.ACTIVE || !nextRoles.includes('ADMIN'))) {
        const others = await tx.user.count({ where: { id: { not: id }, status: UserStatus.ACTIVE, roles: { some: { role: { code: 'ADMIN' } } } } });
        if (!others) throw new BadRequestException({ code: 'LAST_ADMIN', message: '必须保留至少一个启用的管理员' });
      }
      const currentScope = current.scopes[0];
      const scope = input.scope ?? (currentScope ? { type: currentScope.scopeType, storeId: currentScope.storeId ?? undefined, supplierId: currentScope.supplierId ?? undefined } : undefined);
      if (input.scope || input.role) {
        if (!scope) throw new BadRequestException({ code: 'INVALID_SCOPE', message: '请选择所属门店或供应商' });
        for (const role of nextRoles) {
          const required = role === 'SUPPLIER' ? UserScopeType.SUPPLIER : ['STORE', 'STORE_FINANCE'].includes(role) ? UserScopeType.STORE : UserScopeType.COMPANY;
          if (scope.type !== required) throw new BadRequestException({ code: 'INVALID_SCOPE', message: '角色与所属范围不匹配' });
        }
        if (scope.type === UserScopeType.STORE && !await tx.store.findFirst({ where: { id: scope.storeId, status: 'ACTIVE' } })) throw new BadRequestException({ code: 'INVALID_STORE', message: '请选择启用的门店' });
        if (scope.type === UserScopeType.SUPPLIER && !await tx.supplier.findFirst({ where: { id: scope.supplierId, status: 'ACTIVE', isArchived: false } })) throw new BadRequestException({ code: 'INVALID_SUPPLIER', message: '请选择启用的供应商' });
      }
      const changed = await tx.user.updateMany({ where: { id, updatedAt: { gte: new Date(version), lt: new Date(version + 1) } },
        data: { status: input.status, displayName: input.displayName, updatedAt: new Date(Math.max(Date.now(), version + 1)) } });
      if (!changed.count) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'User version has changed' });
      if (input.scope) await tx.userScope.upsert({ where: { userId: id }, create: { userId: id, ...scopeData(input.scope) }, update: scopeData(input.scope) });
      if (input.role) {
        const role = await tx.role.findUnique({ where: { code: input.role } });
        if (!role) throw new BadRequestException({ code: 'INVALID_ROLE', message: '角色不存在' });
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.create({ data: { userId: id, roleId: role.id } });
      }
      if (nextStatus !== UserStatus.ACTIVE || input.role || input.scope) await tx.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      const result = await tx.user.findUniqueOrThrow({ where: { id }, include: { roles: { include: { role: true } }, scopes: true } });
      if (context) await this.audit.record({ ...context, action: 'user.update', entityType: 'User', entityId: id,
        before, after: accountAuditSnapshot(result) }, tx);
      return result;
    });

    return toUserView(updated);
  }

  async resetPassword(id: string, password: string, expectedVersion: number, context: MasterDataAuditContext, currentPassword?: string): Promise<{ id: string; revoked: true }> {
    const passwordHash = await hashPassword(password);
    return auditedMasterDataTransaction(this.database, this.audit, context, currentPassword === undefined ? 'user.password-reset' : 'user.password-change', 'User', async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(810081)`;
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: '用户不存在' });
      if (currentPassword !== undefined && !await verifyPassword(currentPassword, user.passwordHash)) throw new BadRequestException({ code: 'CURRENT_PASSWORD_INVALID', message: '当前密码不正确' });
      if (await verifyPassword(password, user.passwordHash)) throw new BadRequestException({ code: 'PASSWORD_UNCHANGED', message: '新密码不能与当前密码相同' });
      if (userVersion(user) !== expectedVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: '账号已变更，请刷新后重试' });
      await tx.user.update({ where: { id }, data: { passwordHash, updatedAt: new Date(Math.max(Date.now(), expectedVersion + 1)) } });
      await tx.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      return { id, revoked: true as const };
    });
  }

  async changePassword(id: string, currentPassword: string, password: string, context: MasterDataAuditContext) {
    const user = await this.database.client.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: '用户不存在' });
    return this.resetPassword(id, password, userVersion(user), context, currentPassword);
  }

  async revokeSessions(id: string, context: MasterDataAuditContext): Promise<{ id: string; revoked: true }> {
    return auditedMasterDataTransaction(this.database, this.audit, context, 'user.sessions-revoke', 'User', async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(810081)`;
      if (!await tx.user.findUnique({ where: { id } })) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: '用户不存在' });
      await tx.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      return { id, revoked: true as const };
    });
  }
}

function toUserView(user: User & { roles: Array<{ role: { code: string } }>; scopes: Array<{ scopeType: UserScopeType; storeId: string | null; supplierId: string | null }>; sessions?: Array<{ createdAt: Date }> }): UserView {
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
    lastLoginAt: user.sessions?.[0]?.createdAt.toISOString() ?? null,
  };
}

function scopeData(scope: { type: UserScopeType; storeId?: string; supplierId?: string }) {
  return { scopeType: scope.type, storeId: scope.type === UserScopeType.STORE ? scope.storeId : null, supplierId: scope.type === UserScopeType.SUPPLIER ? scope.supplierId : null };
}

function userVersion(user: Pick<User, 'updatedAt'>): number {
  return user.updatedAt.getTime();
}

function accountAuditSnapshot(user: Parameters<typeof toUserView>[0]) {
  const view = toUserView(user);
  return { displayName: view.displayName, status: view.status, roles: view.roles, scope: view.scope, version: view.version };
}
