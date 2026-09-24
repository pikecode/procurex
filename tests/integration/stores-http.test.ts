import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { StoreStatus } from '../../packages/backend/generated/prisma/enums.js';
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

test('stores endpoint creates, lists and disables stores with admin role', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const adminUsername = `it_stores_admin_${runId}`;
  const storeUsername = `it_stores_store_${runId}`;
  const storeCode = `S${runId}`;
  const { app, baseUrl } = await createTestApp();

  try {
    const [adminRole, storeRole] = await Promise.all([
      prisma.role.upsert({ where: { code: 'ADMIN' }, update: {}, create: { code: 'ADMIN', name: 'Administrator' } }),
      prisma.role.upsert({ where: { code: 'STORE' }, update: {}, create: { code: 'STORE', name: 'Store' } }),
    ]);

    await Promise.all([
      prisma.user.create({
        data: {
          username: adminUsername,
          displayName: 'Integration Stores Admin',
          passwordHash: await hashPassword('correct-password'),
          roles: { create: [{ roleId: adminRole.id }] },
        },
      }),
      prisma.user.create({
        data: {
          username: storeUsername,
          displayName: 'Integration Stores Store',
          passwordHash: await hashPassword('correct-password'),
          roles: { create: [{ roleId: storeRole.id }] },
        },
      }),
    ]);

    const [adminToken, storeToken] = await Promise.all([login(baseUrl, adminUsername), login(baseUrl, storeUsername)]);

    const forbidden = await fetch(`${baseUrl}/stores`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${storeToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-stores-forbidden',
      },
      body: JSON.stringify({ code: storeCode, name: 'Forbidden Store' }),
    });
    assert.equal(forbidden.status, 403);

    const created = await fetch(`${baseUrl}/stores`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-stores-create',
      },
      body: JSON.stringify({
        code: storeCode,
        name: 'Main Test Store',
        contactName: 'Alice',
        contactPhone: '13800000000',
        address: 'Shanghai',
      }),
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as {
      data: { id: string; code: string; name: string; status: StoreStatus; version: number };
      traceId: string;
    };
    assert.equal(createdBody.traceId, 'trace-stores-create');
    assert.equal(createdBody.data.code, storeCode);
    assert.equal(createdBody.data.status, StoreStatus.ACTIVE);

    const list = await fetch(`${baseUrl}/stores`, {
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-trace-id': 'trace-stores-list',
      },
    });
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as { data: Array<{ id: string; code: string; version: number }>; traceId: string };
    assert.equal(listBody.traceId, 'trace-stores-list');
    assert.ok(listBody.data.some((store) => store.code === storeCode));

    const conflict = await fetch(`${baseUrl}/stores/${createdBody.data.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-stores-conflict',
      },
      body: JSON.stringify({ expectedVersion: 1, status: StoreStatus.DISABLED }),
    });
    assert.equal(conflict.status, 409);

    const disabled = await fetch(`${baseUrl}/stores/${createdBody.data.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-stores-disable',
      },
      body: JSON.stringify({ expectedVersion: createdBody.data.version, status: StoreStatus.DISABLED }),
    });
    assert.equal(disabled.status, 200);
    const disabledBody = (await disabled.json()) as { data: { status: StoreStatus }; traceId: string };
    assert.equal(disabledBody.traceId, 'trace-stores-disable');
    assert.equal(disabledBody.data.status, StoreStatus.DISABLED);
  } finally {
    await app.close();
    await prisma.store.deleteMany({ where: { code: storeCode } });
    await prisma.userSession.deleteMany({ where: { user: { username: { in: [adminUsername, storeUsername] } } } });
    await prisma.userRole.deleteMany({ where: { user: { username: { in: [adminUsername, storeUsername] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [adminUsername, storeUsername] } } });
    await prisma.$disconnect();
  }
});
