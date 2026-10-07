import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Decimal } from 'decimal.js';
import { prepareNativeAcceptanceProducts } from './prepare-native-acceptance-products.mjs';
import { auditNativeRequestFunding } from './audit-native-request-funding.mjs';

const project = resolve('apps/miniprogram');
const extended = process.argv.includes('--extended');
const output = resolve(extended ? 'var/miniprogram-extended-evidence' : 'var/miniprogram-journey-evidence');
const cli = process.env.WECHATIDE_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide';
const base = process.env.PROCUREX_API_BASE || 'http://127.0.0.1:3100/api/v1';
const seed = JSON.parse(await readFile('apps/web/main-flow-demo-seed.json', 'utf8'));
const resume = process.argv.includes('--resume-replenishment')
  ? JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8')) : null;
const resumeRequest = process.argv.includes('--resume-request')
  ? JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8')) : null;
const resumePayment = process.argv.includes('--resume-payment')
  ? JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8')) : null;
const resumeReturn = process.argv.includes('--resume-return-review')
  ? JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8')) : null;
const evidence = { generatedAt: new Date().toISOString(), status: 'RUNNING', runtime: 'WeChat Developer Tools',
  realDevice: false, paymentRegistration: 'local API fixture; confirmation through native UI',
  receiptEvidenceSelection: 'Local image fixture downloaded into simulator; native binary upload and receipt binding, not camera/album acceptance', steps: [], screenshots: [] };
await mkdir(output, { recursive: true });

function tool(name, options = {}) {
  const args = ['-c', 'Codex', name, '--project', project];
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    args.push(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const result = spawnSync(cli, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const start = result.stdout?.indexOf('{') ?? -1;
  if (start < 0) throw new Error(`${name}: no tool result${result.error ? ` (${result.error.message})` : ''}`);
  let body;
  try { body = JSON.parse(result.stdout.slice(start)); }
  catch { throw new Error(`${name} (${options.action || ''} ${options.method || ''}): malformed/truncated tool JSON (${result.stdout.length} characters)`); }
  if (result.status !== 0 || !body.ok || body.result?.success === false || body.result?.status === 'pending') {
    throw new Error(`${name} (${options.action || ''} ${options.method || ''}): ${body.message || body.result?.error || body.result?.status || 'failed'}`);
  }
  return body.result;
}

const data = path => tool('automation_page_action', { action: 'getData', dataPath: path }).data;
const tap = selector => tool('automation_element_action', { action: 'tap', selector, waitForSelector: selector });
const method = (name, event) => {
  const argsFile = resolve(output, 'method-args.json');
  writeFileSync(argsFile, JSON.stringify(event ? [event] : []));
  return tool('automation_page_action', { action: 'callMethod', method: name, argsFile });
};
const event = (id, extra = {}) => ({ currentTarget: { dataset: { id, ...extra } } });
const view = name => method('changeView', event('', { view: name }));
const select = (selector, index) => tool('automation_element_action', { selector, action: 'trigger', type: 'change', detail: { value: String(index) } });

function waitData(path, predicate) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const value = data(path);
    if (predicate(value)) return value;
  }
  throw new Error(`Timed out waiting for ${path}: ${data('error') || 'no expected state'}`);
}

async function screenshot(name) {
  tool('simulator_screenshot', { path: resolve(output, `${name}.jpg`) });
  if (!evidence.screenshots.includes(`${name}.jpg`)) evidence.screenshots.push(`${name}.jpg`);
}

function step(name) {
  if (!evidence.steps.includes(name)) evidence.steps.push(name);
  writeFileSync(resolve(output, 'manifest.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Native journey: ${name}`);
}

function login(username, workspace) {
  tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
  tool('automation_element_action', { action: 'text', selector: '.primary', waitForSelector: '.primary' });
  tool('automation_page_action', { action: 'setData', waitForSelector: '.primary', patch: JSON.stringify({ username, password: seed.password, apiBase: base }) });
  tap('.primary');
  let loggedIn = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path !== 'pages/login/index') { loggedIn = true; break; }
  }
  if (!loggedIn) throw new Error(`Native login failed: ${data('error') || 'no role navigation'}`);
  tool('automation_navigate', { action: 'switchTab', url: `/pages/${workspace}/index` });
  assert.equal(tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path, `pages/${workspace}/index`);
}

