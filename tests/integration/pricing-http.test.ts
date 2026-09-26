import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { DeliveryMode, SettlementMode } from '../../packages/backend/generated/prisma/enums.js';
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

test('pricing HTTP endpoint publishes prices and lists versions', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const purchaserUsername = `it_price_http_${runId}`;
  const categoryCode = `PHTTP_CAT${runId}`;
  const unitCode = `PHTTP_UNIT${runId}`;
  const sku = `PHTTP_SKU${runId}`;
  const supplierCode = `PHTTP_SUP${runId}`;
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
        displayName: 'Integration Price HTTP',
        passwordHash: await hashPassword('correct-password'),
        roles: { create: [{ roleId: purchaserRole.id }] },
      },
    });

    const [category, unit, supplier] = await Promise.all([
      prisma.category.create({ data: { code: categoryCode, name: 'Price HTTP Category' } }),
      prisma.unit.create({ data: { code: unitCode, name: 'piece' } }),
      prisma.supplier.create({
        data: {
          code: supplierCode,
          name: 'Price HTTP Supplier',
          deliveryMode: DeliveryMode.SELF,
          defaultSettlementMode: SettlementMode.COMPANY_TERM,
          defaultSettlementCycle: 'MONTHLY',
        },
      }),
    ]);
    const product = await prisma.product.create({
      data: {
        sku,
        name: 'Price HTTP Product',
        categoryId: category.id,
        baseUnitId: unit.id,
      },
    });

    const token = await login(baseUrl, purchaserUsername);
    const publish = async (salesPrice: string, supplyPrice: string, effectiveAt: string) => {
      const response = await fetch(`${baseUrl}/price-changes`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-trace-id': `trace-price-${salesPrice}`,
        },
        body: JSON.stringify({
          productId: product.id,
          supplierId: supplier.id,
          salesPrice,
          supplyPrice,
          effectiveAt,
          reason: 'Supplier price update',
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as { data: { scopeId: string; salesPrice: string; supplyPrice: string; reason: string; revision: number; runId: string }; traceId: string };
    };

    const first = await publish('10.000000', '8.000000', '2026-09-01T00:00:00.000Z');
    assert.equal(first.data.salesPrice, '10');
    assert.equal(first.data.supplyPrice, '8');
    assert.equal(first.data.reason, 'Supplier price update');
    assert.equal(first.data.revision, 1);
    assert.notEqual(first.data.runId, '');
    const impact = await fetch(`${baseUrl}/prices/impact-preview`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        productId: product.id,
        supplierId: supplier.id,
        salesPrice: '11.000000',
        supplyPrice: '9.000000',
        effectiveAt: '2026-09-02T00:00:00.000Z',
      }),
    });
    assert.equal(impact.status, 201);
    const impactBody = (await impact.json()) as { data: { scopeId: string; affectedOrderCount: number; salesDelta: string; supplyDelta: string } };
    assert.equal(impactBody.data.scopeId, first.data.scopeId);
    assert.equal(impactBody.data.affectedOrderCount, 0);
    assert.equal(impactBody.data.salesDelta, '0.00');
    assert.equal(impactBody.data.supplyDelta, '0.00');
    const run = await fetch(`${baseUrl}/jobs/${first.data.runId}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(run.status, 200);
    const runBody = (await run.json()) as { data: { status: string; priceVersionIds: string[] } };
    assert.equal(runBody.data.status, 'PENDING');
    assert.equal(runBody.data.priceVersionIds.length, 1);
    const processed = await fetch(`${baseUrl}/jobs/${first.data.runId}/process`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(processed.status, 201);
    const processedBody = (await processed.json()) as { data: { status: string; orders: unknown[] } };
    assert.equal(processedBody.data.status, 'SUCCEEDED');
    assert.deepEqual(processedBody.data.orders, []);
    const repeated = await fetch(`${baseUrl}/jobs/${first.data.runId}/process`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(repeated.status, 409);
    const second = await publish('12.000000', '9.000000', '2026-09-10T00:00:00.000Z');
    assert.equal(second.data.scopeId, first.data.scopeId);
    assert.equal(second.data.revision, 2);

    const correction = await publish('13.000000', '10.000000', '2026-09-10T00:00:00.000Z');
    assert.equal(correction.data.revision, 3);

    const versions = await fetch(`${baseUrl}/price-scopes/${first.data.scopeId}/versions`, {
      headers: {
        authorization: `Bearer ${token}`,
        'x-trace-id': 'trace-price-versions',
      },
    });
    assert.equal(versions.status, 200);
    const versionsBody = (await versions.json()) as { data: Array<{ salesPrice: string; supplyPrice: string; reason: string; revision: number }>; traceId: string };
    assert.equal(versionsBody.traceId, 'trace-price-versions');
    assert.deepEqual(
      versionsBody.data.map((version) => [version.salesPrice, version.supplyPrice, version.reason, version.revision]),
      [
        ['13', '10', 'Supplier price update', 3],
        ['12', '9', 'Supplier price update', 2],
        ['10', '8', 'Supplier price update', 1],
      ],
    );
  } finally {
    await app.close();
    await prisma.priceVersion.deleteMany({ where: { scope: { supplier: { code: supplierCode } } } });
    await prisma.priceScope.deleteMany({ where: { supplier: { code: supplierCode } } });
    await prisma.product.deleteMany({ where: { sku } });
    await prisma.supplier.deleteMany({ where: { code: supplierCode } });
    await prisma.category.deleteMany({ where: { code: categoryCode } });
    await prisma.unit.deleteMany({ where: { code: unitCode } });
    await prisma.userSession.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.userRole.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.user.deleteMany({ where: { username: purchaserUsername } });
    await prisma.$disconnect();
  }
});
