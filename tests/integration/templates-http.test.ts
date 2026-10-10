import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

test('templates endpoint creates templates and binds stores atomically', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const purchaserUsername = `it_templates_purchaser_${runId}`;
  const storeCodeA = `TPLSTOREA${runId}`;
  const storeCodeB = `TPLSTOREB${runId}`;
  const templateCodeA = `TPLA${runId}`;
  const templateCodeB = `TPLB${runId}`;
  const templateCodeC = `TPLC${runId}`;
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
        displayName: 'Integration Templates Purchaser',
        passwordHash: await hashPassword('correct-password'),
        roles: { create: [{ roleId: purchaserRole.id }] },
      },
    });
    const [storeA, storeB] = await Promise.all([
      prisma.store.create({ data: { code: storeCodeA, name: 'Template Store A' } }),
      prisma.store.create({ data: { code: storeCodeB, name: 'Template Store B' } }),
    ]);

    const token = await login(baseUrl, purchaserUsername);
    const createTemplate = async (code: string, storeIds: string[] = [], confirmStoreReassignment = false): Promise<{ id: string; version: number }> => {
      const response = await fetch(`${baseUrl}/templates`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ code, name: code, tag: 'Test', storeIds, confirmStoreReassignment }),
      });
      assert.equal(response.status, 201);
      const body = (await response.json()) as { data: { id: string; version: number } };
      return body.data;
    };

    const templateA = await createTemplate(templateCodeA);
    const templateB = await createTemplate(templateCodeB);

    const conflictVersion = await fetch(`${baseUrl}/templates/${templateA.id}/stores`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-template-version-conflict',
      },
      body: JSON.stringify({ expectedVersion: 1, storeIds: [storeA.id] }),
    });
    assert.equal(conflictVersion.status, 409);

    const boundA = await fetch(`${baseUrl}/templates/${templateA.id}/stores`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-template-bind-a',
      },
      body: JSON.stringify({ expectedVersion: templateA.version, storeIds: [storeA.id] }),
    });
    assert.equal(boundA.status, 200);
    const boundABody = (await boundA.json()) as { data: { templateId: string; storeIds: string[]; version: number }; traceId: string };
    assert.equal(boundABody.traceId, 'trace-template-bind-a');
    assert.deepEqual(boundABody.data.storeIds, [storeA.id]);

    const conflictStore = await fetch(`${baseUrl}/templates/${templateB.id}/stores`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-template-store-conflict',
      },
      body: JSON.stringify({ expectedVersion: templateB.version, storeIds: [storeA.id, storeB.id] }),
    });
    assert.equal(conflictStore.status, 409);

    const bindingsForB = await prisma.storeTemplateBinding.findMany({ where: { templateId: templateB.id, expiredAt: null } });
    assert.equal(bindingsForB.length, 0);
    const transferredB = await fetch(`${baseUrl}/templates/${templateB.id}/stores`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: templateB.version, storeIds: [storeA.id], confirmStoreReassignment: true }),
    });
    assert.equal(transferredB.status, 200);
    assert.equal(await prisma.storeTemplateBinding.count({ where: { templateId: templateA.id, storeId: storeA.id, expiredAt: null } }), 0);
    assert.equal(await prisma.storeTemplateBinding.count({ where: { templateId: templateB.id, storeId: storeA.id, expiredAt: null } }), 1);

    const templateC = await createTemplate(templateCodeC, [storeA.id], true);
    assert.equal(await prisma.storeTemplateBinding.count({ where: { templateId: templateB.id, storeId: storeA.id, expiredAt: null } }), 0);
    assert.deepEqual((await prisma.storeTemplateBinding.findMany({ where: { templateId: templateC.id, expiredAt: null }, select: { storeId: true } })).map(row => row.storeId), [storeA.id]);
  } finally {
    await app.close();
    await prisma.storeTemplateBinding.deleteMany({ where: { store: { code: { in: [storeCodeA, storeCodeB] } } } });
    await prisma.orderTemplate.deleteMany({ where: { code: { in: [templateCodeA, templateCodeB, templateCodeC] } } });
    await prisma.store.deleteMany({ where: { code: { in: [storeCodeA, storeCodeB] } } });
    await prisma.userSession.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.userRole.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.user.deleteMany({ where: { username: purchaserUsername } });
    await prisma.$disconnect();
  }
});