let adminToken;
async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: {
    authorization: `Bearer ${adminToken}`, 'content-type': 'application/json', connection: 'close', ...options.headers,
  } });
  const body = await response.json();
  if (!response.ok) throw new Error(`Fixture/read API ${path}: ${body.error?.message || body.message || response.status}`);
  return body.data || body;
}

async function attachReceiptEvidence() {
  const auth = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: seed.storeUsername, password: seed.password, client: 'WEB' }) });
  const headers = { authorization: `Bearer ${auth.accessToken}` };
  const bytes = await readFile('var/miniprogram-ui-evidence/store-order.jpg');
  const source = await api('/files/upload-sessions', { method: 'POST', headers,
    body: JSON.stringify({ purpose: 'RECEIPT', filename: 'local-receipt-fixture.jpg', mimeType: 'image/jpeg', sizeBytes: bytes.length }) });
  await api(`/files/${source.id}/content`, { method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream', 'x-upload-token': source.uploadToken }, body: bytes });
  await api(`/files/${source.id}/complete`, { method: 'POST', headers });
  tool('automation_evaluate', { fnSource: `async function() {
    const path = await new Promise((resolve, reject) => wx.downloadFile({ url: '${base}/files/${source.id}/download',
      header: { authorization: 'Bearer ' + wx.getStorageSync('procurexToken') },
      success: result => result.statusCode === 200 ? resolve(result.tempFilePath) : reject(new Error('Fixture download failed')), fail: reject }));
    const pages = getCurrentPages(); const page = pages[pages.length - 1];
    page.setData({ receiptEvidence: [{ path, status: 'UPLOADING' }], receiptUploading: true });
    try { await page.uploadReceiptEvidence(path); } finally { page.setData({ receiptUploading: false }); }
    return page.data.receiptEvidence[0].status;
  }` });
  waitData('receiptEvidence', value => value?.length === 1 && value[0].status === 'READY');
}

try {
  tool('simulator_refresh');
  tool('automation_page_action', { action: 'getData', wait: 2, dataPath: 'error' });
  const auth = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: seed.username, password: seed.password, client: 'WEB' }) });
  adminToken = auth.accessToken;
  const productIds = extended ? await prepareNativeAcceptanceProducts(seed) : [seed.productId];
  let supplierUsername = seed.supplierUsername;
  let created, order, selected, freight, firstShipment;
  if (resumePayment) {
    assert.ok(resumePayment.rejectedPaymentId && resumePayment.supplierOrderId);
    Object.assign(evidence, resumePayment, { status: 'RUNNING', error: undefined, resumedPayment: true });
    created = { id: resumePayment.requestId }; order = { id: resumePayment.supplierOrderId };
    supplierUsername = extended ? seed.secondarySupplierUsername : seed.supplierUsername;
  } else {
  if (resume) {
    assert.ok(resume.freightConfirmationId && resume.discrepancyId && resume.firstShipmentId);
    Object.assign(evidence, resume, { status: 'RUNNING', error: undefined, resumed: true });
    evidence.screenshots = resume.screenshots;
    created = { id: resume.requestId }; order = { id: resume.supplierOrderId }; selected = { id: resume.discrepancyId };
    freight = { id: resume.freightConfirmationId }; firstShipment = { id: resume.firstShipmentId };
  } else {
  if (resumeReturn) {
    assert.ok(resumeReturn.discrepancyId && resumeReturn.firstShipmentId);
    Object.assign(evidence, resumeReturn, { status: 'RUNNING', error: undefined, resumedReturnReview: true });
    created = { id: resumeReturn.requestId }; order = { id: resumeReturn.supplierOrderId };
    selected = { id: resumeReturn.discrepancyId }; firstShipment = { id: resumeReturn.firstShipmentId };
    supplierUsername = seed.secondarySupplierUsername;
    login(supplierUsername, 'supplier'); view('differences');
    method('selectDiscrepancy', event(selected.id));
    waitData('selectedDiscrepancy', value => value?.id === selected.id);
    const reviewed = await api(`/shipments/${firstShipment.id}`);
    assert.equal(reviewed.currentReceiptRevision, 2);
    step('Store native returned receipt revised; accepted/replenishment rows preserved');
  } else {
  if (resumeRequest) {
    assert.ok(resumeRequest.requestId);
    created = { id: resumeRequest.requestId };
    Object.assign(evidence, { requestId: created.id, steps: resumeRequest.steps, screenshots: resumeRequest.screenshots, resumedRequest: true });
  } else {
  login(seed.storeUsername, 'store');
  view('order');
  const products = waitData('products', value => value?.length);
  waitData('visibleProducts', value => value?.length);
  await screenshot('store-catalog');
  for (const productId of productIds) {
    const productIndex = products.findIndex(product => product.id === productId);
    assert.ok(productIndex >= 0);
    method('setProductQuantity', { ...event(productId), detail: { value: '3' } });
  }
  assert.equal(data('cart').length, productIds.length);
  if (extended) { method('toggleCart'); await screenshot('store-multi-product-cart'); method('toggleCart'); }
  tap('.preview-order');
  const fundingPreview = waitData('preview', value => value?.funding);
  assert.ok(fundingPreview.funding.canConfirm, `Local demo funding is insufficient: ${JSON.stringify(fundingPreview.funding)}; use the recharge workflow, do not bypass funding checks`);
  assert.equal(data('orderStep'), 'confirm');
  await screenshot('store-order-confirm');
  tool('automation_evaluate', { fnSource: 'function() { const pages = getCurrentPages(); pages[pages.length - 1].setData({ created: null }); return true; }' });
  tap('.submit-order');
  created = waitData('created', value => value?.id);
  evidence.requestId = created.id;
  waitData('selectedRequest', value => value?.id === created.id);
  await screenshot('store-order-detail');
  step('Store native order created');
  }

  login(seed.username, 'purchaser'); view('orders');
  method('selectRequest', event(created.id));
  waitData('selectedRequest', value => value?.id === created.id);
  if (data('selectedRequest').status === 'PENDING_PROCUREMENT') tap('.primary');
  waitData('selectedRequest', value => ['CONFIRMED', 'PARTIAL_PUSHED'].includes(value?.status));
  const request = await api(`/purchase-requests/${created.id}`);
  order = request.supplierOrders.find(item => item.supplierId === seed.supplierId);
  assert.ok(order, 'Expected scoped demo supplier to receive new order');
  evidence.supplierOrderId = order.id;
  step('Purchaser native order confirmed');

  if (extended) {
    const existingReplacement = request.supplierOrders.find(item => item.supplierId === seed.secondarySupplierId && item.status !== 'REJECTED');
    if (existingReplacement) {
      order = existingReplacement;
      evidence.supplierOrderId = order.id;
    } else {
    const initialOrder = await api(`/supplier-orders/${order.id}`);
    assert.equal(initialOrder.items.length, 3);
    if (initialOrder.status !== 'REJECTED') {
    login(supplierUsername, 'supplier'); view('orders');
    method('selectOrder', event(order.id));
    waitData('selectedOrder', value => value?.id === order.id);
    method('onInput', { ...event('', { field: 'rejectionReason' }), detail: { value: 'Local acceptance: supplier cannot fulfill' } });
    method('rejectOrder');
    waitData('result', value => value?.status === 'REJECTED');
    evidence.rejectedOrderId = order.id;
    step('Supplier native multi-product order rejected');
    }
    login(seed.username, 'purchaser'); view('rejections');
    const todos = waitData('rejectionTodos', value => value?.some(item => item.supplierOrderId === order.id));
    const todo = todos.find(item => item.supplierOrderId === order.id);
    method('selectRejection', event('', { requestId: todo.purchaseRequestId, supplierOrderId: todo.supplierOrderId }));
    waitData('selectedRequest', value => value?.id === created.id);
    const suppliers = waitData('suppliers', value => value?.some(item => item.id === seed.secondarySupplierId));
    select('picker', suppliers.findIndex(item => item.id === seed.secondarySupplierId));
    await screenshot('purchaser-multi-product-reallocation');
    method('reallocateRequest');
    waitData('result', value => value?.status === 'REALLOCATED');
    waitData('rejectionTodos', value => Array.isArray(value) && !value.some(item => item.supplierOrderId === evidence.rejectedOrderId));
    const pendingRejections = await api('/purchase-requests/rejection-todos');
    assert.ok(!pendingRejections.some(item => item.supplierOrderId === evidence.rejectedOrderId));
    evidence.rejectionTodoCheck = 'PASSED: reassigned order absent from current API/UI todos';
    const reallocated = await api(`/purchase-requests/${created.id}`);
    assert.equal(reallocated.status, 'CONFIRMED');
    order = reallocated.supplierOrders.find(item => item.supplierId === seed.secondarySupplierId && item.status !== 'REJECTED');
    assert.ok(order);
    assert.equal((await api(`/supplier-orders/${order.id}`)).items.length, 3);
    supplierUsername = seed.secondarySupplierUsername;
    evidence.supplierOrderId = order.id;
    step('Purchaser native rejected multi-product order reallocated to backup supplier');
    }
    supplierUsername = seed.secondarySupplierUsername;
  }

  login(supplierUsername, 'supplier'); view('orders');
  method('selectOrder', event(order.id));
  waitData('selectedOrder', value => value?.id === order.id);
  tap('.button-row .primary');
  waitData('result', value => value?.title);
  step('Supplier native shipment created');

  login(seed.storeUsername, 'store'); view('receive');
  const todos = waitData('shipmentTodos', value => value?.some(item => item.supplierOrderId === order.id));
  firstShipment = todos.find(item => item.supplierOrderId === order.id);
  evidence.firstShipmentId = firstShipment.id;
  method('selectShipment', event(firstShipment.id));
  const receiptItems = waitData('receiptItems', value => value?.length);
  for (const item of receiptItems) method('onReceiptQuantity', { ...event(item.id), detail: { value: '2' } });
  await attachReceiptEvidence();
  if (extended) await screenshot('store-multi-product-short-receipt');
  tap('.receive-submit');
  waitData('receiptResult', value => value?.status === 'SHORT_RECEIVED');
  step('Store native shortage receipt submitted');

  login(supplierUsername, 'supplier'); view('differences');
  const discrepancies = waitData('discrepancies', value => value?.length);
  for (const discrepancy of discrepancies) {
    method('selectDiscrepancy', event(discrepancy.id));
    const detail = waitData('selectedDiscrepancy', value => value?.id === discrepancy.id);
    if (detail.supplierOrderId === order.id && detail.status === 'OPEN') {
      if (!selected) selected = detail;
      else if (extended) {
        const action = evidence.acceptedDiscrepancyId ? 'RETURN' : 'ACCEPT';
        if (action === 'RETURN') method('onInput', { ...event('', { field: 'discrepancyReason' }), detail: { value: 'Local acceptance: verify receiving count' } });
        method('resolveDiscrepancy', event('', { action }));
        const resolved = waitData('selectedDiscrepancy', value => value?.status === 'RESOLVED');
        if (action === 'RETURN') { assert.ok(resolved.returnRecord?.reason); evidence.returnedDiscrepancyId = detail.id; }
        else evidence.acceptedDiscrepancyId = detail.id;
        await screenshot(`supplier-discrepancy-${action.toLowerCase()}`);
        step(`Supplier native multi-product discrepancy ${action}`);
      }
      if (!extended) break;
    }
    if (extended && selected && evidence.acceptedDiscrepancyId && evidence.returnedDiscrepancyId) break;
  }
  assert.ok(selected, 'New shipment shortage must appear in native discrepancy list');
  if (extended) assert.ok(evidence.acceptedDiscrepancyId && evidence.returnedDiscrepancyId);
  method('selectDiscrepancy', event(selected.id));
  waitData('selectedDiscrepancy', value => value?.id === selected.id);
  evidence.discrepancyId = selected.id;
  await screenshot('supplier-discrepancy');
  tap('.discrepancy-replenish');
  waitData('selectedDiscrepancy', value => value?.status === 'REPLENISH_PENDING');
  if (extended) {
    assert.notEqual((await api(`/supplier-orders/${order.id}`)).fulfillmentStatus, 'COMPLETED');
    login(seed.storeUsername, 'store'); view('receive');
    waitData('shipmentTodos', value => value?.some(item => item.id === firstShipment.id));
    method('selectShipment', event(firstShipment.id));
    const reviewItems = waitData('receiptItems', value => value?.length === 3);
    assert.equal(reviewItems.filter(item => item.receiptLocked).length, 2);
    assert.ok(reviewItems.every(item => item.receivedQuantity === '2'));
    await attachReceiptEvidence();
    await screenshot('store-returned-receipt-review');
    method('fillReceipt');
    tap('.receive-submit');
    waitData('receiptResult', value => value?.status === 'RECEIVED');
    assert.equal((await api(`/shipments/${firstShipment.id}`)).currentReceiptRevision, 2);
    const corrected = await api(`/supplier-orders/${order.id}`);
    assert.deepEqual(corrected.items.map(item => item.receivedQuantity).sort(), ['2', '2', '3']);
    assert.notEqual(corrected.fulfillmentStatus, 'COMPLETED');
    step('Store native returned receipt revised; accepted/replenishment rows preserved');
    login(supplierUsername, 'supplier'); view('differences');
    method('selectDiscrepancy', event(selected.id));
    waitData('selectedDiscrepancy', value => value?.id === selected.id);
  }
  }
  tap('.replenish-start');
  waitData('activeView', value => value === 'orders');
  tool('automation_element_action', { selector: '.freight-amount', action: 'input', value: '8.50' });
  tool('automation_element_action', { selector: '.freight-reason', action: 'input', value: '本地验收补发运费' });
  tap('.freight-request-submit');
  const withFreight = waitData('selectedOrder', value => value?.freightConfirmations?.some(item => item.status === 'PENDING'));
  freight = withFreight.freightConfirmations.find(item => item.status === 'PENDING');
  evidence.freightConfirmationId = freight.id;
  step('Supplier native replenishment planned and freight requested');

  login(seed.username, 'purchaser'); view('freight');
  waitData('freightConfirmations', value => value?.some(item => item.id === freight.id));
  method('selectFreight', event(freight.id));
  if (extended) {
    method('onInput', { ...event('', { field: 'freightReason' }), detail: { value: 'Local acceptance: freight requires correction' } });
    method('reviewFreight', event('', { action: 'reject' }));
    waitData('selectedFreight', value => value?.status === 'REJECTED');
    evidence.rejectedFreightId = freight.id;
    await screenshot('purchaser-freight-rejected');
    step('Purchaser native freight rejected with reason');
    login(supplierUsername, 'supplier'); view('differences');
    method('selectDiscrepancy', event(selected.id));
    waitData('selectedDiscrepancy', value => value?.id === selected.id);
    tap('.replenish-start');
    waitData('activeView', value => value === 'orders');
    assert.ok(!data('freightChoices').some(item => item.id === evidence.rejectedFreightId));
    tool('automation_element_action', { selector: '.freight-amount', action: 'input', value: '8.50' });
    tool('automation_element_action', { selector: '.freight-reason', action: 'input', value: 'Local acceptance: corrected freight' });
    tap('.freight-request-submit');
    const updated = waitData('selectedOrder', value => value?.freightConfirmations?.some(item => item.status === 'PENDING'));
    freight = updated.freightConfirmations.find(item => item.status === 'PENDING');
    evidence.freightConfirmationId = freight.id;
    login(seed.username, 'purchaser'); view('freight');
    waitData('freightConfirmations', value => value?.some(item => item.id === freight.id));
    method('selectFreight', event(freight.id));
  }
  await screenshot('purchaser-freight');
  tap('.freight-confirm');
  waitData('selectedFreight', value => value?.status === 'CONFIRMED');
  step('Purchaser native freight confirmed');
  }

  if (extended) supplierUsername = seed.secondarySupplierUsername;
  login(supplierUsername, 'supplier'); view('differences');
  method('selectDiscrepancy', event(selected.id));
  waitData('selectedDiscrepancy', value => value?.id === selected.id);
  tap('.replenish-start');
  waitData('activeView', value => value === 'orders');
  const choices = waitData('freightChoices', value => value?.some(item => item.id === freight.id));
  select('.freight-picker', choices.findIndex(item => item.id === freight.id));
  await screenshot('supplier-replenishment');
  tool('automation_evaluate', { fnSource: 'function() { const pages = getCurrentPages(); pages[pages.length - 1].setData({ result: null }); return true; }' });
  tap('.button-row .primary');
  waitData('result', value => value?.title);
  step('Supplier native gap-allocated replenishment shipped with confirmed freight');

  login(seed.storeUsername, 'store'); view('receive');
  const replenishmentTodos = waitData('shipmentTodos', value => value?.some(item => item.supplierOrderId === order.id && item.id !== firstShipment.id));
  const replenishment = replenishmentTodos.find(item => item.supplierOrderId === order.id && item.id !== firstShipment.id);
  evidence.replenishmentShipmentId = replenishment.id;
  method('selectShipment', event(replenishment.id));
  waitData('selectedShipment', value => value?.id === replenishment.id);
  await attachReceiptEvidence();
  await screenshot('store-replenishment-receipt');
  tap('.receive-submit');
  waitData('receiptResult', value => value?.status === 'RECEIVED');
  const completed = await api(`/supplier-orders/${order.id}`);
  assert.equal(completed.fulfillmentStatus, 'COMPLETED');
  assert.ok(completed.freightConfirmations.find(item => item.id === freight.id)?.usedAt);
  assert.ok(completed.items.every(item => item.replenishmentGaps.every(gap => Number(gap.remainingQuantity) === 0)));
  step('Store native replenishment received; gap closed and freight consumed');
  }

  // Mini-program has no company finance entry; prepare only the local payment fixture over HTTP.
  const settlementItemId = Buffer.from(JSON.stringify({ kind: 'SUPPLIER_PAYABLE', supplierOrderId: order.id })).toString('base64url');
  const preview = await api('/payment-records/preview', { method: 'POST', body: JSON.stringify({ settlementItemIds: [settlementItemId] }) });
  const settlementOrder = await api(`/supplier-orders/${order.id}`);
  const expectedGoods = settlementOrder.items.reduce((sum, item) => sum.plus(new Decimal(item.receivedQuantity).mul(item.supplyUnitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)), new Decimal(0));
  const expectedPayable = expectedGoods.plus('8.50').toFixed(2);
  evidence.settlementCheck = { status: new Decimal(preview.totalPayableAmount).eq(expectedPayable) ? 'PASSED' : 'FAILED',
    expectedSupplierGoods: expectedGoods.toFixed(2), storedSupplierGoods: settlementOrder.supplyGoodsAmount,
    expectedPayable, previewPayable: preview.totalPayableAmount,
    basis: 'Final effective received quantities at order prices plus this scenario confirmed freight' };
  if (evidence.settlementCheck.status !== 'PASSED') {
    evidence.nativeActions = 'PASSED_THROUGH_RECEIPT';
    const error = new Error(`Settlement acceptance blocked: expected ${expectedPayable}, preview ${preview.totalPayableAmount}`);
    error.acceptanceBlock = 'BLOCKED_SETTLEMENT';
    throw error;
  }
  const proofBytes = await readFile('var/miniprogram-ui-evidence/store-order.jpg');
  const upload = await api('/files/upload-sessions', { method: 'POST', body: JSON.stringify({ purpose: 'PAYMENT', filename: 'local-acceptance.jpg', mimeType: 'image/jpeg', sizeBytes: proofBytes.length }) });
  await api(`/files/${upload.id}/content`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-upload-token': upload.uploadToken }, body: proofBytes });
  await api(`/files/${upload.id}/complete`, { method: 'POST' });
  const paymentInput = {
    direction: preview.direction, businessDate: new Date().toISOString().slice(0, 10), evidenceFileIds: [upload.id], remark: '本地原生验收，非真实付款',
    items: preview.items.map(item => ({ settlementItemId: item.settlementItemId, expectedVersion: item.sourceVersion, expectedAmount: item.payableAmount })),
  };
  let payment = await api('/payment-records', { method: 'POST', headers: { 'idempotency-key': `native-payment-${resumePayment ? 'corrected-' : ''}${created.id}` }, body: JSON.stringify(paymentInput) });
  evidence.paymentId = payment.id;
  login(supplierUsername, 'supplier'); view('payments');
  method('selectPayment', event(payment.id));
  const paymentDetail = waitData('selectedPayment', value => value?.id === payment.id);
  assert.equal(paymentDetail.evidenceFiles[0].filename, 'local-acceptance.jpg');
  if (extended && !resumePayment) {
    method('onInput', { ...event('', { field: 'paymentReason' }), detail: { value: 'Local acceptance: incorrect payment evidence' } });
    method('handlePayment', event('', { action: 'reject' }));
    waitData('selectedPayment', value => value?.status === 'REJECTED');
    evidence.rejectedPaymentId = payment.id;
    await screenshot('supplier-payment-rejected');
    step('Supplier native payment rejected with reason');
    const retryPreview = await api('/payment-records/preview', { method: 'POST', body: JSON.stringify({ settlementItemIds: [settlementItemId] }) });
    const retryUpload = await api('/files/upload-sessions', { method: 'POST', body: JSON.stringify({ purpose: 'PAYMENT', filename: 'local-acceptance-corrected.jpg', mimeType: 'image/jpeg', sizeBytes: proofBytes.length }) });
    await api(`/files/${retryUpload.id}/content`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-upload-token': retryUpload.uploadToken }, body: proofBytes });
    await api(`/files/${retryUpload.id}/complete`, { method: 'POST' });
    paymentInput.evidenceFileIds = [retryUpload.id];
    paymentInput.items = retryPreview.items.map(item => ({ settlementItemId: item.settlementItemId, expectedVersion: item.sourceVersion, expectedAmount: item.payableAmount }));
    payment = await api('/payment-records', { method: 'POST', headers: { 'idempotency-key': `native-payment-retry-${created.id}` }, body: JSON.stringify(paymentInput) });
    evidence.paymentId = payment.id;
    method('loadPayments');
    method('selectPayment', event(payment.id));
    waitData('selectedPayment', value => value?.id === payment.id);
  }
  await screenshot('supplier-payment');
  tap('.payment-confirm');
  waitData('selectedPayment', value => value?.status === 'CONFIRMED');
  tap('.evidence-open');
  waitData('evidenceLoading', value => value === false);
  assert.equal(data('error'), '');
  await screenshot('supplier-payment-evidence');
  step('Supplier native payment confirmed and authenticated evidence opened');
  evidence.fundingCheck = await auditNativeRequestFunding(created.id, base);
  await writeFile(resolve(output, 'funding-check.json'), `${JSON.stringify(evidence.fundingCheck, null, 2)}\n`);
  evidence.nativeActions = 'PASSED';
  evidence.status = 'PASSED';
} catch (error) {
  evidence.status = error.acceptanceBlock || 'FAILED';
  evidence.error = error.message;
  console.error(error.message);
  process.exitCode = error.acceptanceBlock ? 2 : 1;
} finally {
  await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Native journey evidence: ${resolve(output, 'manifest.json')}`);
}
