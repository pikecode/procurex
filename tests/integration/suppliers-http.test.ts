import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { DeliveryMode, SettlementMode, SupplierStatus } from '../../packages/backend/generated/prisma/enums.js';
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

test('suppliers endpoint creates, lists and disables suppliers with purchaser role', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const purchaserUsername = `it_suppliers_purchaser_${runId}`;
  const storeUsername = `it_suppliers_store_${runId}`;
  const supplierCode = `SUP${runId}`;
  const { app, baseUrl } = await createTestApp();

  try {
    const [purchaserRole, storeRole] = await Promise.all([
      prisma.role.upsert({ where: { code: 'PURCHASER' }, update: {}, create: { code: 'PURCHASER', name: 'Purchaser' } }),
      prisma.role.upsert({ where: { code: 'STORE' }, update: {}, create: { code: 'STORE', name: 'Store' } }),
    ]);

    await Promise.all([
      prisma.user.create({
        data: {
          username: purchaserUsername,
          displayName: 'Integration Suppliers Purchaser',
          passwordHash: await hashPassword('correct-password'),
          roles: { create: [{ roleId: purchaserRole.id }] },
        },
      }),
      prisma.user.create({
        data: {
          username: storeUsername,
          displayName: 'Integration Suppliers Store',
          passwordHash: await hashPassword('correct-password'),
          roles: { create: [{ roleId: storeRole.id }] },
        },
      }),
    ]);

    const [purchaserToken, storeToken] = await Promise.all([login(baseUrl, purchaserUsername), login(baseUrl, storeUsername)]);

    const forbidden = await fetch(`${baseUrl}/suppliers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${storeToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-suppliers-forbidden',
      },
      body: JSON.stringify({
        code: supplierCode,
        name: 'Forbidden Supplier',
        deliveryMode: DeliveryMode.SELF,
        defaultSettlementMode: SettlementMode.COMPANY_TERM,
        defaultSettlementCycle: 'MONTHLY',
      }),
    });
    assert.equal(forbidden.status, 403);

    const created = await fetch(`${baseUrl}/suppliers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${purchaserToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-suppliers-create',
      },
      body: JSON.stringify({
        code: supplierCode,
        name: 'Main Test Supplier',
        contactName: 'Bob',
        contactPhone: '13900000000',
        deliveryMode: DeliveryMode.LOGISTICS,
        defaultSettlementMode: SettlementMode.COMPANY_TERM,
        defaultSettlementCycle: 'MONTHLY',
      }),
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as {
      data: {
        id: string;
        code: string;
        deliveryMode: DeliveryMode;
        defaultSettlementMode: SettlementMode;
        status: SupplierStatus;
        version: number;
      };
      traceId: string;
    };
    assert.equal(createdBody.traceId, 'trace-suppliers-create');
    assert.equal(createdBody.data.code, supplierCode);
    assert.equal(createdBody.data.deliveryMode, DeliveryMode.LOGISTICS);
    assert.equal(createdBody.data.defaultSettlementMode, SettlementMode.COMPANY_TERM);
    assert.equal(createdBody.data.status, SupplierStatus.ACTIVE);

    const list = await fetch(`${baseUrl}/suppliers`, {
      headers: {
        authorization: `Bearer ${purchaserToken}`,
        'x-trace-id': 'trace-suppliers-list',
      },
    });
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as { data: Array<{ id: string; code: string }>; traceId: string };
    assert.equal(listBody.traceId, 'trace-suppliers-list');
    assert.ok(listBody.data.some((supplier) => supplier.code === supplierCode));

    const conflict = await fetch(`${baseUrl}/suppliers/${createdBody.data.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${purchaserToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-suppliers-conflict',
      },
      body: JSON.stringify({ expectedVersion: 1, status: SupplierStatus.DISABLED }),
    });
    assert.equal(conflict.status, 409);

    const disabled = await fetch(`${baseUrl}/suppliers/${createdBody.data.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${purchaserToken}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-suppliers-disable',
      },
      body: JSON.stringify({ expectedVersion: createdBody.data.version, status: SupplierStatus.DISABLED }),
    });
    assert.equal(disabled.status, 200);
    const disabledBody = (await disabled.json()) as { data: { status: SupplierStatus }; traceId: string };
    assert.equal(disabledBody.traceId, 'trace-suppliers-disable');
    assert.equal(disabledBody.data.status, SupplierStatus.DISABLED);
  } finally {
    await app.close();
    await prisma.supplier.deleteMany({ where: { code: supplierCode } });
    await prisma.userSession.deleteMany({ where: { user: { username: { in: [purchaserUsername, storeUsername] } } } });
    await prisma.userRole.deleteMany({ where: { user: { username: { in: [purchaserUsername, storeUsername] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [purchaserUsername, storeUsername] } } });
    await prisma.$disconnect();
  }
});
