import assert from 'node:assert/strict';
import test from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { UserStatus } from '../../packages/backend/generated/prisma/enums.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../packages/domain/src/password.js';
import { AuthService, tokenHash } from '../../apps/api/src/auth/auth.service.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';

function createClient(): InstanceType<typeof PrismaClient> {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

function createService(prisma: InstanceType<typeof PrismaClient>): AuthService {
  return new AuthService({ client: prisma } as never);
}

test('auth service logs in active users and stores only token hashes', async () => {
  const prisma = createClient();
  const service = createService(prisma);
  const username = `it_auth_login_${Date.now()}`;

  try {
    const role = await prisma.role.upsert({
      where: { code: 'ADMIN' },
      update: {},
      create: { code: 'ADMIN', name: 'Administrator' },
    });
    const user = await prisma.user.create({
      data: {
        username,
        displayName: 'Integration Auth Login',
        passwordHash: await hashPassword('correct-password'),
        roles: {
          create: [{ roleId: role.id }],
        },
      },
    });

    const result = await service.login({
      username,
      password: 'correct-password',
      client: 'web',
    });

    assert.equal(result.user.id, user.id);
    assert.deepEqual(result.user.roles, ['ADMIN']);
    assert.match(result.accessToken, /^[A-Za-z0-9_-]+$/);

    const storedSession = await prisma.userSession.findUniqueOrThrow({
      where: { id: result.session.id },
    });
    assert.equal(storedSession.tokenHash, tokenHash(result.accessToken));
    assert.notEqual(storedSession.tokenHash, result.accessToken);

    const authenticated = await service.authenticate(result.accessToken);
    assert.equal(authenticated?.user.id, user.id);
    assert.equal(authenticated?.session.id, result.session.id);
  } finally {
    await prisma.userSession.deleteMany({ where: { user: { username } } });
    await prisma.userRole.deleteMany({ where: { user: { username } } });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  }
});

test('auth service rejects invalid credentials and disabled users', async () => {
  const prisma = createClient();
  const service = createService(prisma);
  const username = `it_auth_reject_${Date.now()}`;

  try {
    await prisma.user.create({
      data: {
        username,
        displayName: 'Integration Auth Reject',
        passwordHash: await hashPassword('correct-password'),
        status: UserStatus.DISABLED,
      },
    });

    await assert.rejects(
      service.login({ username, password: 'correct-password', client: 'web' }),
      (error: unknown) => error instanceof UnauthorizedException && error.getStatus() === 401,
    );
    await assert.rejects(
      service.login({ username, password: 'wrong-password', client: 'web' }),
      (error: unknown) => error instanceof UnauthorizedException && error.getStatus() === 401,
    );
  } finally {
    await prisma.userSession.deleteMany({ where: { user: { username } } });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  }
});

test('auth service logout revokes the current session', async () => {
  const prisma = createClient();
  const service = createService(prisma);
  const username = `it_auth_logout_${Date.now()}`;

  try {
    await prisma.user.create({
      data: {
        username,
        displayName: 'Integration Auth Logout',
        passwordHash: await hashPassword('correct-password'),
      },
    });

    const result = await service.login({
      username,
      password: 'correct-password',
      client: 'web',
    });

    assert.ok(await service.authenticate(result.accessToken));

    await service.logout(result.accessToken);
    assert.equal(await service.authenticate(result.accessToken), null);

    const storedSession = await prisma.userSession.findUniqueOrThrow({
      where: { id: result.session.id },
    });
    assert.ok(storedSession.revokedAt);
  } finally {
    await prisma.userSession.deleteMany({ where: { user: { username } } });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  }
});
