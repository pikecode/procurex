import assert from 'node:assert/strict';

const base = process.env.PROCUREX_API_BASE || 'http://127.0.0.1:3114/api/v1';
assert.equal(new URL(base).hostname, '127.0.0.1', 'This check only supports the local numbered test environment');
const tokens = {};
async function call(path, token, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: await response.json() };
}
try {
  for (const username of ['store1', 'store2', 'storefin1', 'buyer1', 'buyer2', 'supplier1']) {
    const result = await call('/auth/login', null, { username, password: process.env.ORDER_CENTER_TEST_PASSWORD || '12345678', client: 'ORDER_CENTER_READ_CHECK' });
    assert.equal(result.status, 201, `${username}: login failed`); tokens[username] = result.body.data.accessToken;
  }
  const list = await call('/supplier-orders', tokens.store1);
  assert.equal(list.status, 200);
  assert.ok(list.body.data.length, 'Submit and confirm at least one store1 request through the normal flow before this read-only check');
  const order = list.body.data[0];
  assert.ok(order.requestNo); assert.equal('supplyGoodsAmount' in order, false);
  const detail = await call(`/supplier-orders/${order.id}`, tokens.store1);
  assert.equal(detail.status, 200); assert.ok(detail.body.data.items.length);
  assert.equal('supplyUnitPrice' in detail.body.data.items[0], false);
  assert.equal((await call('/supplier-orders', tokens.storefin1)).status, 200);
  assert.equal((await call(`/supplier-orders/${order.id}`, tokens.store2)).status, 404);
  assert.equal((await call(`/supplier-orders?storeId=${order.storeId}`, tokens.store2)).status, 403);
  for (const username of ['buyer1', 'buyer2']) {
    const result = await call(`/supplier-orders/${order.id}`, tokens[username]);
    assert.equal(result.status, 200); assert.ok(result.body.data.supplyGoodsAmount);
  }
  const supplier = await call('/supplier-orders', tokens.supplier1);
  assert.equal(supplier.status, 200);
  assert.ok(supplier.body.data.every(row => !('salesGoodsAmount' in row)));
  if (order.status === 'COMPLETED') {
    const report = await call(`/reports/order-amounts?storeId=${order.storeId}`, tokens.buyer1);
    assert.equal(report.status, 200);
    assert.equal(report.body.data.orders.find(row => row.supplierOrderId === order.id)?.requestNo, order.requestNo);
  }
  console.log('PASS: local real HTTP order reads, source numbers, store isolation, assigned purchasing and price privacy. No business records written.');
} finally {
  for (const token of Object.values(tokens)) await call('/auth/logout', token, {}).catch(() => {});
}
