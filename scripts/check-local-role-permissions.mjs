import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.LOCAL_API_BASE || 'http://127.0.0.1:3114/api/v1';
if (!/^http:\/\/127\.0\.0\.1:\d+\/api\/v1$/.test(base)) throw new Error('This acceptance script may only run against a local API');
const { LOCAL_ADMIN_USERNAME, LOCAL_ADMIN_PASSWORD, LOCAL_TEST_PASSWORD } = process.env;
if (!LOCAL_ADMIN_USERNAME || !LOCAL_ADMIN_PASSWORD || !LOCAL_TEST_PASSWORD) throw new Error('Provide local administrator and test-account credentials');
const suffix = Date.now().toString(36);
const sessions = []; const accounts = []; let admin; let checks = 0;
async function call(path, token, body, method = body === undefined ? 'GET' : 'POST', expected = 200) {
  const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), 'idempotency-key': randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const value = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`); checks++;
  return value.data;
}
async function login(username, password) {
  const result = await call('/auth/login', null, { username, password, client: 'WEB' }, 'POST', 201);
  sessions.push(result.accessToken); return result.accessToken;
}
try {
  admin = await login(LOCAL_ADMIN_USERNAME, LOCAL_ADMIN_PASSWORD);
  const orders = await call('/supplier-orders', admin);
  const order = orders.find(row => row.storeId && row.supplierId);
  assert.ok(order, 'Run the local business-flow acceptance first to provide a real order');
  const suppliers = await call('/suppliers', admin);
  const ownSupplier = suppliers.find(row => row.id === order.supplierId && row.status === 'ACTIVE');
  assert.ok(ownSupplier);
  const foreignStore = await call('/stores', admin, { name: `权限验收门店-${suffix}`, storeType: 'DIRECT', contactName: '权限验收联系人', contactPhone: '13800138000', address: '广东省广州市天河区权限验收路1号' }, 'POST', 201);
  const foreignSupplier = await call('/suppliers', admin, { name: `权限验收供应商-${suffix}`, deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY', supplierType: 'HEADQUARTERS', requiresFreight: false }, 'POST', 201);
  const roles = ['ADMIN', 'PURCHASER', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER'];
  const tokens = {};
  for (const role of [...roles, 'FOREIGN_STORE', 'FOREIGN_SUPPLIER']) {
    const actualRole = role === 'FOREIGN_STORE' ? 'STORE' : role === 'FOREIGN_SUPPLIER' ? 'SUPPLIER' : role;
    const scope = actualRole === 'STORE' || actualRole === 'STORE_FINANCE' ? { storeId: role === 'FOREIGN_STORE' ? foreignStore.id : order.storeId } : actualRole === 'SUPPLIER' ? { supplierId: role === 'FOREIGN_SUPPLIER' ? foreignSupplier.id : ownSupplier.id } : {};
    const user = await call('/users', admin, { username: `permissions_${role.toLowerCase()}_${suffix}`, displayName: `权限验收-${role}`, password: LOCAL_TEST_PASSWORD, role: actualRole, ...scope }, 'POST', 201);
    accounts.push(user); tokens[role] = await login(user.username, LOCAL_TEST_PASSWORD);
  }
  const reads = [
    ['/users', ['ADMIN']], ['/templates', ['ADMIN', 'PURCHASER']],
    ['/collection-accounts', ['ADMIN', 'HQ_FINANCE']], ['/products', ['ADMIN', 'PURCHASER', 'HQ_FINANCE']],
    ['/supplier-orders', ['ADMIN', 'PURCHASER', 'HQ_FINANCE', 'SUPPLIER']],
    ['/purchase-requests', roles.filter(role => role !== 'SUPPLIER')],
    ['/discrepancies', ['ADMIN', 'SUPPLIER']], ['/reports/profit', ['ADMIN', 'PURCHASER', 'HQ_FINANCE']],
  ];
  for (const role of roles) for (const [path, allowed] of reads) await call(path, tokens[role], undefined, 'GET', allowed.includes(role) ? 200 : 403);
  const writes = [
    ['/users', ['ADMIN']], ['/stores', ['ADMIN']], ['/products', ['ADMIN', 'PURCHASER']],
    [`/purchase-requests/${order.requestId || randomUUID()}/confirm`, ['ADMIN', 'PURCHASER']],
    [`/supplier-orders/${order.id}/shipments`, ['ADMIN', 'SUPPLIER']],
    [`/stores/${order.storeId}/recharges`, ['ADMIN', 'HQ_FINANCE']],
    ['/payment-records', ['ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE']],
    [`/payment-records/${randomUUID()}/confirm`, ['ADMIN', 'HQ_FINANCE', 'SUPPLIER']],
  ];
  for (const role of roles) for (const [path, allowed] of writes) if (!allowed.includes(role)) await call(path, tokens[role], { roles: ['ADMIN'], actorUserId: accounts[0].id, scope: { type: 'COMPANY' } }, 'POST', 403);
  for (const role of ['STORE', 'STORE_FINANCE']) {
    const requests = await call('/purchase-requests', tokens[role]);
    assert.ok(requests.every(row => row.storeId === order.storeId));
    await call(`/stores/${foreignStore.id}/account`, tokens[role], undefined, 'GET', 403);
    await call(`/stores/${foreignStore.id}/catalog`, tokens[role], undefined, 'GET', 403);
    await call(`/reports/order-amounts?storeId=${foreignStore.id}`, tokens[role], undefined, 'GET', 400);
    await call('/exports', tokens[role], { reportType: 'order-amounts', filters: { storeId: foreignStore.id } }, 'POST', 403);
  }
  const ownOrders = await call('/supplier-orders', tokens.SUPPLIER);
  assert.ok(ownOrders.every(row => row.supplierId === ownSupplier.id));
  await call(`/supplier-orders/${order.id}`, tokens.SUPPLIER);
  await call(`/supplier-orders/${order.id}`, tokens.FOREIGN_SUPPLIER, undefined, 'GET', 404);
  await call(`/supplier-orders?supplierId=${foreignSupplier.id}`, tokens.SUPPLIER, undefined, 'GET', 403);
  await call(`/reports/order-amounts?supplierId=${foreignSupplier.id}`, tokens.SUPPLIER, undefined, 'GET', 400);
  await call('/exports', tokens.SUPPLIER, { reportType: 'order-amounts', filters: { supplierId: foreignSupplier.id } }, 'POST', 403);
  const job = await call('/exports', tokens.STORE, { reportType: 'order-amounts', filters: {} }, 'POST', 202);
  assert.ok(job.jobId);
  await call(`/exports/${job.jobId}`, tokens.FOREIGN_STORE, undefined, 'GET', 404);
  await call(`/exports/${job.jobId}/download`, tokens.FOREIGN_STORE, undefined, 'GET', 404);
  // An uploaded private voucher remains inaccessible to another store or supplier.
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
  const file = await call('/files/upload-sessions', tokens.STORE, { filename: '权限验收凭证.png', mimeType: 'image/png', sizeBytes: bytes.length, purpose: 'RECEIPT' }, 'POST', 201);
  const upload = await fetch(base + `/files/${file.id}/content`, { method: 'POST', headers: { authorization: `Bearer ${tokens.STORE}`, 'content-type': 'application/octet-stream', 'x-upload-token': file.uploadToken }, body: bytes });
  assert.ok(upload.ok, await upload.text());
  await call(`/files/${file.id}/complete`, tokens.STORE, {}, 'POST', 201);
  const ownedDownload = await fetch(base + `/files/${file.id}/download`, { headers: { authorization: `Bearer ${tokens.STORE}` } });
  assert.equal(ownedDownload.status, 200);
  assert.deepEqual(Buffer.from(await ownedDownload.arrayBuffer()), bytes); checks++;
  for (const role of ['FOREIGN_STORE', 'FOREIGN_SUPPLIER']) {
    const response = await fetch(base + `/files/${file.id}/download`, { headers: { authorization: `Bearer ${tokens[role]}` } });
    assert.equal(response.status, 404); checks++;
  }
  const user = accounts.find(row => row.roles.includes('PURCHASER'));
  await call(`/users/${user.id}`, admin, { expectedVersion: user.version, role: 'HQ_FINANCE', scope: { type: 'COMPANY' } }, 'PATCH');
  const audit = await call(`/audit-logs?entityType=User&entityId=${user.id}`, admin);
  const change = audit.find(row => row.action === 'user.update');
  assert.deepEqual(change.before.roles, ['PURCHASER']); assert.deepEqual(change.after.roles, ['HQ_FINANCE']);
  assert.ok(!JSON.stringify(audit).includes(LOCAL_TEST_PASSWORD));
  console.log(JSON.stringify({ status: 'PASSED', roles: roles.length, checks, businessApisOnly: true, testAccountCount: accounts.length }));
} finally {
  if (admin) for (const user of accounts) {
    const current = (await call('/users', admin)).find(row => row.id === user.id);
    await call(`/users/${user.id}`, admin, { expectedVersion: current.version, status: 'DISABLED' }, 'PATCH');
  }
  for (const token of sessions) await call('/auth/logout', token, {}, 'POST', 201).catch(() => {});
}
