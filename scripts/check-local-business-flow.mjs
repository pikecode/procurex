import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// This acceptance run uses only authenticated business APIs, never database fixtures.
const base = 'http://127.0.0.1:3114/api/v1';
const username = process.env.LOCAL_ADMIN_USERNAME;
const password = process.env.LOCAL_ADMIN_PASSWORD;
const accountPassword = process.env.LOCAL_TEST_PASSWORD;
if (!username || !password || !accountPassword) throw new Error('Provide administrator credentials and a test-account password for this run');
const suffix = Date.now().toString(36);
const sessions = [];
async function call(path, token, body, method = body ? 'POST' : 'GET', expected = null) {
  const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'idempotency-key': `business-${randomUUID()}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const value = await response.json();
  if (expected) { assert.equal(response.status, expected, path); return value; }
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(value)}`);
  return value.data ?? value;
}
async function login(username, password) {
  const result = await call('/auth/login', null, { username, password, client: 'MINIPROGRAM' });
  sessions.push(result.accessToken); return result.accessToken;
}
try {
  const admin = await login(username, password);
  const store = await call('/stores', admin, { name: `流程验收门店-${suffix}`, contactName: '验收联系人', contactPhone: '13800138000', address: '广东省广州市天河区验收路1号', storeType: 'DIRECT' });
  const supplier = await call('/suppliers', admin, { name: `流程验收供应商-${suffix}`, deliveryMode: 'SELF', defaultSettlementMode: 'STORED_VALUE', defaultSettlementCycle: 'MONTHLY', supplierType: 'HEADQUARTERS', requiresFreight: false });
  const accounts = {};
  for (const [key, role, scope] of [['store', 'STORE', { storeId: store.id }], ['supplier', 'SUPPLIER', { supplierId: supplier.id }], ['purchaser', 'PURCHASER', {}], ['finance', 'HQ_FINANCE', {}]]) {
    accounts[key] = `flow_${key}_${suffix}`;
    const user = await call('/users', admin, { username: accounts[key], password: accountPassword, displayName: `流程验收${key}`, role, ...scope });
    assert.ok(!('passwordHash' in user) && !('password' in user));
  }
  const storeToken = await login(accounts.store, accountPassword);
  const supplierToken = await login(accounts.supplier, accountPassword);
  const purchaserToken = await login(accounts.purchaser, accountPassword);
  const financeToken = await login(accounts.finance, accountPassword);
  await call('/users', storeToken, null, 'GET', 403);
  await call('/users', supplierToken, { username: 'unauthorized', password: accountPassword, displayName: '不能创建', role: 'ADMIN' }, 'POST', 403);
  await call('/users', admin, { username: accounts.store, password: accountPassword, displayName: '重复账号', role: 'STORE', storeId: store.id }, 'POST', 409);
  await call('/auth/login', null, { username: accounts.store, password: 'incorrect-password', client: 'MINIPROGRAM' }, 'POST', 401);
  const category = await call('/categories', admin, { name: `流程验收分类-${suffix}` });
  const units = await call('/units', admin);
  const unit = units.find(item => item.name === '袋') || await call('/units', admin, { name: '袋' });
  const products = [];
  for (const [index, name, price, cost] of [[1, '验收珍珠粉圆', '12.00', '9.00'], [2, '验收茉莉茶叶', '20.00', '15.00'], [3, '验收未绑定商品', '5.00', '3.00']]) {
    products.push(await call('/products', admin, { name: `${name}-${suffix}`, categoryId: category.id, baseUnitId: unit.id, defaultSalesPrice: price, supplierIds: [supplier.id], supplierPurchasePrices: [{ supplierId: supplier.id, supplyPrice: cost, expectedVersionId: null }] }));
  }
  const template = await call('/templates', admin, { name: `流程验收模板-${suffix}`, tag: '本地业务验收' });
  const version = async () => (await call(`/templates/${template.id}`, admin)).version;
  await call(`/templates/${template.id}/items`, admin, { expectedVersion: await version(), items: products.slice(0, 2).map((product, index) => ({ productId: product.id, sortOrder: index, suppliers: [{ supplierId: supplier.id, priority: 1 }] })) }, 'PUT');
  await call(`/templates/${template.id}/supplier-settings`, admin, { expectedVersion: await version(), settings: [{ supplierId: supplier.id, settlementMode: 'STORED_VALUE', settlementCycle: 'MONTHLY' }] }, 'PUT');
  await call(`/templates/${template.id}/stores`, admin, { expectedVersion: await version(), storeIds: [store.id] }, 'PUT');
  const catalog = await call(`/stores/${store.id}/catalog`, storeToken);
  assert.equal(catalog.items.length, 2);
  assert.ok(!catalog.items.some(item => item.product.id === products[2].id));
  const collection = await call('/collection-accounts', financeToken, { name: `验收收款账户-${suffix}`, bankName: '测试收款（非实际银行）', accountName: '本地验收', accountNo: 'LOCAL-TEST-NOT-BANK' });
  await call(`/stores/${store.id}/recharges`, financeToken, { amount: '1000.00', businessDate: new Date().toISOString().slice(0, 10), collectionAccountId: collection.id, remark: '本地业务流程验收，无实际资金转账' });
  const input = { storeId: store.id, items: [{ productId: products[0].id, quantity: '10.000000' }] };
  const preview = await call('/purchase-requests/preview', storeToken, input);
  assert.equal(preview.totals.salesGoodsAmount, '120.00');
  const request = await call('/purchase-requests', storeToken, input);
  const reserved = await call(`/stores/${store.id}/account`, financeToken);
  assert.equal(reserved.balance, '1000.00'); assert.equal(reserved.reservedBalance, '120.00');
  const detail = await call(`/purchase-requests/${request.id}`, purchaserToken);
  const confirmed = await call(`/purchase-requests/${request.id}/confirm`, purchaserToken, { expectedVersion: detail.version });
  const orderId = confirmed.supplierOrderIds[0]; assert.ok(orderId);
  const order = await call(`/supplier-orders/${orderId}`, supplierToken);
  const shipment = await call(`/supplier-orders/${orderId}/shipments`, supplierToken, { expectedVersion: order.version, freight: '0.00', trackingNo: `LOCAL-${suffix}`, items: order.items.map(item => ({ orderItemId: item.id, shipQuantity: item.quantity, permanentlyReduceQuantity: '0.000000' })) });
  const shipped = await call(`/shipments/${shipment.id}`, storeToken);
  await call(`/shipments/${shipment.id}/receipts`, storeToken, { expectedOrderVersion: shipped.supplierOrderVersion, expectedReceiptRevision: shipped.currentReceiptRevision, items: shipped.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: item.shippedQuantity })) });
  const completed = await call(`/supplier-orders/${orderId}`, purchaserToken);
  assert.equal(completed.fulfillmentStatus, 'COMPLETED');
  const after = await call(`/stores/${store.id}/account`, financeToken);
  assert.equal(after.balance, '880.00'); assert.equal(after.reservedBalance, '0.00');
  console.log(JSON.stringify({ accounts, store: store.name, storeId: store.id, supplierId: supplier.id, requestId: request.id, orderId, status: completed.fulfillmentStatus, balance: after.balance, credentialsStoredInFiles: false }, null, 2));
} finally { for (const token of sessions) await call('/auth/logout', token, {}).catch(() => {}); }
