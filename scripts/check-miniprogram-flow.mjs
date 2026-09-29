import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const seed = JSON.parse(await readFile('apps/web/main-flow-demo-seed.json', 'utf8'));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

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
  const result = await request(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: seed.password, client: 'MINIPROGRAM' }),
  });
  return { token: result.accessToken, user: result.user };
}

function authHeaders(token, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...extra,
  };
}

function idempotencyKey(prefix) {
  return `mini-flow-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function loadRoleReports(baseUrl, token, role) {
  const reportRange = 'from=2026-09-01&to=2026-09-30';
  const [orderAmount, productQuantity] = await Promise.all([
    request(`${baseUrl}/reports/order-amounts?${reportRange}`, { headers: authHeaders(token) }),
    request(`${baseUrl}/reports/product-quantities?${reportRange}`, { headers: authHeaders(token) }),
  ]);
  assert.ok(Array.isArray(orderAmount.months), `${role} order report must return months`);
  assert.ok(Array.isArray(productQuantity.products), `${role} product report must return products`);
  return { orderAmount, productQuantity };
}

async function createPurchaseRequest(baseUrl, storeToken, label, quantity = seed.quantity) {
  const preview = await request(`${baseUrl}/purchase-requests/preview`, {
    method: 'POST',
    headers: authHeaders(storeToken),
    body: JSON.stringify({
      storeId: seed.storeId,
      items: [{ productId: seed.productId, quantity }],
    }),
  });
  assert.equal(preview.totals.salesGoodsAmount, seed.expectedSalesAmount);

  const created = await request(`${baseUrl}/purchase-requests`, {
    method: 'POST',
    headers: authHeaders(storeToken, { 'idempotency-key': idempotencyKey(`${label}-create`) }),
    body: JSON.stringify({
      storeId: seed.storeId,
      items: [{ productId: seed.productId, quantity }],
    }),
  });
  assert.equal(created.status, 'PENDING_PROCUREMENT');
  assert.equal(created.paymentStatus, 'PAID');
  return created;
}

async function confirmPurchaseRequest(baseUrl, purchaserToken, requestId, label) {
  const detail = await request(`${baseUrl}/purchase-requests/${requestId}`, {
    headers: authHeaders(purchaserToken),
  });
  assert.equal(detail.shortfallAmount, '0.00');

  const confirmed = await request(`${baseUrl}/purchase-requests/${requestId}/confirm`, {
    method: 'POST',
    headers: authHeaders(purchaserToken, { 'idempotency-key': idempotencyKey(`${label}-confirm`) }),
    body: JSON.stringify({ expectedVersion: detail.version }),
  });
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal(confirmed.supplierOrderIds.length, 1);
  return confirmed.supplierOrderIds[0];
}

async function shipSupplierOrder(baseUrl, supplierToken, supplierOrderId, label) {
  const order = await request(`${baseUrl}/supplier-orders/${supplierOrderId}`, {
    headers: authHeaders(supplierToken),
  });
  const items = order.items.map((item) => ({
    orderItemId: item.id,
    shipQuantity: item.quantity,
    permanentlyReduceQuantity: '0.000000',
  }));
  const preview = await request(`${baseUrl}/supplier-orders/${supplierOrderId}/shipment-preview`, {
    method: 'POST',
    headers: authHeaders(supplierToken),
    body: JSON.stringify({ expectedVersion: order.version, items, freight: '0.00' }),
  });
  assert.equal(preview.supplierOrderId, supplierOrderId);
  assert.ok(preview.items.length > 0);

  const shipment = await request(`${baseUrl}/supplier-orders/${supplierOrderId}/shipments`, {
    method: 'POST',
    headers: authHeaders(supplierToken, { 'idempotency-key': idempotencyKey(`${label}-ship`) }),
    body: JSON.stringify({
      expectedVersion: order.version,
      items,
      freight: '0.00',
      trackingNo: `MINI${Date.now()}`,
    }),
  });
  assert.equal(shipment.kind, 'INITIAL');
  return shipment;
}

async function receiveShipment(baseUrl, storeToken, shipmentId, mode) {
  const detail = await request(`${baseUrl}/shipments/${shipmentId}`, {
    headers: authHeaders(storeToken),
  });
  const items = detail.items.map((item, index) => ({
    shipmentItemId: item.id,
    receivedQuantity: mode === 'SHORT' && index === 0 ? '8.000000' : item.shippedQuantity,
  }));
  const receipt = await request(`${baseUrl}/shipments/${shipmentId}/receipts`, {
    method: 'POST',
    headers: authHeaders(storeToken, { 'idempotency-key': idempotencyKey(`receipt-${mode}`) }),
    body: JSON.stringify({
      expectedOrderVersion: detail.supplierOrderVersion,
      expectedReceiptRevision: detail.currentReceiptRevision,
      items,
    }),
  });
  assert.equal(receipt.revision, detail.currentReceiptRevision + 1);
  return receipt;
}

async function createReadyPaymentEvidence(ownerId) {
  return prisma.fileObject.create({
    data: {
      filename: 'mini-flow-payment.txt',
      mimeType: 'text/plain',
      sizeBytes: 12n,
      objectKey: `mini-flow-payment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      uploadTokenHash: '0'.repeat(64),
      purpose: 'PAYMENT',
      status: 'READY',
      ownerId,
    },
  });
}

