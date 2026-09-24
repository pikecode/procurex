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

test('purchase request preview prices catalog items and reports stored-value shortfall', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const storeUsername = `it_preview_store_user_${runId}`;
  const storeCode = `PREVSTORE${runId}`;
  const templateCode = `PREVTPL${runId}`;
  const categoryCode = `PREVCAT${runId}`;
  const unitCode = `PREVUNIT${runId}`;
  const sku = `PREVSKU${runId}`;
  const supplierCode = `PREVSUP${runId}`;
  const { app, baseUrl } = await createTestApp();

  try {
    const storeRole = await prisma.role.upsert({
      where: { code: 'STORE' },
      update: {},
      create: { code: 'STORE', name: 'Store' },
    });
    await prisma.user.create({
      data: {
        username: storeUsername,
        displayName: 'Integration Preview Store',
        passwordHash: await hashPassword('correct-password'),
        roles: { create: [{ roleId: storeRole.id }] },
      },
    });

    const [store, category, unit, supplier, template] = await Promise.all([
      prisma.store.create({ data: { code: storeCode, name: 'Preview Store' } }),
      prisma.category.create({ data: { code: categoryCode, name: 'Preview Category' } }),
      prisma.unit.create({ data: { code: unitCode, name: 'piece' } }),
      prisma.supplier.create({
        data: {
          code: supplierCode,
          name: 'Preview Supplier',
          deliveryMode: DeliveryMode.SELF,
          defaultSettlementMode: SettlementMode.STORED_VALUE,
          defaultSettlementCycle: 'MONTHLY',
        },
      }),
      prisma.orderTemplate.create({ data: { code: templateCode, name: 'Preview Template' } }),
    ]);
    const product = await prisma.product.create({
      data: {
        sku,
        name: 'Preview Product',
        categoryId: category.id,
        baseUnitId: unit.id,
      },
    });
    await prisma.storeAccount.create({ data: { storeId: store.id, balance: '100.00' } });
    await prisma.templateItem.create({
      data: {
        templateId: template.id,
        productId: product.id,
        suppliers: { create: [{ supplierId: supplier.id, priority: 1 }] },
      },
    });
    await prisma.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } });
    const scope = await prisma.priceScope.create({ data: { productId: product.id, supplierId: supplier.id } });
    const priceVersion = await prisma.priceVersion.create({
      data: {
        scopeId: scope.id,
        salesPrice: '12.000000',
        supplyPrice: '9.000000',
        effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });

    const token = await login(baseUrl, storeUsername);
    const response = await fetch(`${baseUrl}/purchase-requests/preview`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-preview',
      },
      body: JSON.stringify({
        storeId: store.id,
        items: [{ productId: product.id, quantity: '10.000000' }],
      }),
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      data: {
        storeId: string;
        items: Array<{
          productId: string;
          supplierId: string;
          quantity: string;
          salesUnitPrice: string;
          supplyUnitPrice: string;
          salesLineAmount: string;
          supplyLineAmount: string;
          priceVersionId: string;
        }>;
        totals: { salesGoodsAmount: string; supplyGoodsAmount: string };
        funding: { stored: { required: string; paid: string; available: string; shortfall: string }; canConfirm: boolean };
      };
      traceId: string;
    };
    assert.equal(body.traceId, 'trace-preview');
    assert.equal(body.data.storeId, store.id);
    assert.deepEqual(body.data.items, [
      {
        productId: product.id,
        supplierId: supplier.id,
        quantity: '10',
        salesUnitPrice: '12',
        supplyUnitPrice: '9',
        salesLineAmount: '120.00',
        supplyLineAmount: '90.00',
        priceVersionId: priceVersion.id,
      },
    ]);
    assert.deepEqual(body.data.totals, { salesGoodsAmount: '120.00', supplyGoodsAmount: '90.00' });
    assert.deepEqual(body.data.funding, {
      stored: { required: '120.00', paid: '0.00', available: '100.00', shortfall: '20.00' },
      canConfirm: false,
    });
  } finally {
    await app.close();
    await prisma.priceVersion.deleteMany({ where: { scope: { supplier: { code: supplierCode } } } });
    await prisma.priceScope.deleteMany({ where: { supplier: { code: supplierCode } } });
    await prisma.storeAccount.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.storeTemplateBinding.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.templateItemSupplier.deleteMany({ where: { templateItem: { template: { code: templateCode } } } });
    await prisma.templateItem.deleteMany({ where: { template: { code: templateCode } } });
    await prisma.orderTemplate.deleteMany({ where: { code: templateCode } });
    await prisma.product.deleteMany({ where: { sku } });
    await prisma.supplier.deleteMany({ where: { code: supplierCode } });
    await prisma.store.deleteMany({ where: { code: storeCode } });
    await prisma.category.deleteMany({ where: { code: categoryCode } });
    await prisma.unit.deleteMany({ where: { code: unitCode } });
    await prisma.userSession.deleteMany({ where: { user: { username: storeUsername } } });
    await prisma.userRole.deleteMany({ where: { user: { username: storeUsername } } });
    await prisma.user.deleteMany({ where: { username: storeUsername } });
    await prisma.$disconnect();
  }
});

