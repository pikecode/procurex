import 'reflect-metadata';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';
import { DeliveryMode, SettlementMode } from '../dist/packages/backend/generated/prisma/enums.js';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const flowResult = {
  generatedAt: new Date().toISOString(),
  title: 'Main Flow Acceptance',
  summary: 'Store order to supplier payment preview',
  steps: [],
};

function createClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

async function createAcceptanceApp() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address();
  return { app, baseUrl: `http://127.0.0.1:${address.port}/api/v1` };
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${url} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.data ?? body;
}

async function login(baseUrl, username) {
  const data = await request(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'correct-password', client: 'web' }),
  });
  return data.accessToken;
}

function authHeaders(token, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...extra,
  };
}

function logStep(title, data) {
  console.log(`\n${title}`);
  for (const [key, value] of Object.entries(data)) {
    console.log(`  ${key}: ${value}`);
  }
  flowResult.steps.push({ title, data });
}

async function seed(prisma, runId) {
  const username = `flow_user_${runId}`;
  const storeCode = `FLOWSTORE${runId}`;
  const supplierCode = `FLOWSUP${runId}`;
  const templateCode = `FLOWTPL${runId}`;
  const categoryCode = `FLOWCAT${runId}`;
  const unitCode = `FLOWUNIT${runId}`;
  const sku = `FLOWSKU${runId}`;

  const [storeRole, supplierRole, purchaserRole, financeRole] = await Promise.all([
    prisma.role.upsert({ where: { code: 'STORE' }, update: {}, create: { code: 'STORE', name: 'Store' } }),
    prisma.role.upsert({ where: { code: 'SUPPLIER' }, update: {}, create: { code: 'SUPPLIER', name: 'Supplier' } }),
    prisma.role.upsert({ where: { code: 'PURCHASER' }, update: {}, create: { code: 'PURCHASER', name: 'Purchaser' } }),
    prisma.role.upsert({ where: { code: 'HQ_FINANCE' }, update: {}, create: { code: 'HQ_FINANCE', name: 'HQ Finance' } }),
  ]);

  const user = await prisma.user.create({
    data: {
      username,
      displayName: 'Main Flow Acceptance User',
      passwordHash: await hashPassword('correct-password'),
      roles: {
        create: [
          { roleId: storeRole.id },
          { roleId: supplierRole.id },
          { roleId: purchaserRole.id },
          { roleId: financeRole.id },
        ],
      },
    },
  });

  const [store, category, unit, supplier, template] = await Promise.all([
    prisma.store.create({ data: { code: storeCode, name: 'Main Flow Store' } }),
    prisma.category.create({ data: { code: categoryCode, name: 'Main Flow Category' } }),
    prisma.unit.create({ data: { code: unitCode, name: 'piece' } }),
    prisma.supplier.create({
      data: {
        code: supplierCode,
        name: 'Main Flow Supplier',
        deliveryMode: DeliveryMode.SELF,
        defaultSettlementMode: SettlementMode.STORED_VALUE,
        defaultSettlementCycle: 'MONTHLY',
      },
    }),
    prisma.orderTemplate.create({ data: { code: templateCode, name: 'Main Flow Template' } }),
  ]);

  const product = await prisma.product.create({
    data: {
      sku,
      name: 'Main Flow Product',
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
      reason: 'Main flow acceptance baseline',
    },
  });

  return {
    username,
    store,
    supplier,
    product,
    codes: { storeCode, supplierCode, templateCode, categoryCode, unitCode, sku },
    userId: user.id,
  };
}

async function cleanup(prisma, seeded) {
  const { storeCode, supplierCode, templateCode, categoryCode, unitCode, sku } = seeded.codes;
  const username = seeded.username;
  await prisma.commandRecord.deleteMany({ where: { actor: { username } } });
  await prisma.paymentAllocation.deleteMany({ where: { supplierOrder: { request: { store: { code: storeCode } } } } });
  await prisma.paymentRecord.deleteMany({ where: { OR: [{ storeId: seeded.store.id }, { supplierId: seeded.supplier.id }] } });
  await prisma.differenceDisposalItem.deleteMany({
    where: { discrepancyReturn: { orderItem: { supplierOrder: { request: { store: { code: storeCode } } } } } },
  });
  await prisma.differenceDisposal.deleteMany({ where: { storeId: seeded.store.id } });
  await prisma.freightConfirmation.deleteMany({ where: { supplierOrder: { request: { store: { code: storeCode } } } } });
  await prisma.shipmentGapAllocation.deleteMany({
    where: { shipmentItem: { shipment: { supplierOrder: { request: { store: { code: storeCode } } } } } },
  });
  await prisma.replenishmentGap.deleteMany({ where: { orderItem: { supplierOrder: { request: { store: { code: storeCode } } } } } });
  await prisma.discrepancyReturn.deleteMany({ where: { orderItem: { supplierOrder: { request: { store: { code: storeCode } } } } } });
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
  await prisma.userSession.deleteMany({ where: { user: { username } } });
  await prisma.userRole.deleteMany({ where: { user: { username } } });
  await prisma.user.deleteMany({ where: { username } });
}

