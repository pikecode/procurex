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
    const user = await prisma.user.create({
      data: {
        username: purchaserUsername,
        displayName: 'Integration Confirm Purchaser',
        passwordHash: await hashPassword('correct-password'),
        roles: { create: [{ roleId: purchaserRole.id }, { roleId: supplierRole.id }, { roleId: storeRole.id }] },
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
          expectedVersion: orderAfterReceipt.version,
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
    await prisma.freightConfirmation.deleteMany({
      where: { supplierOrder: { request: { store: { code: storeCode } } } },
    });
    await prisma.shipmentGapAllocation.deleteMany({
      where: { shipmentItem: { shipment: { supplierOrder: { request: { store: { code: storeCode } } } } } },
    });
    await prisma.replenishmentGap.deleteMany({
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
    await prisma.userRole.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.user.deleteMany({ where: { username: purchaserUsername } });
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
