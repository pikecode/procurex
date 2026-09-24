import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { UserStatus } from '../../packages/backend/generated/prisma/enums.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../packages/domain/src/password.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';

function createClient(): InstanceType<typeof PrismaClient> {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

async function createTestApp(): Promise<{ app: INestApplication; baseUrl: string }> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${address.port}/api/v1` };
}

async function login(baseUrl: string, username: string): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'correct-password', client: 'web' }),
  });
  assert.equal(response.status, 201);

  const body = (await response.json()) as { data: { accessToken: string } };
  return body.data.accessToken;
}

test('admin users endpoint lists users, enforces roles and checks versions', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const adminUsername = `it_users_admin_${runId}`;
  const storeUsername = `it_users_store_${runId}`;
  const targetUsername = `it_users_target_${runId}`;
  const { app, baseUrl } = await createTestApp();

  try {
    const [adminRole, storeRole] = await Promise.all([
      prisma.role.upsert({ where: { code: 'ADMIN' }, update: {}, create: { code: 'ADMIN', name: 'Administrator' } }),
      prisma.role.upsert({ where: { code: 'STORE' }, update: {}, create: { code: 'STORE', name: 'Store' } }),
    ]);

    const [admin, store, target] = await Promise.all([
      prisma.user.create({
        data: {
          username: adminUsername,
          displayName: 'Integration Users Admin',
          passwordHash: await hashPassword('correct-password'),
          roles: { create: [{ roleId: adminRole.id }] },
        },
      }),
      prisma.user.create({
        data: {
          username: storeUsername,
          displayName: 'Integration Users Store',
          passwordHash: await hashPassword('correct-password'),
          roles: { create: [{ roleId: storeRole.id }] },
        },
      }),
      prisma.user.create({
        data: {
          username: targetUsername,
          displayName: 'Integration Users Target',
          passwordHash: await hashPassword('correct-password'),
        },
      }),
    ]);

    const [adminToken, storeToken] = await Promise.all([login(baseUrl, adminUsername), login(baseUrl, storeUsername)]);

    const forbidden = await fetch(`${baseUrl}/users`, {
      headers: { authorization: `Bearer ${storeToken}`, 'x-trace-id': 'trace-users-forbidden' },
    });
    assert.equal(forbidden.status, 403);
    assert.deepEqual(await forbidden.json(), {
      code: 'FORBIDDEN',
      message: 'Current user is not allowed to perform this action',
      traceId: 'trace-users-forbidden',
    });

    const list = await fetch(`${baseUrl}/users`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-trace-id': 'trace-users-list' },
    });
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as {
      data: Array<{ id: string; username: string; version: number; roles: string[]; status: UserStatus }>;
      traceId: string;
    };
    assert.equal(listBody.traceId, 'trace-users-list');
    assert.ok(listBody.data.some((user) => user.id === admin.id && user.roles.includes('ADMIN')));
    const targetView = listBody.data.find((user) => user.id === target.id);
    assert.equal(targetView?.username, targetUsername);
    assert.equal(targetView?.status, UserStatus.ACTIVE);

    const conflict = await fetch(`${baseUrl}/users/${target.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-users-conflict',
      },
      body: JSON.stringify({ expectedVersion: 1, status: UserStatus.DISABLED }),
    });
    assert.equal(conflict.status, 409);
    const conflictBody = (await conflict.json()) as { code: string; traceId: string; details: { currentVersion: number } };
    assert.equal(conflictBody.code, 'VERSION_CONFLICT');
    assert.equal(conflictBody.traceId, 'trace-users-conflict');
    assert.ok(conflictBody.details.currentVersion > 1);

    const updated = await fetch(`${baseUrl}/users/${target.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-users-update',
      },
      body: JSON.stringify({ expectedVersion: targetView?.version, status: UserStatus.DISABLED }),
    });
    assert.equal(updated.status, 200);
    const updatedBody = (await updated.json()) as { data: { id: string; status: UserStatus }; traceId: string };
    assert.equal(updatedBody.traceId, 'trace-users-update');
    assert.equal(updatedBody.data.id, target.id);
    assert.equal(updatedBody.data.status, UserStatus.DISABLED);
  } finally {
    await app.close();
    await prisma.userSession.deleteMany({ where: { user: { username: { in: [adminUsername, storeUsername, targetUsername] } } } });
    await prisma.userRole.deleteMany({ where: { user: { username: { in: [adminUsername, storeUsername, targetUsername] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [adminUsername, storeUsername, targetUsername] } } });
    await prisma.$disconnect();
  }
});
