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

test('templates endpoint creates templates and binds stores atomically', async () => {
  const prisma = createClient();
  const runId = Date.now();
  const purchaserUsername = `it_templates_purchaser_${runId}`;
  const storeCodeA = `TPLSTOREA${runId}`;
  const storeCodeB = `TPLSTOREB${runId}`;
  const templateCodeA = `TPLA${runId}`;
  const templateCodeB = `TPLB${runId}`;
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
    const createTemplate = async (code: string): Promise<{ id: string; version: number }> => {
      const response = await fetch(`${baseUrl}/templates`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ code, name: code }),
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
  } finally {
    await app.close();
    await prisma.storeTemplateBinding.deleteMany({ where: { store: { code: { in: [storeCodeA, storeCodeB] } } } });
    await prisma.orderTemplate.deleteMany({ where: { code: { in: [templateCodeA, templateCodeB] } } });
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
        categoryId: category.id,
        baseUnitId: unit.id,
      },
    });

    const token = await login(baseUrl, purchaserUsername);
    const created = await fetch(`${baseUrl}/templates`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ code: templateCode, name: 'Template Items' }),
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
        sortOrder: 5,
        suppliers: [{ supplierId: supplier.id, priority: 10 }],
      },
    ]);

    const setting = await fetch(`${baseUrl}/templates/${createdBody.data.id}/supplier-settings/${supplier.id}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-trace-id': 'trace-template-setting',
      },
      body: JSON.stringify({
        expectedVersion: replacedBody.data.version,
        settlementMode: SettlementMode.STORED_VALUE,
        settlementCycle: 'WEEKLY',
      }),
    });
    assert.equal(setting.status, 200);
    const settingBody = (await setting.json()) as {
      data: { templateId: string; supplierId: string; settlementMode: SettlementMode; settlementCycle: string };
      traceId: string;
    };
    assert.equal(settingBody.traceId, 'trace-template-setting');
    assert.equal(settingBody.data.templateId, createdBody.data.id);
    assert.equal(settingBody.data.supplierId, supplier.id);
    assert.equal(settingBody.data.settlementMode, SettlementMode.STORED_VALUE);
    assert.equal(settingBody.data.settlementCycle, 'WEEKLY');
  } finally {
    await app.close();
    await prisma.templateSupplierSetting.deleteMany({ where: { template: { code: templateCode } } });
    await prisma.templateItemSupplier.deleteMany({ where: { templateItem: { template: { code: templateCode } } } });
    await prisma.templateItem.deleteMany({ where: { template: { code: templateCode } } });
    await prisma.orderTemplate.deleteMany({ where: { code: templateCode } });
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
