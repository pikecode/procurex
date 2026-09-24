import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
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

test('catalog endpoints create and archive basic product data', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const purchaserUsername = `it_catalog_purchaser_${runId}`;
  const categoryCode = `CAT${runId}`;
  const unitCode = `UNIT${runId}`;
  const sku = `SKU${runId}`;
  const { app, baseUrl } = await createTestApp();

  try {
    const purchaserRole = await prisma.role.upsert({
      where: { code: 'PURCHASER' },
      update: {},
      create: { code: 'PURCHASER', name: 'Purchaser' },
    });
    await prisma.user.create({
      data: {
        username: purchaserUsername,
        displayName: 'Integration Catalog Purchaser',
        passwordHash: await hashPassword('correct-password'),
        roles: { create: [{ roleId: purchaserRole.id }] },
      },
    });

    const token = await login(baseUrl, purchaserUsername);

    const category = await fetch(`${baseUrl}/categories`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-catalog-category',
      },
      body: JSON.stringify({ code: categoryCode, name: 'Vegetables', sortOrder: 10 }),
    });
    assert.equal(category.status, 201);
    const categoryBody = (await category.json()) as { data: { id: string; code: string }; traceId: string };
    assert.equal(categoryBody.traceId, 'trace-catalog-category');
    assert.equal(categoryBody.data.code, categoryCode);

    const unit = await fetch(`${baseUrl}/units`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-catalog-unit',
      },
      body: JSON.stringify({ code: unitCode, name: 'kg' }),
    });
    assert.equal(unit.status, 201);
    const unitBody = (await unit.json()) as { data: { id: string; code: string }; traceId: string };
    assert.equal(unitBody.traceId, 'trace-catalog-unit');
    assert.equal(unitBody.data.code, unitCode);

    const product = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-catalog-product',
      },
      body: JSON.stringify({
        sku,
        name: 'Chinese Cabbage',
        categoryId: categoryBody.data.id,
        baseUnitId: unitBody.data.id,
        minOrderQty: '1.000000',
        orderMultiple: '0.500000',
      }),
    });
    assert.equal(product.status, 201);
    const productBody = (await product.json()) as {
      data: { id: string; sku: string; minOrderQty: string; orderMultiple: string; isActive: boolean; version: number };
      traceId: string;
    };
    assert.equal(productBody.traceId, 'trace-catalog-product');
    assert.equal(productBody.data.sku, sku);
    assert.equal(productBody.data.minOrderQty, '1');
    assert.equal(productBody.data.orderMultiple, '0.5');
    assert.equal(productBody.data.isActive, true);

    const list = await fetch(`${baseUrl}/products`, {
      headers: { authorization: `Bearer ${token}`, 'x-trace-id': 'trace-catalog-list' },
    });
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as { data: Array<{ id: string; sku: string }>; traceId: string };
    assert.equal(listBody.traceId, 'trace-catalog-list');
    assert.ok(listBody.data.some((item) => item.sku === sku));

    const conflict = await fetch(`${baseUrl}/products/${productBody.data.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-catalog-conflict',
      },
      body: JSON.stringify({ expectedVersion: 1, isActive: false }),
    });
    assert.equal(conflict.status, 409);

    const archived = await fetch(`${baseUrl}/products/${productBody.data.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-catalog-archive',
      },
      body: JSON.stringify({ expectedVersion: productBody.data.version, isActive: false }),
    });
    assert.equal(archived.status, 200);
    const archivedBody = (await archived.json()) as { data: { isActive: boolean }; traceId: string };
    assert.equal(archivedBody.traceId, 'trace-catalog-archive');
    assert.equal(archivedBody.data.isActive, false);
  } finally {
    await app.close();
    await prisma.product.deleteMany({ where: { sku } });
    await prisma.category.deleteMany({ where: { code: categoryCode } });
    await prisma.unit.deleteMany({ where: { code: unitCode } });
    await prisma.userSession.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.userRole.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.user.deleteMany({ where: { username: purchaserUsername } });
    await prisma.$disconnect();
  }
});
