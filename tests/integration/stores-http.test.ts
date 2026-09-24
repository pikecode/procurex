import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { LedgerDirection, LedgerSourceType, StoreStatus } from '../../packages/backend/generated/prisma/enums.js';
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
    const account = await prisma.storeAccount.create({
      data: {
        storeId: createdBody.data.id,
        balance: '320.50',
        creditLimit: '1000.00',
        creditUsed: '125.25',
      },
    });
    await prisma.accountLedger.create({
      data: {
        accountId: account.id,
        direction: LedgerDirection.CREDIT,
        amount: '320.50',
        balanceAfter: '320.50',
        sourceType: LedgerSourceType.RECHARGE,
        sourceId: createdBody.data.id,
        note: 'Initial recharge',
        occurredAt: new Date('2026-09-24T08:00:00.000Z'),
      },
    });

    const accountResponse = await fetch(`${baseUrl}/stores/${createdBody.data.id}/account`, {
      headers: {
        authorization: `Bearer ${storeToken}`,
        'x-trace-id': 'trace-store-account',
      },
    });
    assert.equal(accountResponse.status, 200);
    const accountBody = (await accountResponse.json()) as {
      data: {
        id: string;
        storeId: string;
        balance: string;
        creditLimit: string;
        creditUsed: string;
        creditAvailable: string;
        version: number;
      };
      traceId: string;
    };
    assert.equal(accountBody.traceId, 'trace-store-account');
    assert.equal(accountBody.data.id, account.id);
    assert.equal(accountBody.data.storeId, createdBody.data.id);
    assert.equal(accountBody.data.balance, '320.50');
    assert.equal(accountBody.data.creditLimit, '1000.00');
    assert.equal(accountBody.data.creditUsed, '125.25');
    assert.equal(accountBody.data.creditAvailable, '874.75');
    assert.equal(accountBody.data.version, 1);

    const ledgersResponse = await fetch(
      `${baseUrl}/stores/${createdBody.data.id}/ledgers?occurredFrom=2026-09-24T00:00:00.000Z&occurredTo=2026-09-25T00:00:00.000Z`,
      {
        headers: {
          authorization: `Bearer ${adminToken}`,
          'x-trace-id': 'trace-store-ledgers',
        },
      },
    );
    assert.equal(ledgersResponse.status, 200);
    const ledgersBody = (await ledgersResponse.json()) as {
      data: Array<{
        accountId: string;
        direction: LedgerDirection;
        amount: string;
        balanceAfter: string;
        sourceType: LedgerSourceType;
        sourceId: string;
        note: string | null;
        occurredAt: string;
      }>;
      traceId: string;
    };
    assert.equal(ledgersBody.traceId, 'trace-store-ledgers');
    assert.equal(ledgersBody.data.length, 1);
    assert.equal(ledgersBody.data[0]?.accountId, account.id);
    assert.equal(ledgersBody.data[0]?.direction, LedgerDirection.CREDIT);
    assert.equal(ledgersBody.data[0]?.amount, '320.50');
    assert.equal(ledgersBody.data[0]?.balanceAfter, '320.50');
    assert.equal(ledgersBody.data[0]?.sourceType, LedgerSourceType.RECHARGE);
    assert.equal(ledgersBody.data[0]?.sourceId, createdBody.data.id);
    assert.equal(ledgersBody.data[0]?.note, 'Initial recharge');
    assert.equal(ledgersBody.data[0]?.occurredAt, '2026-09-24T08:00:00.000Z');

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
    await prisma.accountLedger.deleteMany({ where: { account: { store: { code: storeCode } } } });
    await prisma.storeAccount.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.store.deleteMany({ where: { code: storeCode } });
    await prisma.userSession.deleteMany({ where: { user: { username: { in: [adminUsername, storeUsername] } } } });
    await prisma.userRole.deleteMany({ where: { user: { username: { in: [adminUsername, storeUsername] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [adminUsername, storeUsername] } } });
    await prisma.$disconnect();
  }
});
