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
        defaultSalesPrice: '12',
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

    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const input = { name: 'Optional SKU', categoryId: categoryBody.data.id, baseUnitId: unitBody.data.id };
    for (const defaultSalesPrice of [undefined, null, '-1', '1.0000001', '100000000000000']) {
      const invalid = await fetch(`${baseUrl}/products`, { method: 'POST', headers, body: JSON.stringify({ ...input, defaultSalesPrice }) });
      assert.equal(invalid.status, 400);
    }
    for (const optionalSku of [undefined, null, '   ']) {
      const optional = await fetch(`${baseUrl}/products`, { method: 'POST', headers, body: JSON.stringify({ ...input, sku: optionalSku, defaultSalesPrice: '0' }) });
      assert.equal(optional.status, 201);
      const { data } = await optional.json() as { data: { id: string; sku: string | null; defaultSalesPrice: string; version: number } };
      assert.equal(data.sku, null);
      assert.equal(data.defaultSalesPrice, '0');
      const duplicate = await fetch(`${baseUrl}/products/${data.id}`, { method: 'PATCH', headers, body: JSON.stringify({ sku, expectedVersion: data.version }) });
      assert.equal(duplicate.status, 409);
      const edits = await Promise.all(['2', '3'].map(defaultSalesPrice => fetch(`${baseUrl}/products/${data.id}`, { method: 'PATCH', headers, body: JSON.stringify({ defaultSalesPrice, expectedVersion: data.version }) })));
      assert.deepEqual(edits.map(response => response.status).sort(), [200, 409]);
    }
    const duplicateCreate = await fetch(`${baseUrl}/products`, { method: 'POST', headers, body: JSON.stringify({ ...input, sku, defaultSalesPrice: '1' }) });
    assert.equal(duplicateCreate.status, 409);
    const legacy = await prisma.product.create({ data: input });
    const legacyEdit = await fetch(`${baseUrl}/products/${legacy.id}`, { method: 'PATCH', headers, body: JSON.stringify({ expectedVersion: legacy.updatedAt.getTime(), name: 'Legacy product edited' }) });
    assert.equal(legacyEdit.status, 200);
    const legacyBody = await legacyEdit.json() as { data: { version: number; defaultSalesPrice: string | null } };
    assert.equal(legacyBody.data.defaultSalesPrice, null);
    const clearPrice = await fetch(`${baseUrl}/products/${legacy.id}`, { method: 'PATCH', headers, body: JSON.stringify({ expectedVersion: legacyBody.data.version, defaultSalesPrice: null }) });
    assert.equal(clearPrice.status, 400);
  } finally {
    await app.close();
    await prisma.product.deleteMany({ where: { category: { code: categoryCode } } });
    await prisma.product.deleteMany({ where: { sku } });
    await prisma.category.deleteMany({ where: { code: categoryCode } });
    await prisma.unit.deleteMany({ where: { code: unitCode } });
    await prisma.userSession.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.userRole.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.user.deleteMany({ where: { username: purchaserUsername } });
    await prisma.$disconnect();
  }
});

test('store catalog endpoint returns active template products with supplier prices', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const purchaserUsername = `it_store_catalog_${runId}`;
  const storeCode = `CATSTORE${runId}`;
  const templateCode = `CATTPL${runId}`;
  const categoryCode = `CATALOGCAT${runId}`;
  const unitCode = `CATALOGUNIT${runId}`;
  const sku = `CATALOGSKU${runId}`;
  const supplierCode = `CATALOGSUP${runId}`;
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
        displayName: 'Integration Store Catalog',
        passwordHash: await hashPassword('correct-password'),
        roles: { create: [{ roleId: purchaserRole.id }] },
      },
    });

    const [store, category, unit, supplier, template] = await Promise.all([
      prisma.store.create({ data: { code: storeCode, name: 'Catalog Store' } }),
      prisma.category.create({ data: { code: categoryCode, name: 'Catalog Category' } }),
      prisma.unit.create({ data: { code: unitCode, name: 'bag' } }),
      prisma.supplier.create({
        data: {
          code: supplierCode,
          name: 'Catalog Supplier',
          deliveryMode: DeliveryMode.SELF,
          defaultSettlementMode: SettlementMode.COMPANY_TERM,
          defaultSettlementCycle: 'MONTHLY',
        },
      }),
      prisma.orderTemplate.create({ data: { code: templateCode, name: 'Catalog Template' } }),
    ]);
    const product = await prisma.product.create({
      data: {
        sku,
        name: 'Catalog Product',
        categoryId: category.id,
        baseUnitId: unit.id,
        minOrderQty: '2.000000',
        orderMultiple: '1.000000',
      },
    });
    const templateItem = await prisma.templateItem.create({
      data: {
        templateId: template.id,
        productId: product.id,
        sortOrder: 7,
        suppliers: {
          create: [{ supplierId: supplier.id, priority: 3 }],
        },
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

    const token = await login(baseUrl, purchaserUsername);
    const response = await fetch(`${baseUrl}/stores/${store.id}/catalog`, {
      headers: {
        authorization: `Bearer ${token}`,
        'x-trace-id': 'trace-store-catalog',
      },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: {
        storeId: string;
        store: { name: string; address: string | null };
        templateId: string;
        items: Array<{
          product: { id: string; sku: string; minOrderQty: string; categoryName: string; unitName: string };
          sortOrder: number;
          suppliers: Array<{ supplierId: string; priority: number; salesPrice: string | null; supplyPrice: string | null; priceVersionId: string | null }>;
        }>;
      };
      traceId: string;
    };
    assert.equal(body.traceId, 'trace-store-catalog');
    assert.equal(body.data.storeId, store.id);
    assert.equal(body.data.store.name, 'Catalog Store');
    assert.equal(body.data.store.address, null);
    assert.equal(body.data.items[0]?.product.categoryName, 'Catalog Category');
    assert.equal(body.data.items[0]?.product.unitName, 'bag');
    assert.equal(body.data.templateId, template.id);
    assert.equal(body.data.items.length, 1);
    assert.equal(body.data.items[0]?.product.id, product.id);
    assert.equal(body.data.items[0]?.product.sku, sku);
    assert.equal(body.data.items[0]?.product.minOrderQty, '2');
    assert.equal(body.data.items[0]?.sortOrder, 7);
    assert.deepEqual(body.data.items[0]?.suppliers, [
      {
        supplierId: supplier.id,
        supplierName: 'Catalog Supplier',
        purchaseSalesPrice: null,
        purchaseSupplyPrice: null,
        priority: 3,
        salesPrice: '12',
        supplyPrice: '9',
        priceVersionId: priceVersion.id,
        supplyPriceVersionId: priceVersion.id,
      },
    ]);

    assert.equal(templateItem.productId, product.id);
  } finally {
    await app.close();
    await prisma.priceVersion.deleteMany({ where: { scope: { supplier: { code: supplierCode } } } });
    await prisma.priceScope.deleteMany({ where: { supplier: { code: supplierCode } } });
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
