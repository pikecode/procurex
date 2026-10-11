import { randomBytes, createHash } from 'node:crypto';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { UserStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import type { UserSession } from '../../../../packages/backend/generated/prisma/client.js';
import { verifyPassword } from '../../../../packages/domain/src/password.js';
import { DatabaseService } from '../database/database.service.js';

export type LoginInput = {
  username: string;
  password: string;
  client: string;
};

export type LoginResult = {
  accessToken: string;
  session: UserSession;
  user: {
    id: string;
    actorUserId?: string;
    username: string;
    displayName: string;
    roles: string[];
    testWorkbenchEnabled?: boolean;
    testIdentity?: { userId: string; username: string; displayName: string };
    scope?: { type: string; storeId?: string; supplierId?: string; storeIds?: string[]; testUserId?: string; testUsername?: string };
  };
};

export type AuthenticatedSession = {
  session: UserSession;
  user: LoginResult['user'];
};

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const user = await this.database.client.user.findUnique({
      where: { username: input.username },
      include: { roles: { include: { role: true } }, scopes: { include: { stores: true } } },
    });

    if (!user || user.status !== UserStatus.ACTIVE || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
      });
    }

    const accessToken = randomBytes(32).toString('base64url');
    const session = await this.database.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(810081)`;
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (!current || current.status !== UserStatus.ACTIVE || current.passwordHash !== user.passwordHash || current.updatedAt.getTime() !== user.updatedAt.getTime()) {
        throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: '账号已变更，请重新登录' });
      }
      return tx.userSession.create({
      data: {
        userId: user.id,
        tokenHash: tokenHash(accessToken),
        client: input.client,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
      });
    });

    return {
      accessToken,
      session,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        roles: user.roles.map((entry) => entry.role.code).sort(),
        scope: toScope(user.scopes[0]),
        ...(this.workbenchEnabled() && user.roles.some(entry => entry.role.code === 'ADMIN') ? { testWorkbenchEnabled: true } : {}),
      },
    };
  }

  async authenticate(accessToken: string): Promise<AuthenticatedSession | null> {
    const session = await this.database.client.userSession.findUnique({
      where: { tokenHash: tokenHash(accessToken) },
      include: { user: { include: { roles: { include: { role: true } }, scopes: { include: { stores: true } } } } },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== UserStatus.ACTIVE) {
      return null;
    }

    await this.database.client.userSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });

    return {
      session,
      user: {
        id: session.user.id,
        username: session.user.username,
        displayName: session.user.displayName,
        roles: session.user.roles.map((entry) => entry.role.code).sort(),
        scope: toScope(session.user.scopes[0]),
        ...(this.workbenchEnabled() && session.user.roles.some(entry => entry.role.code === 'ADMIN') ? { testWorkbenchEnabled: true } : {}),
      },
    };
  }

  async logout(accessToken: string): Promise<void> {
    await this.database.client.userSession.updateMany({
      where: {
        tokenHash: tokenHash(accessToken),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  private workbenchEnabled(): boolean {
    return process.env.NODE_ENV !== 'production' && process.env.TEST_WORKBENCH_ENABLED === 'true';
  }

  private assertWorkbench(auth: AuthenticatedSession): void {
    if (!this.workbenchEnabled() || !auth.user.roles.includes('ADMIN') || auth.user.testIdentity) {
      throw new ForbiddenException({ code: 'TEST_WORKBENCH_FORBIDDEN', message: '当前环境或账号不允许使用测试身份' });
    }
  }

  async testIdentities(auth: AuthenticatedSession) {
    this.assertWorkbench(auth);
    const usernames = (process.env.TEST_WORKBENCH_USERNAMES || '').split(',').map(value => value.trim()).filter(Boolean);
    const users = await this.database.client.user.findMany({ where: { username: { in: usernames }, status: UserStatus.ACTIVE },
      include: { roles: { include: { role: true } }, scopes: { include: { stores: true, store: true, supplier: true } } }, orderBy: { username: 'asc' } });
    return users.map(user => ({ id: user.id, username: user.username, displayName: user.displayName,
      roles: user.roles.map(entry => entry.role.code).sort(), scope: toScope(user.scopes[0]),
      entityName: user.scopes[0]?.store?.name || user.scopes[0]?.supplier?.name || '' })).filter(user => {
        if (user.roles.length !== 1) return false;
        const role = user.roles[0];
        return ['PURCHASER', 'HQ_FINANCE'].includes(role!) ||
          (['STORE', 'STORE_FINANCE'].includes(role!) && Boolean(user.scope?.storeId) && ['STORE', 'STORE_FINANCE'].includes(user.scope!.type)) ||
          (role === 'SUPPLIER' && user.scope?.type === 'SUPPLIER' && Boolean(user.scope.supplierId));
      });
  }

  async testIdentity(auth: AuthenticatedSession, userId: string): Promise<LoginResult['user']> {
    const target = (await this.testIdentities(auth)).find(user => user.id === userId);
    if (!target) throw new ForbiddenException({ code: 'TEST_IDENTITY_FORBIDDEN', message: '该测试账号未授权、已停用或缺少业务范围' });
    return { ...auth.user, id: target.id, actorUserId: auth.user.id, username: target.username, roles: target.roles, displayName: target.displayName,
      testIdentity: { userId: target.id, username: target.username, displayName: target.displayName },
      scope: { ...(target.scope || { type: 'GLOBAL' }), testUserId: target.id, testUsername: target.username } };
  }
}

function toScope(scope?: { scopeType: string; storeId: string | null; supplierId: string | null; stores?: Array<{ storeId: string }> }) {
  return scope ? { type: scope.scopeType, ...(scope.storeId ? { storeId: scope.storeId } : {}), ...(scope.supplierId ? { supplierId: scope.supplierId } : {}),
    ...(scope.scopeType === 'MULTI_STORE' ? { storeIds: (scope.stores ?? []).map(entry => entry.storeId).sort() } : {}) } : undefined;
}

export function tokenHash(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex');
}