async function run() {
  const prisma = createClient();
  const runId = Date.now();
  const seeded = await seed(prisma, runId);
  const { app, baseUrl } = await createAcceptanceApp();

  try {
    const token = await login(baseUrl, seeded.username);
    logStep('0. Acceptance data ready', {
      store: `${seeded.store.name} (${seeded.store.id})`,
      supplier: `${seeded.supplier.name} (${seeded.supplier.id})`,
      product: `${seeded.product.name} (${seeded.product.id})`,
    });

    const created = await request(`${baseUrl}/purchase-requests`, {
      method: 'POST',
      headers: authHeaders(token, { 'idempotency-key': `flow-create-${runId}` }),
      body: JSON.stringify({
        storeId: seeded.store.id,
        items: [{ productId: seeded.product.id, quantity: '10.000000' }],
      }),
    });
    assert.equal(created.status, 'PENDING_PROCUREMENT');
    assert.equal(created.paymentStatus, 'PAID');
    logStep('1. Store order created', {
      requestId: created.id,
      status: created.status,
      paymentStatus: created.paymentStatus,
      salesGoodsAmount: created.totals.salesGoodsAmount,
    });

    const confirmed = await request(`${baseUrl}/purchase-requests/${created.id}/confirm`, {
      method: 'POST',
      headers: authHeaders(token, { 'idempotency-key': `flow-confirm-${runId}` }),
      body: JSON.stringify({ expectedVersion: created.version }),
    });
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.equal(confirmed.supplierOrderIds.length, 1);
    const supplierOrder = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: confirmed.supplierOrderIds[0] },
      include: { items: true },
    });
    logStep('2. Procurement confirmed and supplier order pushed', {
      supplierOrderId: supplierOrder.id,
      status: supplierOrder.status,
      salesGoodsAmount: supplierOrder.salesGoodsAmount.toFixed(2),
      supplyGoodsAmount: supplierOrder.supplyGoodsAmount.toFixed(2),
    });

    const orderItem = supplierOrder.items[0];
    const shipment = await request(`${baseUrl}/supplier-orders/${supplierOrder.id}/shipments`, {
      method: 'POST',
      headers: authHeaders(token, { 'idempotency-key': `flow-ship-${runId}` }),
      body: JSON.stringify({
        expectedVersion: supplierOrder.version,
        freight: '0.00',
        items: [
          {
            orderItemId: orderItem.id,
            shipQuantity: '10.000000',
            permanentlyReduceQuantity: '0.000000',
          },
        ],
      }),
    });
    assert.equal(shipment.kind, 'INITIAL');
    logStep('3. Supplier shipped goods', {
      shipmentId: shipment.id,
      kind: shipment.kind,
      quantity: shipment.items[0].quantity,
      freight: shipment.freight,
    });

    const orderAfterShipment = await prisma.supplierOrder.findUniqueOrThrow({ where: { id: supplierOrder.id } });
    const receipt = await request(`${baseUrl}/shipments/${shipment.id}/receipts`, {
      method: 'POST',
      headers: authHeaders(token, { 'idempotency-key': `flow-receipt-${runId}` }),
      body: JSON.stringify({
        expectedOrderVersion: orderAfterShipment.version,
        expectedReceiptRevision: 0,
        items: shipment.items.map((item) => ({
          shipmentItemId: item.id,
          receivedQuantity: item.quantity,
        })),
      }),
    });
    const completedOrder = await prisma.supplierOrder.findUniqueOrThrow({ where: { id: supplierOrder.id } });
    assert.equal(completedOrder.status, 'COMPLETED');
    assert.equal(completedOrder.fulfillmentStatus, 'COMPLETED');
    logStep('4. Store received goods and order completed', {
      receiptId: receipt.id,
      receiptRevision: receipt.revision,
      orderStatus: completedOrder.status,
      fulfillmentStatus: completedOrder.fulfillmentStatus,
    });

    const storeStatements = await request(`${baseUrl}/store-statements?storeId=${seeded.store.id}&supplierId=${seeded.supplier.id}`, {
      headers: authHeaders(token),
    });
    const storeStatement = storeStatements.find((statement) => statement.supplierId === seeded.supplier.id);
    assert.ok(storeStatement);
    logStep('5. Store statement visible', {
      statementId: storeStatement.id,
      goodsAmount: storeStatement.goodsAmount,
      payableAmount: storeStatement.payableAmount,
      status: storeStatement.settlementStatus,
    });

    const supplierStatements = await request(`${baseUrl}/supplier-statements?supplierId=${seeded.supplier.id}`, {
      headers: authHeaders(token),
    });
    const supplierStatement = supplierStatements.find((statement) => statement.supplierId === seeded.supplier.id);
    assert.ok(supplierStatement);
    const supplierStatementDetail = await request(`${baseUrl}/supplier-statements/${encodeURIComponent(supplierStatement.id)}`, {
      headers: authHeaders(token),
    });
    logStep('6. Supplier payable statement visible', {
      statementId: supplierStatement.id,
      goodsAmount: supplierStatement.goodsAmount,
      payableAmount: supplierStatement.payableAmount,
      lineCount: supplierStatement.lineCount,
    });

    const paymentPreview = await request(`${baseUrl}/payment-records/preview`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        settlementItemIds: [supplierStatementDetail.lines[0].settlementItemId],
      }),
    });
    assert.equal(paymentPreview.direction, 'COMPANY_TO_SUPPLIER');
    assert.equal(paymentPreview.totalPayableAmount, '90.00');
    logStep('7. Payment preview reaches billing handoff', {
      direction: paymentPreview.direction,
      channel: paymentPreview.channel,
      totalPayableAmount: paymentPreview.totalPayableAmount,
      blockedItems: paymentPreview.blockedItems.length,
    });

    console.log('\nMain flow acceptance runner passed.');
    await writeFile(
      resolve(process.cwd(), 'apps/web/main-flow-run.json'),
      `${JSON.stringify({ ...flowResult, generatedAt: new Date().toISOString(), status: 'PASSED' }, null, 2)}\n`,
    );
  } finally {
    await app.close();
    await cleanup(prisma, seeded).catch((error) => {
      console.error(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    await prisma.$disconnect();
  }
}

await run();
