import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
    const discrepancyId = discrepancyNotification.payload.discrepancyIds[0];
    const resolvedDiscrepancy = await request(`${baseUrl}/discrepancies/${discrepancyId}/resolve`, {
      method: 'POST',
      headers: authHeaders(supplierLogin.accessToken, { 'idempotency-key': `flow-demo-discrepancy-resolve-${Date.now()}` }),
      body: JSON.stringify({
        expectedVersion: 1,
        action: 'ACCEPT',
        reason: 'PXFLOW demo accepts short receipt',
      }),
    });
    assert.equal(resolvedDiscrepancy.status, 'RESOLVED');

    const storeNotificationsAfterResolution = await request(`${baseUrl}/notifications`, {
      headers: authHeaders(storeLogin.accessToken),
    });
    const resolutionNotification = storeNotificationsAfterResolution.notifications.find((item) => item.payload?.discrepancyId === discrepancyId);
    assert.equal(resolutionNotification?.title, '差异已同意少收');

    const rejectedOrder = await createSupplierOrder(baseUrl, token, seed, 'flow-demo-reject');
    const rejection = await request(`${baseUrl}/supplier-orders/${rejectedOrder.id}/reject`, {
      method: 'POST',
      headers: authHeaders(token, { 'idempotency-key': `flow-demo-reject-${Date.now()}` }),
      body: JSON.stringify({
        expectedVersion: rejectedOrder.version,
        reason: 'PXFLOW demo supplier cannot fulfill this order',
      }),
    });
    assert.equal(rejection.status, 'REJECTED');
    const adminNotifications = await request(`${baseUrl}/notifications`, {
      headers: authHeaders(token),
    });
    const rejectionNotification = adminNotifications.notifications.find((item) => item.payload?.supplierOrderId === rejectedOrder.id);
    assert.equal(rejectionNotification?.title, '供应商拒单待处理');

    const auditLogs = await request(`${baseUrl}/audit-logs`, {
      headers: authHeaders(token),
    });
    const actions = new Set(auditLogs.map((entry) => entry.action));
    assert.ok(actions.has('purchase-request.create'));
    assert.ok(actions.has('purchase-request.confirm'));
    assert.ok(actions.has('supplier-order.shipment.create'));
    assert.ok(actions.has('shipment.receipt.create'));
    assert.ok(actions.has('discrepancy.resolve'));
    assert.ok(actions.has('supplier-order.reject'));
    const createdAuditLogs = await request(`${baseUrl}/audit-logs?action=purchase-request.create`, {
      headers: authHeaders(token),
    });
    assert.ok(createdAuditLogs.length > 0);
    assert.ok(createdAuditLogs.every((entry) => entry.action === 'purchase-request.create'));

    const relevantAuditActions = Array.from(actions)
      .filter((action) => action.includes('purchase-request') || action.includes('supplier-order') || action.includes('shipment') || action.includes('discrepancy'))
      .sort();
    const roleEvidence = [
      {
        role: 'Operator',
        account: seed.username,
        status: 'PASSED',
        surface: '下单、采购确认、发货、收货、账单和付款预览',
        evidence: `${completedOrder.status}/${completedOrder.fulfillmentStatus}; ${preview.direction} ${preview.totalPayableAmount}`,
      },
      {
        role: 'Store',
        account: seed.storeUsername,
        status: 'PASSED',
        surface: '门店待收货与差异处理结果通知',
        evidence: `${shipmentNotification.title}; ${resolutionNotification.title}`,
      },
      {
        role: 'Supplier',
        account: seed.supplierUsername,
        status: 'PASSED',
        surface: '供应商收货差异通知与差异处理',
        evidence: `${discrepancyNotification.title}; discrepancy ${resolvedDiscrepancy.status}`,
      },
      {
        role: 'Purchaser',
        account: seed.username,
        status: 'PASSED',
        surface: '采购拒单通知与审计追踪',
        evidence: `${rejectionNotification.title}; ${relevantAuditActions.length} audit actions`,
      },
    ];
    const runResult = {
      generatedAt: new Date().toISOString(),
      title: 'Main Flow Demo Check',
      summary: 'Operator demo plus M5 notification and audit evidence',
      status: 'PASSED',
      roleEvidence,
      steps: [
        {
          title: '1. Store shipment notification is created',
          data: { title: shipmentNotification.title, shipmentId: shipment.id },
        },
        {
          title: '2. Supplier receipt-discrepancy notification is created',
          data: { title: discrepancyNotification.title, receiptId: discrepancyReceipt.id, discrepancyId },
        },
        {
          title: '3. Store discrepancy-resolution notification is created',
          data: { title: resolutionNotification.title, discrepancyId },
        },
        {
          title: '4. Purchaser supplier-rejection notification is created',
          data: { title: rejectionNotification.title, supplierOrderId: rejectedOrder.id },
        },
        {
          title: '5. Order and fulfillment audit actions are queryable',
          data: { actions: relevantAuditActions, filteredPurchaseRequestCreateRows: createdAuditLogs.length },
        },
        {
          title: '6. Main flow still reaches supplier payment preview',
          data: { direction: preview.direction, totalPayableAmount: preview.totalPayableAmount },
        },
      ],
    };
    await mkdir('apps/web', { recursive: true });
    await writeFile('apps/web/main-flow-demo-run.json', `${JSON.stringify(runResult, null, 2)}\n`);

    console.log('Main flow demo check passed.');
    console.log(`  Order: ${completedOrder.status} / ${completedOrder.fulfillmentStatus}`);
    console.log(`  Store notification: ${shipmentNotification.title}`);
    console.log(`  Supplier notification: ${discrepancyNotification.title}`);
    console.log(`  Resolution notification: ${resolutionNotification.title}`);
    console.log(`  Rejection notification: ${rejectionNotification.title}`);
    console.log(`  Audit actions: ${relevantAuditActions.join(', ')}`);
    console.log(`  Payment preview: ${preview.direction} ${preview.totalPayableAmount}`);
    console.log('  Wrote: apps/web/main-flow-demo-run.json');
  } finally {
    await app.close();
  }
}

await run();
