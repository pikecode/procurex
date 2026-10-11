import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { Decimal } from 'decimal.js';

const password = process.env.LOCAL_TEST_PASSWORD;
assert.ok(password, 'LOCAL_TEST_PASSWORD required');
const base = process.env.PROCUREX_API_BASE || 'http://127.0.0.1:3114/api/v1';
const project = resolve('apps/miniprogram');
const returned = process.argv.includes('--return');
const replenish = process.argv.includes('--replenish');
const difference = replenish || returned || process.argv.includes('--difference');
const output = resolve(`var/native-current-regression/${replenish ? 'difference-replenish' : returned ? 'difference-return' : difference ? 'difference-accept' : 'journey'}`);
mkdirSync(output, { recursive: true });
const resume = process.argv.includes('--resume') ? JSON.parse(readFileSync(resolve(output, 'manifest.json'), 'utf8')) : null;
const evidence = { generatedAt: new Date().toISOString(), realDevice: false, status: 'RUNNING',
  businessWrites: 'Native page methods against real local API',
  imageSelection: 'Synthetic image downloaded into simulator; not camera/album verification', steps: [], ...(resume || {}), status: 'RUNNING' };
function tool(name, options = {}) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  const args = ['-c', 'Codex', name, '--project', project];
  for (const [key, value] of Object.entries(options)) args.push(`--${key}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
  const result = spawnSync('/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const start = result.stdout.indexOf('{');
  assert.ok(start >= 0, `${name}: no result`);
  const body = JSON.parse(result.stdout.slice(start));
  assert.ok(result.status === 0 && body.ok && body.result?.success !== false, `${name}: ${body.message || body.result?.error || 'failed'}`);
  return body.result;
}
const data = path => tool('automation_page_action', { action: 'getData', 'data-path': path }).data;
const event = (id, extra = {}) => ({ currentTarget: { dataset: { id, ...extra } } });
function method(name, arg) {
  const path = resolve(output, 'args.json');
  writeFileSync(path, JSON.stringify(arg ? [arg] : []));
  return tool('automation_page_action', { action: 'callMethod', method: name, 'args-file': path });
}
function wait(path, predicate) {
  for (let i = 0; i < 15; i++) { const value = data(path); if (predicate(value)) return value; }
  throw new Error(`Missing ${path}: ${data('error')}`);
}
function step(name) {
  assert.equal(data('error') || '', '', name);
  tool('simulator_screenshot', { path: resolve(output, `${name}.jpg`) });
  if (!evidence.steps.includes(name)) evidence.steps.push(name);
  console.log(`Native journey passed: ${name}`);
}
function login(username, workspace) {
  tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
  tool('automation_page_action', { action: 'setData', 'wait-for-selector': '.primary', patch: JSON.stringify({ username, password }) });
  tool('automation_element_action', { action: 'tap', selector: '.primary', 'wait-for-selector': '.primary' });
  let current;
  for (let i = 0; i < 15; i++) { current = tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path; if (current !== 'pages/login/index') break; }
  assert.equal(current, `pages/${workspace}/index`, `Login navigation failed: ${data('error')}`);
  wait('loading', value => value === false);
  wait('user', value => value?.username === username);
}
let token;
async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { authorization: `Bearer ${token}`, connection: 'close', ...options.headers } });
  const body = await response.json();
  assert.ok(response.ok, `${path}: ${body.message || response.status}`);
  return body.data || body;
}
try {
  let request, detail, order, shipment, accountBefore;
  tool('automation_evaluate', { 'fn-source': `function() { getApp().globalData.apiBase = ${JSON.stringify(base)}; return true; }` });
  login('test_chef_stored', 'store');
  const auth = await api('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test_chef_stored', password, client: 'WEB' }) });
  token = auth.accessToken;
  if (process.env.RECHARGE_AMOUNT && !resume) {
    const hq = await api('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test_hq_finance', password, client: 'WEB' }) });
    const storeId = auth.user.scope.storeId;
    const oldToken = token;
    token = hq.accessToken;
    const bytes = await sharp({ create: { width: 180, height: 120, channels: 3, background: '#28785b' } }).png().toBuffer();
    const file = await api('/files/upload-sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ purpose: 'RECHARGE', filename: 'local-test-recharge.png', mimeType: 'image/png', sizeBytes: bytes.length }) });
    await api(`/files/${file.id}/content`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-upload-token': file.uploadToken }, body: bytes });
    await api(`/files/${file.id}/complete`, { method: 'POST' });
    const recharge = await api(`/stores/${storeId}/recharges`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `native-replenish-recharge-${evidence.generatedAt}` }, body: JSON.stringify({ amount: process.env.RECHARGE_AMOUNT, businessDate: new Date().toISOString().slice(0, 10), collectionAccountId: '39851832-983b-41d6-a42f-4557aa6b222f', remark: '本地原生补货验收测试资金，不代表真实收款', evidenceFileIds: [file.id] }) });
    evidence.rechargeId = recharge.id;
    token = oldToken;
  }
  if (process.argv.includes('--resume-replenishment')) {
    assert.ok(replenish && resume?.discrepancyId);
    const before = await api(`/purchase-requests/${resume.requestId}`);
    const accountBefore = await api(`/stores/${before.storeId}/account`);
    if (!resume.replenishmentShipmentId) {
    login('test_supplier_stored', 'supplier');
    method('changeView', event('', { view: 'differences' }));
    method('selectDiscrepancy', event(resume.discrepancyId));
    wait('selectedDiscrepancy', row => row?.status === 'REPLENISH_PENDING');
    step('supplier-arranged-replenishment');
    method('startReplenishment');
    wait('shipmentItems', rows => rows?.some(row => Number(row.shipQuantity) > 0));
    method('shipOrder');
    wait('result', row => row?.status === 'SHIPPED');
    step('supplier-replenishment-shipped');
    const updated = await api(`/purchase-requests/${resume.requestId}`);
    const shipments = updated.supplierOrders.find(row => row.id === resume.orderId).shipments;
    assert.equal(shipments.length, 2);
    const extra = shipments.find(row => row.id !== resume.shipmentId);
    evidence.replenishmentShipmentId = extra.id;
    }
    login('test_chef_stored', 'store');
    method('selectShipment', event(evidence.replenishmentShipmentId));
    wait('selectedShipment', row => row?.id === evidence.replenishmentShipmentId);
    await attachReceiptEvidence();
    method('receiveShipment', event('', { mode: 'FULL' }));
    wait('receiptResult', row => !!row);
    step('store-replenishment-received');
    const final = await api(`/purchase-requests/${resume.requestId}`);
    assert.equal(final.paymentStatus, 'PAID');
    assert.ok(final.supplierOrders.every(row => row.status === 'COMPLETED'));
    const account = await api(`/stores/${final.storeId}/account`);
    assert.equal(account.balance, new Decimal(accountBefore.balance).minus(final.salesGoodsAmount).toFixed(2));
    assert.equal(account.reservedBalance, new Decimal(accountBefore.reservedBalance).minus(before.salesGoodsAmount).toFixed(2));
    login('test_finance_stored', 'store');
    method('loadAccount');
    const visible = wait('account', row => row?.balance === account.balance);
    assert.equal(visible.reservedBalance, account.reservedBalance);
    step('store-finance-account-verified');
    evidence.accountVerification = { balance: account.balance, reservedBalance: account.reservedBalance, orderAmount: final.salesGoodsAmount };
    evidence.finalPaymentStatus = final.paymentStatus;
    evidence.status = 'PASSED';
    delete evidence.error;
  } else if (process.argv.includes('--verify-only')) {
    assert.ok(resume?.requestId && resume?.shipmentId);
    const request = await api(`/purchase-requests/${resume.requestId}`);
    const shipment = await api(`/shipments/${resume.shipmentId}`);
    assert.equal(shipment.currentReceiptRevision, returned ? 2 : 1);
    assert.ok(shipment.items.every(row => row.receiptLocked));
    assert.ok(request.supplierOrders.every(row => row.status === 'COMPLETED'));
    assert.equal(request.paymentStatus, 'PAID');
    method('changeView', event('', { view: 'receive' }));
    method('loadShipments');
    wait('shipmentTodos', rows => Array.isArray(rows) && rows.every(row => row.id !== shipment.id));
    step('completed-receipt-locked-reminder-cleared');
    const account = await api(`/stores/${request.storeId}/account`);
    assert.equal(request.storedReservedAmount, '0.00');
    const expectedReserved = process.env.EXPECTED_RESERVED_BALANCE;
    assert.ok(expectedReserved, 'EXPECTED_RESERVED_BALANCE required to preserve other pending orders');
    assert.equal(account.reservedBalance, expectedReserved);
    const expected = process.env.EXPECTED_BALANCE;
    assert.ok(expected, 'EXPECTED_BALANCE required for verification');
    assert.equal(account.balance, expected);
    evidence.accountVerification = { status: 'PASSED', balance: account.balance, reservedBalance: account.reservedBalance, orderAmount: request.salesGoodsAmount };
    evidence.status = 'PASSED';
    evidence.finalPaymentStatus = request.paymentStatus;
    delete evidence.error;
  } else {
  if (resume?.requestId) {
    request = await api(`/purchase-requests/${resume.requestId}`);
  } else {
  method('changeView', event('', { view: 'order' }));
  const products = wait('products', value => value?.length > 0);
  const product = products.find(row => row.suppliers?.length === 1) || products[0];
  const quantity = String(Math.ceil(Math.max(difference ? 2 : 1, Number(product.minOrderQty || 1)) / Number(product.orderMultiple || 1)) * Number(product.orderMultiple || 1));
  method('setProductQuantity', { ...event(product.id), detail: { value: quantity } });
  method('previewOrder');
  const preview = wait('preview', value => value?.funding);
  assert.ok(preview.funding.canConfirm, 'Insufficient funding; recharge through normal workflow');
  step('store-preview');
  method('submitOrder');
  request = wait('created', value => value?.id);
  evidence.requestId = request.id;
  step('store-submitted');
  }
  login('test_purchase', 'purchaser');
  method('selectRequest', event(request.id));
  wait('selectedRequest', value => value?.id === request.id);
  if (data('selectedRequest').status === 'PENDING_PROCUREMENT') method('confirmRequest');
  wait('selectedRequest', value => ['CONFIRMED', 'PARTIAL_PUSHED'].includes(value?.status));
  step('procurement-confirmed');
  detail = await api(`/purchase-requests/${request.id}`);
  assert.equal(detail.supplierOrders.length, 1);
  order = detail.supplierOrders[0];
  evidence.orderId = order.id;
  login('test_supplier_stored', 'supplier');
  method('changeView', event('', { view: 'orders' }));
  method('selectOrder', event(order.id));
  wait('selectedOrder', value => value?.id === order.id);
  if (data('selectedOrder').status !== 'SHIPPED') {
  for (const item of data('shipmentItems')) method('onShipQuantity', { ...event(item.id), detail: { value: item.remainingQuantity } });
  method('shipOrder');
  wait('result', value => value?.status === 'SHIPPED');
  step('supplier-shipped');
  }
  const shipped = await api(`/purchase-requests/${request.id}`);
  const shipments = shipped.supplierOrders.find(row => row.id === order.id).shipments;
  assert.equal(shipments.length, 1);
  shipment = shipments[0];
  evidence.shipmentId = shipment.id;
  login('test_chef_stored', 'store');
  method('selectShipment', event(shipment.id));
  wait('selectedShipment', value => value?.id === shipment.id);
  accountBefore = await api(`/stores/${detail.storeId}/account`);
  }
  async function attachReceiptEvidence() {
  const bytes = await sharp({ create: { width: 180, height: 120, channels: 3, background: '#28785b' } }).png().toBuffer();
  const source = await api('/files/upload-sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ purpose: 'RECEIPT', filename: 'native-regression-receipt.png', mimeType: 'image/png', sizeBytes: bytes.length }) });
  await api(`/files/${source.id}/content`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-upload-token': source.uploadToken }, body: bytes });
  await api(`/files/${source.id}/complete`, { method: 'POST' });
  tool('automation_evaluate', { 'fn-source': `async function() {
    const path = await new Promise((resolve, reject) => wx.downloadFile({ url: '${base}/files/${source.id}/download', header: { authorization: 'Bearer ' + wx.getStorageSync('procurexToken') }, success: r => r.statusCode === 200 ? resolve(r.tempFilePath) : reject(new Error('download failed')), fail: reject }));
    const pages = getCurrentPages(); const page = pages[pages.length - 1];
    page.setData({ receiptEvidence: [{ path, status: 'UPLOADING' }], receiptUploading: true });
    try { await page.uploadReceiptEvidence(path); } finally { page.setData({ receiptUploading: false }); }
    return page.data.receiptEvidence[0].status;
  }` });
  wait('receiptEvidence', value => value?.[0]?.status === 'READY');
  }
  if (!process.argv.includes('--verify-only') && !process.argv.includes('--resume-replenishment')) {
  await attachReceiptEvidence();
  step('store-receipt-evidence');
  if (difference) {
    const item = data('receiptItems')[0];
    method('onReceiptQuantity', { ...event(item.id), detail: { value: new Decimal(item.shippedQuantity).minus(1).toString() } });
  }
  method('receiveShipment', event('', { mode: difference ? 'SHORT' : 'FULL' }));
  wait('receiptResult', value => !!value);
  step('store-received');
  const supplierAuth = await api('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test_supplier_stored', password, client: 'WEB' }) });
  if (difference) {
    const pending = await api(`/supplier-orders/${order.id}`, { headers: { authorization: `Bearer ${supplierAuth.accessToken}` } });
    assert.notEqual(pending.status, 'COMPLETED');
    login('test_supplier_stored', 'supplier');
    method('changeView', event('', { view: 'differences' }));
    method('loadDiscrepancies');
    const discrepancies = wait('discrepancies', rows => rows?.some(row => row.supplierOrderId === order.id));
    const discrepancy = discrepancies.find(row => row.supplierOrderId === order.id && row.status === 'OPEN');
    assert.ok(discrepancy);
    evidence.discrepancyId = discrepancy.id;
    method('selectDiscrepancy', event(discrepancy.id));
    wait('selectedDiscrepancy', row => row?.id === discrepancy.id);
    step('supplier-difference-open');
    if (returned) method('onInput', { ...event('', { field: 'discrepancyReason' }), detail: { value: '本地原生回归：请门店重新核对收货数量' } });
    method('resolveDiscrepancy', event('', { action: replenish ? 'REPLENISH' : returned ? 'RETURN' : 'ACCEPT' }));
    wait('result', row => row?.status === (replenish ? 'REPLENISH_PENDING' : 'RESOLVED'));
    step(replenish ? 'supplier-arranged-replenishment' : returned ? 'supplier-returned-receipt' : 'supplier-accepted-short-receipt');
    if (replenish) {
      method('selectDiscrepancy', event(discrepancy.id));
      wait('selectedDiscrepancy', row => Number(row?.replenishmentGap?.remainingQuantity) > 0);
      method('startReplenishment');
      wait('shipmentItems', rows => rows?.some(row => Number(row.shipQuantity) > 0));
      method('shipOrder');
      wait('result', row => row?.status === 'SHIPPED');
      step('supplier-replenishment-shipped');
      const updated = await api(`/purchase-requests/${request.id}`);
      const newShipments = updated.supplierOrders.find(row => row.id === order.id).shipments;
      assert.equal(newShipments.length, 2);
      const extra = newShipments.find(row => row.id !== shipment.id);
      evidence.replenishmentShipmentId = extra.id;
      login('test_chef_stored', 'store');
      method('selectShipment', event(extra.id));
      wait('selectedShipment', row => row?.id === extra.id);
      await attachReceiptEvidence();
      method('receiveShipment', event('', { mode: 'FULL' }));
      wait('receiptResult', row => !!row);
      step('store-replenishment-received');
    }
    if (returned) {
      login('test_chef_stored', 'store');
      method('loadShipments');
      wait('shipmentTodos', rows => rows?.some(row => row.id === shipment.id));
      method('selectShipment', event(shipment.id));
      const selected = wait('selectedShipment', row => row?.id === shipment.id);
      assert.equal(selected.currentReceiptRevision, 1);
      assert.ok(selected.items.some(row => !row.receiptLocked));
      await attachReceiptEvidence();
      method('receiveShipment', event('', { mode: 'FULL' }));
      wait('receiptResult', row => !!row);
      step('store-revised-returned-receipt');
      const revised = await api(`/shipments/${shipment.id}`);
      assert.equal(revised.currentReceiptRevision, 2);
      evidence.receiptRevision = 2;
      method('loadShipments');
      wait('shipmentTodos', rows => Array.isArray(rows) && rows.every(row => row.id !== shipment.id));
    }
  }
  const completed = await api(`/supplier-orders/${order.id}`, { headers: { authorization: `Bearer ${supplierAuth.accessToken}` } });
  assert.equal(completed.status, 'COMPLETED');
  const finalRequest = await api(`/purchase-requests/${request.id}`);
  assert.equal(finalRequest.paymentStatus, 'PAID');
  const accountAfter = await api(`/stores/${detail.storeId}/account`);
  assert.equal(accountAfter.balance, new Decimal(accountBefore.balance).minus(finalRequest.salesGoodsAmount).toFixed(2));
  const initialAmount = detail.salesGoodsAmount || request.salesGoodsAmount;
  assert.equal(accountAfter.reservedBalance, new Decimal(accountBefore.reservedBalance).minus(initialAmount).toFixed(2));
  evidence.accountVerification = { status: 'PASSED', balance: accountAfter.balance,
    reservedBalance: accountAfter.reservedBalance, orderAmount: finalRequest.salesGoodsAmount };
  evidence.status = 'PASSED';
  delete evidence.error;
  evidence.finalPaymentStatus = finalRequest.paymentStatus;
  }
} catch (error) { evidence.status = 'FAILED'; evidence.error = error.message; throw error; }
finally { writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(evidence, null, 2)); }