test('templates endpoint replaces items and supplier settlement overrides', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const purchaserUsername = `it_template_items_${runId}`;
  const templateCode = `TPLITEM${runId}`;
  const categoryCode = `TPLCAT${runId}`;
  const unitCode = `TPLUNIT${runId}`;
  const sku = `TPLSKU${runId}`;
  const supplierCode = `TPLSUP${runId}`;
  const storeCodePrefix = `TPLCYC`;
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
        displayName: 'Integration Template Items',
        passwordHash: await hashPassword('correct-password'),
        roles: { create: [{ roleId: purchaserRole.id }] },
      },
    });

    const [category, unit, supplier] = await Promise.all([
      prisma.category.create({ data: { code: categoryCode, name: 'Template Item Category' } }),
      prisma.unit.create({ data: { code: unitCode, name: 'bag' } }),
      prisma.supplier.create({
        data: {
          code: supplierCode,
          name: 'Template Item Supplier',
          deliveryMode: DeliveryMode.SELF,
          defaultSettlementMode: SettlementMode.COMPANY_TERM,
          defaultSettlementCycle: 'MONTHLY',
        },
      }),
    ]);
    const product = await prisma.product.create({
      data: {
        sku,
        name: 'Template Product',
        defaultSalesPrice: '12.5',
        categoryId: category.id,
        baseUnitId: unit.id,
      },
    });
    await prisma.supplierProduct.create({ data: { supplierId: supplier.id, productId: product.id } });
    await prisma.priceScope.create({ data: { productId: product.id, supplierId: supplier.id, templateKey: '', versions: { create: {
      salesPrice: '12.5', supplyPrice: '9', effectiveAt: new Date('2000-01-01T00:00:00.000Z'), reason: 'Template integration baseline', revision: 1,
    } } } });

    const token = await login(baseUrl, purchaserUsername);
    const created = await fetch(`${baseUrl}/templates`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ code: templateCode, name: 'Template Items', tag: 'Items' }),
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as { data: { id: string; version: number } };

    const replaced = await fetch(`${baseUrl}/templates/${createdBody.data.id}/items`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-template-items',
      },
      body: JSON.stringify({
        expectedVersion: createdBody.data.version,
        items: [
          {
            productId: product.id,
            sortOrder: 5,
            salesPrice: '15.80',
            suppliers: [{ supplierId: supplier.id, priority: 10 }],
          },
        ],
      }),
    });
    assert.equal(replaced.status, 200);
    const replacedBody = (await replaced.json()) as {
      data: {
        templateId: string;
        items: Array<{ productId: string; sortOrder: number; suppliers: Array<{ supplierId: string; priority: number }> }>;
        version: number;
      };
      traceId: string;
    };
    assert.equal(replacedBody.traceId, 'trace-template-items');
    assert.equal(replacedBody.data.templateId, createdBody.data.id);
    assert.deepEqual(replacedBody.data.items, [
      {
        productId: product.id,
        initialSalesPrice: '15.8',
        isEnabled: true,
        minOrderQty: null,
        orderMultiple: null,
        sortOrder: 5,
        suppliers: [{ supplierId: supplier.id, priority: 10 }],
      },
    ]);

    await prisma.product.update({ where: { id: product.id }, data: { defaultSalesPrice: '25' } });
    const repeated = await fetch(`${baseUrl}/templates/${createdBody.data.id}/items`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: replacedBody.data.version, items: [{ productId: product.id, sortOrder: 5, suppliers: [{ supplierId: supplier.id, priority: 10 }] }] }),
    });
    assert.equal(repeated.status, 200);
    const repeatedBody = await repeated.json() as { data: { version: number; items: Array<{ initialSalesPrice: string | null }> } };
    assert.equal(repeatedBody.data.items[0]?.initialSalesPrice, '15.8');
    replacedBody.data.version = repeatedBody.data.version;

    // Settlement mode is maintained on the supplier only; templates keep per-store cycle overrides.
    const template = await prisma.orderTemplate.findUniqueOrThrow({ where: { id: createdBody.data.id } });
    const version = template.updatedAt.getTime();
    const store = await prisma.store.create({ data: { code: `${storeCodePrefix}${runId}`, name: 'Template Cycle Store' } });
    await prisma.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } });

    const cycles = (rows: unknown[], expectedVersion = version) => fetch(`${baseUrl}/templates/${template.id}/settlement-cycles`, {
      method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion, rows }),
    });
    const row = { storeId: store.id, supplierId: supplier.id, settlementCycle: 'HALF_MONTHLY' };
    const cycleCode = async (rows: unknown[], expectedVersion = version) => {
      const response = await cycles(rows, expectedVersion);
      return { status: response.status, code: ((await response.json()) as { code?: string }).code };
    };
    // The store must be bound to the template, and the supplier must be linked to an enabled item on supplier/company terms.
    assert.equal((await cycleCode([{ ...row, storeId: randomUUID() }])).code, 'TEMPLATE_CYCLE_INVALID');
    assert.equal((await cycleCode([{ ...row, supplierId: randomUUID() }])).code, 'TEMPLATE_CYCLE_INVALID');
    assert.equal((await cycleCode([{ ...row, settlementCycle: 'INVALID' }])).status, 400);
    assert.equal((await cycleCode([row, row])).code, 'TEMPLATE_CYCLE_INVALID');
    assert.equal(await prisma.templateStoreSupplierCycle.count({ where: { templateId: template.id } }), 0);

    const saved = await cycles([row]);
    assert.equal(saved.status, 200);
    const savedBody = await saved.json() as { data: { version: number; cycleOverrides: unknown[] } };
    assert.ok(savedBody.data.version > version);
    assert.deepEqual(savedBody.data.cycleOverrides, [row]);
    assert.equal((await prisma.templateStoreSupplierCycle.findUniqueOrThrow({ where: { templateId_storeId_supplierId: { templateId: template.id, storeId: store.id, supplierId: supplier.id } } })).settlementCycle, 'HALF_MONTHLY');

    // A stale expectedVersion must not overwrite the saved cycle.
    assert.equal((await cycleCode([{ ...row, settlementCycle: 'WEEKLY' }], version)).code, 'VERSION_CONFLICT');
    assert.equal((await prisma.templateStoreSupplierCycle.findUniqueOrThrow({ where: { templateId_storeId_supplierId: { templateId: template.id, storeId: store.id, supplierId: supplier.id } } })).settlementCycle, 'HALF_MONTHLY');

    // The deprecated supplier-settings endpoints must stay closed.
    const disabled = await fetch(`${baseUrl}/templates/${template.id}/supplier-settings`, {
      method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: savedBody.data.version, settings: [] }),
    });
    assert.equal(disabled.status, 409);
    assert.equal(((await disabled.json()) as { code: string }).code, 'TEMPLATE_SETTLEMENT_DISABLED');
    assert.equal(await prisma.templateSupplierSetting.count({ where: { templateId: template.id } }), 0);

    const configure = (rows: unknown[], expectedVersion: number, storeIds = [store.id]) => fetch(`${baseUrl}/templates/${template.id}/configuration`, {
      method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion, name: 'Unified Template', tag: 'Items', remark: 'Atomic configuration', storeIds,
        items: [{ productId: product.id, sortOrder: 5, isEnabled: true, suppliers: [{ supplierId: supplier.id, priority: 0 }] }], rows, confirmCycleOverrideRemoval: true }),
    });
    // Fail at the final cycle write: metadata, bindings, items and audits must all roll back.
    const invalid = await configure([{ ...row, supplierId: randomUUID() }], savedBody.data.version);
    assert.equal(invalid.status, 409);
    const unchanged = await prisma.orderTemplate.findUniqueOrThrow({ where: { id: template.id } });
    assert.equal(unchanged.name, template.name);
    assert.equal(unchanged.updatedAt.getTime(), savedBody.data.version);
    assert.equal((await prisma.templateItemSupplier.findFirstOrThrow({ where: { templateItem: { templateId: template.id } } })).priority, 10);
    assert.equal(await prisma.templateStoreSupplierCycle.count({ where: { templateId: template.id } }), 1);
    const restoredDefault = await configure([], savedBody.data.version);
    assert.equal(restoredDefault.status, 200);
    const restored = await restoredDefault.json() as { data: { version: number } };
    assert.equal(await prisma.templateStoreSupplierCycle.count({ where: { templateId: template.id } }), 0);
    assert.equal((await prisma.orderTemplate.findUniqueOrThrow({ where: { id: template.id } })).name, 'Unified Template');
    assert.equal((await configure([], savedBody.data.version)).status, 409);
    const reconfigured = await configure([row], restored.data.version);
    assert.equal(reconfigured.status, 200);
    const next = await reconfigured.json() as { data: { version: number } };
    assert.equal((await configure([], next.data.version, [])).status, 200);
    assert.equal(await prisma.storeTemplateBinding.count({ where: { templateId: template.id, expiredAt: null } }), 0);
    assert.equal(await prisma.templateStoreSupplierCycle.count({ where: { templateId: template.id } }), 0);
  } finally {
    await app.close();
    await prisma.templateStoreSupplierCycle.deleteMany({ where: { template: { code: templateCode } } });
    await prisma.storeTemplateBinding.deleteMany({ where: { template: { code: templateCode } } });
    await prisma.templateSupplierSetting.deleteMany({ where: { template: { code: templateCode } } });
    await prisma.templateItemSupplier.deleteMany({ where: { templateItem: { template: { code: templateCode } } } });
    await prisma.templateItem.deleteMany({ where: { template: { code: templateCode } } });
    await prisma.orderTemplate.deleteMany({ where: { code: templateCode } });
    await prisma.priceScope.deleteMany({ where: { supplier: { code: supplierCode } } });
    await prisma.supplierProduct.deleteMany({ where: { supplier: { code: supplierCode } } });
    await prisma.product.deleteMany({ where: { sku } });
    await prisma.supplier.deleteMany({ where: { code: { in: [supplierCode, `${supplierCode}_batch`] } } });
    await prisma.store.deleteMany({ where: { code: `${storeCodePrefix}${runId}` } });
    await prisma.category.deleteMany({ where: { code: categoryCode } });
    await prisma.unit.deleteMany({ where: { code: unitCode } });
    await prisma.userSession.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.userRole.deleteMany({ where: { user: { username: purchaserUsername } } });
    await prisma.user.deleteMany({ where: { username: purchaserUsername } });
    await prisma.$disconnect();
  }
});
