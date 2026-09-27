import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';

const seed = JSON.parse(await readFile('apps/web/main-flow-demo-seed.json', 'utf8'));

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

function authHeaders(token, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function createSupplierOrder(baseUrl, token, seed, idempotencyPrefix) {
  const created = await request(`${baseUrl}/purchase-requests`, {
    method: 'POST',
    headers: authHeaders(token, { 'idempotency-key': `${idempotencyPrefix}-create-${Date.now()}` }),
    body: JSON.stringify({
      storeId: seed.storeId,
      items: [{ productId: seed.productId, quantity: seed.quantity }],
    }),
  });
  assert.equal(created.status, 'PENDING_PROCUREMENT');
  assert.equal(created.paymentStatus, 'PAID');
  assert.equal(created.totals.salesGoodsAmount, seed.expectedSalesAmount);

  const confirmed = await request(`${baseUrl}/purchase-requests/${created.id}/confirm`, {
    method: 'POST',
    headers: authHeaders(token, { 'idempotency-key': `${idempotencyPrefix}-confirm-${Date.now()}` }),
    body: JSON.stringify({ expectedVersion: created.version }),
  });
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal(confirmed.supplierOrderIds.length, 1);

  return request(`${baseUrl}/supplier-orders/${confirmed.supplierOrderIds[0]}`, {
    headers: authHeaders(token),
  });
}

async function createInitialShipment(baseUrl, token, supplierOrder, idempotencyPrefix) {
  const orderItem = supplierOrder.items[0];
  const shipment = await request(`${baseUrl}/supplier-orders/${supplierOrder.id}/shipments`, {
    method: 'POST',
    headers: authHeaders(token, { 'idempotency-key': `${idempotencyPrefix}-ship-${Date.now()}` }),
    body: JSON.stringify({
      expectedVersion: supplierOrder.version,
      freight: '0.00',
      items: [{ orderItemId: orderItem.id, shipQuantity: orderItem.quantity, permanentlyReduceQuantity: '0.000000' }],
    }),
  });
  assert.equal(shipment.kind, 'INITIAL');
  return shipment;
}

async function run() {
  const { app, baseUrl } = await createAcceptanceApp();
  try {
    const login = await request(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: seed.username, password: seed.password, client: 'web' }),
    });
    const token = login.accessToken;

    const supplierOrder = await createSupplierOrder(baseUrl, token, seed, 'flow-demo');
    const shipment = await createInitialShipment(baseUrl, token, supplierOrder, 'flow-demo');

    const storeLogin = await request(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: seed.storeUsername, password: seed.password, client: 'web' }),
    });
    const storeNotifications = await request(`${baseUrl}/notifications`, {
      headers: authHeaders(storeLogin.accessToken),
    });
    const shipmentNotification = storeNotifications.notifications.find((item) => item.payload?.shipmentId === shipment.id);
    assert.equal(storeNotifications.unreadCount, 1);
    assert.equal(shipmentNotification?.title, '待收货提醒');

    const orderAfterShipment = await request(`${baseUrl}/supplier-orders/${supplierOrder.id}`, {
      headers: authHeaders(token),
    });
    const receipt = await request(`${baseUrl}/shipments/${shipment.id}/receipts`, {
      method: 'POST',
      headers: authHeaders(token, { 'idempotency-key': `flow-demo-receive-${Date.now()}` }),
      body: JSON.stringify({
        expectedOrderVersion: orderAfterShipment.version,
        expectedReceiptRevision: 0,
        items: shipment.items.map((item) => ({ shipmentItemId: item.id, receivedQuantity: item.quantity })),
      }),
    });
    assert.equal(receipt.revision, 1);

    const completedOrder = await request(`${baseUrl}/supplier-orders/${supplierOrder.id}`, {
      headers: authHeaders(token),
    });
    assert.equal(completedOrder.status, 'COMPLETED');
    assert.equal(completedOrder.fulfillmentStatus, 'COMPLETED');

    const statements = await request(`${baseUrl}/supplier-statements?supplierId=${seed.supplierId}`, {
      headers: authHeaders(token),
    });
    const statement = statements.find((item) => item.supplierId === seed.supplierId);
    assert.ok(statement);
    const detail = await request(`${baseUrl}/supplier-statements/${encodeURIComponent(statement.id)}`, {
      headers: authHeaders(token),
    });
    const preview = await request(`${baseUrl}/payment-records/preview`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ settlementItemIds: [detail.lines[0].settlementItemId] }),
    });
    assert.equal(preview.direction, 'COMPANY_TO_SUPPLIER');
    assert.equal(preview.totalPayableAmount, seed.expectedSupplyAmount);

    const discrepancyOrder = await createSupplierOrder(baseUrl, token, seed, 'flow-demo-discrepancy');
    const discrepancyShipment = await createInitialShipment(baseUrl, token, discrepancyOrder, 'flow-demo-discrepancy');
    const discrepancyOrderAfterShipment = await request(`${baseUrl}/supplier-orders/${discrepancyOrder.id}`, {
      headers: authHeaders(token),
    });
    const discrepancyReceipt = await request(`${baseUrl}/shipments/${discrepancyShipment.id}/receipts`, {
      method: 'POST',
      headers: authHeaders(token, { 'idempotency-key': `flow-demo-discrepancy-receive-${Date.now()}` }),
      body: JSON.stringify({
        expectedOrderVersion: discrepancyOrderAfterShipment.version,
        expectedReceiptRevision: 0,
        items: discrepancyShipment.items.map((item) => ({ shipmentItemId: item.id, receivedQuantity: '8.000000' })),
      }),
    });
    assert.equal(discrepancyReceipt.revision, 1);

    const supplierLogin = await request(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: seed.supplierUsername, password: seed.password, client: 'web' }),
    });
    const supplierNotifications = await request(`${baseUrl}/notifications`, {
      headers: authHeaders(supplierLogin.accessToken),
    });
    const discrepancyNotification = supplierNotifications.notifications.find((item) => item.payload?.receiptId === discrepancyReceipt.id);
    assert.equal(discrepancyNotification?.title, '收货差异待处理');

    console.log('Main flow demo check passed.');
    console.log(`  Order: ${completedOrder.status} / ${completedOrder.fulfillmentStatus}`);
    console.log(`  Store notification: ${shipmentNotification.title}`);
    console.log(`  Supplier notification: ${discrepancyNotification.title}`);
    console.log(`  Payment preview: ${preview.direction} ${preview.totalPayableAmount}`);
  } finally {
    await app.close();
  }
}

await run();