test('purchase request create persists request once per idempotency key', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const storeUsername = `it_create_store_user_${runId}`;
  const storeCode = `CREQSTORE${runId}`;
  const templateCode = `CREQTPL${runId}`;
  const categoryCode = `CREQCAT${runId}`;
  const unitCode = `CREQUNIT${runId}`;
  const sku = `CREQSKU${runId}`;
  const supplierCode = `CREQSUP${runId}`;
  const { app, baseUrl } = await createTestApp();

  try {
    const storeRole = await prisma.role.upsert({
      where: { code: 'STORE' },
      update: {},
      create: { code: 'STORE', name: 'Store' },
    });
    const user = await prisma.user.create({
      data: {
        username: storeUsername,
        displayName: 'Integration Create Store',
        passwordHash: await hashPassword('correct-password'),
        roles: { create: [{ roleId: storeRole.id }] },
      },
    });

    const [store, category, unit, supplier, template] = await Promise.all([
      prisma.store.create({ data: { code: storeCode, name: 'Create Store' } }),
      prisma.category.create({ data: { code: categoryCode, name: 'Create Category' } }),
      prisma.unit.create({ data: { code: unitCode, name: 'piece' } }),
      prisma.supplier.create({
        data: {
          code: supplierCode,
          name: 'Create Supplier',
          deliveryMode: DeliveryMode.SELF,
          defaultSettlementMode: SettlementMode.STORED_VALUE,
          defaultSettlementCycle: 'MONTHLY',
        },
      }),
      prisma.orderTemplate.create({ data: { code: templateCode, name: 'Create Template' } }),
    ]);
    const product = await prisma.product.create({
      data: {
        sku,
        name: 'Create Product',
        categoryId: category.id,
        baseUnitId: unit.id,
      },
    });
    await prisma.storeAccount.create({ data: { storeId: store.id, balance: '100.00' } });
    await prisma.templateItem.create({
      data: {
        templateId: template.id,
        productId: product.id,
        suppliers: { create: [{ supplierId: supplier.id, priority: 1 }] },
      },
    });
    await prisma.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } });
    const scope = await prisma.priceScope.create({ data: { productId: product.id, supplierId: supplier.id } });
    await prisma.priceVersion.create({
      data: {
        scopeId: scope.id,
        salesPrice: '12.000000',
        supplyPrice: '9.000000',
        effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });

    const token = await login(baseUrl, storeUsername);
    const requestBody = {
      storeId: store.id,
      items: [{ productId: product.id, quantity: '10.000000' }],
    };
    const create = async () => {
      const response = await fetch(`${baseUrl}/purchase-requests`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'create-request-once',
          'x-trace-id': 'trace-create-request',
        },
        body: JSON.stringify(requestBody),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: { id: string; requestNo: string; status: string; paymentStatus: string; totals: { salesGoodsAmount: string }; funding: { canConfirm: boolean } };
      };
    };

    const first = await create();
    const second = await create();
    assert.equal(second.data.id, first.data.id);
    assert.equal(second.data.requestNo, first.data.requestNo);
    assert.equal(first.data.status, 'PENDING_FUNDS');
    assert.equal(first.data.paymentStatus, 'UNPAID');
    assert.equal(first.data.totals.salesGoodsAmount, '120.00');
    assert.equal(first.data.funding.canConfirm, false);

    const requests = await prisma.purchaseRequest.findMany({ where: { storeId: store.id } });
    assert.equal(requests.length, 1);
    const items = await prisma.requestItem.findMany({ where: { requestId: first.data.id } });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.salesLineAmount.toString(), '120');
    const commands = await prisma.commandRecord.findMany({
      where: { actorUserId: user.id, action: 'purchase-request.create', idempotencyKey: 'create-request-once' },
    });
    assert.equal(commands.length, 1);
  } finally {
    await app.close();
    await prisma.commandRecord.deleteMany({ where: { actor: { username: storeUsername } } });
    await prisma.requestItem.deleteMany({ where: { request: { store: { code: storeCode } } } });
    await prisma.purchaseRequest.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.priceVersion.deleteMany({ where: { scope: { supplier: { code: supplierCode } } } });
    await prisma.priceScope.deleteMany({ where: { supplier: { code: supplierCode } } });
    await prisma.storeAccount.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.storeTemplateBinding.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.templateItemSupplier.deleteMany({ where: { templateItem: { template: { code: templateCode } } } });
    await prisma.templateItem.deleteMany({ where: { template: { code: templateCode } } });
    await prisma.orderTemplate.deleteMany({ where: { code: templateCode } });
    await prisma.product.deleteMany({ where: { sku } });
    await prisma.supplier.deleteMany({ where: { code: supplierCode } });
    await prisma.store.deleteMany({ where: { code: storeCode } });
    await prisma.category.deleteMany({ where: { code: categoryCode } });
    await prisma.unit.deleteMany({ where: { code: unitCode } });
    await prisma.userSession.deleteMany({ where: { user: { username: storeUsername } } });
    await prisma.userRole.deleteMany({ where: { user: { username: storeUsername } } });
    await prisma.user.deleteMany({ where: { username: storeUsername } });
    await prisma.$disconnect();
  }
});