async function run() {
  const { app, baseUrl } = await createAcceptanceApp();
  try {
    const purchaser = await login(baseUrl, seed.username);
    const store = await login(baseUrl, seed.storeUsername);
    const supplier = await login(baseUrl, seed.supplierUsername);

    const storeAccount = await request(`${baseUrl}/stores/${seed.storeId}/account`, {
      headers: authHeaders(store.token),
    });
    assert.equal(storeAccount.storeId, seed.storeId);
    const ledgers = await request(`${baseUrl}/stores/${seed.storeId}/ledgers`, {
      headers: authHeaders(store.token),
    });
    assert.ok(Array.isArray(ledgers));

    const normalRequest = await createPurchaseRequest(baseUrl, store.token, 'normal');
    const storeRequests = await request(`${baseUrl}/purchase-requests`, {
      headers: authHeaders(store.token),
    });
    assert.ok(storeRequests.some((item) => item.id === normalRequest.id));

    const supplierOrderId = await confirmPurchaseRequest(baseUrl, purchaser.token, normalRequest.id, 'normal');
    const supplierOrders = await request(`${baseUrl}/supplier-orders`, {
      headers: authHeaders(supplier.token),
    });
    assert.ok(supplierOrders.some((item) => item.id === supplierOrderId));

    const shipment = await shipSupplierOrder(baseUrl, supplier.token, supplierOrderId, 'normal');
    const storeNotifications = await request(`${baseUrl}/notifications`, {
      headers: authHeaders(store.token),
    });
    const shipmentNotification = storeNotifications.notifications.find((item) => item.payload?.shipmentId === shipment.id);
    assert.equal(shipmentNotification?.title, '待收货提醒');

    const receipt = await receiveShipment(baseUrl, store.token, shipment.id, 'FULL');
    const completedOrder = await request(`${baseUrl}/supplier-orders/${supplierOrderId}`, {
      headers: authHeaders(purchaser.token),
    });
    assert.equal(completedOrder.fulfillmentStatus, 'COMPLETED');

    const statements = await request(`${baseUrl}/supplier-statements`, {
      headers: authHeaders(supplier.token),
    });
    const statement = statements.find((item) => item.supplierId === seed.supplierId);
    assert.ok(statement);
    const statementDetail = await request(`${baseUrl}/supplier-statements/${encodeURIComponent(statement.id)}`, {
      headers: authHeaders(supplier.token),
    });
    assert.ok(statementDetail.lines.length > 0);

    const preview = await request(`${baseUrl}/payment-records/preview`, {
      method: 'POST',
      headers: authHeaders(purchaser.token),
      body: JSON.stringify({ settlementItemIds: [statementDetail.lines[0].settlementItemId] }),
    });
    assert.equal(preview.direction, 'COMPANY_TO_SUPPLIER');
    const evidence = await createReadyPaymentEvidence(purchaser.user.id);
    const payment = await request(`${baseUrl}/payment-records`, {
      method: 'POST',
      headers: authHeaders(purchaser.token, { 'idempotency-key': idempotencyKey('payment-create') }),
      body: JSON.stringify({
        direction: preview.direction,
        businessDate: '2026-09-28',
        evidenceFileIds: [evidence.id],
        remark: 'Mini-program flow check payment',
        items: [{
          settlementItemId: preview.items[0].settlementItemId,
          expectedVersion: preview.items[0].sourceVersion,
          expectedAmount: preview.items[0].payableAmount,
        }],
      }),
    });
    assert.equal(payment.status, 'PENDING');
    const supplierPayments = await request(`${baseUrl}/payment-records?direction=COMPANY_TO_SUPPLIER`, {
      headers: authHeaders(supplier.token),
    });
    assert.ok(supplierPayments.some((item) => item.id === payment.id));
    const paymentDetail = await request(`${baseUrl}/payment-records/${payment.id}`, {
      headers: authHeaders(supplier.token),
    });
    const confirmedPayment = await request(`${baseUrl}/payment-records/${payment.id}/confirm`, {
      method: 'POST',
      headers: authHeaders(supplier.token, { 'idempotency-key': idempotencyKey('payment-confirm') }),
      body: JSON.stringify({ expectedVersion: paymentDetail.version }),
    });
    assert.equal(confirmedPayment.status, 'CONFIRMED');

    const [storeReports, supplierReports, purchaserReportsBase] = await Promise.all([
      loadRoleReports(baseUrl, store.token, 'Store'),
      loadRoleReports(baseUrl, supplier.token, 'Supplier'),
      loadRoleReports(baseUrl, purchaser.token, 'Purchaser'),
    ]);
    const reportRange = 'from=2026-09-01&to=2026-09-30';
    const purchaserProfit = await request(`${baseUrl}/reports/profit?${reportRange}`, {
      headers: authHeaders(purchaser.token),
    });
    assert.ok(purchaserProfit.totals);
    assert.ok(Array.isArray(purchaserProfit.rows));
    const supplierProfit = await fetch(`${baseUrl}/reports/profit?${reportRange}`, {
      headers: authHeaders(supplier.token),
    });
    assert.equal(supplierProfit.status, 403);

    const discrepancyRequest = await createPurchaseRequest(baseUrl, store.token, 'discrepancy');
    const discrepancySupplierOrderId = await confirmPurchaseRequest(baseUrl, purchaser.token, discrepancyRequest.id, 'discrepancy');
    const discrepancyShipment = await shipSupplierOrder(baseUrl, supplier.token, discrepancySupplierOrderId, 'discrepancy');
    const shortReceipt = await receiveShipment(baseUrl, store.token, discrepancyShipment.id, 'SHORT');
    const supplierNotifications = await request(`${baseUrl}/notifications`, {
      headers: authHeaders(supplier.token),
    });
    const discrepancyNotification = supplierNotifications.notifications.find((item) => item.payload?.receiptId === shortReceipt.id);
    assert.equal(discrepancyNotification?.title, '收货差异待处理');
    const discrepancyId = discrepancyNotification.payload.discrepancyIds[0];
    const discrepancy = await request(`${baseUrl}/discrepancies/${discrepancyId}`, {
      headers: authHeaders(supplier.token),
    });
    const resolved = await request(`${baseUrl}/discrepancies/${discrepancyId}/resolve`, {
      method: 'POST',
      headers: authHeaders(supplier.token, { 'idempotency-key': idempotencyKey('discrepancy-accept') }),
      body: JSON.stringify({
        expectedVersion: discrepancy.version,
        action: 'ACCEPT',
        reason: 'Mini-program flow check accepts short receipt',
      }),
    });
    assert.equal(resolved.status, 'RESOLVED');

    const rejectionRequest = await createPurchaseRequest(baseUrl, store.token, 'rejection');
    const rejectionSupplierOrderId = await confirmPurchaseRequest(baseUrl, purchaser.token, rejectionRequest.id, 'rejection');
    const rejectionOrder = await request(`${baseUrl}/supplier-orders/${rejectionSupplierOrderId}`, {
      headers: authHeaders(supplier.token),
    });
    const rejected = await request(`${baseUrl}/supplier-orders/${rejectionSupplierOrderId}/reject`, {
      method: 'POST',
      headers: authHeaders(supplier.token, { 'idempotency-key': idempotencyKey('supplier-reject') }),
      body: JSON.stringify({
        expectedVersion: rejectionOrder.version,
        reason: 'Mini-program flow check supplier rejection',
      }),
    });
    assert.equal(rejected.status, 'REJECTED');
    const purchaserNotifications = await request(`${baseUrl}/notifications`, {
      headers: authHeaders(purchaser.token),
    });
    const rejectionNotification = purchaserNotifications.notifications.find((item) => item.payload?.supplierOrderId === rejectionSupplierOrderId);
    assert.equal(rejectionNotification?.title, '供应商拒单待处理');
    const rejectionDetail = await request(`${baseUrl}/purchase-requests/${rejectionRequest.id}`, {
      headers: authHeaders(purchaser.token),
    });
    const reallocated = await request(`${baseUrl}/purchase-requests/${rejectionRequest.id}/reallocate`, {
      method: 'POST',
      headers: authHeaders(purchaser.token, { 'idempotency-key': idempotencyKey('reallocate') }),
      body: JSON.stringify({
        expectedVersion: rejectionDetail.version,
        rejectedOrderId: rejectionSupplierOrderId,
        reason: 'Mini-program flow check supplier rejection reallocation',
        assignments: rejectionDetail.items.map((item) => ({
          requestItemId: item.id,
          supplierId: seed.secondarySupplierId,
        })),
      }),
    });
    assert.equal(reallocated.status, 'CONFIRMED');
    assert.ok(reallocated.supplierOrders.some((item) => item.supplierId === seed.secondarySupplierId));

    const result = {
      generatedAt: new Date().toISOString(),
      title: 'Mini-program Flow Check',
      status: 'PASSED',
      summary: 'Native mini-program role APIs are reachable through Store, Purchaser, and Supplier flows.',
      evidence: {
        store: {
          accountStoreId: storeAccount.storeId,
          purchaseRequestId: normalRequest.id,
          shipmentNotification: shipmentNotification.title,
          receiptNo: receipt.receiptNo,
          reportOrderRows: storeReports.orderAmount.orders.length,
          reportProductRows: storeReports.productQuantity.products.length,
        },
        purchaser: {
          confirmedRequestId: normalRequest.id,
          rejectionNotification: rejectionNotification.title,
          reallocatedRequestStatus: reallocated.status,
          secondarySupplierId: seed.secondarySupplierId,
          reportOrderRows: purchaserReportsBase.orderAmount.orders.length,
          reportProductRows: purchaserReportsBase.productQuantity.products.length,
          profitRows: purchaserProfit.rows.length,
        },
        supplier: {
          supplierOrderId,
          shipmentNo: shipment.shipmentNo,
          statementId: statement.id,
          paymentStatus: confirmedPayment.status,
          discrepancyStatus: resolved.status,
          reportOrderRows: supplierReports.orderAmount.orders.length,
          reportProductRows: supplierReports.productQuantity.products.length,
          profitDeniedStatus: supplierProfit.status,
        },
      },
      coveredEndpoints: [
        'POST /auth/login',
        'GET /stores/{id}/account',
        'GET /stores/{id}/ledgers',
        'POST /purchase-requests/preview',
        'POST /purchase-requests',
        'GET /purchase-requests',
        'GET /purchase-requests/{id}',
        'POST /purchase-requests/{id}/confirm',
        'POST /purchase-requests/{id}/reallocate',
        'GET /supplier-orders',
        'GET /supplier-orders/{id}',
        'POST /supplier-orders/{id}/shipment-preview',
        'POST /supplier-orders/{id}/shipments',
        'POST /supplier-orders/{id}/reject',
        'GET /notifications',
        'GET /shipments/{id}',
        'POST /shipments/{id}/receipts',
        'GET /discrepancies/{id}',
        'POST /discrepancies/{id}/resolve',
        'GET /supplier-statements',
        'GET /supplier-statements/{id}',
        'GET /payment-records',
        'GET /payment-records/{id}',
        'POST /payment-records/preview',
        'POST /payment-records',
        'POST /payment-records/{id}/confirm',
        'GET /reports/order-amounts',
        'GET /reports/product-quantities',
        'GET /reports/profit',
      ],
    };
    await mkdir('apps/miniprogram', { recursive: true });
    await writeFile('apps/miniprogram/mini-flow-check.json', `${JSON.stringify(result, null, 2)}\n`);

    console.log('Mini-program flow check passed.');
    console.log(`  Store receipt: ${receipt.receiptNo}`);
    console.log(`  Supplier payment: ${confirmedPayment.status}`);
    console.log(`  Supplier discrepancy: ${resolved.status}`);
    console.log(`  Purchaser reallocation: ${reallocated.status}`);
    console.log('  Wrote: apps/miniprogram/mini-flow-check.json');
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

await run();
