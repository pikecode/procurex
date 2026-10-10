import { randomBytes, createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
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
    username: string;
    displayName: string;
    roles: string[];
    scope?: { type: string; storeId?: string; supplierId?: string };
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
      include: { roles: { include: { role: true } }, scopes: true },
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
      },
    };
  }

  async authenticate(accessToken: string): Promise<AuthenticatedSession | null> {
    const session = await this.database.client.userSession.findUnique({
      where: { tokenHash: tokenHash(accessToken) },
      include: { user: { include: { roles: { include: { role: true } }, scopes: true } } },
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
}

function toScope(scope?: { scopeType: string; storeId: string | null; supplierId: string | null }) {
  return scope ? { type: scope.scopeType, ...(scope.storeId ? { storeId: scope.storeId } : {}), ...(scope.supplierId ? { supplierId: scope.supplierId } : {}) } : undefined;
}

export function tokenHash(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex');
}
