import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const local = process.argv.includes('--local');
const seed = JSON.parse(await readFile(local ? '.env.mini-local-test.json' : '.env.mini-test.json', 'utf8'));
const admin = JSON.parse(await readFile(local ? 'apps/web/main-flow-demo-seed.json' : '.env.deploy-access.json', 'utf8'));
const base = local ? 'http://127.0.0.1:3114/api/v1' : 'http://8.138.19.56:8080/api/v1';
async function call(path, token, body, command = false) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(command ? { 'idempotency-key': `mini-test-${randomUUID()}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);
  return result.data ?? result;
}
const tokens = [];
try {
  const login = async account => {
    const result = await call('/auth/login', null, { ...account, client: 'MINIPROGRAM' });
    tokens.push(result.accessToken);
    return result.accessToken;
  };
  const adminToken = await login({ username: admin.username || 'admin', password: admin.password });
  const store = await login(seed.accounts.store);
  const purchaser = await login(seed.accounts.purchaser);
  const supplier = await login(seed.accounts.supplier);
  const catalog = await call(`/stores/${seed.storeId}/catalog`, store);
  for (const product of seed.products) assert.ok(catalog.items.some(item => item.product.id === product.id));
  await call(`/stores/${seed.storeId}/recharges`, adminToken, { amount: '1000.00', businessDate: new Date().toISOString().slice(0, 10), collectionAccountId: seed.collectionAccountId, remark: '小程序流程测试充值，非真实收款' }, true);
  const before = await call(`/stores/${seed.storeId}/account`, adminToken);
  const input = { storeId: seed.storeId, items: [{ productId: seed.products[0].id, quantity: '10.000000' }] };
  const preview = await call('/purchase-requests/preview', store, input);
  assert.equal(preview.totals.salesGoodsAmount, '120.00');
  const request = await call('/purchase-requests', store, input, true);
  assert.equal(request.status, 'PENDING_PROCUREMENT');
  const reserved = await call(`/stores/${seed.storeId}/account`, adminToken);
  assert.equal(reserved.balance, before.balance);
  assert.equal(Number(reserved.reservedBalance) - Number(before.reservedBalance), 120);
  const detail = await call(`/purchase-requests/${request.id}`, purchaser);
  const confirmed = await call(`/purchase-requests/${request.id}/confirm`, purchaser, { expectedVersion: detail.version }, true);
  assert.equal(confirmed.supplierOrderIds.length, 1);
  const orderId = confirmed.supplierOrderIds[0];
  const order = await call(`/supplier-orders/${orderId}`, supplier);
  const shipment = await call(`/supplier-orders/${orderId}/shipments`, supplier, { expectedVersion: order.version, items: order.items.map(item => ({ orderItemId: item.id, shipQuantity: item.quantity, permanentlyReduceQuantity: '0.000000' })), freight: '0.00', trackingNo: `TEST-${Date.now()}` }, true);
  const shipped = await call(`/shipments/${shipment.id}`, store);
  await call(`/shipments/${shipment.id}/receipts`, store, { expectedOrderVersion: shipped.supplierOrderVersion, expectedReceiptRevision: shipped.currentReceiptRevision, items: shipped.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: item.shippedQuantity })) }, true);
  const completed = await call(`/supplier-orders/${orderId}`, purchaser);
  assert.equal(completed.fulfillmentStatus, 'COMPLETED');
  const after = await call(`/stores/${seed.storeId}/account`, adminToken);
  assert.equal(Number(before.balance) - Number(after.balance), 120);
  assert.equal(after.reservedBalance, before.reservedBalance);
  const report = { testedAt: new Date().toISOString(), base, requestId: request.id, supplierOrderId: orderId, shipmentId: shipment.id, fulfillmentStatus: completed.fulfillmentStatus, before, reserved, after };
  await writeFile(local ? '.env.mini-local-test-result.json' : '.env.mini-test-result.json', JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ requestId: request.id, orderId, status: completed.fulfillmentStatus, balanceBefore: before.balance, balanceAfter: after.balance }));
} finally {
  for (const token of tokens) await call('/auth/logout', token, {}).catch(() => {});
}
