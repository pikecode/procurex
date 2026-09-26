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
    const purchaserRole = await prisma.role.upsert({
      where: { code: 'PURCHASER' },
      update: {},
      create: { code: 'PURCHASER', name: 'Purchaser' },
    });
    const user = await prisma.user.create({
      data: {
        username: storeUsername,
        displayName: 'Integration Create Store',
        passwordHash: await hashPassword('correct-password'),
        roles: { create: [{ roleId: storeRole.id }, { roleId: purchaserRole.id }] },
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
    const priceVersion = await prisma.priceVersion.create({
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

    const listResponse = await fetch(`${baseUrl}/purchase-requests?storeId=${store.id}&status=PENDING_FUNDS`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(listResponse.status, 200);
    const listBody = (await listResponse.json()) as {
      data: Array<{ id: string; requestNo: string; status: string; paymentStatus: string; salesGoodsAmount: string }>;
    };
    assert.equal(listBody.data.some((request) => request.id === first.data.id), true);
    const listed = listBody.data.find((request) => request.id === first.data.id);
    assert.equal(listed?.requestNo, first.data.requestNo);
    assert.equal(listed?.status, 'PENDING_FUNDS');
    assert.equal(listed?.paymentStatus, 'UNPAID');
    assert.equal(listed?.salesGoodsAmount, '120.00');

    const detailResponse = await fetch(`${baseUrl}/purchase-requests/${first.data.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(detailResponse.status, 200);
    const detailBody = (await detailResponse.json()) as {
      data: {
        id: string;
        items: Array<{ productId: string; supplierId: string; priceVersionId: string | null; salesLineAmount: string }>;
        supplierOrders: unknown[];
      };
    };
    assert.equal(detailBody.data.id, first.data.id);
    assert.equal(detailBody.data.items.length, 1);
    assert.equal(detailBody.data.items[0]?.productId, product.id);
    assert.equal(detailBody.data.items[0]?.supplierId, supplier.id);
    assert.equal(detailBody.data.items[0]?.priceVersionId, priceVersion.id);
    assert.equal(detailBody.data.items[0]?.salesLineAmount, '120.00');
    assert.deepEqual(detailBody.data.supplierOrders, []);

    const supplierOrder = await prisma.supplierOrder.create({
      data: {
        supplierOrderNo: `CREQSO${runId}`,
        requestId: first.data.id,
        storeId: store.id,
        supplierId: supplier.id,
        status: 'PUSHED',
        fulfillmentStatus: 'PENDING',
        pushedAt: new Date(),
        salesGoodsAmount: '120.00',
        supplyGoodsAmount: '90.00',
      },
    });
    await prisma.orderItem.create({
      data: {
        supplierOrderId: supplierOrder.id,
        productId: product.id,
        quantity: '10.000000',
        salesUnitPrice: '12.000000',
        supplyUnitPrice: '9.000000',
        salesLineAmount: '120.00',
        supplyLineAmount: '90.00',
      },
    });
    const reconcileFunding = async (idempotencyKey: string, expectedVersion: number) => {
      const response = await fetch(`${baseUrl}/supplier-orders/${supplierOrder.id}/reconcile-funding`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
          'x-trace-id': 'trace-reconcile-funding',
        },
        body: JSON.stringify({ expectedVersion }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: {
          supplierOrderId: string;
          supplierOrderVersion: number;
          requestId: string;
          requestStatus: string;
          requestVersion: number;
          paymentStatus: string;
          paidAmount: string;
          shortfallAmount: string;
          funding: { stored: { required: string; paid: string; available: string; shortfall: string }; canConfirm: boolean };
        };
      };
    };
    const insufficientFunding = await reconcileFunding('reconcile-funding-still-short', supplierOrder.version);
    const insufficientReplay = await reconcileFunding('reconcile-funding-still-short', supplierOrder.version);
    assert.deepEqual(insufficientReplay.data, insufficientFunding.data);
    assert.equal(insufficientFunding.data.supplierOrderId, supplierOrder.id);
    assert.equal(insufficientFunding.data.requestId, first.data.id);
    assert.equal(insufficientFunding.data.requestStatus, 'PENDING_FUNDS');
    assert.equal(insufficientFunding.data.paymentStatus, 'UNPAID');
    assert.equal(insufficientFunding.data.paidAmount, '0.00');
    assert.equal(insufficientFunding.data.shortfallAmount, '20.00');
    assert.deepEqual(insufficientFunding.data.funding, {
      stored: { required: '120.00', paid: '0.00', available: '100.00', shortfall: '20.00' },
      canConfirm: false,
    });
    await prisma.storeAccount.update({ where: { storeId: store.id }, data: { balance: '150.00' } });
    const reconciledFunding = await reconcileFunding('reconcile-funding-after-recharge', insufficientFunding.data.supplierOrderVersion);
    assert.equal(reconciledFunding.data.requestStatus, 'CONFIRMED');
    assert.equal(reconciledFunding.data.paymentStatus, 'PAID');
    assert.equal(reconciledFunding.data.paidAmount, '120.00');
    assert.equal(reconciledFunding.data.shortfallAmount, '0.00');
    assert.deepEqual(reconciledFunding.data.funding, {
      stored: { required: '120.00', paid: '120.00', available: '150.00', shortfall: '0.00' },
      canConfirm: true,
    });

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
    await prisma.orderItem.deleteMany({ where: { supplierOrder: { request: { store: { code: storeCode } } } } });
    await prisma.supplierOrder.deleteMany({ where: { request: { store: { code: storeCode } } } });
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

test('purchase request item patch reprices supplier assignments', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const purchaserUsername = `it_patch_purchaser_${runId}`;
  const storeCode = `PATCHSTORE${runId}`;
  const templateCode = `PATCHTPL${runId}`;
  const categoryCode = `PATCHCAT${runId}`;
  const unitCode = `PATCHUNIT${runId}`;
  const sku = `PATCHSKU${runId}`;
  const supplierCodeA = `PATCHSUPA${runId}`;
  const supplierCodeB = `PATCHSUPB${runId}`;
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
        displayName: 'Integration Patch Purchaser',
        passwordHash: await hashPassword('correct-password'),
        roles: { create: [{ roleId: purchaserRole.id }] },
      },
    });

    const [store, category, unit, supplierA, supplierB, template] = await Promise.all([
      prisma.store.create({ data: { code: storeCode, name: 'Patch Store' } }),
      prisma.category.create({ data: { code: categoryCode, name: 'Patch Category' } }),
      prisma.unit.create({ data: { code: unitCode, name: 'piece' } }),
      prisma.supplier.create({
        data: {
          code: supplierCodeA,
          name: 'Patch Supplier A',
          deliveryMode: DeliveryMode.SELF,
          defaultSettlementMode: SettlementMode.STORED_VALUE,
          defaultSettlementCycle: 'MONTHLY',
        },
      }),
      prisma.supplier.create({
        data: {
          code: supplierCodeB,
          name: 'Patch Supplier B',
          deliveryMode: DeliveryMode.SELF,
          defaultSettlementMode: SettlementMode.STORED_VALUE,
          defaultSettlementCycle: 'MONTHLY',
        },
      }),
      prisma.orderTemplate.create({ data: { code: templateCode, name: 'Patch Template' } }),
    ]);
    const product = await prisma.product.create({
      data: {
        sku,
        name: 'Patch Product',
        categoryId: category.id,
        baseUnitId: unit.id,
      },
    });
    await prisma.storeAccount.create({ data: { storeId: store.id, balance: '1000.00' } });
    await prisma.templateItem.create({
      data: {
        templateId: template.id,
        productId: product.id,
        suppliers: {
          create: [
            { supplierId: supplierA.id, priority: 1 },
            { supplierId: supplierB.id, priority: 2 },
          ],
        },
      },
    });
    await prisma.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } });
    const [scopeA, scopeB] = await Promise.all([
      prisma.priceScope.create({ data: { productId: product.id, supplierId: supplierA.id } }),
      prisma.priceScope.create({ data: { productId: product.id, supplierId: supplierB.id } }),
    ]);
    await prisma.priceVersion.create({
      data: {
        scopeId: scopeA.id,
        salesPrice: '12.000000',
        supplyPrice: '9.000000',
        effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
    const priceVersionB = await prisma.priceVersion.create({
      data: {
        scopeId: scopeB.id,
        salesPrice: '20.000000',
        supplyPrice: '15.000000',
        effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });

    const token = await login(baseUrl, purchaserUsername);
    const createResponse = await fetch(`${baseUrl}/purchase-requests`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': 'patch-create-request',
        'x-trace-id': 'trace-patch-create',
      },
      body: JSON.stringify({
        storeId: store.id,
        items: [{ productId: product.id, quantity: '10.000000' }],
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()) as {
      data: { id: string; status: string; version: number; totals: { salesGoodsAmount: string } };
    };
    assert.equal(created.data.status, 'PENDING_PROCUREMENT');
    assert.equal(created.data.totals.salesGoodsAmount, '120.00');

    const patchResponse = await fetch(`${baseUrl}/purchase-requests/${created.data.id}/items`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-patch-items',
      },
      body: JSON.stringify({
        expectedVersion: created.data.version,
        reason: 'Use alternate supplier',
        items: [{ productId: product.id, supplierId: supplierB.id, quantity: '5.000000' }],
      }),
    });
    assert.equal(patchResponse.status, 200);
    const patched = (await patchResponse.json()) as {
      data: {
        id: string;
        status: string;
        paymentStatus: string;
        salesGoodsAmount: string;
        supplyGoodsAmount: string;
        paidAmount: string;
        shortfallAmount: string;
        version: number;
        items: Array<{
          id: string;
          productId: string;
          supplierId: string;
          priceVersionId: string | null;
          quantity: string;
          salesUnitPrice: string;
          supplyUnitPrice: string;
          salesLineAmount: string;
          supplyLineAmount: string;
        }>;
      };
    };
    assert.equal(patched.data.id, created.data.id);
    assert.equal(patched.data.status, 'PENDING_PROCUREMENT');
    assert.equal(patched.data.paymentStatus, 'PAID');
    assert.equal(patched.data.salesGoodsAmount, '100.00');
    assert.equal(patched.data.supplyGoodsAmount, '75.00');
    assert.equal(patched.data.paidAmount, '100.00');
    assert.equal(patched.data.shortfallAmount, '0.00');
    assert.equal(patched.data.version, 2);
    assert.equal(patched.data.items.length, 1);
    assert.equal(patched.data.items[0]?.supplierId, supplierB.id);
    assert.equal(patched.data.items[0]?.priceVersionId, priceVersionB.id);
    assert.equal(patched.data.items[0]?.quantity, '5');
    assert.equal(patched.data.items[0]?.salesUnitPrice, '20');
    assert.equal(patched.data.items[0]?.supplyUnitPrice, '15');
    assert.equal(patched.data.items[0]?.salesLineAmount, '100.00');
    assert.equal(patched.data.items[0]?.supplyLineAmount, '75.00');

    const reassignPreviewResponse = await fetch(`${baseUrl}/purchase-requests/${created.data.id}/reassign-preview`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-reassign-preview',
      },
      body: JSON.stringify({
        expectedVersion: patched.data.version,
        itemIds: [patched.data.items[0]?.id],
        supplierId: supplierA.id,
      }),
    });
    assert.equal(reassignPreviewResponse.status, 201);
    const reassignPreview = (await reassignPreviewResponse.json()) as {
      data: {
        requestId: string;
        supplierId: string;
        items: Array<{
          requestItemId: string;
          productId: string | null;
          currentSupplierId: string | null;
          targetSupplierId: string;
          eligible: boolean;
          reason: string | null;
          salesLineAmount: string | null;
          supplyLineAmount: string | null;
        }>;
      };
    };
    assert.equal(reassignPreview.data.requestId, created.data.id);
    assert.equal(reassignPreview.data.supplierId, supplierA.id);
    assert.equal(reassignPreview.data.items.length, 1);
    assert.equal(reassignPreview.data.items[0]?.requestItemId, patched.data.items[0]!.id);
    assert.equal(reassignPreview.data.items[0]?.productId, product.id);
    assert.equal(reassignPreview.data.items[0]?.currentSupplierId, supplierB.id);
    assert.equal(reassignPreview.data.items[0]?.targetSupplierId, supplierA.id);
    assert.equal(reassignPreview.data.items[0]?.eligible, true);
    assert.equal(reassignPreview.data.items[0]?.reason, null);
    assert.equal(reassignPreview.data.items[0]?.salesLineAmount, '60.00');
    assert.equal(reassignPreview.data.items[0]?.supplyLineAmount, '45.00');

    const assignResponse = await fetch(`${baseUrl}/purchase-requests/${created.data.id}/assign`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-assign',
      },
      body: JSON.stringify({
        expectedVersion: patched.data.version,
        itemIds: [patched.data.items[0]?.id],
        supplierId: supplierA.id,
      }),
    });
    assert.equal(assignResponse.status, 201);
    const assigned = (await assignResponse.json()) as {
      data: {
        salesGoodsAmount: string;
        supplyGoodsAmount: string;
        paidAmount: string;
        version: number;
        items: Array<{ supplierId: string; salesLineAmount: string; supplyLineAmount: string }>;
      };
    };
    assert.equal(assigned.data.salesGoodsAmount, '60.00');
    assert.equal(assigned.data.supplyGoodsAmount, '45.00');
    assert.equal(assigned.data.paidAmount, '60.00');
    assert.equal(assigned.data.version, 3);
    assert.equal(assigned.data.items[0]?.supplierId, supplierA.id);
    assert.equal(assigned.data.items[0]?.salesLineAmount, '60.00');
    assert.equal(assigned.data.items[0]?.supplyLineAmount, '45.00');

    const request = await prisma.purchaseRequest.findUniqueOrThrow({
      where: { id: created.data.id },
      include: { items: true },
    });
    assert.equal(request.version, 3);
    assert.equal(request.salesGoodsAmount.toString(), '60');
    assert.equal(request.items.length, 1);
    assert.equal(request.items[0]?.supplierId, supplierA.id);
    assert.notEqual(request.items[0]?.priceVersionId, priceVersionB.id);
  } finally {
    await app.close();
    await prisma.commandRecord.deleteMany({ where: { actor: { username: purchaserUsername } } });
    await prisma.requestItem.deleteMany({ where: { request: { store: { code: storeCode } } } });
    await prisma.purchaseRequest.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.priceVersion.deleteMany({ where: { scope: { supplier: { code: { in: [supplierCodeA, supplierCodeB] } } } } });
    await prisma.priceScope.deleteMany({ where: { supplier: { code: { in: [supplierCodeA, supplierCodeB] } } } });
    await prisma.storeAccount.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.storeTemplateBinding.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.templateItemSupplier.deleteMany({ where: { templateItem: { template: { code: templateCode } } } });
    await prisma.templateItem.deleteMany({ where: { template: { code: templateCode } } });
    await prisma.orderTemplate.deleteMany({ where: { code: templateCode } });
    await prisma.product.deleteMany({ where: { sku } });
    await prisma.supplier.deleteMany({ where: { code: { in: [supplierCodeA, supplierCodeB] } } });
    await prisma.store.deleteMany({ where: { code: storeCode } });
    await prisma.category.deleteMany({ where: { code: categoryCode } });
    await prisma.unit.deleteMany({ where: { code: unitCode } });
    await prisma.userSession.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.userRole.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.user.deleteMany({ where: { username: purchaserUsername } });
    await prisma.$disconnect();
  }
});

test('purchase request confirm splits supplier orders once per idempotency key', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const purchaserUsername = `it_confirm_purchaser_${runId}`;
  const financeUsername = `it_confirm_finance_${runId}`;
  const storeCode = `CONFSTORE${runId}`;
  const templateCode = `CONFTPL${runId}`;
  const categoryCode = `CONFCAT${runId}`;
  const unitCode = `CONFUNIT${runId}`;
  const skuA = `CONFSKUA${runId}`;
  const skuB = `CONFSKUB${runId}`;
  const supplierCodeA = `CONFSUPA${runId}`;
  const supplierCodeB = `CONFSUPB${runId}`;
  const { app, baseUrl } = await createTestApp();

  try {
    const purchaserRole = await prisma.role.upsert({
      where: { code: 'PURCHASER' },
      update: {},
      create: { code: 'PURCHASER', name: 'Purchaser' },
    });
    const supplierRole = await prisma.role.upsert({
      where: { code: 'SUPPLIER' },
      update: {},
      create: { code: 'SUPPLIER', name: 'Supplier' },
    });
    const storeRole = await prisma.role.upsert({
      where: { code: 'STORE' },
      update: {},
      create: { code: 'STORE', name: 'Store' },
    });
    const hqFinanceRole = await prisma.role.upsert({
      where: { code: 'HQ_FINANCE' },
      update: {},
      create: { code: 'HQ_FINANCE', name: 'HQ Finance' },
    });
    const user = await prisma.user.create({
      data: {
        username: purchaserUsername,
        displayName: 'Integration Confirm Purchaser',
        passwordHash: await hashPassword('correct-password'),
        roles: { create: [{ roleId: purchaserRole.id }, { roleId: supplierRole.id }, { roleId: storeRole.id }] },
      },
    });
    await prisma.user.create({
      data: {
        username: financeUsername,
        displayName: 'Integration Confirm Finance',
        passwordHash: await hashPassword('correct-password'),
        roles: { create: [{ roleId: hqFinanceRole.id }] },
      },
    });

    const [store, category, unit, supplierA, supplierB, template] = await Promise.all([
      prisma.store.create({ data: { code: storeCode, name: 'Confirm Store' } }),
      prisma.category.create({ data: { code: categoryCode, name: 'Confirm Category' } }),
      prisma.unit.create({ data: { code: unitCode, name: 'piece' } }),
      prisma.supplier.create({
        data: {
          code: supplierCodeA,
          name: 'Confirm Supplier A',
          deliveryMode: DeliveryMode.SELF,
          defaultSettlementMode: SettlementMode.STORED_VALUE,
          defaultSettlementCycle: 'MONTHLY',
        },
      }),
      prisma.supplier.create({
        data: {
          code: supplierCodeB,
          name: 'Confirm Supplier B',
          deliveryMode: DeliveryMode.SELF,
          defaultSettlementMode: SettlementMode.STORED_VALUE,
          defaultSettlementCycle: 'MONTHLY',
        },
      }),
      prisma.orderTemplate.create({ data: { code: templateCode, name: 'Confirm Template' } }),
    ]);
    const [productA, productB] = await Promise.all([
      prisma.product.create({
        data: {
          sku: skuA,
          name: 'Confirm Product A',
          categoryId: category.id,
          baseUnitId: unit.id,
        },
      }),
      prisma.product.create({
        data: {
          sku: skuB,
          name: 'Confirm Product B',
          categoryId: category.id,
          baseUnitId: unit.id,
        },
      }),
    ]);
    await prisma.storeAccount.create({ data: { storeId: store.id, balance: '1000.00' } });
    await Promise.all([
      prisma.templateItem.create({
        data: {
          templateId: template.id,
          productId: productA.id,
          suppliers: {
            create: [
              { supplierId: supplierA.id, priority: 1 },
              { supplierId: supplierB.id, priority: 2 },
            ],
          },
        },
      }),
      prisma.templateItem.create({
        data: {
          templateId: template.id,
          productId: productB.id,
          suppliers: { create: [{ supplierId: supplierB.id, priority: 1 }] },
        },
      }),
    ]);
    await prisma.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } });
    const [scopeA, scopeAB, scopeB] = await Promise.all([
      prisma.priceScope.create({ data: { productId: productA.id, supplierId: supplierA.id } }),
      prisma.priceScope.create({ data: { productId: productA.id, supplierId: supplierB.id } }),
      prisma.priceScope.create({ data: { productId: productB.id, supplierId: supplierB.id } }),
    ]);
    await Promise.all([
      prisma.priceVersion.create({
        data: {
          scopeId: scopeA.id,
          salesPrice: '12.000000',
          supplyPrice: '9.000000',
          effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      }),
      prisma.priceVersion.create({
        data: {
          scopeId: scopeAB.id,
          salesPrice: '11.000000',
          supplyPrice: '8.000000',
          effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      }),
      prisma.priceVersion.create({
        data: {
          scopeId: scopeB.id,
          salesPrice: '5.000000',
          supplyPrice: '4.000000',
          effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      }),
    ]);

    const token = await login(baseUrl, purchaserUsername);
    const financeToken = await login(baseUrl, financeUsername);
    const createResponse = await fetch(`${baseUrl}/purchase-requests`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': 'confirm-create-request',
        'x-trace-id': 'trace-confirm-create',
      },
      body: JSON.stringify({
        storeId: store.id,
        items: [
          { productId: productA.id, quantity: '10.000000' },
          { productId: productB.id, quantity: '2.000000' },
        ],
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()) as {
      data: { id: string; status: string; paymentStatus: string; version: number; totals: { salesGoodsAmount: string } };
    };
    assert.equal(created.data.status, 'PENDING_PROCUREMENT');
    assert.equal(created.data.paymentStatus, 'PAID');
    assert.equal(created.data.totals.salesGoodsAmount, '130.00');

    const confirm = async () => {
      const response = await fetch(`${baseUrl}/purchase-requests/${created.data.id}/confirm`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'confirm-request-once',
          'x-trace-id': 'trace-confirm-request',
        },
        body: JSON.stringify({ expectedVersion: created.data.version }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: { requestId: string; status: string; supplierOrderIds: string[] };
      };
    };

    const first = await confirm();
    const second = await confirm();
    assert.equal(second.data.requestId, first.data.requestId);
    assert.deepEqual(second.data.supplierOrderIds, first.data.supplierOrderIds);
    assert.equal(first.data.requestId, created.data.id);
    assert.equal(first.data.status, 'CONFIRMED');
    assert.equal(first.data.supplierOrderIds.length, 2);

    const request = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: created.data.id } });
    assert.equal(request.status, 'CONFIRMED');
    assert.equal(request.version, 2);
    assert.ok(request.confirmedAt);
    const supplierOrders = await prisma.supplierOrder.findMany({
      where: { requestId: created.data.id },
      include: { items: true },
      orderBy: { supplierId: 'asc' },
    });
    assert.equal(supplierOrders.length, 2);
    assert.equal(supplierOrders.flatMap((order) => order.items).length, 2);
    assert.deepEqual(
      supplierOrders.map((order) => order.status),
      ['PUSHED', 'PUSHED'],
    );
    assert.deepEqual(
      supplierOrders.map((order) => order.fulfillmentStatus),
      ['PENDING', 'PENDING'],
    );
    const supplierOrderA = supplierOrders.find((order) => order.supplierId === supplierA.id);
    assert.ok(supplierOrderA);
    const supplierOrderListResponse = await fetch(`${baseUrl}/supplier-orders?supplierId=${supplierA.id}&status=PUSHED`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(supplierOrderListResponse.status, 200);
    const supplierOrderList = (await supplierOrderListResponse.json()) as {
      data: Array<{
        id: string;
        requestId: string;
        storeId: string;
        supplierId: string;
        status: string;
        fulfillmentStatus: string;
        salesGoodsAmount: string;
        supplyGoodsAmount: string;
      }>;
    };
    const listedSupplierOrder = supplierOrderList.data.find((order) => order.id === supplierOrderA.id);
    assert.equal(listedSupplierOrder?.requestId, created.data.id);
    assert.equal(listedSupplierOrder?.storeId, store.id);
    assert.equal(listedSupplierOrder?.supplierId, supplierA.id);
    assert.equal(listedSupplierOrder?.status, 'PUSHED');
    assert.equal(listedSupplierOrder?.fulfillmentStatus, 'PENDING');
    assert.equal(listedSupplierOrder?.salesGoodsAmount, '120.00');
    assert.equal(listedSupplierOrder?.supplyGoodsAmount, '90.00');

    const supplierOrderDetailResponse = await fetch(`${baseUrl}/supplier-orders/${supplierOrderA.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(supplierOrderDetailResponse.status, 200);
    const supplierOrderDetail = (await supplierOrderDetailResponse.json()) as {
      data: {
        id: string;
        items: Array<{ productId: string; quantity: string; salesLineAmount: string; supplyLineAmount: string }>;
      };
    };
    assert.equal(supplierOrderDetail.data.id, supplierOrderA.id);
    assert.equal(supplierOrderDetail.data.items.length, 1);
    assert.equal(supplierOrderDetail.data.items[0]?.productId, productA.id);
    assert.equal(supplierOrderDetail.data.items[0]?.quantity, '10');
    assert.equal(supplierOrderDetail.data.items[0]?.salesLineAmount, '120.00');
    assert.equal(supplierOrderDetail.data.items[0]?.supplyLineAmount, '90.00');

    const rejectSupplierOrder = async () => {
      const response = await fetch(`${baseUrl}/supplier-orders/${supplierOrderA.id}/reject`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'reject-supplier-order-once',
          'x-trace-id': 'trace-reject-supplier-order',
        },
        body: JSON.stringify({ expectedVersion: supplierOrderA.version, reason: 'Out of stock' }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: {
          supplierOrderId: string;
          requestId: string;
          status: string;
          fulfillmentStatus: string;
          version: number;
          rejectedAt: string | null;
        };
      };
    };

    const rejectedOrder = await rejectSupplierOrder();
    const rejectedOrderReplay = await rejectSupplierOrder();
    assert.deepEqual(rejectedOrderReplay.data, rejectedOrder.data);
    assert.equal(rejectedOrder.data.supplierOrderId, supplierOrderA.id);
    assert.equal(rejectedOrder.data.requestId, created.data.id);
    assert.equal(rejectedOrder.data.status, 'REJECTED');
    assert.equal(rejectedOrder.data.fulfillmentStatus, 'CANCELED');
    assert.equal(rejectedOrder.data.version, 2);
    assert.ok(rejectedOrder.data.rejectedAt);

    const rejectedSupplierOrder = await prisma.supplierOrder.findUniqueOrThrow({ where: { id: supplierOrderA.id } });
    assert.equal(rejectedSupplierOrder.status, 'REJECTED');
    assert.equal(rejectedSupplierOrder.fulfillmentStatus, 'CANCELED');
    assert.equal(rejectedSupplierOrder.rejectedReason, 'Out of stock');
    const requestAfterSupplierReject = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: created.data.id } });
    assert.equal(requestAfterSupplierReject.status, 'PARTIAL_PUSHED');
    const rejectedRequestItem = await prisma.requestItem.findFirstOrThrow({
      where: { requestId: created.data.id, productId: productA.id },
    });
    const reallocateResponse = await fetch(`${baseUrl}/purchase-requests/${created.data.id}/reallocate`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-reallocate-request',
      },
      body: JSON.stringify({
        expectedVersion: requestAfterSupplierReject.version,
        rejectedOrderId: supplierOrderA.id,
        reason: 'Move rejected item to alternate supplier',
        assignments: [{ requestItemId: rejectedRequestItem.id, supplierId: supplierB.id }],
      }),
    });
    assert.equal(reallocateResponse.status, 201);
    const reallocated = (await reallocateResponse.json()) as {
      data: {
        id: string;
        status: string;
        salesGoodsAmount: string;
        supplyGoodsAmount: string;
        version: number;
        items: Array<{ productId: string; supplierId: string; salesLineAmount: string; supplyLineAmount: string }>;
      };
    };
    assert.equal(reallocated.data.id, created.data.id);
    assert.equal(reallocated.data.status, 'CONFIRMED');
    assert.equal(reallocated.data.salesGoodsAmount, '120.00');
    assert.equal(reallocated.data.supplyGoodsAmount, '88.00');
    assert.equal(reallocated.data.version, 4);
    const reallocatedProductA = reallocated.data.items.find((item) => item.productId === productA.id);
    assert.equal(reallocatedProductA?.supplierId, supplierB.id);
    assert.equal(reallocatedProductA?.salesLineAmount, '110.00');
    assert.equal(reallocatedProductA?.supplyLineAmount, '80.00');
    const supplierBOrderAfterReallocate = await prisma.supplierOrder.findFirstOrThrow({
      where: { requestId: created.data.id, supplierId: supplierB.id, status: 'PUSHED' },
      include: { items: true },
    });
    assert.equal(supplierBOrderAfterReallocate.salesGoodsAmount.toString(), '120');
    assert.equal(supplierBOrderAfterReallocate.supplyGoodsAmount.toString(), '88');
    assert.equal(supplierBOrderAfterReallocate.items.length, 2);
    const productAOrderItem = supplierBOrderAfterReallocate.items.find((item) => item.productId === productA.id);
    const productBOrderItem = supplierBOrderAfterReallocate.items.find((item) => item.productId === productB.id);
    assert.ok(productAOrderItem);
    assert.ok(productBOrderItem);
    const shipmentPreviewResponse = await fetch(`${baseUrl}/supplier-orders/${supplierBOrderAfterReallocate.id}/shipment-preview`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-shipment-preview',
      },
      body: JSON.stringify({
        expectedVersion: supplierBOrderAfterReallocate.version,
        freight: '0.00',
        items: [
          {
            orderItemId: productAOrderItem.id,
            shipQuantity: '6.000000',
            permanentlyReduceQuantity: '1.000000',
          },
          {
            orderItemId: productBOrderItem.id,
            shipQuantity: '2.000000',
            permanentlyReduceQuantity: '0.000000',
          },
        ],
      }),
    });
    assert.equal(shipmentPreviewResponse.status, 201);
    const shipmentPreview = (await shipmentPreviewResponse.json()) as {
      data: {
        supplierOrderId: string;
        version: number;
        totals: {
          shipQuantity: string;
          permanentlyReduceQuantity: string;
          remainingQuantity: string;
          salesGoodsAmount: string;
          supplyGoodsAmount: string;
          freight: string;
        };
        items: Array<{
          orderItemId: string;
          remainingQuantityBefore: string;
          remainingQuantityAfter: string;
          salesLineAmount: string;
          supplyLineAmount: string;
        }>;
      };
    };
    assert.equal(shipmentPreview.data.supplierOrderId, supplierBOrderAfterReallocate.id);
    assert.equal(shipmentPreview.data.version, supplierBOrderAfterReallocate.version);
    assert.deepEqual(shipmentPreview.data.totals, {
      shipQuantity: '8',
      permanentlyReduceQuantity: '1',
      remainingQuantity: '3',
      salesGoodsAmount: '76.00',
      supplyGoodsAmount: '56.00',
      freight: '0.00',
    });
    const previewProductA = shipmentPreview.data.items.find((item) => item.orderItemId === productAOrderItem.id);
    assert.equal(previewProductA?.remainingQuantityBefore, '10');
    assert.equal(previewProductA?.remainingQuantityAfter, '3');
    assert.equal(previewProductA?.salesLineAmount, '66.00');
    assert.equal(previewProductA?.supplyLineAmount, '48.00');
    const createShipmentResponse = await fetch(`${baseUrl}/supplier-orders/${supplierBOrderAfterReallocate.id}/shipments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': 'create-shipment-once',
        'x-trace-id': 'trace-create-shipment',
      },
      body: JSON.stringify({
        expectedVersion: supplierBOrderAfterReallocate.version,
        freight: '0.00',
        items: [
          {
            orderItemId: productAOrderItem.id,
            shipQuantity: '6.000000',
            permanentlyReduceQuantity: '1.000000',
          },
          {
            orderItemId: productBOrderItem.id,
            shipQuantity: '2.000000',
            permanentlyReduceQuantity: '0.000000',
          },
        ],
      }),
    });
    assert.equal(createShipmentResponse.status, 201);
    const createdShipment = (await createShipmentResponse.json()) as {
      data: {
        id: string;
        supplierOrderId: string;
        sequence: number;
        kind: string;
        freight: string;
        items: Array<{ id: string; orderItemId: string; quantity: string; permanentlyReduced: string; salesLineAmount: string }>;
      };
    };
    assert.equal(createdShipment.data.supplierOrderId, supplierBOrderAfterReallocate.id);
    assert.equal(createdShipment.data.sequence, 1);
    assert.equal(createdShipment.data.kind, 'INITIAL');
    assert.equal(createdShipment.data.freight, '0.00');
    assert.equal(createdShipment.data.items.length, 2);
    const shippedProductA = createdShipment.data.items.find((item) => item.orderItemId === productAOrderItem.id);
    assert.equal(shippedProductA?.quantity, '6');
    assert.equal(shippedProductA?.permanentlyReduced, '1');
    assert.equal(shippedProductA?.salesLineAmount, '66.00');
    const createShipmentReplayResponse = await fetch(`${baseUrl}/supplier-orders/${supplierBOrderAfterReallocate.id}/shipments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': 'create-shipment-once',
        'x-trace-id': 'trace-create-shipment-replay',
      },
      body: JSON.stringify({
        expectedVersion: supplierBOrderAfterReallocate.version,
        freight: '0.00',
        items: [
          {
            orderItemId: productAOrderItem.id,
            shipQuantity: '6.000000',
            permanentlyReduceQuantity: '1.000000',
          },
          {
            orderItemId: productBOrderItem.id,
            shipQuantity: '2.000000',
            permanentlyReduceQuantity: '0.000000',
          },
        ],
      }),
    });
    assert.equal(createShipmentReplayResponse.status, 201);
    const replayedShipment = (await createShipmentReplayResponse.json()) as { data: { id: string } };
    assert.equal(replayedShipment.data.id, createdShipment.data.id);
    const shippedOrder = await prisma.supplierOrder.findUniqueOrThrow({ where: { id: supplierBOrderAfterReallocate.id } });
    assert.equal(shippedOrder.status, 'PARTIAL_SHIPPED');
    assert.equal(shippedOrder.fulfillmentStatus, 'PARTIAL_SHIPPED');
    assert.ok(shippedOrder.firstShippedAt);
    const shippedItems = await prisma.orderItem.findMany({ where: { supplierOrderId: supplierBOrderAfterReallocate.id } });
    assert.equal(shippedItems.find((item) => item.id === productAOrderItem.id)?.shippedQuantity.toString(), '6');
    assert.equal(shippedItems.find((item) => item.id === productBOrderItem.id)?.shippedQuantity.toString(), '2');
    const persistedShipments = await prisma.shipment.findMany({ where: { supplierOrderId: supplierBOrderAfterReallocate.id } });
    assert.equal(persistedShipments.length, 1);
    const createReceipt = async () => {
      const response = await fetch(`${baseUrl}/shipments/${createdShipment.data.id}/receipts`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'create-receipt-once',
          'x-trace-id': 'trace-create-receipt',
        },
        body: JSON.stringify({
          expectedOrderVersion: shippedOrder.version,
          expectedReceiptRevision: 0,
          items: createdShipment.data.items.map((item) => ({
            shipmentItemId: item.id,
            receivedQuantity: item.orderItemId === productAOrderItem.id ? '5.000000' : item.quantity,
          })),
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: {
          id: string;
          shipmentId: string;
          revision: number;
          isCurrent: boolean;
          items: Array<{ shipmentItemId: string; receivedQuantity: string }>;
        };
      };
    };
    const receipt = await createReceipt();
    const receiptReplay = await createReceipt();
    assert.deepEqual(receiptReplay.data, receipt.data);
    assert.equal(receipt.data.shipmentId, createdShipment.data.id);
    assert.equal(receipt.data.revision, 1);
    assert.equal(receipt.data.isCurrent, true);
    assert.equal(receipt.data.items.length, 2);
    assert.equal(receipt.data.items.find((item) => item.shipmentItemId === shippedProductA?.id)?.receivedQuantity, '5');
    const receivedItems = await prisma.orderItem.findMany({ where: { supplierOrderId: supplierBOrderAfterReallocate.id } });
    assert.equal(receivedItems.find((item) => item.id === productAOrderItem.id)?.receivedQuantity.toString(), '5');
    assert.equal(receivedItems.find((item) => item.id === productBOrderItem.id)?.receivedQuantity.toString(), '2');
    const orderAfterReceipt = await prisma.supplierOrder.findUniqueOrThrow({ where: { id: supplierBOrderAfterReallocate.id } });
    assert.equal(orderAfterReceipt.fulfillmentStatus, 'PARTIAL_SHIPPED');
    const persistedReceipts = await prisma.receipt.findMany({ where: { shipmentId: createdShipment.data.id } });
    assert.equal(persistedReceipts.length, 1);
    const discrepancy = await prisma.discrepancy.findFirstOrThrow({
      where: { orderItemId: productAOrderItem.id, status: 'OPEN' },
    });
    assert.equal(discrepancy.missingQuantity.toString(), '1');
    const resolveDiscrepancy = async () => {
      const response = await fetch(`${baseUrl}/discrepancies/${discrepancy.id}/resolve`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'resolve-discrepancy-once',
          'x-trace-id': 'trace-resolve-discrepancy',
        },
        body: JSON.stringify({
          expectedVersion: discrepancy.version,
          action: 'ACCEPT',
          reason: 'Store accepts shortage',
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: { id: string; status: string; version: number; resolvedAt: string | null; missingQuantity: string };
      };
    };
    const resolvedDiscrepancy = await resolveDiscrepancy();
    const resolvedDiscrepancyReplay = await resolveDiscrepancy();
    assert.deepEqual(resolvedDiscrepancyReplay.data, resolvedDiscrepancy.data);
    assert.equal(resolvedDiscrepancy.data.id, discrepancy.id);
    assert.equal(resolvedDiscrepancy.data.status, 'RESOLVED');
    assert.equal(resolvedDiscrepancy.data.version, 2);
    assert.equal(resolvedDiscrepancy.data.missingQuantity, '1');
    assert.ok(resolvedDiscrepancy.data.resolvedAt);
    const discrepancyActions = await prisma.discrepancyAction.findMany({ where: { discrepancyId: discrepancy.id } });
    assert.equal(discrepancyActions.length, 1);
    assert.equal(discrepancyActions[0]?.action, 'ACCEPT');
    const orderAfterAcceptedDiscrepancy = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: supplierBOrderAfterReallocate.id },
    });

    const createFreightConfirmation = async () => {
      const response = await fetch(`${baseUrl}/supplier-orders/${supplierBOrderAfterReallocate.id}/freight-confirmations`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'create-freight-confirmation-once',
          'x-trace-id': 'trace-create-freight-confirmation',
        },
        body: JSON.stringify({
          expectedVersion: orderAfterAcceptedDiscrepancy.version,
          amount: '18.50',
          reason: 'Extra replenishment freight',
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: {
          id: string;
          supplierOrderId: string;
          amount: string;
          reason: string;
          status: string;
          version: number;
          confirmedAt: string | null;
          rejectedAt: string | null;
        };
      };
    };
    const freightConfirmation = await createFreightConfirmation();
    const freightConfirmationReplay = await createFreightConfirmation();
    assert.deepEqual(freightConfirmationReplay.data, freightConfirmation.data);
    assert.equal(freightConfirmation.data.supplierOrderId, supplierBOrderAfterReallocate.id);
    assert.equal(freightConfirmation.data.amount, '18.50');
    assert.equal(freightConfirmation.data.reason, 'Extra replenishment freight');
    assert.equal(freightConfirmation.data.status, 'PENDING');
    assert.equal(freightConfirmation.data.version, 1);
    assert.equal(freightConfirmation.data.confirmedAt, null);
    assert.equal(freightConfirmation.data.rejectedAt, null);

    const confirmFreightConfirmation = async () => {
      const response = await fetch(`${baseUrl}/freight-confirmations/${freightConfirmation.data.id}/confirm`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'confirm-freight-confirmation-once',
          'x-trace-id': 'trace-confirm-freight-confirmation',
        },
        body: JSON.stringify({
          expectedVersion: freightConfirmation.data.version,
          reason: 'Approved freight',
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: { id: string; amount: string; status: string; version: number; confirmedAt: string | null };
      };
    };
    const confirmedFreight = await confirmFreightConfirmation();
    const confirmedFreightReplay = await confirmFreightConfirmation();
    assert.deepEqual(confirmedFreightReplay.data, confirmedFreight.data);
    assert.equal(confirmedFreight.data.id, freightConfirmation.data.id);
    assert.equal(confirmedFreight.data.amount, '18.50');
    assert.equal(confirmedFreight.data.status, 'CONFIRMED');
    assert.equal(confirmedFreight.data.version, 2);
    assert.ok(confirmedFreight.data.confirmedAt);
    const persistedFreight = await prisma.freightConfirmation.findUniqueOrThrow({
      where: { id: freightConfirmation.data.id },
    });
    assert.equal(persistedFreight.status, 'CONFIRMED');

    const orderBeforeReplenishmentShipment = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: supplierBOrderAfterReallocate.id },
    });
    const createReplenishmentShipmentResponse = await fetch(`${baseUrl}/supplier-orders/${supplierBOrderAfterReallocate.id}/shipments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': 'create-replenishment-shipment-once',
        'x-trace-id': 'trace-create-replenishment-shipment',
      },
      body: JSON.stringify({
        expectedVersion: orderBeforeReplenishmentShipment.version,
        freight: '0.00',
        items: [
          {
            orderItemId: productAOrderItem.id,
            shipQuantity: '3.000000',
            permanentlyReduceQuantity: '0.000000',
          },
        ],
      }),
    });
    assert.equal(createReplenishmentShipmentResponse.status, 201);
    const replenishmentShipment = (await createReplenishmentShipmentResponse.json()) as {
      data: {
        id: string;
        kind: string;
        items: Array<{ id: string; orderItemId: string; quantity: string }>;
      };
    };
    assert.equal(replenishmentShipment.data.kind, 'REPLENISHMENT');
    const replenishmentProductA = replenishmentShipment.data.items.find((item) => item.orderItemId === productAOrderItem.id);
    assert.equal(replenishmentProductA?.quantity, '3');
    const orderAfterReplenishmentShipment = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: supplierBOrderAfterReallocate.id },
    });
    const createReplenishmentReceipt = async () => {
      const response = await fetch(`${baseUrl}/shipments/${replenishmentShipment.data.id}/receipts`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'create-replenishment-receipt-once',
          'x-trace-id': 'trace-create-replenishment-receipt',
        },
        body: JSON.stringify({
          expectedOrderVersion: orderAfterReplenishmentShipment.version,
          expectedReceiptRevision: 0,
          items: [
            {
              shipmentItemId: replenishmentProductA!.id,
              receivedQuantity: '2.000000',
            },
          ],
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as { data: { id: string; shipmentId: string } };
    };
    const replenishmentReceipt = await createReplenishmentReceipt();
    const replenishmentReceiptReplay = await createReplenishmentReceipt();
    assert.deepEqual(replenishmentReceiptReplay.data, replenishmentReceipt.data);
    const replenishmentDiscrepancy = await prisma.discrepancy.findFirstOrThrow({
      where: {
        orderItemId: productAOrderItem.id,
        receiptItem: { receiptId: replenishmentReceipt.data.id },
        status: 'OPEN',
      },
    });
    assert.equal(replenishmentDiscrepancy.missingQuantity.toString(), '1');
    const resolveReplenishmentDiscrepancy = async () => {
      const response = await fetch(`${baseUrl}/discrepancies/${replenishmentDiscrepancy.id}/resolve`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'resolve-replenishment-discrepancy-once',
          'x-trace-id': 'trace-resolve-replenishment-discrepancy',
        },
        body: JSON.stringify({
          expectedVersion: replenishmentDiscrepancy.version,
          action: 'REPLENISH',
          reason: 'Supplier will replenish shortage',
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: {
          id: string;
          status: string;
          version: number;
          resolvedAt: string | null;
          replenishmentGap: {
            id: string;
            discrepancyId: string;
            orderItemId: string;
            quantity: string;
            remainingQuantity: string;
            status: string;
            version: number;
          } | null;
        };
      };
    };
    const replenishmentResolution = await resolveReplenishmentDiscrepancy();
    const replenishmentResolutionReplay = await resolveReplenishmentDiscrepancy();
    assert.deepEqual(replenishmentResolutionReplay.data, replenishmentResolution.data);
    assert.equal(replenishmentResolution.data.id, replenishmentDiscrepancy.id);
    assert.equal(replenishmentResolution.data.status, 'REPLENISH_PENDING');
    assert.equal(replenishmentResolution.data.version, 2);
    assert.equal(replenishmentResolution.data.resolvedAt, null);
    assert.equal(replenishmentResolution.data.replenishmentGap?.discrepancyId, replenishmentDiscrepancy.id);
    assert.equal(replenishmentResolution.data.replenishmentGap?.orderItemId, productAOrderItem.id);
    assert.equal(replenishmentResolution.data.replenishmentGap?.quantity, '1');
    assert.equal(replenishmentResolution.data.replenishmentGap?.remainingQuantity, '1');
    assert.equal(replenishmentResolution.data.replenishmentGap?.status, 'PENDING');
    assert.equal(replenishmentResolution.data.replenishmentGap?.version, 1);
    const persistedGap = await prisma.replenishmentGap.findUniqueOrThrow({
      where: { discrepancyId: replenishmentDiscrepancy.id },
    });
    assert.equal(persistedGap.status, 'PENDING');
    assert.equal(persistedGap.remainingQuantity.toString(), '1');

    const orderBeforeGapShipment = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: supplierBOrderAfterReallocate.id },
    });
    const createGapShipmentResponse = await fetch(`${baseUrl}/supplier-orders/${supplierBOrderAfterReallocate.id}/shipments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': 'create-gap-shipment-once',
        'x-trace-id': 'trace-create-gap-shipment',
      },
      body: JSON.stringify({
        expectedVersion: orderBeforeGapShipment.version,
        freight: '18.50',
        freightConfirmationId: freightConfirmation.data.id,
        items: [
          {
            orderItemId: productAOrderItem.id,
            shipQuantity: '1.000000',
            permanentlyReduceQuantity: '0.000000',
            gapAllocations: [{ gapId: persistedGap.id, quantity: '1.000000' }],
          },
        ],
      }),
    });
    assert.equal(createGapShipmentResponse.status, 201);
    const gapShipment = (await createGapShipmentResponse.json()) as {
      data: {
        id: string;
        kind: string;
        freight: string;
        freightConfirmationId: string | null;
        items: Array<{
          id: string;
          orderItemId: string;
          quantity: string;
          gapAllocations: Array<{ gapId: string; quantity: string }>;
        }>;
      };
    };
    assert.equal(gapShipment.data.kind, 'REPLENISHMENT');
    assert.equal(gapShipment.data.freight, '18.50');
    assert.equal(gapShipment.data.freightConfirmationId, freightConfirmation.data.id);
    const gapShipmentProductA = gapShipment.data.items.find((item) => item.orderItemId === productAOrderItem.id);
    assert.equal(gapShipmentProductA?.quantity, '1');
    assert.deepEqual(gapShipmentProductA?.gapAllocations, [{ gapId: persistedGap.id, quantity: '1' }]);
    const filledGap = await prisma.replenishmentGap.findUniqueOrThrow({ where: { id: persistedGap.id } });
    assert.equal(filledGap.status, 'FILLED');
    assert.equal(filledGap.remainingQuantity.toString(), '0');
    assert.equal(filledGap.version, 2);
    const persistedGapAllocations = await prisma.shipmentGapAllocation.findMany({
      where: { gapId: persistedGap.id },
    });
    assert.equal(persistedGapAllocations.length, 1);
    assert.equal(persistedGapAllocations[0]?.shipmentItemId, gapShipmentProductA?.id);
    assert.equal(persistedGapAllocations[0]?.quantity.toString(), '1');
    const usedFreight = await prisma.freightConfirmation.findUniqueOrThrow({ where: { id: freightConfirmation.data.id } });
    assert.equal(usedFreight.status, 'USED');
    assert.ok(usedFreight.usedAt);
    assert.equal(usedFreight.version, 3);
    const orderBeforeGapReceipt = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: supplierBOrderAfterReallocate.id },
    });
    const createGapReceipt = async () => {
      const response = await fetch(`${baseUrl}/shipments/${gapShipment.data.id}/receipts`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'create-gap-receipt-once',
          'x-trace-id': 'trace-create-gap-receipt',
        },
        body: JSON.stringify({
          expectedOrderVersion: orderBeforeGapReceipt.version,
          expectedReceiptRevision: 0,
          items: [
            {
              shipmentItemId: gapShipmentProductA!.id,
              receivedQuantity: '1.000000',
            },
          ],
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as { data: { id: string; shipmentId: string } };
    };
    const gapReceipt = await createGapReceipt();
    const gapReceiptReplay = await createGapReceipt();
    assert.deepEqual(gapReceiptReplay.data, gapReceipt.data);
    const completedOrder = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: supplierBOrderAfterReallocate.id },
    });
    assert.equal(completedOrder.status, 'COMPLETED');
    assert.equal(completedOrder.fulfillmentStatus, 'COMPLETED');
    const replaceGapReceipt = async () => {
      const response = await fetch(`${baseUrl}/shipments/${gapShipment.data.id}/receipts`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'replace-gap-receipt-once',
          'x-trace-id': 'trace-replace-gap-receipt',
        },
        body: JSON.stringify({
          expectedOrderVersion: completedOrder.version,
          expectedReceiptRevision: 1,
          items: [
            {
              shipmentItemId: gapShipmentProductA!.id,
              receivedQuantity: '0.000000',
            },
          ],
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: { id: string; shipmentId: string; revision: number; isCurrent: boolean; items: Array<{ shipmentItemId: string; receivedQuantity: string }> };
      };
    };
    const replacementReceipt = await replaceGapReceipt();
    const replacementReceiptReplay = await replaceGapReceipt();
    assert.deepEqual(replacementReceiptReplay.data, replacementReceipt.data);
    assert.equal(replacementReceipt.data.shipmentId, gapShipment.data.id);
    assert.equal(replacementReceipt.data.revision, 2);
    assert.equal(replacementReceipt.data.isCurrent, true);
    assert.equal(replacementReceipt.data.items[0]?.receivedQuantity, '0');
    const gapReceipts = await prisma.receipt.findMany({
      where: { shipmentId: gapShipment.data.id },
      orderBy: { revision: 'asc' },
    });
    assert.equal(gapReceipts.length, 2);
    assert.equal(gapReceipts[0]?.isCurrent, false);
    assert.equal(gapReceipts[1]?.isCurrent, true);
    const returnDiscrepancy = await prisma.discrepancy.findFirstOrThrow({
      where: {
        orderItemId: productAOrderItem.id,
        receiptItem: { receiptId: replacementReceipt.data.id },
        status: 'OPEN',
      },
    });
    assert.equal(returnDiscrepancy.missingQuantity.toString(), '1');
    const orderAfterReplacement = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: supplierBOrderAfterReallocate.id },
    });
    assert.equal(orderAfterReplacement.status, 'PARTIAL_SHIPPED');
    assert.equal(orderAfterReplacement.fulfillmentStatus, 'PARTIAL_SHIPPED');
    const resolveReturnDiscrepancy = async () => {
      const response = await fetch(`${baseUrl}/discrepancies/${returnDiscrepancy.id}/resolve`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'resolve-return-discrepancy-once',
          'x-trace-id': 'trace-resolve-return-discrepancy',
        },
        body: JSON.stringify({
          expectedVersion: returnDiscrepancy.version,
          action: 'RETURN',
          reason: 'Supplier will return shortage value',
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: {
          id: string;
          orderItemId: string;
          missingQuantity: string;
          status: string;
          version: number;
          resolvedAt: string | null;
          returnRecord: { id: string; discrepancyId: string; orderItemId: string; quantity: string; reason: string | null } | null;
        };
      };
    };
    const returnedDiscrepancy = await resolveReturnDiscrepancy();
    const returnedDiscrepancyReplay = await resolveReturnDiscrepancy();
    assert.deepEqual(returnedDiscrepancyReplay.data, returnedDiscrepancy.data);
    assert.equal(returnedDiscrepancy.data.id, returnDiscrepancy.id);
    assert.equal(returnedDiscrepancy.data.orderItemId, productAOrderItem.id);
    assert.equal(returnedDiscrepancy.data.missingQuantity, '1');
    assert.equal(returnedDiscrepancy.data.status, 'RESOLVED');
    assert.equal(returnedDiscrepancy.data.version, 2);
    assert.ok(returnedDiscrepancy.data.resolvedAt);
    assert.equal(returnedDiscrepancy.data.returnRecord?.discrepancyId, returnDiscrepancy.id);
    assert.equal(returnedDiscrepancy.data.returnRecord?.orderItemId, productAOrderItem.id);
    assert.equal(returnedDiscrepancy.data.returnRecord?.quantity, '1');
    assert.equal(returnedDiscrepancy.data.returnRecord?.reason, 'Supplier will return shortage value');
    const persistedReturn = await prisma.discrepancyReturn.findUniqueOrThrow({
      where: { discrepancyId: returnDiscrepancy.id },
    });
    assert.equal(persistedReturn.quantity.toString(), '1');
    assert.equal(persistedReturn.reason, 'Supplier will return shortage value');
    const completedOrderAfterReturn = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: supplierBOrderAfterReallocate.id },
    });
    assert.equal(completedOrderAfterReturn.status, 'COMPLETED');
    assert.equal(completedOrderAfterReturn.fulfillmentStatus, 'COMPLETED');
    const supplierPayableSettlementItemId = Buffer.from(
      JSON.stringify({ kind: 'SUPPLIER_PAYABLE', supplierOrderId: supplierBOrderAfterReallocate.id }),
    ).toString('base64url');
    const createDifferenceDisposal = async () => {
      const response = await fetch(`${baseUrl}/difference-disposals`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${financeToken}`,
          'content-type': 'application/json',
          'idempotency-key': 'create-difference-disposal-once',
          'x-trace-id': 'trace-create-difference-disposal',
        },
        body: JSON.stringify({
          method: 'OFFSET',
          creditItemIds: [persistedReturn.id],
          targetDebitItemIds: [supplierPayableSettlementItemId],
          amount: '8.00',
          businessDate: '2026-09-24',
          reason: 'Offset shortage value against supplier payable',
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: {
          id: string;
          disposalNo: string;
          direction: string;
          method: string;
          storeId: string | null;
          supplierId: string | null;
          amount: string;
          businessDate: string;
          status: string;
          reason: string | null;
          version: number;
          confirmedAt: string | null;
          items: Array<{ creditItemId: string; targetDebitItemId: string | null; amount: string; sourceVersion: number }>;
        };
      };
    };
    const differenceDisposal = await createDifferenceDisposal();
    const differenceDisposalReplay = await createDifferenceDisposal();
    assert.deepEqual(differenceDisposalReplay.data, differenceDisposal.data);
    const payableWhileOffsetPendingResponse = await fetch(`${baseUrl}/payment-records/preview`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ settlementItemIds: [supplierPayableSettlementItemId] }),
    });
    assert.equal(payableWhileOffsetPendingResponse.status, 201);
    const payableWhileOffsetPending = (await payableWhileOffsetPendingResponse.json()) as {
      data: { totalPayableAmount: string; items: Array<{ payableAmount: string }> };
    };
    assert.equal(payableWhileOffsetPending.data.totalPayableAmount, '98.50');
    assert.equal(payableWhileOffsetPending.data.items[0]?.payableAmount, '98.50');
    assert.ok(differenceDisposal.data.disposalNo);
    assert.equal(differenceDisposal.data.direction, 'SUPPLIER_TO_COMPANY');
    assert.equal(differenceDisposal.data.method, 'OFFSET');
    assert.equal(differenceDisposal.data.storeId, store.id);
    assert.equal(differenceDisposal.data.supplierId, supplierB.id);
    assert.equal(differenceDisposal.data.amount, '8.00');
    assert.equal(differenceDisposal.data.businessDate, '2026-09-24');
    assert.equal(differenceDisposal.data.status, 'PENDING');
    assert.equal(differenceDisposal.data.reason, 'Offset shortage value against supplier payable');
    assert.equal(differenceDisposal.data.version, 1);
    assert.equal(differenceDisposal.data.confirmedAt, null);
    assert.equal(differenceDisposal.data.items[0]?.creditItemId, persistedReturn.id);
    assert.equal(differenceDisposal.data.items[0]?.targetDebitItemId, supplierPayableSettlementItemId);
    assert.equal(differenceDisposal.data.items[0]?.amount, '8.00');
    assert.equal(differenceDisposal.data.items[0]?.sourceVersion, completedOrderAfterReturn.version);
    const confirmDifferenceDisposal = async () => {
      const response = await fetch(`${baseUrl}/difference-disposals/${differenceDisposal.data.id}/confirm`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${financeToken}`,
          'content-type': 'application/json',
          'idempotency-key': 'confirm-difference-disposal-once',
          'x-trace-id': 'trace-confirm-difference-disposal',
        },
        body: JSON.stringify({ expectedVersion: differenceDisposal.data.version }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: { id: string; status: string; version: number; confirmedAt: string | null; amount: string };
      };
    };
    const confirmedDifferenceDisposal = await confirmDifferenceDisposal();
    const confirmedDifferenceDisposalReplay = await confirmDifferenceDisposal();
    assert.deepEqual(confirmedDifferenceDisposalReplay.data, confirmedDifferenceDisposal.data);
    assert.equal(confirmedDifferenceDisposal.data.id, differenceDisposal.data.id);
    assert.equal(confirmedDifferenceDisposal.data.status, 'CONFIRMED');
    assert.equal(confirmedDifferenceDisposal.data.version, 2);
    assert.equal(confirmedDifferenceDisposal.data.amount, '8.00');
    assert.ok(confirmedDifferenceDisposal.data.confirmedAt);
    const differenceDisposalDetailResponse = await fetch(`${baseUrl}/difference-disposals/${differenceDisposal.data.id}`, {
      headers: { authorization: `Bearer ${financeToken}` },
    });
    assert.equal(differenceDisposalDetailResponse.status, 200);
    const differenceDisposalDetail = (await differenceDisposalDetailResponse.json()) as {
      data: { id: string; status: string; amount: string; items: Array<{ creditItemId: string; amount: string }> };
    };
    assert.equal(differenceDisposalDetail.data.id, differenceDisposal.data.id);
    assert.equal(differenceDisposalDetail.data.status, 'CONFIRMED');
    assert.equal(differenceDisposalDetail.data.amount, '8.00');
    assert.equal(differenceDisposalDetail.data.items[0]?.creditItemId, persistedReturn.id);
    assert.equal(differenceDisposalDetail.data.items[0]?.amount, '8.00');
    const adjustmentsResponse = await fetch(`${baseUrl}/adjustments?storeId=${store.id}&supplierId=${supplierB.id}`, {
      headers: { authorization: `Bearer ${financeToken}` },
    });
    assert.equal(adjustmentsResponse.status, 200);
    const adjustments = (await adjustmentsResponse.json()) as {
      data: Array<{
        id: string;
        type: string;
        direction: string;
        storeId: string;
        supplierId: string;
        supplierOrderId: string;
        sourceReturnId: string;
        sourceDiscrepancyId: string;
        originalStatementId: string;
        goodsAdjustmentAmount: string;
        freightAdjustmentAmount: string;
        adjustmentAmount: string;
        pendingReturnOrOffsetAmount: string;
        processingStatus: string;
      }>;
    };
    const returnAdjustment = adjustments.data.find((adjustment) => adjustment.sourceReturnId === persistedReturn.id);
    assert.ok(returnAdjustment);
    assert.equal(returnAdjustment.type, 'RETURN_SHORTAGE');
    assert.equal(returnAdjustment.direction, 'SUPPLIER_PAYABLE_DECREASE');
    assert.equal(returnAdjustment.storeId, store.id);
    assert.equal(returnAdjustment.supplierId, supplierB.id);
    assert.equal(returnAdjustment.supplierOrderId, supplierBOrderAfterReallocate.id);
    assert.equal(returnAdjustment.sourceDiscrepancyId, returnDiscrepancy.id);
    assert.ok(returnAdjustment.originalStatementId);
    assert.equal(returnAdjustment.goodsAdjustmentAmount, '-8.00');
    assert.equal(returnAdjustment.freightAdjustmentAmount, '0.00');
    assert.equal(returnAdjustment.adjustmentAmount, '-8.00');
    assert.equal(returnAdjustment.pendingReturnOrOffsetAmount, '0.00');
    assert.equal(returnAdjustment.processingStatus, 'DISPOSED');
    const adjustmentDetailResponse = await fetch(`${baseUrl}/adjustments/${returnAdjustment.id}`, {
      headers: { authorization: `Bearer ${financeToken}` },
    });
    assert.equal(adjustmentDetailResponse.status, 200);
    const adjustmentDetail = (await adjustmentDetailResponse.json()) as {
      data: {
        id: string;
        processingStatus: string;
        lines: Array<{ orderItemId: string; quantity: string; unitSupplyPrice: string; supplyAdjustmentAmount: string }>;
        disposal: { disposalId: string; status: string; amount: string } | null;
      };
    };
    assert.equal(adjustmentDetail.data.id, returnAdjustment.id);
    assert.equal(adjustmentDetail.data.processingStatus, 'DISPOSED');
    assert.equal(adjustmentDetail.data.lines[0]?.orderItemId, productAOrderItem.id);
    assert.equal(adjustmentDetail.data.lines[0]?.quantity, '1');
    assert.equal(adjustmentDetail.data.lines[0]?.unitSupplyPrice, '8.00');
    assert.equal(adjustmentDetail.data.lines[0]?.supplyAdjustmentAmount, '-8.00');
    assert.equal(adjustmentDetail.data.disposal?.disposalId, differenceDisposal.data.id);
    assert.equal(adjustmentDetail.data.disposal?.status, 'CONFIRMED');
    assert.equal(adjustmentDetail.data.disposal?.amount, '8.00');
    const adjustmentCredit = await prisma.adjustmentDocument.create({
      data: {
        sourcePriceChangeId: crypto.randomUUID(), supplierOrderId: supplierBOrderAfterReallocate.id,
        storeId: store.id, supplierId: supplierB.id, side: 'SUPPLIER', amount: '-5.00',
        originalPeriodKey: 'test:original', settlementPeriodKey: 'test:current', sourceRevision: 1,
      },
    });
    const adjustmentTarget = await prisma.adjustmentDocument.create({
      data: {
        sourcePriceChangeId: crypto.randomUUID(), supplierOrderId: supplierBOrderAfterReallocate.id,
        storeId: store.id, supplierId: supplierB.id, side: 'SUPPLIER', amount: '10.00',
        originalPeriodKey: 'test:original', settlementPeriodKey: 'test:current', sourceRevision: 2,
      },
    });
    const adjustmentTargetId = Buffer.from(JSON.stringify({
      kind: 'ADJUSTMENT', supplierOrderId: supplierBOrderAfterReallocate.id,
      adjustmentDocumentId: adjustmentTarget.id, adjustmentSide: 'SUPPLIER',
    })).toString('base64url');
    const adjustmentOffsetResponse = await fetch(`${baseUrl}/difference-disposals`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${financeToken}`, 'content-type': 'application/json',
        'idempotency-key': 'offset-adjustment-credit-once', 'x-trace-id': 'trace-offset-adjustment-credit',
      },
      body: JSON.stringify({
        method: 'OFFSET', creditItemIds: [adjustmentCredit.id], targetDebitItemIds: [adjustmentTargetId],
        amount: '5.00', businessDate: '2026-09-24', reason: 'Offset negative adjustment against positive adjustment',
      }),
    });
    assert.equal(adjustmentOffsetResponse.status, 201);
    const adjustmentOffset = (await adjustmentOffsetResponse.json()) as {
      data: { status: string; amount: string; items: Array<{ adjustmentDocumentId: string; targetDebitItemId: string }> };
    };
    assert.equal(adjustmentOffset.data.status, 'PENDING');
    assert.equal(adjustmentOffset.data.amount, '5.00');
    assert.equal(adjustmentOffset.data.items[0]?.adjustmentDocumentId, adjustmentCredit.id);
    assert.equal(adjustmentOffset.data.items[0]?.targetDebitItemId, adjustmentTargetId);
    const storeStatementsResponse = await fetch(`${baseUrl}/store-statements?storeId=${store.id}&supplierId=${supplierB.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(storeStatementsResponse.status, 200);
    const storeStatements = (await storeStatementsResponse.json()) as {
      data: Array<{
        id: string;
        type: string;
        storeId: string;
        supplierId: string;
        cycle: string;
        settlementStatus: string;
        goodsAmount: string;
        freightAmount: string;
        totalAmount: string;
        payableAmount: string;
        lineCount: number;
      }>;
    };
    const storeStatement = storeStatements.data.find((statement) => statement.supplierId === supplierB.id);
    assert.ok(storeStatement);
    assert.equal(storeStatement.type, 'STORE');
    assert.equal(storeStatement.storeId, store.id);
    assert.equal(storeStatement.cycle, 'MONTHLY');
    assert.equal(storeStatement.settlementStatus, 'OPEN');
    assert.equal(storeStatement.goodsAmount, '120.00');
    assert.equal(storeStatement.freightAmount, '18.50');
    assert.equal(storeStatement.totalAmount, '138.50');
    assert.equal(storeStatement.payableAmount, '138.50');
    assert.equal(storeStatement.lineCount, 1);
    const storeStatementDetailResponse = await fetch(`${baseUrl}/store-statements/${storeStatement.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(storeStatementDetailResponse.status, 200);
    const storeStatementDetail = (await storeStatementDetailResponse.json()) as {
      data: {
        id: string;
        goodsAmount: string;
        freightAmount: string;
        totalAmount: string;
        lines: Array<{ settlementItemId: string; supplierOrderId: string; goodsAmount: string; freightAmount: string; totalAmount: string }>;
      };
    };
    assert.equal(storeStatementDetail.data.id, storeStatement.id);
    assert.equal(storeStatementDetail.data.goodsAmount, '120.00');
    assert.equal(storeStatementDetail.data.freightAmount, '18.50');
    assert.equal(storeStatementDetail.data.totalAmount, '138.50');
    assert.equal(storeStatementDetail.data.lines[0]?.supplierOrderId, supplierBOrderAfterReallocate.id);
    assert.equal(storeStatementDetail.data.lines[0]?.goodsAmount, '120.00');
    assert.equal(storeStatementDetail.data.lines[0]?.freightAmount, '18.50');
    assert.equal(storeStatementDetail.data.lines[0]?.totalAmount, '138.50');
    const storePaymentPreviewResponse = await fetch(`${baseUrl}/payment-records/preview`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        settlementItemIds: [storeStatementDetail.data.lines[0]!.settlementItemId],
      }),
    });
    assert.equal(storePaymentPreviewResponse.status, 201);
    const storePaymentPreview = (await storePaymentPreviewResponse.json()) as {
      data: {
        direction: string;
        channel: string;
        storeId: string | null;
        supplierId: string | null;
        totalPayableAmount: string;
        totalPendingPaymentAmount: string;
        totalConfirmedPaidAmount: string;
        items: Array<{ settlementItemId: string; kind: string; supplierOrderId: string; sourceVersion: number; payableAmount: string }>;
        blockedItems: unknown[];
      };
    };
    assert.equal(storePaymentPreview.data.direction, 'STORE_TO_COMPANY');
    assert.equal(storePaymentPreview.data.channel, 'COMPANY');
    assert.equal(storePaymentPreview.data.storeId, store.id);
    assert.equal(storePaymentPreview.data.supplierId, null);
    assert.equal(storePaymentPreview.data.totalPayableAmount, '138.50');
    assert.equal(storePaymentPreview.data.totalPendingPaymentAmount, '0.00');
    assert.equal(storePaymentPreview.data.totalConfirmedPaidAmount, '0.00');
    assert.equal(storePaymentPreview.data.items[0]?.settlementItemId, storeStatementDetail.data.lines[0]?.settlementItemId);
    assert.equal(storePaymentPreview.data.items[0]?.kind, 'STORE_RECEIVABLE');
    assert.equal(storePaymentPreview.data.items[0]?.supplierOrderId, supplierBOrderAfterReallocate.id);
    assert.equal(storePaymentPreview.data.items[0]?.sourceVersion, completedOrderAfterReturn.version);
    assert.equal(storePaymentPreview.data.items[0]?.payableAmount, '138.50');
    assert.equal(storePaymentPreview.data.blockedItems.length, 0);
    const createStorePayment = async () => {
      const response = await fetch(`${baseUrl}/payment-records`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'create-store-payment-once',
          'x-trace-id': 'trace-create-store-payment',
        },
        body: JSON.stringify({
          direction: 'STORE_TO_COMPANY',
          businessDate: '2026-09-24',
          remark: 'Store pays company for completed order',
          items: [
            {
              settlementItemId: storePaymentPreview.data.items[0]!.settlementItemId,
              expectedVersion: storePaymentPreview.data.items[0]!.sourceVersion,
              expectedAmount: storePaymentPreview.data.items[0]!.payableAmount,
            },
          ],
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: {
          id: string;
          paymentNo: string;
          direction: string;
          channel: string;
          storeId: string | null;
          supplierId: string | null;
          amount: string;
          businessDate: string;
          status: string;
          remark: string | null;
          version: number;
          allocations: Array<{ settlementItemId: string; supplierOrderId: string; amount: string; sourceVersion: number; state: string }>;
        };
      };
    };
    const storePayment = await createStorePayment();
    const storePaymentReplay = await createStorePayment();
    assert.deepEqual(storePaymentReplay.data, storePayment.data);
    assert.ok(storePayment.data.paymentNo);
    assert.equal(storePayment.data.direction, 'STORE_TO_COMPANY');
    assert.equal(storePayment.data.channel, 'COMPANY');
    assert.equal(storePayment.data.storeId, store.id);
    assert.equal(storePayment.data.supplierId, null);
    assert.equal(storePayment.data.amount, '138.50');
    assert.equal(storePayment.data.businessDate, '2026-09-24');
    assert.equal(storePayment.data.status, 'PENDING');
    assert.equal(storePayment.data.remark, 'Store pays company for completed order');
    assert.equal(storePayment.data.version, 1);
    assert.equal(storePayment.data.allocations[0]?.settlementItemId, storePaymentPreview.data.items[0]?.settlementItemId);
    assert.equal(storePayment.data.allocations[0]?.supplierOrderId, supplierBOrderAfterReallocate.id);
    assert.equal(storePayment.data.allocations[0]?.amount, '138.50');
    assert.equal(storePayment.data.allocations[0]?.sourceVersion, completedOrderAfterReturn.version);
    assert.equal(storePayment.data.allocations[0]?.state, 'RESERVED');
    const storePaymentPreviewAfterReserveResponse = await fetch(`${baseUrl}/payment-records/preview`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        settlementItemIds: [storeStatementDetail.data.lines[0]!.settlementItemId],
      }),
    });
    assert.equal(storePaymentPreviewAfterReserveResponse.status, 201);
    const storePaymentPreviewAfterReserve = (await storePaymentPreviewAfterReserveResponse.json()) as {
      data: {
        totalPayableAmount: string;
        totalPendingPaymentAmount: string;
        totalConfirmedPaidAmount: string;
        items: Array<{ payableAmount: string; pendingPaymentAmount: string; confirmedPaidAmount: string }>;
      };
    };
    assert.equal(storePaymentPreviewAfterReserve.data.totalPayableAmount, '0.00');
    assert.equal(storePaymentPreviewAfterReserve.data.totalPendingPaymentAmount, '138.50');
    assert.equal(storePaymentPreviewAfterReserve.data.totalConfirmedPaidAmount, '0.00');
    assert.equal(storePaymentPreviewAfterReserve.data.items[0]?.payableAmount, '0.00');
    assert.equal(storePaymentPreviewAfterReserve.data.items[0]?.pendingPaymentAmount, '138.50');
    assert.equal(storePaymentPreviewAfterReserve.data.items[0]?.confirmedPaidAmount, '0.00');
    const confirmStorePayment = async () => {
      const response = await fetch(`${baseUrl}/payment-records/${storePayment.data.id}/confirm`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'confirm-store-payment-once',
          'x-trace-id': 'trace-confirm-store-payment',
        },
        body: JSON.stringify({
          expectedVersion: storePayment.data.version,
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: {
          id: string;
          status: string;
          version: number;
          allocations: Array<{ settlementItemId: string; amount: string; state: string }>;
        };
      };
    };
    const confirmedStorePayment = await confirmStorePayment();
    const confirmedStorePaymentReplay = await confirmStorePayment();
    assert.deepEqual(confirmedStorePaymentReplay.data, confirmedStorePayment.data);
    assert.equal(confirmedStorePayment.data.id, storePayment.data.id);
    assert.equal(confirmedStorePayment.data.status, 'CONFIRMED');
    assert.equal(confirmedStorePayment.data.version, 2);
    assert.equal(confirmedStorePayment.data.allocations[0]?.settlementItemId, storePaymentPreview.data.items[0]?.settlementItemId);
    assert.equal(confirmedStorePayment.data.allocations[0]?.amount, '138.50');
    assert.equal(confirmedStorePayment.data.allocations[0]?.state, 'CONFIRMED');
    const storeSnapshot = await prisma.settlementItemSnapshot.findUnique({
      where: { settlementItemId: storePaymentPreview.data.items[0]!.settlementItemId },
    });
    assert.equal(storeSnapshot?.goodsAmount.toFixed(2), '120.00');
    assert.equal(storeSnapshot?.freightAmount.toFixed(2), '18.50');
    await prisma.supplierOrder.update({
      where: { id: storeStatementDetail.data.lines[0]!.supplierOrderId },
      data: { salesGoodsAmount: '121.00' },
    });
    const storePaymentPreviewAfterConfirmResponse = await fetch(`${baseUrl}/payment-records/preview`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        settlementItemIds: [storeStatementDetail.data.lines[0]!.settlementItemId],
      }),
    });
    assert.equal(storePaymentPreviewAfterConfirmResponse.status, 201);
    const storePaymentPreviewAfterConfirm = (await storePaymentPreviewAfterConfirmResponse.json()) as {
      data: {
        totalPayableAmount: string;
        totalPendingPaymentAmount: string;
        totalConfirmedPaidAmount: string;
        items: Array<{ payableAmount: string; pendingPaymentAmount: string; confirmedPaidAmount: string }>;
      };
    };
    assert.equal(storePaymentPreviewAfterConfirm.data.totalPayableAmount, '0.00');
    assert.equal(storePaymentPreviewAfterConfirm.data.totalPendingPaymentAmount, '0.00');
    assert.equal(storePaymentPreviewAfterConfirm.data.totalConfirmedPaidAmount, '138.50');
    assert.equal(storePaymentPreviewAfterConfirm.data.items[0]?.payableAmount, '0.00');
    assert.equal(storePaymentPreviewAfterConfirm.data.items[0]?.pendingPaymentAmount, '0.00');
    assert.equal(storePaymentPreviewAfterConfirm.data.items[0]?.confirmedPaidAmount, '138.50');
    const settledStoreStatementResponse = await fetch(`${baseUrl}/store-statements/${storeStatement.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(settledStoreStatementResponse.status, 200);
    const settledStoreStatement = (await settledStoreStatementResponse.json()) as {
      data: { goodsAmount: string; totalAmount: string; lines: Array<{ goodsAmount: string; totalAmount: string }> };
    };
    assert.equal(settledStoreStatement.data.goodsAmount, '120.00');
    assert.equal(settledStoreStatement.data.totalAmount, '138.50');
    assert.equal(settledStoreStatement.data.lines[0]?.goodsAmount, '120.00');
    await prisma.supplierOrder.update({
      where: { id: storeStatementDetail.data.lines[0]!.supplierOrderId },
      data: { salesGoodsAmount: '120.00' },
    });
    const storePaymentDetailResponse = await fetch(`${baseUrl}/payment-records/${storePayment.data.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(storePaymentDetailResponse.status, 200);
    const storePaymentDetail = (await storePaymentDetailResponse.json()) as {
      data: {
        id: string;
        status: string;
        amount: string;
        allocations: Array<{ settlementItemId: string; state: string }>;
      };
    };
    assert.equal(storePaymentDetail.data.id, storePayment.data.id);
    assert.equal(storePaymentDetail.data.status, 'CONFIRMED');
    assert.equal(storePaymentDetail.data.amount, '138.50');
    assert.equal(storePaymentDetail.data.allocations[0]?.settlementItemId, storePaymentPreview.data.items[0]?.settlementItemId);
    assert.equal(storePaymentDetail.data.allocations[0]?.state, 'CONFIRMED');
    const supplierStatementsResponse = await fetch(`${baseUrl}/supplier-statements?supplierId=${supplierB.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(supplierStatementsResponse.status, 200);
    const supplierStatements = (await supplierStatementsResponse.json()) as {
      data: Array<{
        id: string;
        type: string;
        supplierId: string;
        cycle: string;
        settlementStatus: string;
        goodsAmount: string;
        freightAmount: string;
        totalAmount: string;
        payableAmount: string;
        storeCount: number;
        lineCount: number;
      }>;
    };
    const supplierStatement = supplierStatements.data.find((statement) => statement.supplierId === supplierB.id);
    assert.ok(supplierStatement);
    assert.equal(supplierStatement.type, 'SUPPLIER_TOTAL');
    assert.equal(supplierStatement.cycle, 'MONTHLY');
    assert.equal(supplierStatement.settlementStatus, 'OPEN');
    assert.equal(supplierStatement.goodsAmount, '88.00');
    assert.equal(supplierStatement.freightAmount, '18.50');
    assert.equal(supplierStatement.totalAmount, '106.50');
    assert.equal(supplierStatement.payableAmount, '106.50');
    assert.equal(supplierStatement.storeCount, 1);
    assert.equal(supplierStatement.lineCount, 1);
    const supplierStatementDetailResponse = await fetch(`${baseUrl}/supplier-statements/${supplierStatement.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(supplierStatementDetailResponse.status, 200);
    const supplierStatementDetail = (await supplierStatementDetailResponse.json()) as {
      data: {
        id: string;
        goodsAmount: string;
        freightAmount: string;
        totalAmount: string;
        lines: Array<{ settlementItemId: string; supplierOrderId: string; storeId: string; goodsAmount: string; freightAmount: string; totalAmount: string }>;
      };
    };
    assert.equal(supplierStatementDetail.data.id, supplierStatement.id);
    assert.equal(supplierStatementDetail.data.goodsAmount, '88.00');
    assert.equal(supplierStatementDetail.data.freightAmount, '18.50');
    assert.equal(supplierStatementDetail.data.totalAmount, '106.50');
    assert.equal(supplierStatementDetail.data.lines[0]?.settlementItemId, supplierPayableSettlementItemId);
    assert.equal(supplierStatementDetail.data.lines[0]?.supplierOrderId, supplierBOrderAfterReallocate.id);
    assert.equal(supplierStatementDetail.data.lines[0]?.storeId, store.id);
    assert.equal(supplierStatementDetail.data.lines[0]?.goodsAmount, '88.00');
    assert.equal(supplierStatementDetail.data.lines[0]?.freightAmount, '18.50');
    assert.equal(supplierStatementDetail.data.lines[0]?.totalAmount, '106.50');
    const supplierPaymentPreviewResponse = await fetch(`${baseUrl}/payment-records/preview`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        settlementItemIds: [supplierStatementDetail.data.lines[0]!.settlementItemId],
      }),
    });
    assert.equal(supplierPaymentPreviewResponse.status, 201);
    const supplierPaymentPreview = (await supplierPaymentPreviewResponse.json()) as {
      data: {
        direction: string;
        channel: string;
        storeId: string | null;
        supplierId: string | null;
        totalPayableAmount: string;
        items: Array<{ settlementItemId: string; kind: string; supplierOrderId: string; sourceVersion: number; payableAmount: string }>;
        blockedItems: unknown[];
      };
    };
    assert.equal(supplierPaymentPreview.data.direction, 'COMPANY_TO_SUPPLIER');
    assert.equal(supplierPaymentPreview.data.channel, 'COMPANY');
    assert.equal(supplierPaymentPreview.data.storeId, null);
    assert.equal(supplierPaymentPreview.data.supplierId, supplierB.id);
    assert.equal(supplierPaymentPreview.data.totalPayableAmount, '98.50');
    assert.equal(supplierPaymentPreview.data.items[0]?.settlementItemId, supplierStatementDetail.data.lines[0]?.settlementItemId);
    assert.equal(supplierPaymentPreview.data.items[0]?.kind, 'SUPPLIER_PAYABLE');
    assert.equal(supplierPaymentPreview.data.items[0]?.supplierOrderId, supplierBOrderAfterReallocate.id);
    assert.equal(supplierPaymentPreview.data.items[0]?.sourceVersion, completedOrderAfterReturn.version);
    assert.equal(supplierPaymentPreview.data.items[0]?.payableAmount, '98.50');
    assert.equal(supplierPaymentPreview.data.blockedItems.length, 0);
    const createSupplierPayment = async (idempotencyKey: string, traceId: string) => {
      const response = await fetch(`${baseUrl}/payment-records`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
          'x-trace-id': traceId,
        },
        body: JSON.stringify({
          direction: 'COMPANY_TO_SUPPLIER',
          businessDate: '2026-09-24',
          remark: 'Company pays supplier for completed order',
          items: [
            {
              settlementItemId: supplierPaymentPreview.data.items[0]!.settlementItemId,
              expectedVersion: supplierPaymentPreview.data.items[0]!.sourceVersion,
              expectedAmount: supplierPaymentPreview.data.items[0]!.payableAmount,
            },
          ],
        }),
      });
      return { status: response.status, body: (await response.json()) as {
        data: {
          id: string;
          direction: string;
          supplierId: string | null;
          amount: string;
          status: string;
          version: number;
          allocations: Array<{ settlementItemId: string; amount: string; state: string }>;
        };
      } };
    };
    const concurrentSupplierPayments = await Promise.all([
      createSupplierPayment('create-supplier-payment-at13-a', 'trace-create-supplier-payment-at13-a'),
      createSupplierPayment('create-supplier-payment-at13-b', 'trace-create-supplier-payment-at13-b'),
    ]);
    assert.deepEqual(concurrentSupplierPayments.map((result) => result.status).sort(), [201, 409]);
    const winner = concurrentSupplierPayments.find((result) => result.status === 201)!;
    const winnerKey = concurrentSupplierPayments[0]?.status === 201
      ? 'create-supplier-payment-at13-a'
      : 'create-supplier-payment-at13-b';
    const supplierPayment = winner.body;
    const supplierPaymentReplay = (await createSupplierPayment(winnerKey, 'trace-create-supplier-payment-replay')).body;
    assert.deepEqual(supplierPaymentReplay.data, supplierPayment.data);
    assert.equal(supplierPayment.data.direction, 'COMPANY_TO_SUPPLIER');
    assert.equal(supplierPayment.data.supplierId, supplierB.id);
    assert.equal(supplierPayment.data.amount, '98.50');
    assert.equal(supplierPayment.data.status, 'PENDING');
    assert.equal(supplierPayment.data.allocations[0]?.settlementItemId, supplierPaymentPreview.data.items[0]?.settlementItemId);
    assert.equal(supplierPayment.data.allocations[0]?.amount, '98.50');
    assert.equal(supplierPayment.data.allocations[0]?.state, 'RESERVED');
    const rejectSupplierPayment = async () => {
      const response = await fetch(`${baseUrl}/payment-records/${supplierPayment.data.id}/reject`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'reject-supplier-payment-once',
          'x-trace-id': 'trace-reject-supplier-payment',
        },
        body: JSON.stringify({
          expectedVersion: supplierPayment.data.version,
          reason: 'Supplier bank proof was invalid',
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: {
          id: string;
          status: string;
          rejectedReason: string | null;
          version: number;
          allocations: Array<{ settlementItemId: string; amount: string; state: string }>;
        };
      };
    };
    const rejectedSupplierPayment = await rejectSupplierPayment();
    const rejectedSupplierPaymentReplay = await rejectSupplierPayment();
    assert.deepEqual(rejectedSupplierPaymentReplay.data, rejectedSupplierPayment.data);
    assert.equal(rejectedSupplierPayment.data.id, supplierPayment.data.id);
    assert.equal(rejectedSupplierPayment.data.status, 'REJECTED');
    assert.equal(rejectedSupplierPayment.data.rejectedReason, 'Supplier bank proof was invalid');
    assert.equal(rejectedSupplierPayment.data.version, 2);
    assert.equal(rejectedSupplierPayment.data.allocations[0]?.settlementItemId, supplierPaymentPreview.data.items[0]?.settlementItemId);
    assert.equal(rejectedSupplierPayment.data.allocations[0]?.amount, '98.50');
    assert.equal(rejectedSupplierPayment.data.allocations[0]?.state, 'RELEASED');
    const supplierPaymentPreviewAfterRejectResponse = await fetch(`${baseUrl}/payment-records/preview`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        settlementItemIds: [supplierStatementDetail.data.lines[0]!.settlementItemId],
      }),
    });
    assert.equal(supplierPaymentPreviewAfterRejectResponse.status, 201);
    const supplierPaymentPreviewAfterReject = (await supplierPaymentPreviewAfterRejectResponse.json()) as {
      data: {
        totalPayableAmount: string;
        totalPendingPaymentAmount: string;
        totalConfirmedPaidAmount: string;
        items: Array<{ payableAmount: string; pendingPaymentAmount: string; confirmedPaidAmount: string }>;
      };
    };
    assert.equal(supplierPaymentPreviewAfterReject.data.totalPayableAmount, '98.50');
    assert.equal(supplierPaymentPreviewAfterReject.data.totalPendingPaymentAmount, '0.00');
    assert.equal(supplierPaymentPreviewAfterReject.data.totalConfirmedPaidAmount, '0.00');
    assert.equal(supplierPaymentPreviewAfterReject.data.items[0]?.payableAmount, '98.50');
    assert.equal(supplierPaymentPreviewAfterReject.data.items[0]?.pendingPaymentAmount, '0.00');
    assert.equal(supplierPaymentPreviewAfterReject.data.items[0]?.confirmedPaidAmount, '0.00');
    const createSupplierPaymentForCancel = async () => {
      const response = await fetch(`${baseUrl}/payment-records`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'create-supplier-payment-cancel-once',
          'x-trace-id': 'trace-create-supplier-payment-cancel',
        },
        body: JSON.stringify({
          direction: 'COMPANY_TO_SUPPLIER',
          businessDate: '2026-09-24',
          remark: 'Company payment to cancel',
          items: [
            {
              settlementItemId: supplierPaymentPreview.data.items[0]!.settlementItemId,
              expectedVersion: supplierPaymentPreview.data.items[0]!.sourceVersion,
              expectedAmount: supplierPaymentPreviewAfterReject.data.items[0]!.payableAmount,
            },
          ],
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: {
          id: string;
          amount: string;
          status: string;
          version: number;
          allocations: Array<{ settlementItemId: string; amount: string; state: string }>;
        };
      };
    };
    const supplierPaymentForCancel = await createSupplierPaymentForCancel();
    const supplierPaymentForCancelReplay = await createSupplierPaymentForCancel();
    assert.deepEqual(supplierPaymentForCancelReplay.data, supplierPaymentForCancel.data);
    assert.equal(supplierPaymentForCancel.data.amount, '98.50');
    assert.equal(supplierPaymentForCancel.data.status, 'PENDING');
    assert.equal(supplierPaymentForCancel.data.allocations[0]?.state, 'RESERVED');
    const cancelSupplierPayment = async () => {
      const response = await fetch(`${baseUrl}/payment-records/${supplierPaymentForCancel.data.id}/cancel`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'cancel-supplier-payment-once',
          'x-trace-id': 'trace-cancel-supplier-payment',
        },
        body: JSON.stringify({
          expectedVersion: supplierPaymentForCancel.data.version,
          reason: 'Entered by mistake',
        }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: {
          id: string;
          status: string;
          cancelledReason: string | null;
          version: number;
          allocations: Array<{ settlementItemId: string; amount: string; state: string }>;
        };
      };
    };
    const cancelledSupplierPayment = await cancelSupplierPayment();
    const cancelledSupplierPaymentReplay = await cancelSupplierPayment();
    assert.deepEqual(cancelledSupplierPaymentReplay.data, cancelledSupplierPayment.data);
    assert.equal(cancelledSupplierPayment.data.id, supplierPaymentForCancel.data.id);
    assert.equal(cancelledSupplierPayment.data.status, 'CANCELLED');
    assert.equal(cancelledSupplierPayment.data.cancelledReason, 'Entered by mistake');
    assert.equal(cancelledSupplierPayment.data.version, 2);
    assert.equal(cancelledSupplierPayment.data.allocations[0]?.settlementItemId, supplierPaymentPreview.data.items[0]?.settlementItemId);
    assert.equal(cancelledSupplierPayment.data.allocations[0]?.amount, '98.50');
    assert.equal(cancelledSupplierPayment.data.allocations[0]?.state, 'RELEASED');
    const supplierPaymentPreviewAfterCancelResponse = await fetch(`${baseUrl}/payment-records/preview`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        settlementItemIds: [supplierStatementDetail.data.lines[0]!.settlementItemId],
      }),
    });
    assert.equal(supplierPaymentPreviewAfterCancelResponse.status, 201);
    const supplierPaymentPreviewAfterCancel = (await supplierPaymentPreviewAfterCancelResponse.json()) as {
      data: {
        totalPayableAmount: string;
        totalPendingPaymentAmount: string;
        totalConfirmedPaidAmount: string;
        items: Array<{ payableAmount: string; pendingPaymentAmount: string; confirmedPaidAmount: string }>;
      };
    };
    assert.equal(supplierPaymentPreviewAfterCancel.data.totalPayableAmount, '98.50');
    assert.equal(supplierPaymentPreviewAfterCancel.data.totalPendingPaymentAmount, '0.00');
    assert.equal(supplierPaymentPreviewAfterCancel.data.totalConfirmedPaidAmount, '0.00');
    assert.equal(supplierPaymentPreviewAfterCancel.data.items[0]?.payableAmount, '98.50');
    assert.equal(supplierPaymentPreviewAfterCancel.data.items[0]?.pendingPaymentAmount, '0.00');
    assert.equal(supplierPaymentPreviewAfterCancel.data.items[0]?.confirmedPaidAmount, '0.00');
    const supplierPaymentsResponse = await fetch(`${baseUrl}/payment-records?supplierId=${supplierB.id}&direction=COMPANY_TO_SUPPLIER`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(supplierPaymentsResponse.status, 200);
    const supplierPayments = (await supplierPaymentsResponse.json()) as {
      data: Array<{ id: string; supplierId: string | null; direction: string; status: string; amount: string }>;
    };
    assert.ok(supplierPayments.data.some((payment) => payment.id === supplierPayment.data.id && payment.status === 'REJECTED'));
    assert.ok(supplierPayments.data.some((payment) => payment.id === supplierPaymentForCancel.data.id && payment.status === 'CANCELLED'));
    assert.ok(
      supplierPayments.data.every(
        (payment) => payment.supplierId === supplierB.id && payment.direction === 'COMPANY_TO_SUPPLIER' && payment.amount === '98.50',
      ),
    );
    const supplierStoreStatementsResponse = await fetch(
      `${baseUrl}/supplier-store-statements?supplierId=${supplierB.id}&storeId=${store.id}`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    assert.equal(supplierStoreStatementsResponse.status, 200);
    const supplierStoreStatements = (await supplierStoreStatementsResponse.json()) as {
      data: Array<{
        id: string;
        parentStatementId: string;
        type: string;
        storeId: string;
        supplierId: string;
        cycle: string;
        settlementStatus: string;
        goodsAmount: string;
        freightAmount: string;
        totalAmount: string;
        payableAmount: string;
        lineCount: number;
      }>;
    };
    const supplierStoreStatement = supplierStoreStatements.data.find((statement) => statement.supplierId === supplierB.id);
    assert.ok(supplierStoreStatement);
    assert.equal(supplierStoreStatement.parentStatementId, supplierStatement.id);
    assert.equal(supplierStoreStatement.type, 'SUPPLIER_STORE');
    assert.equal(supplierStoreStatement.storeId, store.id);
    assert.equal(supplierStoreStatement.cycle, 'MONTHLY');
    assert.equal(supplierStoreStatement.settlementStatus, 'OPEN');
    assert.equal(supplierStoreStatement.goodsAmount, '88.00');
    assert.equal(supplierStoreStatement.freightAmount, '18.50');
    assert.equal(supplierStoreStatement.totalAmount, '106.50');
    assert.equal(supplierStoreStatement.payableAmount, '106.50');
    assert.equal(supplierStoreStatement.lineCount, 1);
    const supplierStoreStatementDetailResponse = await fetch(`${baseUrl}/supplier-store-statements/${supplierStoreStatement.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(supplierStoreStatementDetailResponse.status, 200);
    const supplierStoreStatementDetail = (await supplierStoreStatementDetailResponse.json()) as {
      data: {
        id: string;
        parentStatementId: string;
        goodsAmount: string;
        freightAmount: string;
        totalAmount: string;
        lines: Array<{ settlementItemId: string; supplierOrderId: string; goodsAmount: string; freightAmount: string; totalAmount: string }>;
      };
    };
    assert.equal(supplierStoreStatementDetail.data.id, supplierStoreStatement.id);
    assert.equal(supplierStoreStatementDetail.data.parentStatementId, supplierStatement.id);
    assert.equal(supplierStoreStatementDetail.data.goodsAmount, '88.00');
    assert.equal(supplierStoreStatementDetail.data.freightAmount, '18.50');
    assert.equal(supplierStoreStatementDetail.data.totalAmount, '106.50');
    assert.equal(supplierStoreStatementDetail.data.lines[0]?.supplierOrderId, supplierBOrderAfterReallocate.id);
    assert.equal(supplierStoreStatementDetail.data.lines[0]?.settlementItemId, supplierStatementDetail.data.lines[0]?.settlementItemId);
    assert.equal(supplierStoreStatementDetail.data.lines[0]?.goodsAmount, '88.00');
    assert.equal(supplierStoreStatementDetail.data.lines[0]?.freightAmount, '18.50');
    assert.equal(supplierStoreStatementDetail.data.lines[0]?.totalAmount, '106.50');
    const storeGoodsTotal = supplierStoreStatements.data.reduce((sum, statement) => sum + Number(statement.goodsAmount), 0).toFixed(2);
    const storeFreightTotal = supplierStoreStatements.data.reduce((sum, statement) => sum + Number(statement.freightAmount), 0).toFixed(2);
    const storeTotal = supplierStoreStatements.data.reduce((sum, statement) => sum + Number(statement.totalAmount), 0).toFixed(2);
    assert.equal(storeGoodsTotal, supplierStatement.goodsAmount);
    assert.equal(storeFreightTotal, supplierStatement.freightAmount);
    assert.equal(storeTotal, supplierStatement.totalAmount);

    const commands = await prisma.commandRecord.findMany({
      where: { actorUserId: user.id, action: 'purchase-request.confirm', idempotencyKey: 'confirm-request-once' },
    });
    assert.equal(commands.length, 1);
    const rejectCommands = await prisma.commandRecord.findMany({
      where: { actorUserId: user.id, action: 'supplier-order.reject', idempotencyKey: 'reject-supplier-order-once' },
    });
    assert.equal(rejectCommands.length, 1);
  } finally {
    await app.close();
    await prisma.commandRecord.deleteMany({ where: { actor: { username: purchaserUsername } } });
    await prisma.commandRecord.deleteMany({ where: { actor: { username: financeUsername } } });
    await prisma.paymentAllocation.deleteMany({
      where: { supplierOrder: { request: { store: { code: storeCode } } } },
    });
    await prisma.paymentRecord.deleteMany({
      where: {
        OR: [
          { storeId: { in: (await prisma.store.findMany({ where: { code: storeCode }, select: { id: true } })).map((store) => store.id) } },
          { supplierId: { in: (await prisma.supplier.findMany({ where: { code: { in: [supplierCodeA, supplierCodeB] } }, select: { id: true } })).map((supplier) => supplier.id) } },
        ],
      },
    });
    await prisma.differenceDisposalItem.deleteMany({
      where: { discrepancyReturn: { orderItem: { supplierOrder: { request: { store: { code: storeCode } } } } } },
    });
    await prisma.differenceDisposal.deleteMany({
      where: { storeId: { in: (await prisma.store.findMany({ where: { code: storeCode }, select: { id: true } })).map((store) => store.id) } },
    });
    await prisma.freightConfirmation.deleteMany({
      where: { supplierOrder: { request: { store: { code: storeCode } } } },
    });
    await prisma.shipmentGapAllocation.deleteMany({
      where: { shipmentItem: { shipment: { supplierOrder: { request: { store: { code: storeCode } } } } } },
    });
    await prisma.replenishmentGap.deleteMany({
      where: { orderItem: { supplierOrder: { request: { store: { code: storeCode } } } } },
    });
    await prisma.discrepancyReturn.deleteMany({
      where: { orderItem: { supplierOrder: { request: { store: { code: storeCode } } } } },
    });
    await prisma.discrepancyAction.deleteMany({ where: { discrepancy: { orderItem: { supplierOrder: { request: { store: { code: storeCode } } } } } } });
    await prisma.discrepancy.deleteMany({ where: { orderItem: { supplierOrder: { request: { store: { code: storeCode } } } } } });
    await prisma.receiptItem.deleteMany({ where: { receipt: { shipment: { supplierOrder: { request: { store: { code: storeCode } } } } } } });
    await prisma.receipt.deleteMany({ where: { shipment: { supplierOrder: { request: { store: { code: storeCode } } } } } });
    await prisma.shipmentItem.deleteMany({ where: { shipment: { supplierOrder: { request: { store: { code: storeCode } } } } } });
    await prisma.shipment.deleteMany({ where: { supplierOrder: { request: { store: { code: storeCode } } } } });
    await prisma.orderItem.deleteMany({ where: { supplierOrder: { request: { store: { code: storeCode } } } } });
    await prisma.supplierOrder.deleteMany({ where: { request: { store: { code: storeCode } } } });
    await prisma.requestItem.deleteMany({ where: { request: { store: { code: storeCode } } } });
    await prisma.purchaseRequest.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.priceVersion.deleteMany({ where: { scope: { supplier: { code: { in: [supplierCodeA, supplierCodeB] } } } } });
    await prisma.priceScope.deleteMany({ where: { supplier: { code: { in: [supplierCodeA, supplierCodeB] } } } });
    await prisma.storeAccount.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.storeTemplateBinding.deleteMany({ where: { store: { code: storeCode } } });
    await prisma.templateItemSupplier.deleteMany({ where: { templateItem: { template: { code: templateCode } } } });
    await prisma.templateItem.deleteMany({ where: { template: { code: templateCode } } });
    await prisma.orderTemplate.deleteMany({ where: { code: templateCode } });
    await prisma.product.deleteMany({ where: { sku: { in: [skuA, skuB] } } });
    await prisma.supplier.deleteMany({ where: { code: { in: [supplierCodeA, supplierCodeB] } } });
    await prisma.store.deleteMany({ where: { code: storeCode } });
    await prisma.category.deleteMany({ where: { code: categoryCode } });
    await prisma.unit.deleteMany({ where: { code: unitCode } });
    await prisma.userSession.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.userSession.deleteMany({ where: { user: { username: financeUsername } } });
    await prisma.userRole.deleteMany({ where: { user: { username: { in: [purchaserUsername, financeUsername] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [purchaserUsername, financeUsername] } } });
    await prisma.$disconnect();
  }
});

test('purchase request reject cancels request once per idempotency key', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const purchaserUsername = `it_reject_purchaser_${runId}`;
  const storeCode = `REJSTORE${runId}`;
  const templateCode = `REJTPL${runId}`;
  const categoryCode = `REJCAT${runId}`;
  const unitCode = `REJUNIT${runId}`;
  const sku = `REJSKU${runId}`;
  const supplierCode = `REJSUP${runId}`;
  const { app, baseUrl } = await createTestApp();

  try {
    const purchaserRole = await prisma.role.upsert({
      where: { code: 'PURCHASER' },
      update: {},
      create: { code: 'PURCHASER', name: 'Purchaser' },
    });
    const user = await prisma.user.create({
      data: {
        username: purchaserUsername,
        displayName: 'Integration Reject Purchaser',
        passwordHash: await hashPassword('correct-password'),
        roles: { create: [{ roleId: purchaserRole.id }] },
      },
    });

    const [store, category, unit, supplier, template] = await Promise.all([
      prisma.store.create({ data: { code: storeCode, name: 'Reject Store' } }),
      prisma.category.create({ data: { code: categoryCode, name: 'Reject Category' } }),
      prisma.unit.create({ data: { code: unitCode, name: 'piece' } }),
      prisma.supplier.create({
        data: {
          code: supplierCode,
          name: 'Reject Supplier',
          deliveryMode: DeliveryMode.SELF,
          defaultSettlementMode: SettlementMode.STORED_VALUE,
          defaultSettlementCycle: 'MONTHLY',
        },
      }),
      prisma.orderTemplate.create({ data: { code: templateCode, name: 'Reject Template' } }),
    ]);
    const product = await prisma.product.create({
      data: {
        sku,
        name: 'Reject Product',
        categoryId: category.id,
        baseUnitId: unit.id,
      },
    });
    await prisma.storeAccount.create({ data: { storeId: store.id, balance: '1000.00' } });
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

    const token = await login(baseUrl, purchaserUsername);
    const createResponse = await fetch(`${baseUrl}/purchase-requests`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': 'reject-create-request',
        'x-trace-id': 'trace-reject-create',
      },
      body: JSON.stringify({
        storeId: store.id,
        items: [{ productId: product.id, quantity: '10.000000' }],
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()) as {
      data: { id: string; status: string; paymentStatus: string; version: number };
    };
    assert.equal(created.data.status, 'PENDING_PROCUREMENT');
    assert.equal(created.data.paymentStatus, 'PAID');

    const reject = async () => {
      const response = await fetch(`${baseUrl}/purchase-requests/${created.data.id}/reject`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'reject-request-once',
          'x-trace-id': 'trace-reject-request',
        },
        body: JSON.stringify({ expectedVersion: created.data.version, reason: 'Supplier capacity changed' }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as {
        data: { requestId: string; status: string; version: number; rejectedAt: string | null };
      };
    };

    const first = await reject();
    const second = await reject();
    assert.deepEqual(second.data, first.data);
    assert.equal(first.data.requestId, created.data.id);
    assert.equal(first.data.status, 'CANCELED');
    assert.equal(first.data.version, 2);
    assert.ok(first.data.rejectedAt);

    const request = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: created.data.id } });
    assert.equal(request.status, 'CANCELED');
    assert.equal(request.version, 2);
    assert.equal(request.rejectedReason, 'Supplier capacity changed');
    assert.ok(request.rejectedAt);
    const supplierOrderCount = await prisma.supplierOrder.count({ where: { requestId: created.data.id } });
    assert.equal(supplierOrderCount, 0);
    const commands = await prisma.commandRecord.findMany({
      where: { actorUserId: user.id, action: 'purchase-request.reject', idempotencyKey: 'reject-request-once' },
    });
    assert.equal(commands.length, 1);
  } finally {
    await app.close();
    await prisma.commandRecord.deleteMany({ where: { actor: { username: purchaserUsername } } });
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
    await prisma.userSession.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.userRole.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.user.deleteMany({ where: { username: purchaserUsername } });
    await prisma.$disconnect();
  }
});
