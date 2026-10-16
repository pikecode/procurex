import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

function page(role, request = async () => ({}), apiOverrides = {}, wxOverrides = {}) {
  let definition;
  const quantityModule = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/quantity.js', 'utf8'), { module: quantityModule });
  const viewModule = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/store-view.js', 'utf8'), { module: viewModule });
  vm.runInNewContext(readFileSync(`apps/miniprogram/pages/${role}/index.js`, 'utf8'), {
    Page: value => { definition = value; },
    require: path => path.includes('quantity') ? quantityModule.exports : path.includes('store-view') ? viewModule.exports : { request, roleCommand: (_role, path, options) => request(path, options), ...apiOverrides },
    wx: wxOverrides,
  });
  definition.setData = function (value) { Object.assign(this.data, value); };
  definition.originalLoadWork = definition.loadWork;
  definition.loadWork = async () => {};
  definition.data.canWrite = true;
  return definition;
}

const tap = (id, extra = {}) => ({ currentTarget: { dataset: { id, ...extra } } });
test('purchaser supplier funding hints do not restrict the product editor', () => {
  const purchaser = page('purchaser', undefined, {}, { pageScrollTo() {} });
  purchaser.data.editingRequest = true;
  purchaser.data.selectedRequest = { version: 1, items: [] };
  purchaser.data.fundingGroups = [{ supplierId: 's1', mode: 'CREDIT', amount: '300.00' }, { supplierId: 's2', mode: 'CREDIT', amount: '210.00' }];
  purchaser.data.editCatalog = { items: ['s1', 's2'].map((id, index) => ({ product: { id, name: id }, suppliers: [{ supplierId: id, supplierName: id, salesPrice: index ? '210' : '300' }] })) };
  purchaser.data.editItems = ['s1', 's2'].map(id => ({ productId: id, quantity: '1', supplierIndex: 0 }));
  purchaser.refreshEditCatalog();
  assert.deepEqual(Array.from(purchaser.data.visibleEditProducts, item => item.id), ['s1', 's2']);
  assert.equal(purchaser.data.visibleEditProducts.length, 2);
  const markup = readFileSync('apps/miniprogram/pages/purchaser/index.wxml', 'utf8');
  assert.equal(markup.includes('adjustFundingProducts'), false);
  assert.ok(markup.includes('供应商结算方式'));
  const editorMarkup = markup.slice(markup.indexOf('<view class="request-catalog"'), markup.indexOf('<view class="sheet-mask"'));
  for (const fragment of ['confirmationFunds', 'funds-adjust-guide', '资金参考', '金额限制', 'funding-supplier-row']) assert.equal(editorMarkup.includes(fragment), false);
  assert.ok(editorMarkup.includes('saveRequestDraft'));
  assert.ok(editorMarkup.includes('confirmRequestEdit'));
});

test('purchaser editor retains all settlement modes and unknown suppliers', () => {
  const purchaser = page('purchaser', undefined, {}, { pageScrollTo() {} });
  purchaser.data.editingRequest = true;
  purchaser.data.selectedRequest = { version: 1, items: [] };
  purchaser.data.fundingGroups = [{ supplierId: 'credit', mode: 'CREDIT' }, { supplierId: 'stored', mode: 'STORED_VALUE' }];
  purchaser.data.editCatalog = { items: ['credit', 'stored', 'unknown'].map(id => ({ product: { id, name: id }, suppliers: [{ supplierId: id, salesPrice: '10' }] })) };
  purchaser.data.editItems = ['credit', 'stored', 'unknown'].map(id => ({ productId: id, quantity: '1', supplierIndex: 0 }));
  purchaser.refreshEditCatalog();
  assert.deepEqual(Array.from(purchaser.data.visibleEditProducts, row => row.id), ['credit', 'stored', 'unknown']);
  assert.equal(purchaser.data.visibleEditProducts[0].settlementLabel, '挂账支付');
  assert.equal(purchaser.data.visibleEditProducts.length, 3);
});

test('purchaser can preview funding without saving or providing a reason', async () => {
  const calls = [];
  const purchaser = page('purchaser', async (path, options) => {
    calls.push({ path, options });
    return { funding: { canConfirm: false, stored: { shortfall: '0.00' }, credit: { shortfall: '300.00' } }, settlementGroups: [{ supplierId: 's', mode: 'CREDIT' }] };
  });
  purchaser.data.editingRequest = true; purchaser.data.requestId = 'r';
  purchaser.data.selectedRequest = { version: 1, items: [] };
  purchaser.data.editItems = [{ productId: 'p', supplierId: 's', quantity: '1' }];
  purchaser.data.assignmentGroups = [{ supplierId: 's' }];
  await purchaser.refreshConfirmationFunding();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/purchase-requests/r/items-preview');
  assert.equal(purchaser.data.editReason, '');
  assert.equal(purchaser.data.fundingView.credit.shortfall, '300.00');
  assert.equal(purchaser.data.assignmentGroups[0].settlementLabel, '挂账支付');
  assert.throws(() => purchaser.requestEditBody(), /修改原因/);
  purchaser.markRequestEditChanged();
  assert.equal(purchaser.data.fundingView, null);
});

test('store editing entry is locked after procurement confirmation including returned requests', () => {
  const urls = [];
  const store = page('store', undefined, {}, { navigateTo: value => urls.push(value.url) });
  store.data.selectedRequest = { id: 'r', status: 'PENDING_PROCUREMENT', supplierOrders: [] };
  store.editRequest(); assert.equal(urls.length, 1);
  store.data.selectedRequest.procurementConfirmedAt = '2026-10-16';
  store.editRequest(); assert.equal(urls.length, 1);
  store.data.selectedRequest = { id: 'r', status: 'PENDING_FINANCE', supplierOrders: [] };
  store.editRequest(); assert.equal(urls.length, 1);
});

test('store editor saves quantities without sending supplier or price overrides', async () => {
  const calls = [];
  const editor = page('store-request-edit', async (path, options) => { calls.push({ path, options }); }, {}, {
    showModal: options => options.success({ confirm: true }), setStorageSync() {}, removeStorageSync() {}, showToast() {}, navigateBack() {},
  });
  editor.id = 'r'; editor.storageKey = 'edit';
  editor.data.editable = true; editor.data.detail = { version: 3, templateId: 't' };
  editor.data.rows = [{ id: 'p', name: '商品', quantity: '2', available: true, salesPrice: '10', supplierId: 's' }, { id: 'p2', quantity: '0' }];
  await editor.save();
  assert.equal(calls.length, 1); assert.equal(calls[0].options.method, 'PATCH');
  assert.equal(calls[0].options.data.expectedVersion, 3);
  assert.equal(calls[0].options.data.items.length, 1);
  assert.equal(calls[0].options.data.items[0].quantity, '2');
  assert.equal(calls[0].options.data.items[0].supplierId, undefined);
  assert.equal(editor.data.pending, null);
});

test('store editor keeps original idempotency key after uncertain save and blocks another save', async () => {
  const calls = [];
  const editor = page('store-request-edit', async (path, options) => { calls.push(options); throw Object.assign(new Error('网络中断'), { uncertain: true }); });
  editor.id = 'r'; editor.data.editable = true;
  editor.data.pending = { key: 'same-key', body: { expectedVersion: 1, items: [] } };
  await editor.submitPending(); await editor.save(); await editor.submitPending();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].header['idempotency-key'], calls[1].header['idempotency-key']);
  assert.equal(editor.data.pending.key, 'same-key');
});

test('finance review blocks shortage and blank return reason without posting commands', async () => {
  const calls = [];
  const review = page('finance-review', async (...args) => calls.push(args));
  review.data.selected = { id: 'r', version: 2, funding: { canConfirm: false } };
  await review.decide(tap('r', { action: 'approve' }));
  assert.match(review.data.error, /资金不足/);
  await review.decide(tap('r', { action: 'return' }));
  assert.match(review.data.error, /退回原因/);
  assert.equal(calls.length, 0);
});
test('finance review approves the displayed version once and returns to the queue', async () => {
  const calls = [];
  const review = page('finance-review', async (path, options) => { calls.push({ path, options }); return { supplierOrderIds: ['o'] }; },
    { roleCommandState: () => ({ pending: null }) }, { showModal: options => options.success({ confirm: true }), showToast() {} });
  review.data.selected = { id: 'r', version: 4, funding: { canConfirm: true } };
  await review.decide(tap('r', { action: 'approve' }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/purchase-requests/r/finance-approve');
  assert.deepEqual(plain(calls[0].options.data), { expectedVersion: 4 });
  assert.equal(review.data.selected, null);
  assert.equal(review.data.reviewing, false);
});
test('finance review retains failed detail and protects uncertain submissions', async () => {
  let calls = 0;
  const review = page('finance-review', async () => { calls++; throw new Error('资金已变化'); },
    { roleCommandState: () => ({ pending: { path: '/purchase-requests/r/finance-approve' } }) }, { showModal: options => options.success({ confirm: true }) });
  review.data.selected = { id: 'r', version: 4, funding: { canConfirm: true } };
  await review.decide(tap('r', { action: 'approve' }));
  assert.equal(review.data.selected.id, 'r');
  assert.equal(review.data.error, '资金已变化');
  await review.decide(tap('r', { action: 'approve' }));
  assert.equal(calls, 1);
});

test('supplier report quantities remove trailing zeroes without rounding fractional units', () => {
  const labels = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/labels.wxs', 'utf8'), { module: labels });
  for (const [value, expected] of [['5.000000', '5'], ['5.250000', '5.25'], ['0.000001', '0.000001'], ['0.000000', '0'], ['-0.000000', '0'], ['-1.500000', '-1.5'], [0, '0'], [null, '—']]) assert.equal(labels.exports.quantity(value), expected);
  const markup = readFileSync('apps/miniprogram/pages/supplier/index.wxml', 'utf8');
  assert.ok(markup.includes("{{labels.quantity(item.quantity)}} {{item.unit || ''}}"));
});
test('supplier reconciliation, payment lists and native money labels keep two decimals without changing amounts', async () => {
  const labels = { exports: {} }; const view = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/labels.wxs', 'utf8'), { module: labels });
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/store-view.js', 'utf8'), { module: view });
  for (const [value, expected] of [['10', '10.00'], ['20.1', '20.10'], ['1.005', '1.01'], ['9.999', '10.00'], ['-1.005', '-1.01'], ['-0.001', '0.00'], ['9999999999.999999', '10000000000.00'], [null, '—']]) {
    assert.equal(labels.exports.money(value), expected);
    assert.equal(view.exports.moneyText(value), expected);
  }
  const markup = readFileSync('apps/miniprogram/pages/supplier/index.wxml', 'utf8');
  for (const field of ['payableAmount', 'pendingPaymentAmount', 'confirmedPaidAmount', 'amount']) assert.ok(markup.includes(`labels.money(item.${field})`));
  assert.equal(/\{\{item\.(?:payableAmount|pendingPaymentAmount|confirmedPaidAmount|amount)\}\}/.test(markup), false);
  const supplier = page('supplier', async () => ({ freightConfirmations: [{ id: 'f1', status: 'CONFIRMED', amount: '1.005', reason: '配送' }] }));
  supplier.data.supplierOrderId = 'o1'; supplier.data.selectedOrder = { id: 'o1', version: 2 };
  await supplier.refreshFreight();
  assert.equal(supplier.data.freightChoices[1].label, '¥1.01 · 配送');
  assert.equal(supplier.data.freightChoices[1].amount, '1.005');
});
test('freight refresh exposes only approved unused fees without resetting shipment quantities or accepting a new order version', async () => {
  const supplier = page('supplier', async () => ({ version: 9, requiresFreightSnapshot: true, freightConfirmations: [
    { id: 'approved', amount: '10.00', status: 'CONFIRMED' }, { id: 'pending', status: 'PENDING' }, { id: 'used', status: 'CONFIRMED', usedAt: 'today' }
  ] }));
  supplier.data.supplierOrderId = 'o1'; supplier.data.selectedOrder = { id: 'o1', version: 2 };
  supplier.data.shipmentItems = [{ id: 'i1', shipQuantity: '3' }]; supplier.data.freightChoices = [{ id: '', amount: '0.00' }];
  await supplier.refreshFreight();
  assert.equal(supplier.data.freightChoices.length, 2); assert.equal(supplier.data.freightChoices[1].id, 'approved');
  assert.equal(supplier.data.shipmentItems[0].shipQuantity, '3'); assert.equal(supplier.data.selectedOrder.version, 2);
});
test('company finance registers supplier payments only after server preview and attaches evidence', async () => {
  const calls = [];
  const preview = { direction: 'COMPANY_TO_SUPPLIER', totalPayableAmount: '30.00', blockedItems: [], items: [
    { settlementItemId: 'item-a', supplierOrderNo: 'SO-A', sourceVersion: 4, payableAmount: '30.00' }
  ] };
  const finance = page('finance', async (path, options) => {
    calls.push({ path, options });
    if (path === '/payment-records/preview') return preview;
    return { id: 'payment-1', paymentNo: 'PAY-1', direction: 'COMPANY_TO_SUPPLIER', amount: '30.00', status: 'PENDING' };
  }, { currentUser: () => ({ id: 'finance-1' }), roleCommand: async (role, path, options) => {
    calls.push({ role, path, options });
    return { id: 'payment-1', paymentNo: 'PAY-1', direction: 'COMPANY_TO_SUPPLIER', amount: '30.00', status: 'PENDING' };
  } });
  finance.data.user = { id: 'finance-1', roles: ['HQ_FINANCE'] };
  finance.data.selectedKind = 'supplier'; finance.data.selected = { id: 'bill-1', payableAmount: '30.00' };
  finance.data.paymentSelection = ['item-a']; finance.data.paymentDate = '2026-10-15';
  await finance.prepareSupplierPayment();
  assert.equal(calls[0].path, '/payment-records/preview');
  assert.equal(finance.data.paymentPreview.totalPayableAmount, '30.00');
  finance.data.paymentEvidence = [{ id: 'proof-1' }];
  await finance.submitSupplierPayment();
  const submitted = calls.find(call => call.path === '/payment-records');
  assert.equal(submitted.role, 'finance');
  assert.equal(submitted.options.data.direction, 'COMPANY_TO_SUPPLIER');
  assert.deepEqual(Array.from(submitted.options.data.items, item => [item.settlementItemId, item.expectedVersion, item.expectedAmount]), [['item-a', 4, '30.00']]);
  assert.deepEqual(Array.from(submitted.options.data.evidenceFileIds), ['proof-1']);
  assert.match(submitted.options.header['idempotency-key'], /^mini-company-payment-/);
  assert.equal(finance.data.selectedKind, 'payment');
  assert.equal(finance.data.selected.paymentNo, 'PAY-1');
  const markup = readFileSync('apps/miniprogram/pages/finance/index.wxml', 'utf8');
  assert.ok(markup.includes('登记公司付款'));
  assert.ok(markup.includes('核对可付金额'));
  assert.ok(markup.includes('确认登记付款'));
});
test('company finance labels a fully reserved supplier bill as awaiting supplier confirmation', async () => {
  const finance = page('finance', async path => {
    if (path === '/supplier-statements') return [{ id: 'bill', supplierId: 's1', periodKey: '2026-10', settlementStatus: 'OPEN', payableAmount: '0.00', pendingPaymentAmount: '30.00' }];
    if (path === '/stores' || path === '/suppliers' || path === '/payment-records' || path === '/store-statements') return [];
    return {};
  });
  await finance.originalLoadWork();
  assert.equal(finance.data.supplierStatements[0].status, 'PENDING_SETTLEMENT_CONFIRMATION');
  const labels = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/labels.wxs', 'utf8'), { module: labels });
  assert.equal(labels.exports.status(finance.data.supplierStatements[0].status), '待供应商确认收款');
});
test('shipping navigation, clickable recipient phone and account statement labels avoid ambiguous duplicate controls', () => {
  const supplier = readFileSync('apps/miniprogram/pages/supplier/index.wxml', 'utf8');
  assert.ok(supplier.includes("!statementReturnId && orderMode === 'detail'"));
  assert.ok(supplier.includes('class="contact-phone" bindtap="callContact"'));
  assert.equal(supplier.includes('联系收货人</button>'), false);
  const store = readFileSync('apps/miniprogram/pages/store/index.wxml', 'utf8');
  assert.ok(store.includes('返回我的')); assert.ok(store.includes('暂无公司账期账单'));
  const finance = readFileSync('apps/miniprogram/pages/finance/index.wxml', 'utf8');
  assert.ok(finance.includes("=== 'OPEN' ? '待结清'"));
});
test('supplier exception history is compact, hidden when empty, and guarded against empty navigation', () => {
  const markup = readFileSync('apps/miniprogram/pages/supplier/index.wxml', 'utf8');
  assert.ok(markup.includes('class="supplier-exception-empty"'));
  assert.ok(markup.includes('wx:if="{{discrepancies.length > 0 && !loading && !error}}"'));
  assert.equal((markup.match(/查看全部收货异常/g) || []).length, 1);
  let toast = '';
  const supplier = page('supplier', undefined, {}, { showToast: options => { toast = options.title; } });
  supplier.data.discrepancies = [];
  supplier.changeView(tap('', { view: 'differences' }));
  assert.equal(supplier.data.activeView, 'tasks');
  assert.equal(toast, '暂无收货异常记录');
  supplier.data.discrepancies = [{ id: 'd1' }];
  supplier.changeView(tap('', { view: 'differences' }));
  assert.equal(supplier.data.activeView, 'differences');
});
test('supplier reconciliation highlights bill balance and payment amounts with separate scannable rows', () => {
  const markup = readFileSync('apps/miniprogram/pages/supplier/index.wxml', 'utf8');
  const styles = readFileSync('apps/miniprogram/pages/supplier/index.wxss', 'utf8');
  assert.ok(markup.includes('class="supplier-bill-item pressable"'));
  assert.ok(markup.includes('class="supplier-bill-payable"'));
  assert.ok(markup.includes('class="supplier-bill-breakdown"'));
  assert.ok(markup.includes('class="supplier-payment-item pressable"'));
  assert.ok(markup.includes('class="supplier-payment-amount"'));
  assert.equal(markup.includes('reconcile-guide'), false);
  assert.ok(styles.includes('supplier-bill-item, .supplier-payment-item'));
  assert.ok(styles.includes('supplier-bill-payable text:last-child'));
});
test('store and purchaser default to formal orders and retain a separate source record view', async () => {
  for (const role of ['store', 'purchaser']) {
    const instance = page(role, async () => ({ id: 'r1', status: 'CONFIRMED', items: [], supplierOrders: [] }));
    assert.equal(instance.data.recordType, 'orders');
    let opened = '';
    instance.selectComponent = () => ({ data: { active: true }, open: event => { opened = event.currentTarget.dataset.id; } });
    instance.openOrderSource({ detail: { id: 'r1', orderId: 'order1' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(instance.data.recordType, 'requests');
    assert.equal(instance.data.sourceOrderReturn, true);
    if (role === 'store') instance.closeRequest(); else instance.backToList();
    assert.equal(instance.data.recordType, 'orders'); assert.equal(opened, 'order1');
    assert.equal(instance.data.sourceOrderReturn, false);
  }
});
test('procurement generated-order entry opens the exact formal order and does not reconfirm', () => {
  const instance = page('purchaser');
  instance.data.activeView = 'orders'; instance.data.requestId = 'r1'; instance.data.taskOrigin = true;
  let opened = '';
  instance.selectComponent = () => ({ open: event => { opened = event.currentTarget.dataset.id; } });
  instance.openGeneratedOrder(tap('order2'));
  assert.equal(instance.data.requestId, ''); assert.equal(instance.data.activeView, 'orders');
  assert.equal(instance.data.recordType, 'orders'); assert.equal(instance.data.taskOrigin, false); assert.equal(opened, 'order2');
});
test('procurement reports group separate orders under supplier identity across pagination', () => {
  const purchaser = page('purchaser');
  purchaser.data.reports.orderAmount = { orders: [
    { supplierOrderId: 'o1', supplierId: 's1', supplierName: '供应商甲', items: [{ id: 'i1' }] },
    { supplierOrderId: 'o2', supplierId: 's2', supplierName: '供应商乙', items: [] },
    { supplierOrderId: 'o3', supplierId: 's1', supplierName: '供应商甲', items: [{ id: 'i3' }] },
    { supplierOrderId: 'o4', supplierId: 's3', supplierName: '供应商丙', items: [] },
  ] };
  purchaser.refreshReportDetails(2);
  assert.equal(purchaser.data.reportSupplierGroups.length, 2);
  assert.equal(purchaser.data.moreReportDetails, true);
  assert.equal(purchaser.data.reportSupplierGroups[0].orders.length, 2);
  assert.equal(purchaser.data.visibleReportOrders.length, 3);
  purchaser.toggleReportOrder(tap('o1'));
  assert.equal(purchaser.data.reportSupplierGroups.length, 2);
  purchaser.nextReportDetails();
  assert.equal(purchaser.data.reportSupplierGroups.length, 3);
  assert.equal(purchaser.data.moreReportDetails, false);
  assert.equal(purchaser.data.reportSupplierGroups[0].orders.length, 2);
  assert.equal(purchaser.data.reportSupplierGroups[0].orders[0].supplierOrderId, 'o1');
  assert.equal(purchaser.data.reportSupplierGroups[0].orders[1].supplierOrderId, 'o3');
  assert.equal(purchaser.data.reportSupplierGroups[0].orders[0].open, true);
  assert.equal(purchaser.data.reportSupplierGroups[0].orders[1].open, undefined);
  purchaser.updateReportImage('unused', { imageUrl: 'local-image' });
  assert.equal(purchaser.data.reportSupplierGroups.length, 3);
  assert.equal(purchaser.data.reportSupplierGroups[0].orders[0].open, true);
});
test('procurement report date presets follow Shanghai dates and support cross-month totals', () => {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/store-view.js', 'utf8'), { module });
  const v = module.exports;
  assert.deepEqual(plain(v.reportPreset('today', '2026-10-12T18:00:00Z')), { from: '2026-10-13', to: '2026-10-13' });
  assert.deepEqual(plain(v.reportPreset('week', '2026-10-12T18:00:00Z')), { from: '2026-10-12', to: '2026-10-13' });
  assert.deepEqual(plain(v.reportPreset('lastMonth', '2026-01-10T00:00:00Z')), { from: '2025-12-01', to: '2025-12-31' });
  assert.ok(v.reportRangeError({ from: '2026-02-30', to: '2026-03-01' }));
  assert.ok(v.reportRangeError({ from: '2026-10-13', to: '2026-10-12' }));
  assert.ok(v.reportRangeError({ from: '2026-01-01', to: '2026-05-01' }));
  assert.equal(v.reportRangeError({ from: '2026-09-01', to: '2026-10-13' }), '');
  const summary = v.reportSummary({ months: [{ totalAmount: '10.10', orderCount: 1 }, { totalAmount: '20.20', orderCount: 2 }] }, { products: [{}, {}] });
  assert.equal(summary.amount, '30.30'); assert.equal(summary.count, 3); assert.equal(summary.productCount, 2);
});

test('procurement statistics queries applied custom range and ignores superseded responses', async () => {
  const pending = [];
  const purchaser = page('purchaser', path => new Promise(resolve => pending.push({ path, resolve })));
  purchaser.data.user = { id: 'buyer' };
  purchaser.data.reportDraft = { from: '2026-09-01', to: '2026-10-13' };
  const old = purchaser.applyReportRange();
  assert.equal(pending.length, 2);
  assert.ok(pending.every(item => !item.path.includes('/reports/profit')));
  purchaser.data.reportDraft = { from: '2026-10-01', to: '2026-10-13' };
  const latest = purchaser.applyReportRange();
  const responses = [{ months: [{ totalAmount: '30.30', orderCount: 2 }] }, { products: [] }];
  pending.slice(2).forEach((item, i) => item.resolve(responses[i]));
  await latest;
  pending.slice(0, 2).forEach((item, i) => item.resolve(i === 0 ? { months: [{ totalAmount: '999.00' }] } : responses[i]));
  await old;
  assert.equal(purchaser.data.reportSummary.amount, '30.30');
  assert.equal(purchaser.data.reportRange.from, '2026-10-01');
  assert.equal(purchaser.data.reportsLoading, false);
  purchaser.data.reportDraft = { from: '2026-10-14', to: '2026-10-01' };
  await purchaser.applyReportRange();
  assert.equal(pending.length, 4);
  assert.ok(purchaser.data.reportsError);
});
test('procurement statistics paginate five suppliers without standalone quantity tabs', () => {
  const purchaser = page('purchaser');
  purchaser.data.reports = { orderAmount: { orders: Array.from({ length: 12 }, (_, id) => ({ supplierOrderId: String(id) })) }, productQuantity: { products: [{ productId: 'p' }] } };
  purchaser.refreshReportDetails();
  assert.equal(purchaser.data.visibleReportOrders.length, 5);
  assert.equal(purchaser.data.moreReportDetails, true);
  purchaser.nextReportDetails();
  assert.equal(purchaser.data.visibleReportOrders.length, 10);
  assert.equal(purchaser.data.moreReportDetails, true);
  purchaser.nextReportDetails();
  assert.equal(purchaser.data.visibleReportOrders.length, 12);
  assert.equal(purchaser.data.moreReportDetails, false);
  assert.equal(purchaser.changeReportDetailView, undefined);
  const markup = readFileSync('apps/miniprogram/pages/purchaser/index.wxml', 'utf8');
  assert.ok(markup.includes('order.items'));
  assert.ok(!markup.includes('changeReportDetailView'));
});
test('report filters apply to both queries and completed orders show real receipt lines', async () => {
  const calls = [];
  const purchaser = page('purchaser', async path => {
    calls.push(path);
    return path.includes('order-amounts') ? { months: [], orders: [{ supplierOrderId: 'o', completedAt: '2026-10-13T00:00:00Z', items: [{ id: 'i', productName: '大米', receivedQuantity: '3.000000', goodsAmount: '195.84', unitPrice: '65.28' }] }] } : { products: [] };
  });
  purchaser.data.reportStoreOptions = [{ id: '', name: '全部' }, { id: 'store', name: '门店' }];
  purchaser.chooseReportFilter({ currentTarget: { dataset: { field: 'storeId' } }, detail: { value: '1' } });
  assert.equal(purchaser.data.reportFilters.storeId, '');
  await purchaser.applyReportRange();
  assert.ok(calls.every(path => path.includes('storeId=store')));
  assert.ok(calls[0].includes('includeItems=true'));
  assert.equal(purchaser.data.visibleReportOrders[0].items[0].quantityText, '3');
  purchaser.toggleReportOrder(tap('o'));
  assert.equal(purchaser.data.visibleReportOrders[0].open, true);
  purchaser.toggleReportOrder(tap('o'));
  assert.equal(purchaser.data.visibleReportOrders[0].open, false);
});
test('report product image results cannot update a later query', async () => {
  let resolveImage;
  const purchaser = page('purchaser', undefined, { imagePath: () => new Promise(resolve => { resolveImage = resolve; }) });
  purchaser.data.user = { id: 'buyer' };
  purchaser.reportSequence = 1;
  purchaser.data.reports.orderAmount = { orders: [{ supplierOrderId: 'o', items: [{ id: 'i', imageFile: { id: 'image' } }] }] };
  const loading = purchaser.loadReportImages('o');
  assert.equal(purchaser.data.visibleReportOrders[0].items[0].imageLoading, true);
  purchaser.reportSequence = 2;
  purchaser.data.reports.orderAmount = { orders: [{ supplierOrderId: 'new', items: [] }] };
  resolveImage('/tmp/image.png'); await loading;
  assert.equal(purchaser.data.reports.orderAmount.orders[0].supplierOrderId, 'new');
  assert.equal(purchaser.data.reports.orderAmount.orders[0].items.length, 0);
});
test('report thumbnail failures remain explicit and can retry', async () => {
  let fail = true;
  const purchaser = page('purchaser', undefined, { imagePath: async () => { if (fail) throw new Error('failed'); return '/tmp/image.png'; } });
  purchaser.data.user = { id: 'buyer' }; purchaser.reportSequence = 1;
  purchaser.data.reports.orderAmount = { orders: [{ supplierOrderId: 'o', items: [{ id: 'i', imageFile: { id: 'image' } }] }] };
  await purchaser.loadReportImages('o');
  assert.equal(purchaser.data.visibleReportOrders[0].items[0].imageFailed, true);
  fail = false;
  await purchaser.retryReportImage({ detail: { productId: 'i' } });
  assert.equal(purchaser.data.visibleReportOrders[0].items[0].imageUrl, '/tmp/image.png');
});
test('procurement statistics has a contextual return to mine without clearing reports', () => {
  const purchaser = page('purchaser');
  purchaser.data.activeView = 'reports';
  const range = purchaser.data.reportRange;
  const reports = purchaser.data.reports;
  purchaser.changeView(tap('', { view: 'mine' }));
  assert.equal(purchaser.data.activeView, 'mine');
  assert.equal(purchaser.data.reportRange, range);
  assert.equal(purchaser.data.reports, reports);
  const markup = readFileSync('apps/miniprogram/pages/purchaser/index.wxml', 'utf8');
  assert.match(markup, /class="card" wx:if="\{\{activeView === 'reports'\}\}">\s*<view class="back-link" data-view="mine" bindtap="changeView">‹ 返回我的<\/view>/);
});
test('checkout funding shows only used methods and subtracts exact cents', () => {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/store-view.js', 'utf8'), { module });
  const summary = module.exports.checkoutFunding;
  const preview = (total, stored, credit) => ({ totals: { salesGoodsAmount: total }, funding: { stored, ...(credit ? { credit } : {}) } });
  const credit = summary(preview('290.50', { required: '0.00', available: '0.00' }, { required: '290.50', available: '4631.16' }));
  assert.equal(credit.usesStored, false);
  assert.equal(credit.usesCredit, true);
  assert.equal(credit.creditRemaining, '4340.66');
  assert.equal(credit.termAmount, null);
  const mixed = summary(preview('100.00', { required: '30.00', available: '50.00' }, { required: '40.00', available: '70.00' }));
  assert.equal(mixed.storedRemaining, '20.00');
  assert.equal(mixed.creditRemaining, '30.00');
  assert.equal(mixed.termAmount, '30.00');
  const shortfall = summary(preview('50.00', { required: '30.00', available: '10.00' }, { required: '20.00', available: '5.00' }));
  assert.equal(shortfall.storedRemaining, null);
  assert.equal(shortfall.creditRemaining, null);
  const term = summary(preview('50.00', { required: '0.00', available: '100.00' }));
  assert.equal(term.usesStored, false);
  assert.equal(term.usesCredit, false);
  assert.equal(term.termAmount, '50.00');
  assert.equal(summary(preview('0.30', { required: '0.10', available: '0.30' })).storedRemaining, '0.20');
  assert.equal(summary(preview('1.00', { required: '1.00', available: 'invalid' })).storedRemaining, null);
});
test('procurement rejection detail retains cause and opens only its affected order', async () => {
  const purchaser = page('purchaser', async path => path.startsWith('/supplier-orders/') ? { items: [] } : { id: 'r', status: 'CONFIRMED', supplierOrders: [{ id: 'o' }], items: [] });
  purchaser.data.rejectionTodos = [{ supplierOrderId: 'o', supplierName: '生鲜供应商', reason: '缺货' }];
  await purchaser.selectRejection(tap('', { requestId: 'r', supplierOrderId: 'o' }));
  assert.equal(purchaser.data.rejectionContext.reason, '缺货');
  assert.equal(purchaser.data.expandedOrders.o, true);
  const markup = readFileSync('apps/miniprogram/pages/purchaser/index.wxml', 'utf8');
  assert.ok(markup.includes("item.id === rejectedOrderId"));
  assert.ok(markup.includes('task-decision-section'));
  assert.ok(markup.includes('确认改派'));
});
test('purchaser rejection detail has only its contextual return action', () => {
  const markup = readFileSync('apps/miniprogram/pages/purchaser/index.wxml', 'utf8');
  assert.ok(markup.includes("activeView === 'freight' || activeView === 'rejections' && !requestId"));
  const purchaser = page('purchaser');
  Object.assign(purchaser.data, { activeView: 'rejections', taskOrigin: true, taskType: 'rejections', requestId: 'r' });
  purchaser.backToList();
  assert.equal(purchaser.data.activeView, 'tasks');
  assert.equal(purchaser.data.taskType, 'rejections');
});
test('confirmed procurement folds order products independently and original request is opt-in', () => {
  const purchaser = page('purchaser');
  purchaser.data.selectedRequest = { supplierOrders: [{ id: 'a' }, { id: 'b' }] };
  assert.equal(purchaser.data.showOriginalRequest, false);
  assert.deepEqual(plain(purchaser.data.expandedOrders), {});
  purchaser.toggleSupplierOrder(tap('a'));
  assert.equal(purchaser.data.expandedOrders.a, true);
  assert.equal(purchaser.data.expandedOrders.b, undefined);
  purchaser.toggleSupplierOrder(tap('unknown'));
  assert.equal(purchaser.data.expandedOrders.unknown, undefined);
  purchaser.toggleSupplierOrder(tap('a'));
  assert.equal(purchaser.data.expandedOrders.a, false);
  purchaser.toggleOriginalRequest();
  assert.equal(purchaser.data.showOriginalRequest, true);
  purchaser.toggleOriginalRequest();
  assert.equal(purchaser.data.showOriginalRequest, false);
  purchaser.data.selectedRequest = { supplierOrders: [] };
  purchaser.toggleOriginalRequest();
  assert.equal(purchaser.data.showOriginalRequest, false);
  const markup = readFileSync('apps/miniprogram/pages/purchaser/index.wxml', 'utf8');
  assert.ok(markup.includes('!selectedRequest.supplierOrders.length || showOriginalRequest'));
  assert.ok(markup.includes('wx:if="{{expandedOrders[item.id]}}"'));
});
test('mini-program master data routes and purchaser maintenance commands are retired', () => {
  const config = JSON.parse(readFileSync('apps/miniprogram/app.json', 'utf8'));
  const project = JSON.parse(readFileSync('apps/miniprogram/project.config.json', 'utf8'));
  for (const folder of ['pages/products', 'pages/prices']) {
    assert.equal(config.pages.includes(`${folder}/index`), false);
    assert.ok(project.packOptions.ignore.some(item => item.type === 'folder' && item.value === folder));
  }
  const purchaser = page('purchaser');
  assert.equal(purchaser.openProducts, undefined);
  assert.equal(purchaser.openPrices, undefined);
});
test('order status switches preserve search and return to list controls', () => {
  for (const role of ['purchaser', 'supplier', 'store']) {
    const scrolls = [];
    const instance = page(role, undefined, {}, { pageScrollTo: options => scrolls.push(options) });
    if (role === 'store') {
      instance.data.orderSearch = 'PR-123';
      instance.data.requests = [];
      instance.filterOrders(tap('', { filter: 'completed' }));
      assert.equal(instance.data.orderSearch, 'PR-123');
    } else {
      instance.data.search = '科技园';
      instance.filterStatus(tap('', { filter: 'all' }));
      assert.equal(instance.data.search, '科技园');
    }
    assert.equal(scrolls[0].scrollTop, 0);
    assert.equal(scrolls[0].duration, 0);
  }
});
test('purchaser task detail returns to its category', async () => {
  const purchaser = page('purchaser');
  purchaser.selectRequest = async () => purchaser.setData({ requestId: 'r' });
  purchaser.changeTaskType(tap('', { type: 'freight' }));
  purchaser.changeTaskType(tap('', { type: 'invalid' }));
  assert.equal(purchaser.data.taskType, 'freight');
  await purchaser.openTaskRequest(tap('r'));
  purchaser.backToList();
  assert.equal(purchaser.data.activeView, 'tasks');
  assert.equal(purchaser.data.taskType, 'freight');
  assert.equal(purchaser.data.requestId, '');
  await purchaser.openTaskRequest(tap('r'));
  purchaser.changeView(tap('', { view: 'mine' }));
  assert.equal(purchaser.data.activeView, 'mine');
  assert.equal(purchaser.data.taskOrigin, false);
});
test('purchaser freight opens selected review and preserves category', () => {
  const purchaser = page('purchaser');
  purchaser.data.taskType = 'freight';
  purchaser.data.freightConfirmations = [{ id: 'f', status: 'PENDING' }];
  purchaser.openTaskFreight(tap('f'));
  assert.equal(purchaser.data.selectedFreight.id, 'f');
  purchaser.backToList();
  assert.equal(purchaser.data.activeView, 'tasks');
  assert.equal(purchaser.data.taskType, 'freight');
  assert.equal(purchaser.data.selectedFreight, null);
});
test('prices display two decimals and delivery contact calls the separate phone', () => {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/labels.wxs', 'utf8'), { module });
  assert.equal(module.exports.money('8'), '8.00');
  assert.equal(module.exports.money('1.005'), '1.01');
  assert.equal(module.exports.money('9.999'), '10.00');
  assert.equal(module.exports.money(null), '—');
  let called;
  const store = page('store', undefined, {}, { makePhoneCall: value => { called = value.phoneNumber; } });
  store.callDeliveryContact(tap('', { phone: '13800000000' }));
  assert.equal(called, '13800000000');
  store.callDeliveryContact(tap('', { phone: '' }));
  assert.equal(called, '13800000000');
});
const input = (id, value) => ({ ...tap(id), detail: { value } });
const plain = value => JSON.parse(JSON.stringify(value));

test('admin role switch is only available in mine and normal accounts do not see it', () => {
  for (const name of ['store', 'supplier', 'purchaser', 'finance', 'region']) {
    const template = readFileSync(`apps/miniprogram/pages/${name}/index.wxml`, 'utf8');
    assert.ok(template.includes('<test-context wx:if="{{activeView === \'mine\'}}" />'));
    assert.equal(template.includes('<test-context />'), false);
  }
  let user = { roles: ['STORE'], displayName: '门店用户', username: 'store1' };
  let definition;
  const calls = [];
  vm.runInNewContext(readFileSync('apps/miniprogram/components/test-context/index.js', 'utf8'), {
    Component: value => { definition = value; }, require: () => ({ currentUser: () => user }),
    wx: { navigateTo: value => calls.push(value.url) },
  });
  const component = { data: { ...definition.data }, ...definition.methods, setData(value) { Object.assign(this.data, value); } };
  component.refresh();
  assert.equal(component.data.enabled, false);
  user = { ...user, testWorkbenchEnabled: true, testIdentity: { userId: 'store1' } };
  component.refresh();
  assert.equal(component.data.enabled, true);
  assert.equal(component.data.roleText, '门店厨政经理');
  component.open();
  assert.deepEqual(calls, ['/pages/test-workbench/index']);
});

function workbenchApi() {
  const storage = new Map([['procurexToken', 'root-session'], ['procurexUser', { id: 'target', testWorkbenchEnabled: true, roles: ['STORE'], scope: { storeId: 'store' }, testIdentity: { userId: 'target' } }]]);
  const calls = [], pages = [], module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), { module, getApp: () => ({ globalData: { apiBase: 'http://local/api/v1' } }), getCurrentPages: () => pages, wx: {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), request: options => calls.push(options)
  } });
  return { api: module.exports, storage, calls, pages };
}
test('test identity headers preserve root token and switching returns to administrator', async () => {
  const { api, calls, storage } = workbenchApi();
  assert.deepEqual(plain(api.authHeaders()), { authorization: 'Bearer root-session', 'x-test-user-id': 'target' });
  const switching = api.switchTestIdentity('supplier');
  assert.equal(calls[0].header['x-test-user-id'], undefined);
  assert.equal(calls[0].header.authorization, 'Bearer root-session');
  calls[0].success({ statusCode: 201, data: { data: { user: { id: 'supplier', testWorkbenchEnabled: true, roles: ['SUPPLIER'], testIdentity: { userId: 'supplier' } } } } });
  await switching;
  assert.equal(storage.get('procurexToken'), 'root-session');
  const returning = api.switchTestIdentity(null);
  assert.ok(calls[1].url.endsWith('/me')); assert.equal(calls[1].header['x-test-user-id'], undefined);
  calls[1].success({ statusCode: 200, data: { data: { user: { id: 'admin', roles: ['ADMIN'], testWorkbenchEnabled: true } } } });
  await returning; assert.equal(api.authHeaders()['x-test-user-id'], undefined);
});
test('test identity switching blocks active requests, pending submissions and uploads', async () => {
  const { api, calls, storage, pages } = workbenchApi();
  const reading = api.request('/stores');
  await assert.rejects(api.switchTestIdentity('other'), /等待当前操作/);
  calls[0].success({ statusCode: 200, data: { data: [] } }); await reading;
  storage.set('procurex-order-target-store', { key: 'pending' });
  await assert.rejects(api.switchTestIdentity('other'), /待确认/);
  storage.delete('procurex-order-target-store');
  storage.set('procurexRoleCommands:http%3A%2F%2Flocal%2Fapi%2Fv1:target:supplier', { pending: { key: 'pending' } });
  await assert.rejects(api.switchTestIdentity('other'), /原提交结果/);
  storage.delete('procurexRoleCommands:http%3A%2F%2Flocal%2Fapi%2Fv1:target:supplier');
  pages.push({ route: 'pages/store/index', data: { receiptUploading: true } });
  await assert.rejects(api.switchTestIdentity('other'), /完成或取消/);
  assert.equal(calls.length, 1);
});
test('test workbench confirmation cancellation does not change identity', async () => {
  let switched = false;
  const workbench = page('test-workbench', undefined, { switchTestIdentity: () => { switched = true; } }, { showModal: options => options.success({ confirm: false }) });
  workbench.data.items = [{ id: 'a', displayName: '测试门店' }];
  await workbench.select(tap('a'));
  assert.equal(switched, false); assert.equal(workbench.data.switching, false);
});
test('test workbench groups identities by business role and supports logout', () => {
  let loggedOut = false; const calls = [];
  const workbench = page('test-workbench', undefined, { logout: () => { loggedOut = true; } }, { reLaunch: value => calls.push(value.url) });
  workbench.data.items = [
    { id: 's1', username: 'store1', displayName: '门店用户1', entityName: '门店1', roles: ['STORE'], roleText: '门店厨政经理' },
    { id: 'p1', username: 'supplier1', displayName: '供应商用户1', entityName: '供应商1', roles: ['SUPPLIER'], roleText: '供应商' },
    { id: 'b1', username: 'buyer1', displayName: '采购用户1', roles: ['PURCHASER'], roleText: '公司采购' },
  ];
  workbench.groupItems();
  assert.deepEqual(plain(workbench.data.groups.map(group => [group.role, group.items.length])), [['STORE', 1], ['SUPPLIER', 1], ['PURCHASER', 1]]);
  workbench.logout();
  assert.equal(loggedOut, true); assert.deepEqual(calls, ['/pages/login/index']);
});

for (const role of ['REGION_MANAGER', 'REGION_FINANCE', 'PURCHASE_FOLLOWER']) {
  test(`assigned-store workspace routes ${role} and rejects empty authorization`, () => {
    const calls = [], module = { exports: {} };
    let user = { id: 'assigned', roles: [role], scope: { type: 'MULTI_STORE', storeIds: ['a', 'b'] } };
    vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), { module, wx: {
      getStorageSync: () => user, hideTabBar: () => calls.push('hide'), showTabBar: () => calls.push('show'),
      switchTab: options => calls.push(options.url), redirectTo: options => calls.push(options.url)
    } });
    assert.equal(module.exports.openWorkspace('region').id, 'assigned');
    assert.equal(module.exports.openWorkspace('purchaser'), null);
    assert.equal(calls.at(-1), '/pages/region/index');
    user = { ...user, scope: { type: 'MULTI_STORE', storeIds: [] } };
    assert.equal(module.exports.openWorkspace('region'), null);
    assert.equal(calls.at(-1), '/pages/login/index');
  });
  test(`assigned-store workspace ${role} starts with role-specific tasks and scoped queries`, async () => {
    const user = { id: role, roles: [role], scope: { type: 'MULTI_STORE', storeIds: ['a', 'b'] } }, calls = [];
    const region = page('region', async path => {
      calls.push(path);
      if (path === '/stores') return [{ id: 'a', name: '授权A' }, { id: 'b', name: '授权B' }, { id: 'c', name: '范围外C' }];
      if (path.startsWith('/supplier-orders')) return [];
      return [{ id: 'one', storeId: 'a', status: 'PENDING_PROCUREMENT', requestNo: '订货一' }, { id: 'foreign', storeId: 'c', status: 'PENDING_PROCUREMENT' }];
    }, { currentUser: () => user, openWorkspace: () => user, roleCommandState: () => ({ pending: null }) });
    await region.onShow();
    assert.equal(region.data.canConfirm, role === 'PURCHASE_FOLLOWER');
    assert.equal(region.data.activeView, role === 'PURCHASE_FOLLOWER' ? 'tasks' : role === 'REGION_FINANCE' ? 'books' : 'orders');
    await region.originalLoadWork();
    assert.deepEqual(plain(region.data.stores.map(store => store.id)), ['a', 'b']);
    assert.deepEqual(plain(region.data.rows.map(row => row.id)), ['one']);
    assert.ok(!calls.includes('/suppliers') && !calls.includes('/products') && !calls.includes('/payment-records'));
    region.data.storeIndex = 2;
    await region.originalLoadWork();
    assert.ok(calls.some(path => path.endsWith('?storeId=b')));
  });
}

test('assigned-store reports validate dates and request no company profit', async () => {
  const user = { id: 'region', roles: ['REGION_MANAGER'], scope: { type: 'MULTI_STORE', storeIds: ['a'] } }, calls = [];
  const region = page('region', async path => {
    calls.push(path);
    if (path === '/stores') return [{ id: 'a', name: '授权A' }];
    return path.includes('order-amounts') ? { months: [{ month: '2026-10', totalAmount: '12.00', orderCount: 1 }] } : { products: [] };
  }, { currentUser: () => user });
  region.data.user = user; region.data.activeView = 'reports'; region.data.range = { from: '2026-10-01', to: '2026-10-10' };
  await region.originalLoadWork();
  assert.equal(region.data.report.months[0].totalAmount, '12.00');
  assert.ok(calls.every(path => !path.includes('profit')));
  region.data.range = { from: '2026-10-11', to: '2026-10-01' }; calls.length = 0;
  await region.originalLoadWork();
  assert.equal(region.data.report, null);
  assert.match(region.data.error, /开始日期/);
  assert.deepEqual(calls, ['/stores']);
});

test('assigned-store statement lines display first shipment dates without invented order status', async () => {
  const user = { id: 'finance', scope: { storeIds: ['a'] } };
  const region = page('region', async () => ({ lines: [{ supplierOrderId: 'order', firstShippedAt: '2026-10-10T08:00:00Z' }] }), { currentUser: () => user });
  region.data.user = user; region.data.activeView = 'books'; region.data.rows = [{ id: 'book', title: '门店账单' }];
  await region.openRecord(tap('book'));
  assert.match(region.data.selected.lines[0].dateText, /2026-10-10/);
  const markup = readFileSync('apps/miniprogram/pages/region/index.wxml', 'utf8');
  assert.ok(markup.includes('首发 {{item.dateText}}'));
  assert.ok(!markup.includes('{{item.completedAt}}'));
});

test('assigned-store query ignores stale account and page-hidden responses', async () => {
  let resolveStores, user = { id: 'old', scope: { storeIds: ['a'] } };
  const region = page('region', () => new Promise(resolve => { resolveStores = resolve; }), { currentUser: () => user });
  region.data.user = user;
  const load = region.originalLoadWork();
  region.onHide(); user = { id: 'new', scope: { storeIds: ['b'] } };
  resolveStores([{ id: 'a', name: '旧账号门店' }]); await load;
  assert.deepEqual(plain(region.data.stores), []);
});

test('assigned-store decisions are blocked for read-only roles and retain version on follower cancellation', async () => {
  const user = { id: 'follow', scope: { storeIds: ['a'] } }, commands = [];
  const region = page('region', undefined, {
    currentUser: () => user, roleCommandState: () => ({ pending: null }),
    roleCommand: async (...args) => { commands.push(args); }
  }, { showModal: options => options.success({ confirm: true, content: '门店取消订货' }), showToast: () => {} });
  region.data.user = user; region.data.selectedKind = 'order'; region.data.selected = { id: 'order', version: 3, status: 'PENDING_PROCUREMENT' };
  region.sequence = 1;
  await region.submitDecision(tap('', { action: 'confirm' }));
  assert.equal(commands.length, 0);
  region.data.canConfirm = true;
  await region.submitDecision(tap('', { action: 'reject' }));
  assert.equal(commands[0][1], '/purchase-requests/order/reject');
  assert.deepEqual(plain(commands[0][2].data), { expectedVersion: 3, reason: '门店取消订货' });
  assert.equal(region.data.selected, null);
});

test('assigned-store recovery never replays manager pricing or reallocation commands', async () => {
  let recovered = 0, pending = { path: '/price-changes' };
  const region = page('region', undefined, { roleCommandState: () => ({ pending }), retryRoleCommand: async () => { recovered += 1; } });
  region.data.canConfirm = true;
  region.syncCommand();
  assert.equal(region.data.blockedCommand, true);
  await region.recoverCommand();
  assert.equal(recovered, 0);
  pending = { path: '/purchase-requests/a/reallocate' }; region.syncCommand();
  assert.equal(region.data.pendingCommand, null);
  pending = { path: '/purchase-requests/a/confirm' }; region.syncCommand();
  assert.equal(region.data.pendingCommand.path, pending.path);
});

test('store receipt reminders exclude received shipments and retain returned editable receipts', async () => {
  const workspace = page('store', async path => {
    if (path === '/notifications') return { notifications: [
      { payload: { shipmentId: 'done', type: 'SHIPMENT_CREATED' } },
      { payload: { shipmentId: 'new', type: 'SHIPMENT_CREATED' } },
      { payload: { shipmentId: 'returned', type: 'DISCREPANCY_RESOLVED', action: 'RETURN' } },
      { payload: { shipmentId: 'locked', type: 'DISCREPANCY_RESOLVED', action: 'RETURN' } },
    ] };
    return { currentReceiptRevision: path.endsWith('/new') ? 0 : 1,
      items: [{ receiptLocked: !path.endsWith('/returned') }] };
  });
  await workspace.loadShipments();
  assert.equal(workspace.data.error, '');
  assert.deepEqual(plain(workspace.data.shipmentTodos.map(item => item.id)), ['new', 'returned']);
});

test('workspace forms reserve space for fixed actions and financial review has one submit control', () => {
  const styles = readFileSync('apps/miniprogram/styles/workspace.wxss', 'utf8');
  assert.match(styles, /has-action-bar.*padding-bottom/);
  assert.match(styles, /\.action-bar.*position: fixed/);
  for (const role of ['supplier', 'purchaser', 'finance']) {
    const markup = readFileSync(`apps/miniprogram/pages/${role}/index.wxml`, 'utf8');
    assert.ok(markup.includes('has-action-bar'));
    assert.ok(markup.includes('action-bar'));
  }
  const finance = readFileSync('apps/miniprogram/pages/finance/index.wxml', 'utf8');
  assert.equal((finance.match(/bindtap="submitReview"/g) || []).length, 1);
  const labels = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/labels.wxs', 'utf8'), { module: labels });
  assert.equal(labels.exports.status('SETTLED'), '已结清');
  assert.equal(labels.exports.status('SHORTFALL'), '待补足资金');
});

test('evidence component loads authenticated image thumbnails but does not download PDFs eagerly', async () => {
  let definition;
  const calls = [];
  vm.runInNewContext(readFileSync('apps/miniprogram/components/evidence/index.js', 'utf8'), {
    Component: value => { definition = value; },
    require: () => ({ currentUser: () => ({ id: 'actor' }), downloadEvidence: async file => { calls.push(file.id); return '/tmp/image.jpg'; } })
  });
  const component = { ...definition.methods, data: definition.data,
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const match = key.match(/^rows\[(\d+)\]\.(\w+)$/);
        if (match) this.data.rows[Number(match[1])][match[2]] = value;
        else this.data[key] = value;
      }
    } };
  await component.loadFiles([{ id: 'image', mimeType: 'image/jpeg' }, { id: 'pdf', mimeType: 'application/pdf' }]);
  assert.deepEqual(calls, ['image']);
  assert.equal(component.data.rows[0].path, '/tmp/image.jpg');
  assert.equal(component.data.rows[1].path, undefined);
});

test('finance query pagination preserves full searchable records', () => {
  const workspace = page('finance');
  workspace.data.payments = Array.from({ length: 25 }, (_, index) => ({ title: '付款' + index }));
  workspace.refreshRecords(); assert.equal(workspace.data.visibleRecords.length, 10);
  workspace.nextRecords(); assert.equal(workspace.data.visibleRecords.length, 20);
  workspace.nextRecords(); assert.equal(workspace.data.visibleRecords.length, 25);
  workspace.onSearch({ detail: { value: '付款24' } });
  assert.equal(workspace.data.visibleRecords.length, 1);
  assert.equal(workspace.data.moreRecords, false);
});

test('supplier does not restore another account order list after a delayed response', async () => {
  let resolve;
  const workspace = page('supplier', () => new Promise(done => { resolve = done; }));
  workspace.data.user = { id: 'old' };
  const pending = workspace.loadOrders();
  workspace.data.user = { id: 'new' };
  resolve([{ id: 'old-order', status: 'PUSHED' }]);
  await pending;
  assert.equal(workspace.data.orders.length, 0);
});

test('finance tasks contain only pending incoming company receipts', async () => {
  const workspace = page('finance', async path => ({
    '/payment-records': [
      { id: 'incoming', paymentNo: 'R1', direction: 'STORE_TO_COMPANY', storeId: 's', status: 'PENDING' },
      { id: 'outgoing', direction: 'COMPANY_TO_SUPPLIER', status: 'PENDING' },
      { id: 'done', direction: 'STORE_TO_COMPANY', status: 'CONFIRMED' }
    ], '/store-statements': [], '/supplier-statements': [],
    '/stores': [{ id: 's', name: '验收门店' }], '/suppliers': []
  })[path]);
  await workspace.originalLoadWork();
  assert.deepEqual(plain(workspace.data.tasks.map(item => item.id)), ['incoming']);
  assert.equal(workspace.data.tasks[0].subtitle, '验收门店');
});

test('finance rejection requires a reason and sends version with idempotency protection', async () => {
  const calls = [];
  const workspace = page('finance', async (path, options) => {
    calls.push({ path, options }); return { status: 'REJECTED' };
  });
  workspace.data.selected = { id: 'receipt', canReview: true, version: 3 };
  workspace.startReview(tap('', { action: 'reject' }));
  await workspace.submitReview();
  assert.equal(calls.length, 0);
  workspace.onReason({ detail: { value: '金额不符' } });
  await workspace.submitReview();
  assert.equal(calls[0].path, '/payment-records/receipt/reject');
  assert.deepEqual(plain(calls[0].options.data), { expectedVersion: 3, reason: '金额不符' });
  assert.ok(calls[0].options.header['idempotency-key']);
  assert.equal(workspace.data.selected.canReview, false);
});

test('finance cannot review outgoing payments and ignores hidden-page detail responses', async () => {
  let resolve;
  const workspace = page('finance', () => new Promise(done => { resolve = done; }));
  const pending = workspace.openRecord(tap('outgoing', { kind: 'payment' }));
  workspace.onHide();
  resolve({ id: 'outgoing', direction: 'COMPANY_TO_SUPPLIER', status: 'PENDING' });
  await pending;
  assert.equal(workspace.data.selected, null);
  workspace.data.selected = { canReview: false };
  workspace.startReview(tap('', { action: 'confirm' }));
  assert.equal(workspace.data.reviewMode, '');
});

test('supplier starts with actionable orders and separates completed from awaiting receipt', async () => {
  const workspace = page('supplier', async () => [
    { id: 'new', status: 'PUSHED', productSummary: '珍珠粉圆' },
    { id: 'accepted', status: 'ACCEPTED' },
    { id: 'partial', status: 'PARTIAL_SHIPPED' },
    { id: 'shipped', status: 'SHIPPED', fulfillmentStatus: 'PENDING' },
    { id: 'done', status: 'SHIPPED', fulfillmentStatus: 'COMPLETED' },
  ]);
  await workspace.loadOrders();
  workspace.filterStatus(tap('', { filter: 'pending' }));
  assert.deepEqual(plain(workspace.data.visibleOrders.map(item => item.id)), ['new', 'accepted']);
  workspace.filterStatus(tap('', { filter: 'SHIPPED' }));
  assert.deepEqual(plain(workspace.data.visibleOrders.map(item => item.id)), ['shipped']);
  workspace.filterStatus(tap('', { filter: 'COMPLETED' }));
  assert.deepEqual(plain(workspace.data.visibleOrders.map(item => item.id)), ['done']);
  workspace.filterStatus(tap('', { filter: 'all' }));
  workspace.onSearch({ detail: { value: '珍珠' } });
  assert.deepEqual(plain(workspace.data.visibleOrders.map(item => item.id)), ['new']);
});

test('supplier orders prioritize workflow state and sort active work oldest first', async () => {
  const workspace = page('supplier', async () => [
    { id: 'done-new', status: 'COMPLETED', fulfillmentStatus: 'COMPLETED', createdAt: '2026-10-10T10:00:00Z' },
    { id: 'shipped-old', status: 'SHIPPED', createdAt: '2026-10-01T10:00:00Z' },
    { id: 'pending-new', status: 'PUSHED', createdAt: '2026-10-09T10:00:00Z' },
    { id: 'rejected', status: 'REJECTED', createdAt: '2026-10-15T10:00:00Z' },
    { id: 'partial-old', status: 'PARTIAL_SHIPPED', createdAt: '2026-10-02T10:00:00Z' },
    { id: 'pending-old', status: 'ACCEPTED', createdAt: '2026-10-03T10:00:00Z' },
    { id: 'done-old', status: 'COMPLETED', fulfillmentStatus: 'COMPLETED', createdAt: '2026-10-05T10:00:00Z' },
  ]);
  await workspace.loadOrders();
  assert.deepEqual(plain(workspace.data.visibleOrders.map(item => item.id)), [
    'pending-old', 'pending-new', 'partial-old', 'shipped-old', 'done-new', 'done-old', 'rejected'
  ]);
  assert.deepEqual(plain(workspace.data.shippingTasks.map(item => item.id)), [
    'partial-old', 'pending-old', 'pending-new'
  ]);
  const markup = readFileSync('apps/miniprogram/pages/supplier/index.wxml', 'utf8');
  assert.ok(markup.includes('待处理订单优先 · 处理中按下单时间从早到晚'));
});

test('supplier order list separates each order and presents store, status, items and amount in clear hierarchy', () => {
  const markup = readFileSync('apps/miniprogram/pages/supplier/index.wxml', 'utf8');
  const styles = readFileSync('apps/miniprogram/pages/supplier/index.wxss', 'utf8');
  assert.ok(markup.includes('class="list supplier-orders-list"'));
  assert.ok(markup.includes('class="row supplier-order-list-item pressable"'));
  for (const label of ['supplier-order-store', 'supplier-order-meta', 'supplier-order-products-heading', 'supplier-order-total', '查看详情']) assert.ok(markup.includes(label));
  assert.ok(styles.includes('border: 1rpx solid var(--line)'));
  assert.ok(styles.includes('gap: 14rpx'));
  assert.ok(styles.includes('-webkit-line-clamp: 2'));
});

test('supplier enters shipping or rejection only when permitted and cannot switch during submission', () => {
  const workspace = page('supplier');
  workspace.data.selectedOrder = { canShip: false, canReject: false };
  workspace.changeOrderMode(tap('', { mode: 'ship' }));
  assert.equal(workspace.data.orderMode, 'detail');
  workspace.data.selectedOrder = { canShip: true, canReject: true };
  workspace.changeOrderMode(tap('', { mode: 'ship' }));
  assert.equal(workspace.data.orderMode, 'ship');
  workspace.data.shipping = true;
  workspace.changeOrderMode(tap('', { mode: 'reject' }));
  assert.equal(workspace.data.orderMode, 'ship');
  workspace.data.shipping = false;
  workspace.changeOrderMode(tap('', { mode: 'reject' }));
  assert.equal(workspace.data.orderMode, 'reject');
  workspace.backToList();
  assert.equal(workspace.data.orderMode, 'detail');
});

for (const role of ['supplier', 'purchaser']) {
  test(`${role} workspace account navigation preserves filters and submission guards`, () => {
    const workspace = page(role);
    workspace.data.search = 'saved-search';
    workspace.data.statusFilter = 'saved-filter';
    workspace.changeView(tap('', { view: 'mine' }));
    assert.equal(workspace.data.activeView, 'mine');
    workspace.changeView(tap('', { view: 'orders' }));
    assert.equal(workspace.data.search, 'saved-search');
    assert.equal(workspace.data.statusFilter, 'saved-filter');
    workspace.data[role === 'supplier' ? 'shipping' : 'confirming'] = true;
    workspace.changeView(tap('', { view: 'mine' }));
    assert.equal(workspace.data.activeView, 'orders');
    const markup = readFileSync(`apps/miniprogram/pages/${role}/index.wxml`, 'utf8');
    assert.ok(markup.includes('data-view="mine"'));
    assert.ok(!markup.includes('本机提交记录'));
    assert.ok(!markup.includes("activeView === 'history'"));
    assert.ok(markup.includes('account-logout'));
  });
}

test('all role workspaces omit device submission history entries', () => {
  for (const role of ['store', 'supplier', 'purchaser', 'finance', 'region']) {
    const markup = readFileSync(`apps/miniprogram/pages/${role}/index.wxml`, 'utf8');
    assert.ok(!markup.includes('本机提交记录'));
    assert.ok(!markup.includes('data-view="history"'));
  }
});

test('native own profiles require a binding and never enumerate foreign entities', async () => {
  const calls = [];
  const user = { id: 'supplier-user', roles: ['SUPPLIER'], scope: { supplierId: 'own' } };
  const request = async path => {
    calls.push(path);
    return path.endsWith('/managed-products') ? { items: [
      { id: 'p', name: 'Water', sku: 'W', categoryId: 'water', categoryName: '饮用水', categoryParentId: 'drink', categoryParentName: '饮品', productActive: true, supplyEnabled: true, version: 1 },
      { id: 'p2', name: 'Tea', sku: 'T', categoryId: 'tea', categoryName: '茶饮', categoryParentId: 'drink', categoryParentName: '饮品', productActive: true, supplyEnabled: false, version: 2 },
      { id: 'p3', name: 'Rice', sku: 'R', categoryId: 'rice', categoryName: '米面', categoryParentId: 'food', categoryParentName: '粮油', productActive: true, supplyEnabled: true, version: 3 }
    ] }
      : { id: 'own', name: 'Own supplier', bankAccount: 'own-bank', defaultSettlementMode: 'COMPANY_TERM', status: 'ACTIVE' };
  };
  const profile = page('profile', request, { currentUser: () => user });
  profile.onLoad({ kind: 'supplier' }); await profile.loadProfile();
  assert.deepEqual(calls, ['/suppliers/own']);
  const catalog = page('supplier-products', request, { currentUser: () => user });
  await catalog.loadProducts();
  assert.deepEqual(calls, ['/suppliers/own', '/suppliers/own/managed-products']);
  assert.equal(profile.data.profile.id, 'own');
  assert.equal(profile.data.fields.find(item => item.label === '银行账号').value, 'own-bank');
  assert.deepEqual(plain(catalog.data.categories.map(item => [item.name, item.level, item.count])), [
    ['全部商品', 0, 3], ['饮品', 1, 2], ['粮油', 1, 1]
  ]);
  catalog.choosePrimaryCategory(tap('drink')); assert.deepEqual(catalog.data.visibleProducts.map(item => item.id), ['p', 'p2']);
  assert.deepEqual(plain(catalog.data.subcategories.map(item => item.name)), ['全部', '饮用水', '茶饮']);
  catalog.chooseCategory(tap('tea')); assert.deepEqual(catalog.data.visibleProducts.map(item => item.id), ['p2']);
  catalog.choosePrimaryCategory(tap('food')); assert.equal(catalog.data.categoryId, '');
  assert.deepEqual(catalog.data.visibleProducts.map(item => item.id), ['p3']);
  assert.deepEqual(plain(catalog.data.subcategories.map(item => item.name)), ['全部', '米面']);
  catalog.chooseCategory(tap('tea')); assert.equal(catalog.data.categoryId, '');
  catalog.onSearch({ detail: { value: 'Rice' } }); assert.equal(catalog.data.categoryId, ''); assert.deepEqual(catalog.data.visibleProducts.map(item => item.id), ['p3']);
  catalog.onSearch({ detail: { value: 'NO-MATCH' } }); assert.equal(catalog.data.visibleProducts.length, 0);
  user.scope = {}; await catalog.loadProducts();
  assert.equal(calls.length, 2); assert.equal(catalog.data.products.length, 0); assert.match(catalog.data.error, /尚未配置/);
});

test('supplier listing prevents duplicate confirmation and sends versioned status only', async () => {
  const calls = [];
  let confirm;
  const user = { id: 'supplier', roles: ['SUPPLIER'], scope: { supplierId: 'own' } };
  const profile = page('supplier-products', async (path, options) => calls.push({ path, options }),
    { currentUser: () => user }, { showModal: options => { confirm = options.success; } });
  profile.data.products = [{ id: 'p', name: 'Rice', productActive: true, supplyEnabled: true, version: 3 }];
  profile.loadProfile = async () => {};
  const pending = profile.changeListing(tap('p'));
  await profile.changeListing(tap('p'));
  assert.equal(calls.length, 0);
  confirm({ confirm: true }); await pending;
  assert.deepEqual(plain(calls), [
    { path: '/suppliers/own/managed-products/p', options: { method: 'PATCH', data: { supplyEnabled: false, expectedVersion: 3 } } },
    { path: '/suppliers/own/managed-products' }
  ]);
  assert.equal(profile.data.saving, '');
});

test('supplier listing confirmation cannot submit after leaving page or switching account', async () => {
  for (const invalidate of ['hide', 'account']) {
    let confirm;
    let user = { id: 'supplier', roles: ['SUPPLIER'], scope: { supplierId: 'own' } };
    const calls = [];
    const profile = page('supplier-products', async path => calls.push(path), { currentUser: () => user },
      { showModal: options => { confirm = options.success; } });
    profile.data.products = [{ id: 'p', productActive: true, supplyEnabled: true, version: 1 }];
    const pending = profile.changeListing(tap('p'));
    if (invalidate === 'hide') profile.onHide(); else user = { ...user, id: 'other' };
    confirm({ confirm: true }); await pending;
    assert.equal(calls.length, 0);
    assert.equal(profile.data.saving, '');
  }
});

test('native store profile uses independent receipt details and cannot save data', async () => {
  const store = page('profile', async path => {
    assert.equal(path, '/stores/own'); return { name: 'Store', address: 'Business', receiptAddress: 'Warehouse', receiptContactName: 'Receiver', status: 'ACTIVE' };
  }, { currentUser: () => ({ id: 'store-user', roles: ['STORE_FINANCE'], scope: { storeId: 'own' } }) });
  store.onLoad({ kind: 'store' }); await store.loadProfile();
  assert.equal(store.data.fields.find(item => item.label === '收货地址').value, 'Warehouse');
  assert.equal(store.saveProfile, undefined);
});

test('late native profile responses cannot repopulate an account after navigation', async () => {
  let resolve;
  const profile = page('profile', () => new Promise(done => { resolve = done; }), { currentUser: () => ({ id: 'user', roles: ['STORE'], scope: { storeId: 'own' } }) });
  profile.onLoad({ kind: 'store' }); const loading = profile.loadProfile(); profile.onHide(); resolve({ id: 'own', name: 'Hidden' }); await loading;
  assert.equal(profile.data.profile, null);
});

function prices(request = async () => ({}), overrides = {}) {
  const instance = page('prices', request, { currentUser: () => ({ id: 'buyer', roles: ['PURCHASER'] }),
    roleCommandState: () => ({ pending: null, history: [] }), ...overrides });
  instance.actorId = 'buyer'; instance.sequence = 1;
  Object.assign(instance.data, { allowed: true, productChoices: [{ id: 'product', name: 'Water', defaultSalesPrice: '12' }], productIndex: 0,
    supplierChoices: [{ id: 'supplier', name: 'Supplier' }], supplierIndex: 0, salesPrice: '12', supplyPrice: '8',
    effectiveDate: '2026-10-01', effectiveTime: '09:30', reason: 'New price' });
  return instance;
}
const priceImpact = { scopeId: 'scope', effectiveAt: '2026-10-01T01:30:00.000Z', affectedOrderCount: 1, salesDelta: '2', supplyDelta: '0',
  orders: [{ supplierOrderId: 'order', supplierOrderNo: 'SO', salesDelta: '2', supplyDelta: '0' }] };

test('native pricing denies supplier role before catalog or pricing requests', async () => {
  let calls = 0;
  const instance = prices(async () => { calls++; }, { currentUser: () => ({ id: 'supplier', roles: ['SUPPLIER'] }) });
  instance.onShow(); await instance.previewPrice(); await instance.publishPrice();
  assert.equal(instance.data.allowed, false); assert.equal(calls, 0);
});

test('native template pricing filters associated suppliers and locks shared cost', async () => {
  const instance = prices(async path => path.endsWith('/products') ? { supplierId: path.split('/')[2], productIds: ['product'] } : {});
  instance.data.template = { id: 'template', items: [{ productId: 'product', isEnabled: true, initialSalesPrice: '12', suppliers: [{ supplierId: 'supplier' }] }] };
  instance.data.suppliers = [{ id: 'supplier' }, { id: 'foreign' }];
  await instance.chooseProduct({ detail: { value: '0' } });
  assert.deepEqual(plain(instance.data.supplierChoices), [{ id: 'supplier' }]);
  instance.data.supplyPrice = '8';
  instance.onInput({ currentTarget: { dataset: { field: 'supplyPrice' } }, detail: { value: '9' } });
  assert.equal(instance.data.supplyPrice, '8');
});

test('native pricing rejects invalid decimals and missing reason before preview', async () => {
  let calls = 0; const instance = prices(async () => { calls++; return priceImpact; });
  instance.data.salesPrice = '1e2'; await instance.previewPrice(); assert.equal(calls, 0);
  instance.data.salesPrice = '12'; instance.data.reason = ' '; await instance.previewPrice(); assert.equal(calls, 0);
  instance.data.reason = 'Valid'; await instance.previewPrice(); assert.equal(calls, 1); assert.ok(instance.data.approvedBody);
  instance.onInput({ currentTarget: { dataset: { field: 'salesPrice' } }, detail: { value: '13' } });
  assert.equal(instance.data.approvedBody, ''); assert.equal(instance.data.impact, null);
});

test('native pricing rechecks impact and requires a second confirmation when orders change', async () => {
  let commands = 0, previews = 0;
  const instance = prices(async () => ++previews === 1 ? priceImpact : { ...priceImpact, salesDelta: '3' }, { roleCommand: async () => { commands++; } });
  await instance.previewPrice(); await instance.publishPrice();
  assert.equal(commands, 0); assert.equal(instance.data.impact.salesDelta, '3'); assert.match(instance.data.error, /影响订单已变化/);
});

test('native price publication keeps server result, versions and existing price-run controls', async () => {
  const published = { scopeId: 'scope', versionId: 'version', runId: 'run', salesPrice: '12', supplyPrice: '8' }; let commands = 0;
  const instance = prices(async path => path === '/prices/impact-preview' ? priceImpact : path.endsWith('/versions') ? [published] : { id: 'run', status: path.endsWith('/process') ? 'SUCCEEDED' : 'PENDING' },
    { roleCommand: async (role, path, options) => { commands++; assert.equal(role, 'purchaser'); assert.ok(options.header['idempotency-key']);
      if (path === '/jobs/run/process') return { id: 'run', status: 'SUCCEEDED' };
      assert.equal(path, '/price-changes'); return published; } });
  await instance.previewPrice(); await instance.publishPrice();
  assert.equal(commands, 1); assert.equal(instance.data.published.versionId, 'version'); assert.equal(instance.data.run.status, 'PENDING');
  await instance.processRun(); assert.equal(instance.data.run.status, 'SUCCEEDED');
});

test('native price recovery uses the persisted request and never creates a new publish', async () => {
  let retries = 0;
  const published = { scopeId: 'scope', versionId: 'version', salesPrice: '12', supplyPrice: '8' };
  const instance = prices(async () => [published], { retryRoleCommand: async role => { assert.equal(role, 'purchaser'); retries++; return published; } });
  instance.data.pendingCommand = { path: '/purchase-requests/request/confirm' }; await instance.recoverPrice(); assert.equal(retries, 0);
  instance.data.pendingCommand = { path: '/price-changes', key: 'original-key' }; await instance.recoverPrice(); assert.equal(retries, 1);
  assert.equal(instance.data.published.versionId, 'version'); assert.equal(instance.data.pendingCommand, null);
});

test('durable native price command history retains the actual version for page restoration', async () => {
  const harness = commandApi(), api = harness.reload();
  harness.handle(options => options.success({ statusCode: 201, data: { data: { versionId: 'version', scopeId: 'scope', runId: 'run' } } }));
  await api.roleCommand('purchaser', '/price-changes', commandOptions());
  const reloaded = harness.reload(); assert.equal(reloaded.roleCommandState('purchaser').history[0].result.versionId, 'version');
});

test('native pricing ignores late previews after navigation and resets loading on return', async () => {
  let resolve;
  const instance = prices(() => new Promise(done => { resolve = done; }));
  const preview = instance.previewPrice(); instance.onHide(); resolve(priceImpact); await preview;
  assert.equal(instance.data.impact, null); assert.equal(instance.data.approvedBody, '');
  instance.loadChoices = () => {};
  instance.onShow(); assert.equal(instance.data.previewing, false); assert.equal(instance.data.quoting, false);
});

test('native run controls cannot start during uncertain publication or resubmit a finished run', async () => {
  let calls = 0; const instance = prices(async () => { calls++; });
  instance.data.run = { id: 'run', status: 'PENDING' }; instance.data.pendingCommand = { path: '/price-changes' };
  await instance.processRun(); assert.equal(calls, 0);
  instance.data.pendingCommand = null; instance.data.run.status = 'SUCCEEDED'; await instance.processRun(); assert.equal(calls, 0);
});

test('native uncertain price-run keeps original command despite refreshing a pending run', async () => {
  let calls = 0, pending = null;
  const instance = prices(async path => path.endsWith('/versions') ? [] : { id: 'run', status: 'PENDING' }, {
    roleCommand: async (role, path, options) => {
      calls++; assert.equal(role, 'purchaser'); assert.equal(path, '/jobs/run/process'); assert.ok(options.header['idempotency-key']);
      pending = { path, key: 'original-key' }; const error = new Error('Lost response'); error.uncertain = true; throw error;
    },
    roleCommandState: () => ({ pending, history: [] }),
    retryRoleCommand: async () => { assert.equal(pending.key, 'original-key'); pending = null; return { id: 'run', status: 'SUCCEEDED' }; }
  });
  instance.data.run = { id: 'run', status: 'PENDING' }; instance.data.published = { scopeId: 'scope', versionId: 'version', runId: 'run' };
  await instance.processRun(); assert.equal(instance.data.pendingRun, true);
  await instance.processRun(); assert.equal(calls, 1);
  await instance.refreshRun(); assert.equal(instance.data.pendingRun, true); assert.equal(instance.data.run.status, 'PENDING');
  await instance.processRun(); assert.equal(calls, 1);
  await instance.recoverRun(); assert.equal(instance.data.run.status, 'SUCCEEDED'); assert.equal(instance.data.pendingCommand, null);
});

test('native run recovery ignores results after navigation and refuses unrelated commands', async () => {
  let resolve, calls = 0;
  const instance = prices(async () => ({}), { retryRoleCommand: () => { calls++; return new Promise(done => { resolve = done; }); } });
  instance.data.pendingCommand = { path: '/price-changes' }; await instance.recoverRun(); assert.equal(calls, 0);
  instance.data.pendingRun = true; instance.data.pendingCommand = { path: '/jobs/run/process' };
  const recovery = instance.recoverRun(); instance.onHide(); resolve({ id: 'run', status: 'SUCCEEDED' }); await recovery;
  assert.equal(instance.data.run, null);
});

test('durable price-run response loss survives restart and replays the exact original key', async () => {
  const harness = commandApi(), api = harness.reload(); let original;
  harness.handle(options => { original = options.header['idempotency-key']; options.fail({ errMsg: 'Lost response' }); });
  await assert.rejects(api.roleCommand('purchaser', '/jobs/run/process', commandOptions()));
  const restored = harness.reload(); assert.equal(restored.roleCommandState('purchaser').pending.title, '价格重算');
  harness.handle(options => { assert.equal(options.url.endsWith('/jobs/run/process'), true); assert.equal(options.header['idempotency-key'], original);
    options.success({ statusCode: 200, data: { data: { id: 'run', status: 'SUCCEEDED' } } }); });
  await restored.retryRoleCommand('purchaser');
  assert.equal(harness.reload().roleCommandState('purchaser').history[0].result.id, 'run');
});

test('durable price-run definite failure retains the code and releases pending submission', async () => {
  const harness = commandApi(), api = harness.reload();
  harness.handle(options => options.success({ statusCode: 409, data: { error: { code: 'CREDIT_LIMIT_EXCEEDED', message: 'Credit limit exceeded' } } }));
  await assert.rejects(api.roleCommand('purchaser', '/jobs/run/process', commandOptions()));
  const state = harness.reload().roleCommandState('purchaser');
  assert.equal(state.pending, null); assert.equal(state.history[0].code, 'CREDIT_LIMIT_EXCEEDED'); assert.equal(state.history[0].status, 'FAILED');
});

test('administrator-closed rollback releases native pending only after original-key failure replay', async () => {
  const harness = commandApi(), api = harness.reload();
  harness.handle(options => options.fail({ errMsg: 'Lost response' }));
  await assert.rejects(api.roleCommand('purchaser', '/jobs/run/process', commandOptions()));
  const pending = harness.reload().roleCommandState('purchaser').pending;
  harness.handle(options => {
    assert.equal(options.header['idempotency-key'], pending.key);
    options.success({ statusCode: 409, data: { code: 'COMMAND_ROLLED_BACK', message: 'Rolled back' } });
  });
  await assert.rejects(harness.reload().retryRoleCommand('purchaser'), /原价格重算已回滚/);
  const state = harness.reload().roleCommandState('purchaser');
  assert.equal(state.pending, null); assert.equal(state.history[0].code, 'COMMAND_ROLLED_BACK'); assert.equal(state.history[0].key, pending.key);
});

test('uncommitted price closure replays native failure without automatically submitting again', async () => {
  const harness = commandApi(), api = harness.reload(); let calls = 0;
  harness.handle(options => { calls++; options.fail({ errMsg: 'Lost response' }); });
  await assert.rejects(api.roleCommand('purchaser', '/jobs/run/process', commandOptions()));
  const pending = harness.reload().roleCommandState('purchaser').pending;
  harness.handle(options => { calls++; assert.equal(options.header['idempotency-key'], pending.key);
    options.success({ statusCode: 409, data: { code: 'COMMAND_NOT_COMMITTED', message: 'Not committed' } }); });
  await assert.rejects(harness.reload().retryRoleCommand('purchaser'), /原价格重算未提交/);
  assert.equal(calls, 2); assert.equal(harness.reload().roleCommandState('purchaser').pending, null);
  assert.equal(harness.reload().roleCommandState('purchaser').history[0].code, 'COMMAND_NOT_COMMITTED');
});

test('native run history displays server outcomes without exposing private payloads', async () => {
  const instance = prices(async path => {
    assert.equal(path, '/jobs/run/submissions');
    return [{ id: 'failed', status: 'FAILED', startedAt: '2026-10-04T01:00:00Z', errorCode: 'COMMAND_ROLLED_BACK', responseBody: { secret: true } },
      { id: 'done', status: 'SUCCEEDED', startedAt: '2026-10-04T02:00:00Z', errorCode: null }];
  });
  instance.data.run = { id: 'run', status: 'SUCCEEDED' }; await instance.loadSubmissions();
  assert.equal(instance.data.submissions.length, 2); assert.equal(instance.data.submissions[0].errorText, '已回滚');
  assert.ok(instance.data.submissions[0].startedText); assert.ok(!JSON.stringify(instance.data.submissions).includes('secret'));
  assert.equal(instance.data.submissionsLoading, false);
});

test('native run history failure preserves task and existing records with independent retry', async () => {
  let fail = true;
  const instance = prices(async () => { if (fail) throw new Error('History unavailable'); return []; });
  instance.data.run = { id: 'run', status: 'PENDING' }; instance.data.submissionsRunId = 'run'; instance.data.submissions = [{ id: 'existing' }];
  await instance.loadSubmissions(); assert.equal(instance.data.run.status, 'PENDING'); assert.equal(instance.data.submissions.length, 1);
  assert.equal(instance.data.submissionsError, 'History unavailable'); assert.equal(instance.data.error, '');
  fail = false; await instance.loadSubmissions(); assert.equal(instance.data.submissionsError, ''); assert.equal(instance.data.submissions.length, 0);
});

test('native run history discards older overlapping refreshes', async () => {
  const responses = [];
  const instance = prices(() => new Promise(resolve => responses.push(resolve))); instance.data.run = { id: 'run' };
  const old = instance.loadSubmissions(), fresh = instance.loadSubmissions();
  responses[1]([{ id: 'fresh', status: 'SUCCEEDED' }]); await fresh;
  responses[0]([{ id: 'old', status: 'FAILED' }]); await old;
  assert.equal(instance.data.submissions[0].id, 'fresh'); assert.equal(instance.data.submissionsLoading, false);
});

for (const change of ['navigation', 'account', 'task']) {
  test(`native run history ignores late response after ${change}`, async () => {
    let resolve, actor = 'buyer';
    const instance = prices(() => new Promise(done => { resolve = done; }), { currentUser: () => ({ id: actor, roles: ['PURCHASER'] }) });
    instance.data.run = { id: 'run' }; const loading = instance.loadSubmissions();
    if (change === 'navigation') instance.onHide();
    if (change === 'account') actor = 'other';
    if (change === 'task') instance.data.run = { id: 'different' };
    resolve([{ id: 'late', status: 'SUCCEEDED' }]); await loading;
    assert.equal(instance.data.submissions.length, 0);
  });
}

test('native run history refuses malformed responses and clears records when changing task', async () => {
  const instance = prices(async () => ({ unexpected: true }));
  instance.data.run = { id: 'new' }; instance.data.submissionsRunId = 'old'; instance.data.submissions = [{ id: 'old-private' }];
  await instance.loadSubmissions(); assert.equal(instance.data.submissions.length, 0);
  assert.equal(instance.data.submissionsError, '重算记录加载失败'); assert.equal(instance.data.submissionsLoading, false);
});

for (const [status, code] of [[409, 'COMMAND_PROCESSING'], [500, 'INTERNAL_ERROR'], [401, 'UNAUTHORIZED']]) {
  test(`price-run recovery retains the original key on ${code}`, async () => {
    const harness = commandApi(), api = harness.reload();
    harness.handle(options => options.success({ statusCode: status, data: { error: { code, message: code } } }));
    await assert.rejects(api.roleCommand('purchaser', '/jobs/run/process', commandOptions()));
    const pending = plain(harness.reload().roleCommandState('purchaser').pending);
    await assert.rejects(harness.reload().retryRoleCommand('purchaser'));
    assert.deepEqual(plain(harness.reload().roleCommandState('purchaser').pending), pending);
    assert.equal(harness.reload().roleCommandState('purchaser').history.length, 0);
  });
}

test('a supplier cost version change invalidates the store quote even when its sale price is unchanged', () => {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/store-view.js', 'utf8'), { module });
  const preview = { items: [{ productId: 'product', quantity: '2', salesUnitPrice: '12', priceVersionId: 'sale', supplyPriceVersionId: 'cost-a' }], totals: { salesGoodsAmount: '24' } };
  const changed = { ...preview, items: [{ ...preview.items[0], supplyPriceVersionId: 'cost-b' }] };
  assert.notEqual(module.exports.previewSignature(preview), module.exports.previewSignature(changed));
});

test('store purchase-unit selection sends explicit unit/version, scales estimates, and never reinterprets cart quantities', async () => {
  const store = page('store', async () => ({ items: [{ product: { id: 'p', name: 'Water', baseUnitId: 'bottle', unitName: 'Bottle', purchaseUnitName: 'Pack', version: 42, isActive: true,
    minOrderQty: '2', orderMultiple: '2', purchaseUnitConversion: { purchaseUnitId: 'pack', salesUnitId: 'bottle', salesUnitsPerPurchaseUnit: '12' } },
    suppliers: [{ supplierId: 's', salesPrice: '1.234567', purchaseSalesPrice: '14.814804', priceVersionId: 'v' }] }] }));
  await store.loadCatalog();
  store.data.storeId = 'store';
  store.chooseProductUnit(input('p', '1'));
  store.stepProduct(tap('p', { direction: 1 }));
  assert.deepEqual(plain(store.orderInput().items), [{ productId: 'p', quantity: '1', unitId: 'pack', expectedProductVersion: 42 }]);
  assert.equal(store.data.cart[0].unitName, 'Pack');
  assert.equal(store.data.estimatedAmount, '14.81');
  assert.equal(store.data.visibleProducts[0].displayPrice, '14.814804'); assert.equal(store.data.visibleProducts[0].displayUnitName, 'Pack');
  store.data.pendingOrder = { key: 'pending' }; store.chooseProductUnit(input('p', '0'));
  assert.equal(store.data.cart[0].unitId, 'pack');
  store.data.pendingOrder = null; store.chooseProductUnit(input('p', '0'));
  assert.equal(store.data.cart.length, 0);
  store.stepProduct(tap('p', { direction: 1 }));
  assert.equal(store.data.cart[0].quantity, '2'); assert.equal(store.data.cart[0].unitId, 'bottle');
});

test('native product brand choices include registered brands even before a product uses them', async () => {
  const editor = page('products', async path => path === '/brands' ? [{ id: 'brand-unused', name: 'Unused registered brand' }] : path === '/products' ? [{ id: 'p', name: 'Product', brand: 'Legacy brand' }] : []);
  await editor.loadProducts();
  assert.deepEqual(plain(editor.data.brands), ['Legacy brand', 'Unused registered brand']);
});

test('supplier freight choices follow the order snapshot and legacy unknown remains compatible', async () => {
  let snapshot = false; let writes = 0;
  const supplier = page('supplier', async (_path, options) => {
    if (options?.method === 'POST') { writes++; return {}; }
    return { id: 'order', version: 1, status: 'PUSHED', fulfillmentStatus: 'PENDING', requiresFreightSnapshot: snapshot, items: [], freightConfirmations: [{ id: 'freight', amount: '5.00', status: 'CONFIRMED', reason: 'Delivery' }] };
  });
  await supplier.loadOrder('order');
  assert.equal(supplier.data.selectedOrder.canRequestFreight, false);
  assert.equal(supplier.data.freightChoices.length, 1);
  supplier.data.freightRequestAmount = '5.00'; supplier.data.freightRequestReason = 'Delivery';
  await supplier.requestFreight(); assert.equal(writes, 0); assert.match(supplier.data.error, /不允许/);
  for (snapshot of [null, true]) {
    await supplier.loadOrder('order');
    assert.equal(supplier.data.selectedOrder.canRequestFreight, true);
    assert.equal(supplier.data.freightChoices.length, 2);
  }
});

function commandApi() {
  const storage = new Map([['procurexUser', { id: 'actor-a' }], ['procurexToken', 'token-a']]);
  const calls = [];
  let handler = options => options.fail({});
  const reload = () => {
    const module = { exports: {} };
    vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), { module,
      getApp: () => ({ globalData: { apiBase: 'http://localhost/api/v1' } }),
      wx: { getStorageSync: key => storage.has(key) ? structuredClone(storage.get(key)) : '',
        setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
        request: options => { calls.push(options); handler(options); } } });
    return module.exports;
  };
  return { storage, calls, reload, handle: value => { handler = value; } };
}
const commandOptions = () => ({ method: 'POST', data: { expectedVersion: 7, items: [{ id: 'line', quantity: '2' }] }, header: { 'idempotency-key': 'original-key' } });

test('finance account credit recovery preserves PATCH and the original body and key', async () => {
  const harness = commandApi(), api = harness.reload();
  await assert.rejects(api.roleCommand('finance', '/stores/store/credit-limit', { ...commandOptions(), method: 'PATCH', data: { expectedVersion: 2, limit: '100.00', reason: '调整额度' } }));
  const pending = plain(api.roleCommandState('finance').pending);
  assert.equal(pending.title, '挂账额度调整');
  harness.handle(options => options.success({ statusCode: 200, data: { data: { version: 3 } } }));
  await harness.reload().retryRoleCommand('finance');
  assert.equal(harness.calls[0].method, 'PATCH'); assert.equal(harness.calls[1].method, 'PATCH');
  assert.equal(harness.calls[1].header['idempotency-key'], pending.key);
  assert.deepEqual(plain(harness.calls[1].data), pending.body);
});

function financeAccounts(request = async () => ({}), overrides = {}) {
  const user = { id: 'finance-user', roles: ['HQ_FINANCE'] };
  const instance = page('finance-accounts', request, { currentUser: () => user, roleCommandState: () => ({ pending: null }), ...overrides }, { showToast: () => {} });
  instance.data.user = user; instance.sequence = 1;
  instance.data.store = { id: 'store', name: '测试门店' };
  instance.data.account = { version: 3, creditLimit: '100.00', creditUsed: '20.00' };
  instance.data.businessDate = '2026-10-11';
  return instance;
}

test('finance account write is denied to regional finance and invalid recharge cannot proceed', async () => {
  let writes = 0;
  const account = financeAccounts(async () => { writes++; });
  account.data.user.roles = ['REGION_FINANCE'];
  account.startAction(tap('', { mode: 'recharge' })); assert.equal(account.data.mode, '');
  account.data.mode = 'recharge'; await account.prepare(); assert.equal(writes, 0); assert.equal(account.data.confirming, false);
  account.data.user.roles = ['HQ_FINANCE'];
  await account.prepare(); assert.match(account.data.error, /凭证/);
  account.data.evidenceFiles = [{ id: 'file' }]; account.data.amount = '10.123';
  await account.prepare(); assert.match(account.data.error, /充值金额/);
  account.data.amount = '10.00'; account.data.collectionAccounts = [{ id: 'collection' }]; account.data.collectionIndex = 0;
  await account.prepare(); assert.equal(account.data.confirming, true); assert.equal(writes, 0);
});

test('finance clearing filters selections and submits exact service preview versions and amounts once', async () => {
  const commands = []; let finish;
  const account = financeAccounts(async path => path.endsWith('/preview') ? { totalAmount: '12.34', items: [{ fundingAllocationId: 'one', version: 7, clearableAmount: '12.34' }] } : [],
    { roleCommand: (...args) => { commands.push(args); return new Promise(resolve => { finish = resolve; }); } });
  account.loadAccount = async () => {};
  account.data.credits = [
    { fundingAllocationId: 'one', date: '2026-10-10', dateText: '2026-10-10', supplierName: '供应商A', supplierOrderNo: 'SO001', creditOutstanding: '12.34' },
    { fundingAllocationId: 'two', date: '2026-09-01', dateText: '2026-09-01', supplierName: '供应商B', supplierOrderNo: 'SO002', creditOutstanding: '0.01' }
  ];
  account.data.from = '2026-10-01'; account.filterCredits();
  account.chooseCredits({ detail: { value: ['one', 'two', 'one'] } }); assert.deepEqual(plain(account.data.chosen), ['one']);
  assert.equal(account.data.selectedTotal, 12.34);
  account.data.mode = 'clearing'; account.data.evidenceFiles = [{ id: 'evidence' }];
  await account.prepare(); assert.equal(account.data.confirming, true);
  assert.equal(account.data.preview.items[0].supplierOrderNo, 'SO001');
  assert.equal(account.data.preview.items[0].supplierName, '供应商A');
  const first = account.submit(); await account.submit(); assert.equal(commands.length, 1);
  assert.deepEqual(plain(commands[0][2].data.items), [{ fundingAllocationId: 'one', expectedVersion: 7, expectedAmount: '12.34' }]);
  assert.deepEqual(plain(commands[0][2].data.evidenceFileIds), ['evidence']); finish({}); await first;
  assert.equal(account.data.mode, '');
});

test('finance credit adjustment uses displayed account version and cannot fall below outstanding debt', async () => {
  const commands = [];
  const account = financeAccounts(undefined, { roleCommand: async (...args) => { commands.push(args); } });
  account.loadAccount = async () => {};
  account.data.mode = 'credit'; account.data.amount = '19.99'; account.data.reason = '调整';
  await account.prepare(); assert.equal(account.data.confirming, false); assert.match(account.data.error, /不能低于/);
  account.data.amount = '200'; await account.prepare(); await account.submit();
  assert.equal(commands[0][2].method, 'PATCH');
  assert.deepEqual(plain(commands[0][2].data), { expectedVersion: 3, limit: '200.00', reason: '调整' });
  account.data.mode = 'credit'; account.data.amount = '90071992547409.91'; await account.prepare(); await account.submit();
  assert.equal(commands[1][2].data.limit, '90071992547409.91');
});

test('finance account recharge and clearing history retain document links and evidence metadata', async () => {
  const account = financeAccounts(async path => path.endsWith('/account') ? { version: 4 } : path.endsWith('/credit-items') ? [] : path.endsWith('/ledgers')
    ? [{ sourceType: 'RECHARGE', sourceId: 'r', amount: '15.00', occurredAt: '2026-10-10T00:00:00Z' }]
    : path.endsWith('/credit-movements') ? [1, 2].map(value => ({ sourceType: 'CLEARING', sourceId: 'c', amount: value === 1 ? '10.10' : '2.24', occurredAt: '2026-10-10T00:00:00Z' }))
    : { documentNo: '充值单', operatorName: '财务人员', evidenceFiles: [{ id: 'image' }] });
  account.data.stores = [{ id: 'store', name: '测试门店', account: { version: 3 } }];
  await account.loadAccount(account.data.store, 1, account.data.user.id);
  assert.equal(account.data.visibleStores[0].account.version, 4);
  assert.equal(account.data.history.length, 2); assert.equal(account.data.history.find(row => row.kind === 'clearings').amount, 12.34);
  await account.openDocument(tap('r', { kind: 'recharges' }));
  assert.equal(account.data.document.documentNo, '充值单'); assert.equal(account.data.document.evidenceFiles[0].id, 'image');
});

test('finance account request ignores a response received after leaving the page', async () => {
  let finish;
  const account = financeAccounts(() => new Promise(resolve => { finish = resolve; }));
  account.data.history = [{ id: 'r', kind: 'recharges', title: '充值' }];
  const work = account.openDocument(tap('r', { kind: 'recharges' })); account.onHide(); finish({ documentNo: '旧单据' }); await work;
  assert.equal(account.data.document, null);
});

test('finance durable commands retain the exact original key after response loss', async () => {
  const harness = commandApi(), api = harness.reload();
  await assert.rejects(api.roleCommand('finance', '/payment-records/receipt/confirm', commandOptions()));
  const pending = plain(api.roleCommandState('finance').pending);
  harness.handle(options => options.success({ statusCode: 201, data: { data: { status: 'CONFIRMED' } } }));
  await harness.reload().retryRoleCommand('finance');
  assert.equal(harness.calls[1].header['idempotency-key'], pending.key);
  assert.equal(harness.reload().roleCommandState('finance').pending, null);
});

test('credit reincrease after an adjustment is a definite reconciliation failure', async () => {
  const harness = commandApi(), api = harness.reload();
  harness.handle(options => options.success({ statusCode: 409, data: { code: 'CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED' } }));
  await assert.rejects(api.request('/test'), failure => failure.code === 'CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED'
    && failure.uncertain === false && failure.message.includes('有效已付金额'));
});

test('cleared-credit adjustment blocker is readable and is not an uncertain network failure', async () => {
  const harness = commandApi(), api = harness.reload();
  harness.handle(options => options.success({ statusCode: 409, data: { error: { code: 'CLEARED_CREDIT_ADJUSTMENT_REQUIRED', message: 'Settlement adjustment required' } } }));
  await assert.rejects(api.request('/test'), error => error.code === 'CLEARED_CREDIT_ADJUSTMENT_REQUIRED'
    && error.uncertain === false && error.message.includes('独立结算调整'));
});

test('role command survives restart and replays the exact original request after response loss', async () => {
  const harness = commandApi(); let api = harness.reload(); const options = commandOptions();
  await assert.rejects(api.roleCommand('supplier', '/supplier-orders/order/shipments', options), /网络/);
  options.data.items[0].quantity = '9';
  const original = plain(api.roleCommandState('supplier').pending);
  assert.equal(original.body.items[0].quantity, '2');
  await assert.rejects(api.roleCommand('supplier', '/other', commandOptions()), /待确认/);
  api = harness.reload();
  harness.handle(options => options.success({ statusCode: 201, data: { data: { id: 'shipment' } } }));
  assert.equal((await api.retryRoleCommand('supplier')).id, 'shipment');
  assert.deepEqual(plain(harness.calls[1].data), original.body);
  assert.equal(harness.calls[1].header['idempotency-key'], original.key);
  assert.equal(api.roleCommandState('supplier').pending, null);
  assert.equal(api.roleCommandState('supplier').history[0].status, 'SUCCEEDED');
});

test('role recovery isolates actors and workspaces, ignores stale server settings and preserves authentication failures', async () => {
  const harness = commandApi(), api = harness.reload();
  await assert.rejects(api.roleCommand('purchaser', '/purchase-requests/id/confirm', commandOptions()));
  assert.equal(api.roleCommandState('supplier').pending, null);
  harness.storage.set('procurexUser', { id: 'actor-b' });
  assert.equal(api.roleCommandState('purchaser').pending, null);
  harness.storage.set('procurexUser', { id: 'actor-a' });
  harness.storage.set('procurexApiBase', 'http://other/api/v1');
  assert.equal(api.apiBase(), 'http://localhost/api/v1');
  assert.ok(api.roleCommandState('purchaser').pending);
  harness.storage.delete('procurexApiBase');
  for (const status of [401, 403, 408, 429, 500]) {
    harness.handle(options => options.success({ statusCode: status, data: { message: 'Unavailable' } }));
    await assert.rejects(api.retryRoleCommand('purchaser')); assert.ok(api.roleCommandState('purchaser').pending);
  }
  harness.handle(options => options.success({ statusCode: 409, data: { code: 'COMMAND_PROCESSING' } }));
  await assert.rejects(api.retryRoleCommand('purchaser')); assert.ok(api.roleCommandState('purchaser').pending);
  harness.handle(options => options.success({ statusCode: 409, data: { code: 'VERSION_CONFLICT', message: '版本已变更' } }));
  await assert.rejects(api.retryRoleCommand('purchaser'));
  assert.equal(api.roleCommandState('purchaser').pending, null);
  assert.equal(api.roleCommandState('purchaser').history[0].status, 'FAILED');
});

test('double retry sends only one in-flight command and history retains only the latest twenty', async () => {
  const harness = commandApi(), api = harness.reload(); let response;
  harness.handle(options => { response = options; });
  const submitting = api.roleCommand('supplier', '/order/reject', commandOptions());
  await assert.rejects(api.retryRoleCommand('supplier'), /正在确认/); assert.equal(harness.calls.length, 1);
  response.success({ statusCode: 201, data: { data: { id: 'order' } } }); await submitting;
  harness.handle(options => options.success({ statusCode: 201, data: { data: { id: 'order' } } }));
  for (let i = 0; i < 25; i++) await api.roleCommand('supplier', `/order-${i}/reject`, commandOptions());
  assert.equal(api.roleCommandState('supplier').history.length, 20);
  assert.equal(api.roleCommandState('supplier').history[0].path, '/order-24/reject');
});

test('both role recovery pages refresh server state and clear stale selections', async () => {
  for (const role of ['purchaser', 'supplier']) {
    let retries = 0; let refreshed = 0;
    const instance = page(role, undefined, { retryRoleCommand: async workspace => { assert.equal(workspace, role); retries++; },
      roleCommandState: () => ({ pending: null, history: [{ key: 'key', status: 'SUCCEEDED' }] }) });
    instance.loadWork = async () => { refreshed++; };
    instance.data.selectedOrder = { id: 'old' }; instance.data.selectedRequest = { id: 'old' };
    await instance.recoverCommand(); assert.equal(retries, 1); assert.equal(refreshed, 1);
    assert.equal(instance.data.recovering, false); assert.equal(instance.data.pendingCommand, null);
    assert.equal(role === 'supplier' ? instance.data.selectedOrder : instance.data.selectedRequest, null);
  }
});

test('late command completion updates only its original actor record', async () => {
  const harness = commandApi(), api = harness.reload(); let response;
  harness.handle(options => { response = options; });
  const original = api.roleCommand('supplier', '/order/reject', commandOptions());
  harness.storage.set('procurexUser', { id: 'actor-b' });
  assert.equal(api.roleCommandState('supplier').pending, null);
  response.success({ statusCode: 201, data: { data: { id: 'order' } } }); await original;
  assert.equal(api.roleCommandState('supplier').history.length, 0);
  harness.storage.set('procurexUser', { id: 'actor-a' });
  assert.equal(api.roleCommandState('supplier').history[0].status, 'SUCCEEDED');
});

test('failed durable storage prevents sending a role command', () => {
  const module = { exports: {} }; let sent = false;
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), { module,
    getApp: () => ({ globalData: { apiBase: 'http://localhost/api/v1' } }),
    wx: { getStorageSync: key => key === 'procurexUser' ? { id: 'actor' } : '',
      setStorageSync: () => { throw new Error('Storage full'); }, request: () => { sent = true; } } });
  assert.throws(() => module.exports.roleCommand('supplier', '/order/reject', commandOptions()), /Storage full/);
  assert.equal(sent, false);
});

test('new products require a valid default price but allow an empty SKU', async () => {
  const writes = [];
  const products = page('products', async (path, options) => { writes.push({ path, ...plain(options) }); return { id: 'product' }; });
  products.loadProducts = async () => {};
  Object.assign(products.data.draft, { name: '水', categoryId: 'category', baseUnitId: 'unit', sku: '' });
  for (const price of ['', '-1', '1.0000001', '100000000000000']) {
    products.data.draft.defaultSalesPrice = price;
    await products.saveProduct();
    assert.equal(writes.length, 0);
  }
  products.data.draft.defaultSalesPrice = '0';
  await products.saveProduct();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/products');
  assert.equal(writes[0].data.sku, null);
  assert.equal(writes[0].data.defaultSalesPrice, '0');
});

test('removed product image cannot reappear from an older download', async () => {
  let complete;
  const products = page('products', undefined, { imagePath: () => new Promise(resolve => { complete = resolve; }) });
  products.data.imageFile = { id: 'old' };
  const loading = products.loadImage(products.data.imageFile);
  products.removeImage(); complete('/temp/old'); await loading;
  assert.equal(products.data.imageUrl, ''); assert.equal(products.data.draft.imageFileId, null);
});

test('product metadata save keeps price changes outside the ordinary editor', async () => {
  let write;
  const products = page('products', async (path, options) => { write = { path, ...plain(options) }; return { id: 'product' }; });
  products.loadProducts = async () => {};
  products.data.selectedId = 'product'; products.data.draft = { sku: 'SKU', name: '水', categoryId: 'category', baseUnitId: 'unit', version: 4,
    minOrderQty: '1', orderMultiple: '2', specification: '500mL', brand: '品牌', storageCondition: 'AMBIENT', imageFileId: 'image', isActive: true };
  await products.saveProduct();
  assert.equal(write.path, '/products/product'); assert.equal(write.data.expectedVersion, 4);
  assert.equal(write.data.specification, '500mL'); assert.equal(write.data.imageFileId, 'image');
  assert.equal('salesPrice' in write.data, false); assert.equal('supplyPrice' in write.data, false);
});

test('product crop creates a square bounded preview and uploads only the rendered image', async () => {
  let drawn, uploaded;
  const products = page('products', undefined, { uploadEvidence: async (path, purpose) => { uploaded = { path, purpose }; return { id: 'image' }; } }, {
    getImageInfo: options => options.success({ width: 100, height: 200, path: 'source' }),
    createCanvasContext: () => ({ setFillStyle() {}, fillRect() {}, drawImage: (...args) => { drawn = args; }, draw: (_, callback) => callback() }),
    canvasToTempFilePath: options => { assert.equal(options.destWidth, options.destHeight); assert.equal(options.fileType, 'jpg'); options.success({ tempFilePath: 'cropped' }); }
  });
  await products.prepareCrop('source'); assert.equal(products.data.crop.width, 240); assert.equal(products.data.crop.height, 480);
  products.onCropZoom({ detail: { value: 2 } });
  products.onCropMove({ detail: { x: 1000, y: -1000 } });
  await products.confirmCrop();
  assert.deepEqual(drawn, ['source', 0, -720, 480, 960]);
  assert.deepEqual(uploaded, { path: 'cropped', purpose: 'PRODUCT' }); assert.equal(products.data.draft.imageFileId, 'image'); assert.equal(products.data.crop, null);
});

test('failed product upload retains the crop for retry and version conflicts retain the draft', async () => {
  const products = page('products', async () => { const error = new Error('版本冲突'); error.code = 'VERSION_CONFLICT'; throw error; }, { uploadEvidence: async () => { throw new Error('断网'); } }, {
    createCanvasContext: () => ({ setFillStyle() {}, fillRect() {}, drawImage() {}, draw: (_, callback) => callback() }),
    canvasToTempFilePath: options => options.success({ tempFilePath: 'cropped' })
  });
  products.data.crop = { path: 'source', x: 0, y: 0, width: 240, height: 240 };
  await products.confirmCrop(); assert.ok(products.data.crop); assert.equal(products.data.draft.imageFileId, null);
  products.data.crop = null; products.data.selectedId = 'product'; Object.assign(products.data.draft, { name: '水', categoryId: 'c', baseUnitId: 'u', version: 3 });
  await products.saveProduct(); assert.equal(products.data.conflict, true); assert.equal(products.data.draft.name, '水');
});

test('product image downloads cannot overwrite a refreshed catalog generation', async () => {
  let complete;
  const store = page('store', undefined, { imagePath: () => new Promise(resolve => { complete = resolve; }) });
  const product = { id: 'product', imageFileId: 'old', imageFile: { id: 'old' } };
  store.catalogRequestSequence = 1; store.data.products = [product];
  const pending = store.loadProductImage(product, 1);
  store.catalogRequestSequence = 2; store.data.products = [{ ...product, imageFileId: 'new', imageUrl: 'new-path' }];
  complete('old-path'); await pending; assert.equal(store.data.products[0].imageUrl, 'new-path');
});

test('purchaser rejection work reads current orders rather than notification history', async () => {
  const paths = [];
  const purchaser = page('purchaser', async path => { paths.push(path); return [{ id: 'rejected', supplierOrderId: 'rejected' }]; });
  await purchaser.loadRejections();
  assert.deepEqual(paths, ['/purchase-requests/rejection-todos']);
  assert.equal(purchaser.data.rejectionTodos.length, 1);
});

test('supplier statement displays business dates with the exclusive end converted to its last day', async () => {
  const supplier = page('supplier', async () => ({ id: 'bill', periodStart: '2024-02-01', periodEndExclusive: '2024-03-01', lines: [] }));
  await supplier.selectStatement(tap('bill'));
  assert.equal(supplier.data.selectedStatement.periodText, '2024-02-01 至 2024-02-29');
});

test('supplier total opens only exact-parent store bills and returns through source to fresh child and parent', async () => {
  let parentReads = 0, childReads = 0;
  const supplier = page('supplier', async path => {
    if (path.startsWith('/payment-records')) return [];
    if (path.startsWith('/supplier-store-statements?')) return [
      { id: 'child/id', parentStatementId: 'parent' }, { id: 'other', parentStatementId: 'different-parent' },
    ];
    if (path === '/supplier-store-statements/child%2Fid') return { id: 'child/id', type: 'SUPPLIER_STORE', parentStatementId: 'parent',
      payableAmount: String(++childReads), lines: [{ supplierOrderId: 'order', settlementItemId: 'base', products: [] }] };
    if (path.startsWith('/supplier-orders/')) return { id: 'order', status: 'COMPLETED', items: [] };
    return { id: 'parent', type: 'SUPPLIER_TOTAL', supplierId: 'supplier', cycle: 'MONTHLY', payableAmount: String(++parentReads), lines: [] };
  });
  await supplier.selectStatement(tap('parent'));
  assert.deepEqual(plain(supplier.data.statementStores.map(item => item.id)), ['child/id']);
  await supplier.selectStoreStatement(tap('other')); assert.equal(supplier.data.statementId, 'parent');
  await supplier.selectStoreStatement(tap('child/id')); assert.equal(supplier.data.statementKind, 'store');
  await supplier.openStatementSource(tap('order', { kind: 'order' }));
  assert.equal(supplier.data.statementReturnKind, 'store');
  await supplier.backToList(); assert.equal(supplier.data.selectedStatement.payableAmount, '2');
  assert.equal(supplier.data.statementKind, 'store');
  await supplier.backToList(); assert.equal(supplier.data.selectedStatement.id, 'parent');
  assert.equal(supplier.data.selectedStatement.payableAmount, '2'); assert.equal(supplier.data.statementKind, 'total');
});

test('store bill membership mismatch is rejected and retry retains the correct endpoint', async () => {
  let attempts = 0;
  const supplier = page('supplier', async path => path.startsWith('/payment-records') ? [] : {
    id: 'child', type: 'SUPPLIER_STORE', parentStatementId: ++attempts === 1 ? 'foreign' : 'parent', lines: [],
  });
  await supplier.selectStatement(tap('child', { statementKind: 'store', parentId: 'parent' }));
  assert.equal(supplier.data.selectedStatement, null); assert.match(supplier.data.error, /不属于/);
  await supplier.retryStatement(); assert.equal(supplier.data.selectedStatement.id, 'child'); assert.equal(supplier.data.error, '');
});

test('store bill list failure preserves total amounts and can retry independently', async () => {
  let attempts = 0, reads = 0;
  const supplier = page('supplier', async path => {
    if (path.startsWith('/payment-records')) return [];
    if (path.startsWith('/supplier-store-statements?')) { if (++attempts === 1) throw new Error('分店连接失败'); return [{ id: 'child', parentStatementId: 'parent' }]; }
    reads++; return { id: 'parent', type: 'SUPPLIER_TOTAL', supplierId: 'supplier', cycle: 'MONTHLY', payableAmount: '20.00', lines: [] };
  });
  await supplier.selectStatement(tap('parent'));
  assert.equal(supplier.data.selectedStatement.payableAmount, '20.00'); assert.match(supplier.data.statementStoresError, /连接失败/);
  await supplier.retryStatementStores(); assert.equal(reads, 1); assert.equal(supplier.data.statementStores.length, 1);
  assert.equal(supplier.data.statementStoresError, '');
});

test('late store-bill list cannot overwrite a newer parent or a child selection', async () => {
  let complete;
  const supplier = page('supplier', async path => {
    if (path.startsWith('/payment-records')) return [];
    if (path.startsWith('/supplier-store-statements?')) return new Promise(resolve => { complete = resolve; });
    return { id: path.endsWith('/parent') ? 'parent' : 'new', type: path.endsWith('/parent') ? 'SUPPLIER_TOTAL' : 'SUPPLIER_STORE', parentStatementId: 'parent', supplierId: 'supplier', cycle: 'MONTHLY', lines: [] };
  });
  const old = supplier.selectStatement(tap('parent'));
  await new Promise(resolve => setImmediate(resolve));
  await supplier.selectStatement(tap('new', { statementKind: 'store', parentId: 'parent' }));
  complete([{ id: 'old', parentStatementId: 'parent' }]); await old;
  assert.equal(supplier.data.statementId, 'new'); assert.equal(supplier.data.statementStores.length, 0);
  assert.equal(supplier.data.statementStoresLoading, false);
});

test('product expansion requires current bill membership and view change does not reopen its parent', async () => {
  let reads = 0;
  const supplier = page('supplier', async () => { reads++; return {}; });
  Object.assign(supplier.data, { selectedStatement: { lines: [{ supplierOrderId: 'order' }] }, statementId: 'child', statementKind: 'store', statementParentId: 'parent', activeView: 'reports' });
  supplier.toggleStatementProducts(tap('foreign')); assert.equal(supplier.data.expandedStatementOrderId, '');
  supplier.toggleStatementProducts(tap('order')); assert.equal(supplier.data.expandedStatementOrderId, 'order');
  supplier.toggleStatementProducts(tap('order')); assert.equal(supplier.data.expandedStatementOrderId, '');
  supplier.changeView(tap('', { view: 'orders' })); assert.equal(reads, 0); assert.equal(supplier.data.statementId, '');
});

test('bill quantities and unit prices trim display zeros without floating-point conversion', async () => {
  const supplier = page('supplier', async path => path.startsWith('/payment-records') ? [] : { id: 'bill', lines: [{ products: [{
    orderedQuantity: '99999999999999.123000', effectiveQuantity: '10.000000', receivedQuantity: '0.000000', supplyUnitPrice: '9.500000',
  }] }] });
  await supplier.selectStatement(tap('bill'));
  const product = supplier.data.selectedStatement.lines[0].products[0];
  assert.equal(product.orderedText, '99999999999999.123'); assert.equal(product.effectiveText, '10');
  assert.equal(product.receivedText, '0'); assert.equal(product.priceText, '9.5');
});

test('supplier bill detail encodes statement identity and ignores a closed or stale response', async () => {
  const pending = new Map();
  const supplier = page('supplier', path => path.startsWith('/payment-records') ? Promise.resolve([]) : new Promise(resolve => pending.set(path, resolve)));
  const old = supplier.selectStatement(tap('bill/old'));
  const next = supplier.selectStatement(tap('bill/new'));
  pending.get('/supplier-statements/bill%2Fnew')({ id: 'bill/new', lines: [] }); await next;
  pending.get('/supplier-statements/bill%2Fold')({ id: 'bill/old', lines: [] }); await old;
  assert.equal(supplier.data.selectedStatement.id, 'bill/new');
  const closed = supplier.selectStatement(tap('bill/closed')); supplier.backToList();
  pending.get('/supplier-statements/bill%2Fclosed')({ id: 'bill/closed' }); await closed;
  assert.equal(supplier.data.selectedStatement, null); assert.equal(supplier.data.statementLoading, false);
});

test('handled rejection cannot be reallocated again from a stale selection', async () => {
  let writes = 0;
  const purchaser = page('purchaser', async (path, options) => {
    if (options?.method === 'POST') writes++;
    return path.startsWith('/supplier-orders/') ? { id: 'o1', requestId: 'r1', status: 'REJECTED' }
      : { id: 'r1', supplierOrders: [{ id: 'o1', rejectionHandled: true }] };
  });
  Object.assign(purchaser.data, { requestId: 'r1', rejectedOrderId: 'o1', targetSupplierId: 's2' });
  await purchaser.reallocateRequest(); assert.equal(writes, 0); assert.match(purchaser.data.error, /已处理/);
});

test('bill payment sources match settlement identities, not whole payment or order totals', async () => {
  const supplier = page('supplier', async path => path.startsWith('/payment-records') ? [
    { id: 'related', amount: '100.00', allocations: [{ id: 'a', settlementItemId: 'base', amount: '30.00', state: 'CONFIRMED' }, { id: 'b', settlementItemId: 'elsewhere', amount: '70.00' }] },
    { id: 'rejected', allocations: [{ id: 'c', settlementItemId: 'adjustment', amount: '5.00', state: 'RELEASED' }] },
    { id: 'other', allocations: [{ id: 'd', settlementItemId: 'elsewhere', amount: '70.00' }] }
  ] : { id: 'bill', lines: [{ settlementItemId: 'base' }], adjustmentItems: [{ settlementItemId: 'adjustment' }] });
  await supplier.selectStatement(tap('bill'));
  assert.deepEqual(plain(supplier.data.statementPayments.map(item => item.id)), ['related', 'rejected']);
  assert.equal(supplier.data.statementPayments[0].statementAllocations.length, 1);
  assert.equal(supplier.data.statementPayments[0].statementAllocations[0].amount, '30.00');
});

test('source navigation verifies membership and rereads the bill on return', async () => {
  let reads = 0;
  const supplier = page('supplier', async path => {
    if (path.startsWith('/payment-records')) return [];
    if (path.startsWith('/supplier-orders')) return { id: 'order', status: 'COMPLETED', items: [] };
    return { id: 'bill', payableAmount: String(++reads), lines: [{ supplierOrderId: 'order', settlementItemId: 'base' }] };
  });
  await supplier.selectStatement(tap('bill'));
  await supplier.openStatementSource(tap('unrelated', { kind: 'order' })); assert.equal(supplier.data.statementId, 'bill');
  await supplier.openStatementSource(tap('order', { kind: 'order' }));
  assert.equal(supplier.data.activeView, 'orders'); assert.equal(supplier.data.statementReturnId, 'bill');
  await supplier.backToList(); assert.equal(supplier.data.activeView, 'reports');
  assert.equal(supplier.data.selectedStatement.payableAmount, '2');
  await supplier.openStatementSource(tap('order', { kind: 'order' }));
  supplier.changeView(tap('', { view: 'payments' }));
  assert.equal(supplier.data.statementReturnId, ''); assert.equal(supplier.data.statementId, '');
});

test('bill stays visible when related payments fail and can retry without rereading money', async () => {
  let attempts = 0;
  const supplier = page('supplier', async path => {
    if (path.startsWith('/payment-records')) { if (++attempts === 1) throw new Error('连接失败'); return []; }
    return { id: 'bill', payableAmount: '12.00', lines: [] };
  });
  await supplier.selectStatement(tap('bill'));
  assert.equal(supplier.data.selectedStatement.payableAmount, '12.00'); assert.equal(supplier.data.statementLoading, false);
  assert.match(supplier.data.statementPaymentError, /连接失败/); assert.equal(supplier.data.error, '');
  await supplier.retryStatementPayments(); assert.equal(supplier.data.statementPaymentError, '');
});

test('reopening the same bill cannot let an older response replace its latest balance', async () => {
  const resolves = [];
  const supplier = page('supplier', path => path.startsWith('/payment-records') ? Promise.resolve([]) : new Promise(resolve => resolves.push(resolve)));
  const old = supplier.selectStatement(tap('bill')); const current = supplier.selectStatement(tap('bill'));
  resolves[1]({ id: 'bill', payableAmount: '20.00', lines: [] }); await current;
  resolves[0]({ id: 'bill', payableAmount: '99.00', lines: [] }); await old;
  assert.equal(supplier.data.selectedStatement.payableAmount, '20.00');
});

test('bill payment and adjustment details keep a working return path and encoded source identity', async () => {
  const paths = [];
  const supplier = page('supplier', async path => {
    paths.push(path);
    if (path.startsWith('/payment-records?')) return [{ id: 'payment', allocations: [{ settlementItemId: 'base' }] }];
    if (path.startsWith('/payment-records/')) return { id: 'payment', status: 'CONFIRMED', allocations: [], evidenceFiles: [] };
    if (path.startsWith('/adjustments/')) return { id: 'adjustment/id', lines: [], periodStart: '2026-10-01', periodEndExclusive: '2026-11-01', originalPeriodStart: '2026-09-01', originalPeriodEndExclusive: '2026-10-01' };
    return { id: 'bill', lines: [{ settlementItemId: 'base' }], adjustmentItems: [{ settlementItemId: 'credit', adjustmentId: 'adjustment/id' }] };
  });
  await supplier.selectStatement(tap('bill'));
  await supplier.openStatementSource(tap('payment', { kind: 'payment' }));
  assert.equal(supplier.data.activeView, 'payments'); assert.equal(supplier.data.selectedPayment.id, 'payment');
  await supplier.backToList();
  await supplier.openStatementSource(tap('adjustment/id', { kind: 'adjustment' }));
  assert.equal(supplier.data.activeView, 'reports'); assert.equal(supplier.data.selectedAdjustment.periodText, '2026-10-01 至 2026-10-31');
  assert.equal(supplier.data.selectedAdjustment.originalPeriodText, '2026-09-01 至 2026-09-30');
  assert.ok(paths.includes('/adjustments/adjustment%2Fid'));
  await supplier.backToList(); assert.equal(supplier.data.selectedStatement.id, 'bill');
});

test('role order lists search and filter without silently truncating twenty rows', async () => {
  for (const role of ['supplier', 'purchaser']) {
    const rows = Array.from({ length: 25 }, (_, index) => ({ id: String(index), requestNo: `REQ-${index}`, supplierOrderNo: `SO-${index}`, status: index === 24 ? 'COMPLETED' : 'PUSHED' }));
    const screen = page(role, async () => rows);
    await screen[role === 'supplier' ? 'loadOrders' : 'loadRequests']();
    const list = role === 'supplier' ? 'visibleOrders' : 'visibleRequests';
    if (role === 'supplier') screen.filterStatus(tap('', { filter: 'all' }));
    assert.equal(screen.data[list].length, 10);
    assert.equal(screen.data.orderTotal, 25);
    screen.nextOrders();
    assert.equal(screen.data[list].length, 20);
    screen.nextOrders();
    assert.equal(screen.data[list].length, 25);
    assert.equal(screen.data.moreOrders, false);
    screen.onSearch({ detail: { value: '24' } });
    assert.equal(screen.data[list][0].id, '24');
    screen.filterStatus(tap('', { filter: 'PUSHED' }));
    assert.equal(screen.data[list].length, 0);
    screen.onSearch({ detail: { value: '' } });
    assert.equal(screen.data[list].length, 10);
    assert.equal(screen.data.orderTotal, 24);
    assert.match(screen.data.reportRange.from, /^\d{4}-\d{2}-01$/);
    assert.ok(screen.data.reportRange.to >= screen.data.reportRange.from);
  }
});

test('role detail return preserves in-flight operations and clears completed selection', () => {
  const supplier = page('supplier');
  supplier.data.selectedOrder = { id: 'order' }; supplier.data.shipping = true;
  supplier.changeView(tap('', { view: 'payments' })); assert.equal(supplier.data.activeView, 'tasks');
  supplier.backToList(); assert.equal(supplier.data.selectedOrder.id, 'order');
  supplier.data.shipping = false; supplier.backToList(); assert.equal(supplier.data.selectedOrder, null);
  const purchaser = page('purchaser');
  purchaser.data.requestId = 'request'; purchaser.data.confirming = true;
  purchaser.backToList(); assert.equal(purchaser.data.requestId, 'request');
  purchaser.data.confirming = false; purchaser.backToList(); assert.equal(purchaser.data.requestId, '');
  purchaser.data.requestId = 'old'; purchaser.data.selectedRequest = { id: 'old' };
  purchaser.changeView(tap('', { view: 'rejections' }));
  assert.equal(purchaser.data.requestId, ''); assert.equal(purchaser.data.selectedRequest, null);
});

test('store confirmed request groups items by supplier', async () => {
  const store = page('store', async () => ({ items: [
    { id: 'i1', productId: 'p1', supplierId: 's1', supplierName: '粮油供应商', supplierContactName: '张经理', supplierContactPhone: '13800000001', deliveryContactPhone: '13800000002', supplierAddress: '上海市浦东新区', productName: '大米', salesLineAmount: '12.50' },
    { id: 'i2', productId: 'p1', supplierId: 's2', productName: '大米', salesLineAmount: '8.25' },
    { id: 'i3', productId: 'p2', supplierId: 's1', supplierName: '粮油供应商', productName: '面粉', salesLineAmount: '3.50' },
  ], supplierOrders: [
    { id: 'o1', supplierId: 's1', supplierName: '粮油供应商', shipments: [] },
    { id: 'o2', supplierId: 's2', supplierName: '备用供应商', shipments: [] },
  ] }));
  await store.selectRequest(tap('r1'));
  const groups = plain(store.data.selectedRequest.supplierOrders);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].supplierName, '粮油供应商');
  assert.equal(groups[0].itemCount, 2);
  assert.equal(groups[0].groupAmount, '16.00');
  assert.equal(groups[1].supplierName, '备用供应商');
  assert.equal(groups[1].groupAmount, '8.25');
  assert.equal(groups[1].items[0].id, 'i2');
  assert.equal(groups[0].contactName, '张经理');
  assert.equal(groups[0].contactPhone, '13800000001');
  assert.equal(groups[0].deliveryContactPhone, '13800000002');
  assert.equal(groups[0].address, '上海市浦东新区');
  store.toggleRequestGroup(tap('', { supplierId: 's1' }));
  assert.equal(store.data.selectedRequest.supplierOrders[0].open, false);
  assert.equal(store.data.selectedRequest.supplierOrders[1].open, false);
  store.toggleRequestGroup(tap('', { supplierId: 's1' }));
  assert.equal(store.data.selectedRequest.supplierOrders[0].open, true);
});

test('store request detail distinguishes the master request from generated supplier orders', () => {
  const template = readFileSync('apps/miniprogram/pages/store/index.wxml', 'utf8');
  const styles = readFileSync('apps/miniprogram/pages/store/index.wxss', 'utf8');
  assert.ok(template.includes('class="section-band request-master-summary"'));
  assert.ok(template.includes('门店下货单'));
  assert.ok(template.includes('采购确认后生成的供应商订单'));
  assert.ok(template.includes('class="section-band request-supplier-group"'));
  assert.ok(template.includes('bindtap="toggleRequestGroup"'));
  assert.ok(template.includes('bindtap="selectShipment"'));
  assert.ok(template.includes('门店提交的商品'));
  assert.match(styles, /\.request-master-summary\s*\{/);
  assert.match(styles, /\.request-supplier-group\s*\{[^}]*border-radius/s);
});

test('pending store requests do not expose tentative supplier groups', async () => {
  const store = page('store', async () => ({ status: 'PENDING_PROCUREMENT', items: [{ id: 'i', supplierId: 's', supplierName: '暂定供应商', productName: '大米' }], supplierOrders: [] }));
  await store.selectRequest(tap('request'));
  assert.deepEqual(plain(store.data.selectedRequest.supplierOrders), []);
  assert.equal(store.data.selectedRequest.items.length, 1);
  const template = readFileSync('apps/miniprogram/pages/store/index.wxml', 'utf8');
  const confirmation = template.slice(template.indexOf('wx:if="{{activeView === \'order\' && orderStep === \'confirm\'}}"'), template.indexOf('wx:if="{{activeView === \'orders\''));
  assert.ok(!confirmation.includes('order.supplierName'));
  assert.ok(!confirmation.includes('order.deliveryContactPhone'));
});

test('store request detail loads images for source items and generated supplier orders', async () => {
  const loaded = [];
  const store = page('store', async () => ({ items: [
    { id: 'line-1', productId: 'p1', supplierId: 's1', productName: '商品1', imageFile: { id: 'image-1' }, salesLineAmount: '10.00' },
    { id: 'line-2', productId: 'p2', productName: '商品2', imageFile: null, salesLineAmount: '20.00' },
  ], supplierOrders: [{ id: 'o1', supplierId: 's1', supplierName: '供应商1', shipments: [] }] }), {
    imagePath: async file => { loaded.push(file.id); return `/tmp/${file.id}.jpg`; },
  });
  await store.selectRequest(tap('r1'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(loaded, ['image-1']);
  assert.equal(store.data.selectedRequest.items[0].imageUrl, '/tmp/image-1.jpg');
  assert.equal(store.data.selectedRequest.supplierOrders[0].items[0].imageUrl, '/tmp/image-1.jpg');
  store.data.selectedRequest.items[0].imageFailed = true;
  await store.retryRequestImage({ detail: { productId: 'p1' } });
  assert.equal(store.data.selectedRequest.items[0].imageFailed, false);
  const markup = readFileSync('apps/miniprogram/pages/store/index.wxml', 'utf8');
  assert.ok(markup.includes('bind:retryimage="retryRequestImage"'));
  assert.ok(markup.includes('查看门店原始下货清单'));
  assert.ok(markup.includes('采购确认前可修改商品和数量'));
});

test('store request image downloads cannot update a different opened request', async () => {
  let resolveImage;
  const store = page('store', async () => ({ items: [{ id: 'line', productId: 'p1', imageFile: { id: 'image' } }], supplierOrders: [] }), {
    imagePath: () => new Promise(resolve => { resolveImage = resolve; }),
  });
  const opening = store.selectRequest(tap('r1'));
  await new Promise(resolve => setImmediate(resolve));
  store.data.selectedRequestId = 'r2';
  store.requestImageSequence += 1;
  resolveImage('/tmp/old.jpg');
  await opening;
  assert.notEqual(store.data.selectedRequest?.items[0]?.imageUrl, '/tmp/old.jpg');
});

test('purchaser replaces one product supplier only after valid price preview and confirmation', async () => {
  const calls = [];
  const detail = { id: 'r', version: 2, status: 'PENDING_PROCUREMENT', supplierOrders: [], items: [{ id: 'i', productId: 'p', supplierId: 'a', productName: '大米', salesLineAmount: '10.00', supplyLineAmount: '8.00' }] };
  const purchaser = page('purchaser', async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('/edit-catalog')) return { items: [{ product: { id: 'p' }, suppliers: [{ supplierId: 'a', supplierName: '原供应商' }, { supplierId: 'b', supplierName: '新供应商' }] }] };
    if (path.endsWith('/reassign-preview')) return { requestId: 'r', supplierId: 'b', items: [{ requestItemId: 'i', eligible: true, salesLineAmount: '12.00', supplyLineAmount: '9.00', priceVersionId: 'v', supplyPriceVersionId: 'sv' }] };
    return detail;
  }, {}, { showModal: options => options.success({ confirm: true }) });
  purchaser.data.requestId = 'r';
  await purchaser.loadRequestDetail('r');
  purchaser.loadRequests = async () => {};
  await purchaser.changeItemSupplier(input('i', '1'));
  const command = calls.find(call => call.path.endsWith('/assign'));
  assert.deepEqual(plain(command.options.data), { expectedVersion: 2, itemIds: ['i'], supplierId: 'b', expectedPrices: [{ requestItemId: 'i', priceVersionId: 'v', supplyPriceVersionId: 'sv' }] });
  assert.ok(command.options.header['idempotency-key']);
  assert.ok(!calls.some(call => call.path.endsWith('/confirm')));
  assert.equal(purchaser.data.reallocating, false);
});

test('purchaser blocks adjusted confirmation on shortage and generates orders after funds are sufficient', async () => {
  const calls = [];
  const preview = { items: [{ productId: 'p1', priceVersionId: 'sale-1', supplyPriceVersionId: 'supply-1' }],
    totals: { salesGoodsAmount: '12.00', supplyGoodsAmount: '10.00' }, funding: { canConfirm: false } };
  const purchaser = page('purchaser', async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('/items-preview')) return preview;
    if (path.endsWith('/confirm-adjusted')) return { requestId: 'request', status: 'CONFIRMED', supplierOrderIds: ['order'] };
    return { id: 'request' };
  });
  purchaser.data.requestId = 'request';
  purchaser.data.canReallocate = true;
  purchaser.data.selectedRequest = { id: 'request', version: 3, items: [{ productId: 'p1', productName: '苹果', supplierId: 'supplier-1', quantity: '5', unitSnapshot: { inputQuantity: '5', inputUnitId: 'unit-1', inputUnitName: '斤' } }] };
  purchaser.data.editCatalog = { items: [{ product: { id: 'p1', name: '苹果', baseUnitId: 'unit-1', unitName: '斤', version: 5, minOrderQty: '1', orderMultiple: '1' }, suppliers: [{ supplierId: 'supplier-1', supplierName: '供应商甲', priceVersionId: 'sale-1', supplyPriceVersionId: 'supply-1', salesPrice: '2', supplyPrice: '1.5' }] }] };
  purchaser.loadRequests = async () => {};
  purchaser.loadRequestDetail = async () => {};
  purchaser.startRequestEdit();
  purchaser.editInput({ currentTarget: { dataset: { field: 'editReason' } }, detail: { value: '门店确认核减' } });
  purchaser.changeEditQuantity({ currentTarget: { dataset: { id: 'p1' } }, detail: { value: '4' } });
  purchaser.changeEditQuantity({ currentTarget: { dataset: { id: 'p1' } }, detail: { value: '6' } });
  assert.match(purchaser.data.error, /不能超过门店原下单数量 5 斤/);
  assert.equal(purchaser.data.editItems[0].quantity, '4');
  await purchaser.confirmRequestEdit();
  assert.equal(calls.length, 1);
  assert.match(purchaser.data.error, /资金不足/);
  assert.equal(purchaser.data.editingRequest, true);
  preview.funding.canConfirm = true;
  calls.length = 0;
  await purchaser.confirmRequestEdit();
  assert.equal(calls[0].path, '/purchase-requests/request/items-preview');
  assert.equal(calls[0].options.data.items[0].quantity, '4');
  assert.equal(calls[1].path, '/purchase-requests/request/confirm-adjusted');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.data.items[0].expectedPriceVersionId, 'sale-1');
  assert.equal(calls.length, 2);
  assert.equal(purchaser.data.editingRequest, false);
  const markup = readFileSync('apps/miniprogram/pages/purchaser/index.wxml', 'utf8');
  assert.equal(purchaser.data.result.status, 'CONFIRMED');
  for (const label of ['调整下货单', '取消调整', '确认并生成订单', '供应商价格', '门店原下单量', '待充值金额', '待补挂账额度', '保存调整']) assert.ok(markup.includes(label));
  assert.equal(markup.includes('核对调整'), false);
  for (const handler of ['chooseEditPrimaryCategory', 'stepEditProduct', 'setEditProductQuantity', 'changeEditSupplier']) assert.ok(markup.includes(`bindtap="${handler}"`) || markup.includes(`bindblur="${handler}"`) || markup.includes(`bindchange="${handler}"`));
  assert.equal(markup.includes('>编辑商品</button>'), false);
});

test('purchaser navigation does not show a combined cached todo badge', () => {
  const markup = readFileSync('apps/miniprogram/pages/purchaser/index.wxml', 'utf8');
  const navigation = markup.split('\n').find(line => line.includes('class="business-nav"'));
  assert.ok(navigation);
  assert.ok(navigation.includes('>待办</view>'));
  assert.equal(navigation.includes('nav-badge'), false);
  assert.equal(navigation.includes('procurementTasks.length'), false);
});

test('purchaser rejection requires a reason and cancels the whole request through the command endpoint', async () => {
  const calls = [];
  const purchaser = page('purchaser', async (path, options) => { calls.push({ path, options }); return { status: 'CANCELED' }; }, {}, {
    showModal: options => options.success({ confirm: true })
  });
  purchaser.data.selectedRequest = { id: 'request', version: 4 };
  purchaser.data.rejectingRequest = true;
  purchaser.loadRequests = async () => {};
  purchaser.loadRequestDetail = async () => {};
  await purchaser.rejectRequest();
  assert.match(purchaser.data.error, /拒单原因/);
  purchaser.data.rejectReason = '商品信息不符';
  await purchaser.rejectRequest();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/purchase-requests/request/reject');
  assert.deepEqual(plain(calls[0].options.data), { expectedVersion: 4, reason: '商品信息不符' });
  assert.equal(purchaser.data.rejectingRequest, false);
});

test('purchaser groups confirmation products by supplier and rebuilds groups after reassignment', async () => {
  let reassigned = false;
  const purchaser = page('purchaser', async path => {
    if (path.endsWith('/edit-catalog')) return { items: ['p1', 'p2', 'p3'].map(id => ({ product: { id }, suppliers: [{ supplierId: 'a', supplierName: '粮油供应商' }, { supplierId: 'b', supplierName: '蔬菜供应商' }] })) };
    if (path.endsWith('/reassign-preview')) return { requestId: 'r', supplierId: 'b', items: [{ requestItemId: 'i1', eligible: true, salesLineAmount: '15.00', supplyLineAmount: '12.00', priceVersionId: 'v', supplyPriceVersionId: 'sv' }] };
    if (path.endsWith('/assign')) { reassigned = true; return {}; }
    return { id: 'r', version: reassigned ? 2 : 1, status: 'PENDING_PROCUREMENT', supplierOrders: [], items: [
      { id: 'i1', productId: 'p1', supplierId: reassigned ? 'b' : 'a', productName: '大米', salesLineAmount: reassigned ? '15.00' : '12.50', supplyLineAmount: reassigned ? '12.00' : '10.00' },
      { id: 'i2', productId: 'p2', supplierId: 'b', productName: '青菜', salesLineAmount: '8.25', supplyLineAmount: '6.00' },
      { id: 'i3', productId: 'p3', supplierId: 'a', productName: '面粉', salesLineAmount: '3.50', supplyLineAmount: '2.00' }
    ] };
  }, {}, { showModal: options => options.success({ confirm: true }) });
  purchaser.data.requestId = 'r'; purchaser.loadRequests = async () => {};
  await purchaser.loadRequestDetail();
  assert.deepEqual(plain(purchaser.data.assignmentGroups.map(group => [group.supplierId, group.itemCount, group.salesAmount, group.supplyAmount])), [
    ['a', 2, '16.00', '12.00'], ['b', 1, '8.25', '6.00']
  ]);
  assert.equal(purchaser.data.assignmentGroups[0].supplierName, '粮油供应商');
  await purchaser.changeItemSupplier(input('i1', '1'));
  const groupB = purchaser.data.assignmentGroups.find(group => group.supplierId === 'b');
  assert.equal(groupB.itemCount, 2);
  assert.equal(groupB.salesAmount, '23.25');
  assert.equal(groupB.supplyAmount, '18.00');
  assert.deepEqual(plain(groupB.items.map(item => item.id)), ['i1', 'i2']);
  assert.equal(purchaser.data.assignmentGroups.find(group => group.supplierId === 'a').itemCount, 1);
  purchaser.backToList();
  assert.deepEqual(plain(purchaser.data.assignmentGroups), []);
});

test('purchaser prices distinguish snapshot unit prices from amounts in both detail layouts', () => {
  const markup = readFileSync('apps/miniprogram/pages/purchaser/index.wxml', 'utf8');
  assert.equal((markup.match(/labels\.money\(item\.salesUnitPrice\)/g) || []).length, 2);
  assert.equal((markup.match(/labels\.money\(item\.supplyUnitPrice\)/g) || []).length, 2);
  for (const label of ['销售价格', '供应商价格', '销售金额', '供应商金额']) assert.ok(markup.includes(label));
  assert.ok(!markup.includes('供货金额'));
  assert.ok(!markup.includes('defaultSalesPrice'));
  assert.ok(markup.includes('!visibleRequests.length && !loading && !error'));
  assert.equal((markup.match(/class="assignment-price-grid" wx:if="\{\{showPriceDetails\}\}"/g) || []).length, 2);
  assert.ok(markup.includes('class="assignment-group-totals" wx:if="{{showPriceDetails}}"'));
  const purchaser = page('purchaser');
  assert.equal(purchaser.data.showPriceDetails, false);
  purchaser.togglePriceDetails({ detail: { value: true } });
  assert.equal(purchaser.data.showPriceDetails, true);
  purchaser.togglePriceDetails({ detail: { value: false } });
  assert.equal(purchaser.data.showPriceDetails, false);
  purchaser.togglePriceDetails({ detail: { value: true } });
  purchaser.backToList();
  assert.equal(purchaser.data.showPriceDetails, false);
});

test('purchaser detail retries failures and blocks commands until refreshed', async () => {
  let fail = true;
  const purchaser = page('purchaser', async () => {
    if (fail) throw new Error('网络暂不可用');
    return { id: 'r', status: 'CONFIRMED', supplierOrders: [{ id: 'o' }] };
  });
  purchaser.data.requestId = 'r';
  await purchaser.loadRequestDetail();
  assert.equal(purchaser.data.detailError, '网络暂不可用');
  assert.equal(purchaser.data.detailing, false);
  await purchaser.confirmRequest();
  assert.equal(purchaser.data.confirming, false);
  fail = false;
  await purchaser.loadRequestDetail();
  assert.equal(purchaser.data.detailError, '');
  assert.equal(purchaser.data.selectedRequest.id, 'r');
  const markup = readFileSync('apps/miniprogram/pages/purchaser/index.wxml', 'utf8');
  assert.ok(!markup.includes('刷新明细'));
  assert.ok(markup.includes('wx:if="{{detailError}}"'));
  assert.ok(!markup.includes('bindchange="changeItemSupplier"'), 'the original request detail must not expose a mutating supplier shortcut');
  assert.ok(markup.includes('bindchange="changeEditSupplier"'), 'supplier changes belong to the execution-adjustment flow');
  assert.ok(!markup.includes('class="field-label">供货供应商'));
  assert.ok(!markup.includes('item.options[item.supplierIndex].supplierName'));
  assert.ok(markup.includes('供应商：{{item.supplierName}}'));
  assert.ok(markup.includes('待充值金额'));
  assert.ok(markup.includes('待补挂账额度'));
});

test('purchaser detail refreshes when returning to the page, but not during a write', () => {
  const user = { id: 'buyer', displayName: '采购经理' };
  const purchaser = page('purchaser', undefined, { openWorkspace: () => user });
  purchaser.data.user = user; purchaser.data.requestId = 'r';
  let reads = 0;
  purchaser.loadRequestDetail = () => { reads++; };
  purchaser.onShow();
  assert.equal(reads, 1);
  purchaser.data.reallocating = true;
  purchaser.onShow();
  assert.equal(reads, 1);
});

test('purchaser confirmation generates and shows supplier orders without finance review', async () => {
  const scrolls = [];
  const detail = { id: 'r', requestNo: 'PR-001', version: 2, status: 'CONFIRMED', supplierOrders: [{ id: 'o' }] };
  const purchaser = page('purchaser', async path => path.endsWith('/confirmation-preview') ? { funding: { canConfirm: true } } : path.endsWith('/confirm') ? { status: 'CONFIRMED', supplierOrderIds: ['o'] }
    : path.startsWith('/supplier-orders/') ? { items: [{ id: path, productName: '订单商品', quantity: '3', unitName: '袋' }] } : detail,
    {}, { pageScrollTo: options => scrolls.push(options) });
  purchaser.data.requestId = 'r'; purchaser.data.selectedRequest = { ...detail, status: 'PENDING_PROCUREMENT', supplierOrders: [] };
  await purchaser.confirmRequest();
  assert.equal(purchaser.data.error, '');
  assert.equal(purchaser.data.result.title, '采购确认成功');
  assert.equal(purchaser.data.result.detail, '已生成 1 张供应商订单');
  assert.equal(purchaser.data.selectedRequest.supplierOrders.length, 1);
  assert.equal(scrolls.length, 1);
  const template = readFileSync('apps/miniprogram/pages/purchaser/index.wxml', 'utf8');
  assert.ok(template.includes('class="order-count" wx:if="{{!rejectedOrderId}}">{{selectedRequest.supplierOrders.length}} 张</text>'));
  assert.ok(template.includes('wx:for="{{item.items}}"'));
  for (const field of ['salesUnitPrice', 'salesLineAmount', 'supplyUnitPrice', 'supplyLineAmount']) {
    assert.ok(template.includes(`labels.money(product.${field})`));
  }
  assert.ok(template.indexOf('id="supplier-order-summary"') < template.indexOf('bindtap="confirmRequest"'));
});

test('purchaser thumbnails use authenticated file loading once per file and ignore stale details', async () => {
  const calls = [];
  const purchaser = page('purchaser', undefined, { imagePath: async file => { calls.push(file.id); return '/tmp/product.jpg'; } });
  const item = { id: 'i', imageFile: { id: 'f' } };
  const request = { id: 'r', items: [item], supplierOrders: [{ id: 'o', items: [item] }] };
  purchaser.data.requestId = 'r'; purchaser.detailRequestSequence = 1;
  purchaser.data.selectedRequest = request;
  purchaser.data.assignmentItems = [item]; purchaser.data.assignmentGroups = [{ items: [item] }];
  await purchaser.loadProductImages(request, 1);
  assert.deepEqual(calls, ['f']);
  assert.equal(purchaser.data.selectedRequest.supplierOrders[0].items[0].imageUrl, '/tmp/product.jpg');
  assert.equal(purchaser.data.assignmentGroups[0].items[0].imageUrl, '/tmp/product.jpg');
  purchaser.data.requestId = 'other';
  purchaser.data.assignmentItems = [item];
  await purchaser.loadProductImages(request, 1);
  assert.equal(purchaser.data.assignmentItems[0].imageUrl, undefined);
});

test('purchaser thumbnail failures leave an explicit placeholder', async () => {
  const purchaser = page('purchaser', undefined, { imagePath: async () => { throw new Error('download failed'); } });
  const request = { id: 'r', items: [{ id: 'i', imageFile: { id: 'f' } }] };
  purchaser.data.requestId = 'r'; purchaser.detailRequestSequence = 1; purchaser.data.selectedRequest = request;
  await purchaser.loadProductImages(request, 1);
  assert.equal(purchaser.data.selectedRequest.items[0].imageFailed, true);
  assert.equal(purchaser.data.selectedRequest.items[0].imageUrl, '');
  const markup = readFileSync('apps/miniprogram/pages/purchaser/index.wxml', 'utf8');
  assert.equal((markup.match(/<product-card product="\{\{(product|item)\}\}"/g) || []).length >= 3, true);
  const component = readFileSync('apps/miniprogram/components/product-card/index.wxml', 'utf8');
  assert.ok(component.includes("product.imageFailed ? '图片加载失败，点此重试'"));
  assert.ok(component.includes('bindtap="previewImage"'));
  assert.ok(component.includes('暂无图片'));
});

test('supplier adjustment cancellation and ineligible preview do not submit writes', async () => {
  for (const eligible of [true, false]) {
    const calls = [];
    const purchaser = page('purchaser', async (path) => {
      calls.push(path);
      return { requestId: 'r', supplierId: 'b', items: [{ requestItemId: 'i', eligible, priceVersionId: 'v', supplyPriceVersionId: 'sv' }] };
    }, {}, { showModal: options => options.success({ confirm: false }) });
    purchaser.data.requestId = 'r';
    purchaser.data.selectedRequest = { id: 'r', version: 1 };
    purchaser.data.assignmentItems = [{ id: 'i', supplierId: 'a', options: [{ supplierId: 'b' }] }];
    await purchaser.changeItemSupplier(input('i', '0'));
    assert.equal(calls.length, 1);
    assert.ok(calls[0].endsWith('/reassign-preview'));
    assert.equal(purchaser.data.reallocating, false);
    assert.equal(Boolean(purchaser.data.error), !eligible);
  }
});

test('store catalog searches and filters real product units and hides invalid prices', async () => {
  const store = page('store', async () => ({ store: { name: '门店一', address: '上海市' }, items: [
    { product: { id: 'p1', name: '大米', sku: 'RICE', isActive: true, categoryId: 'food', categoryName: '粮食', unitName: '袋', minOrderQty: '2', orderMultiple: '2' }, suppliers: [{ supplierId: 's1', supplierName: '粮食供应商', salesPrice: '12', priceVersionId: 'v1' }] },
    { product: { id: 'p2', name: '清洁剂', isActive: true, categoryId: 'clean', categoryName: '清洁', unitName: '瓶', minOrderQty: '1', orderMultiple: '1' }, suppliers: [] },
  ] }));
  await store.loadCatalog();
  assert.equal(store.data.store.name, '门店一');
  assert.equal(store.data.visibleProducts.length, 2);
  assert.equal(store.data.visibleProducts[1].canOrder, false);
  store.stepProduct(tap('p2', { direction: 1 })); assert.equal(store.data.cart.length, 0);
  store.onSearch({ detail: { value: 'rice' } }); assert.equal(store.data.visibleProducts.length, 1);
  store.stepProduct(tap('p1', { direction: 1 })); assert.equal(store.data.cart[0].quantity, '2');
  assert.equal(store.data.estimatedAmount, '24.00');
  const template = readFileSync('apps/miniprogram/pages/store/index.wxml', 'utf8');
  assert.equal((template.match(/>¥\{\{labels.money\(estimatedAmount\)\}\}/g) || []).length, 2);
  assert.ok(!template.includes('商品合计 ¥'));
  assert.ok(!template.includes('预估 ¥'));
  store.stepProduct(tap('p1', { direction: 1 })); assert.equal(store.data.cart[0].quantity, '4');
  store.stepProduct(tap('p1', { direction: -1 })); assert.equal(store.data.cart[0].quantity, '2');
  store.stepProduct(tap('p1', { direction: -1 })); assert.equal(store.data.cart.length, 0);
  store.onSearch({ detail: { value: '' } }); store.choosePrimaryCategory(tap('clean'));
  assert.equal(store.data.visibleProducts[0].id, 'p2');
});

test('store catalog groups two-level categories and omits absent optional text', async () => {
  const store = page('store', async () => ({ items: [
    { product: { id: 'a', name: '大米', isActive: true, categoryId: 'rice', categoryName: '米类', categoryParentId: 'food', categoryParentName: '粮油', brand: null, specification: 'null', storageCondition: 'AMBIENT' }, suppliers: [] },
    { product: { id: 'b', name: '面粉', isActive: true, categoryId: 'flour', categoryName: '面类', categoryParentId: 'food', categoryParentName: '粮油', brand: 'undefined' }, suppliers: [] },
    { product: { id: 'c', name: '清洁剂', isActive: true, categoryId: 'clean', categoryName: '清洁' }, suppliers: [] },
  ] }));
  await store.loadCatalog();
  assert.deepEqual(plain(store.data.categories.map(item => item.name)), ['全部商品', '粮油', '清洁']);
  assert.equal(store.data.products[0].brand, '');
  assert.equal(store.data.products[0].specification, '');
  store.choosePrimaryCategory(tap('food'));
  assert.equal(store.data.visibleProducts.length, 2);
  assert.deepEqual(plain(store.data.subcategories.map(item => item.name)), ['全部', '米类', '面类']);
  store.chooseCategory(tap('rice'));
  assert.equal(store.data.visibleProducts[0].id, 'a');
  store.choosePrimaryCategory(tap('clean'));
  assert.equal(store.data.categoryId, '');
  assert.equal(store.data.subcategories.length, 0);
  assert.equal(store.data.visibleProducts[0].id, 'c');
  store.choosePrimaryCategory(tap('food'));
  store.chooseCategory(tap('rice'));
  store.onCatalogScroll({ detail: { scrollTop: 180 } });
  store.onSearch({ detail: { value: '清洁' } });
  assert.equal(store.data.primaryCategoryId, '');
  assert.equal(store.data.categoryId, '');
  assert.equal(store.data.catalogScrollTop, 0);
  assert.equal(store.data.visibleProducts[0].id, 'c');
  store.choosePrimaryCategory(tap('food'));
  assert.equal(store.data.search, '');
  assert.equal(store.data.visibleProducts.length, 2);
  const template = readFileSync('apps/miniprogram/pages/store/index.wxml', 'utf8');
  assert.match(template, /scroll-y class="category-sidebar"/);
  assert.match(template, /scroll-y class="catalog-products"/);
});

test('unbound store shows a binding state before loading and cannot expose checkout controls', () => {
  const user = { id: 'multi-role', roles: ['STORE', 'SUPPLIER', 'PURCHASER'] };
  const store = page('store', async () => { throw new Error('No catalog request expected'); },
    { openWorkspace: () => user }, { getStorageSync: () => null });
  store.onShow();
  assert.equal(store.data.storeId, '');
  assert.equal(store.data.products.length, 0);
  const template = readFileSync('apps/miniprogram/pages/store/index.wxml', 'utf8');
  const binding = template.indexOf('class="empty-state store-unbound" wx:if="{{!storeId}}"');
  assert.ok(binding >= 0 && binding < template.indexOf('class="catalog-skeleton"'));
  assert.match(template, /class="order-bar" wx:if="\{\{canWrite && storeId && !templateMissing\}\}"/);
  assert.match(template, /class="search-input"[^>]*disabled="\{\{!storeId\}\}"/);
  user.scope = { storeId: 'own-store' }; store.onShow();
  assert.equal(store.data.storeId, 'own-store');
  assert.equal(store.data.canWrite, true);
});

function orderPreview(price = '12', version = 'v1') {
  return { items: [{ productId: 'p1', supplierId: 's1', quantity: '2', salesUnitPrice: price, salesLineAmount: String(Number(price) * 2), priceVersionId: version }],
    totals: { salesGoodsAmount: String(Number(price) * 2) }, funding: { stored: { required: '24', available: '100', paid: '0', shortfall: '0.00' }, canConfirm: true } };
}

function prepareCart(store) {
  store.data.storeId = 'store'; store.data.user = { id: 'user' };
  store.data.products = [{ id: 'p1', name: '大米', unitName: '袋', supplierName: '粮食供应商', minOrderQty: '2', orderMultiple: '2' }];
  store.data.cart = [{ productId: 'p1', name: '大米', quantity: '2' }];
}

test('store checkout groups suppliers and requires a second review when prices change', async () => {
  let calls = 0, writes = 0;
  const store = page('store', async path => {
    if (path.endsWith('/preview')) return ++calls === 1 ? orderPreview() : orderPreview('14', 'v2');
    writes++; return { id: 'request' };
  });
  prepareCart(store); await store.previewOrder();
  assert.equal(store.data.orderStep, 'confirm');
  assert.equal(store.data.previewGroups[0].supplierName, '粮食供应商');
  assert.equal(store.data.previewGroups[0].items[0].unitName, '袋');
  await store.submitOrder(); assert.equal(writes, 0);
  assert.match(store.data.error, /重新核对/);
  assert.equal(store.data.preview.items[0].priceVersionId, 'v2');
});

test('native unit labels prefer current names while leaving transaction snapshots unchanged', () => {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/store-view.js', 'utf8'), { module });
  const unitSnapshot = { salesUnitName: '旧单位', salesUnitsPerPurchaseUnit: '12' };
  const preview = { items: [{ productId: 'p', supplierId: 's', unitName: '新单位', quantity: '24', unitSnapshot }] };
  const groups = module.exports.previewGroups(preview, [{ id: 'p', name: '水', unitName: '其他单位' }]);
  assert.equal(groups[0].items[0].unitName, '新单位');
  assert.equal(preview.items[0].unitSnapshot.salesUnitName, '旧单位');
  assert.equal(preview.items[0].quantity, '24');
});

test('uncertain order submission retains the same key and body while cart changes are locked', async () => {
  const submissions = []; let failed = false;
  const store = page('store', async (path, options) => {
    if (path.endsWith('/preview')) return orderPreview();
    if (path === '/purchase-requests' && options) {
      submissions.push(plain(options));
      if (!failed) { failed = true; const error = new Error('断网'); error.uncertain = true; throw error; }
      return { id: 'r1' };
    }
    if (path === '/purchase-requests/r1') return { items: [], supplierOrders: [] };
    return [];
  });
  prepareCart(store); await store.previewOrder(); await store.submitOrder();
  assert.ok(store.data.pendingOrder);
  store.removeCartItem(tap('p1')); assert.equal(store.data.cart.length, 1);
  await store.submitOrder(); assert.equal(store.data.pendingOrder, null);
  assert.deepEqual(submissions[0].header, submissions[1].header);
  assert.deepEqual(submissions[0].data, submissions[1].data);
  assert.equal(store.data.activeView, 'orders');
});

test('credit shortfall permits a request submission and retains the funding shortage', async () => {
  let writes = 0;
  const preview = { ...orderPreview(), funding: { ...orderPreview().funding, credit: { required: '24', available: '10', shortfall: '14.00' } } };
  const store = page('store', async (path, options) => {
    if (path.endsWith('/preview')) return preview;
    if (path === '/purchase-requests' && options?.method === 'POST') { writes++; return { id: 'pending', status: 'PENDING_FUNDS' }; }
    if (path === '/purchase-requests/pending') return { items: [], supplierOrders: [], status: 'PENDING_FUNDS' };
    return [];
  });
  prepareCart(store); await store.previewOrder(); await store.submitOrder();
  assert.equal(writes, 1); assert.equal(store.data.created.status, 'PENDING_FUNDS');
  assert.equal(store.data.pendingOrder, null);
});

test('order filters use aggregate completion rather than procurement CONFIRMED status', async () => {
  const store = page('store', async () => [
    { id: 'r1', status: 'CONFIRMED', supplierCount: 2, completedSupplierCount: 2, paymentStatus: 'PAID' },
    { id: 'r2', status: 'CONFIRMED', supplierCount: 2, completedSupplierCount: 1, paymentStatus: 'UNPAID' },
    { id: 'r3', status: 'PENDING_FUNDS', paymentStatus: 'UNPAID' },
  ]);
  await store.loadRequests(); store.filterOrders({ currentTarget: { dataset: { filter: 'completed' } } });
  assert.deepEqual(plain(store.data.filteredRequests.map(order => order.id)), ['r1']);
  store.filterOrders({ currentTarget: { dataset: { filter: 'receive' } } });
  assert.deepEqual(plain(store.data.filteredRequests.map(order => order.id)), ['r2']);
  store.filterFunding({ detail: { value: true } }); assert.equal(store.data.filteredRequests.length, 1);
});

test('receipt retry keeps the original revision and quantities after a network failure', async () => {
  const writes = [];
  const store = page('store', async (path, options) => {
    if (!options) return { id: 's1', shipmentNo: 'SH1', supplierOrderVersion: 8, currentReceiptRevision: 1, items: [{ id: 'i1', shippedQuantity: '3' }] };
    writes.push(plain(options));
    if (writes.length === 1) { const error = new Error('断网'); error.uncertain = true; throw error; }
    return { id: 'receipt', revision: 2 };
  });
  store.data.user = { id: 'user' }; await store.selectShipment(tap('s1'));
  store.data.receiptEvidence = [{ id: 'evidence', status: 'READY' }];
  store.onReceiptQuantity(input('i1', '2')); await store.receiveShipment(tap('', { mode: 'SHORT' }));
  store.onReceiptQuantity(input('i1', '3')); assert.equal(store.data.receiptItems[0].receivedQuantity, '2');
  await store.receiveShipment(tap('', { mode: 'FULL' }));
  assert.deepEqual(writes[0], writes[1]); assert.equal(store.data.pendingReceipt, null);
});

test('unchanged submitted receipts cannot create another revision but correction remains available', async () => {
  let writes = 0;
  const store = page('store', async (path, options) => {
    if (options) { writes++; return { id: 'receipt', revision: 2 }; }
    return { id: 's1', supplierOrderVersion: 8, currentReceiptRevision: 1, items: [{ id: 'i1', shippedQuantity: '3', currentReceivedQuantity: '3', receiptLocked: false }] };
  });
  await store.selectShipment(tap('s1')); assert.equal(store.data.receiptCanSubmit, false);
  store.data.receiptEvidence = [{ id: 'evidence', status: 'READY' }];
  await store.receiveShipment(tap('', { mode: 'FULL' })); assert.equal(writes, 0);
  store.onReceiptQuantity(input('i1', '2')); assert.equal(store.data.receiptCanSubmit, true);
  await store.receiveShipment(tap('', { mode: 'SHORT' })); assert.equal(writes, 1);
});

test('store finance role cannot invoke order or receipt write handlers', async () => {
  let calls = 0;
  const store = page('store', async () => { calls++; return {}; });
  prepareCart(store); store.data.canWrite = false;
  store.stepProduct(tap('p1', { direction: 1 })); await store.previewOrder(); await store.submitOrder();
  await store.receiveShipment(tap('', { mode: 'FULL' }));
  assert.equal(calls, 0); assert.equal(store.data.cart[0].quantity, '2');
});

test('store cart submits multiple products and validates minimum/multiple', () => {
  const store = page('store');
  store.data.storeId = 'store';
  store.data.products = [
    { id: 'p1', name: '商品一', minOrderQty: '2', orderMultiple: '2' },
    { id: 'p2', name: '商品二', minOrderQty: '0.1', orderMultiple: '0.1' },
  ];
  store.selectProduct({ detail: { value: '0' } });
  store.data.quantity = '3'; store.addToCart(); assert.equal(store.data.cart.length, 0);
  store.data.quantity = '4'; store.addToCart();
  store.selectProduct({ detail: { value: '1' } }); store.data.quantity = '0.3'; store.addToCart();
  assert.deepEqual(plain(store.orderInput()), { storeId: 'store', items: [{ productId: 'p1', quantity: '4' }, { productId: 'p2', quantity: '0.3' }] });
  store.data.quantity = '0.5'; store.addToCart(); assert.equal(store.data.cart.length, 2);
  assert.equal(store.data.cart[1].quantity, '0.5');
  store.removeCartItem(tap('p1')); assert.equal(store.data.cart.length, 1);
});

test('store receipts preserve per-item counts and displayed version; reject over-receipt', async () => {
  let payload;
  const shipment = { id: 's1', shipmentNo: 'S1', supplierOrderVersion: 7, currentReceiptRevision: 2,
    items: [{ id: 'i1', shippedQuantity: '4' }, { id: 'i2', shippedQuantity: '3' }] };
  const store = page('store', async (path, options) => {
    if (path.endsWith('/receipts')) { payload = options.data; return { id: 'r1', revision: 3 }; }
    return shipment;
  });
  await store.selectShipment(tap('s1'));
  store.onReceiptQuantity(input('i1', '2')); store.onReceiptQuantity(input('i2', '0'));
  store.data.receiptEvidence = [{ id: 'evidence', status: 'READY' }];
  await store.receiveShipment(tap('', { mode: 'SHORT' }));
  assert.deepEqual(plain(payload), { expectedOrderVersion: 7, expectedReceiptRevision: 2, evidenceFileIds: ['evidence'],
    items: [{ shipmentItemId: 'i1', receivedQuantity: '2' }, { shipmentItemId: 'i2', receivedQuantity: '0' }] });
  payload = null; await store.selectShipment(tap('s1')); store.onReceiptQuantity(input('i2', '4'));
  await store.receiveShipment(tap('', { mode: 'SHORT' })); assert.equal(payload, null); assert.match(store.data.error, /超过/);
});

test('returned receipt review preserves finalized rows and applies only the revised quantity delta', async () => {
  let payload;
  const store = page('store', async (path, options) => {
    if (path.endsWith('/receipts')) { payload = options.data; return { revision: 2 }; }
    return { id: 's1', supplierOrderVersion: 8, currentReceiptRevision: 1, items: [
      { id: 'accepted', shippedQuantity: '3', currentReceivedQuantity: '2', receiptLocked: true },
      { id: 'returned', shippedQuantity: '3', currentReceivedQuantity: '2', receiptLocked: false },
    ] };
  });
  await store.selectShipment(tap('s1'));
  store.onReceiptQuantity(input('accepted', '3'));
  store.data.receiptEvidence = [{ id: 'evidence', status: 'READY' }];
  assert.equal(store.data.receiptItems[0].receivedQuantity, '2');
  await store.receiveShipment(tap('', { mode: 'FULL' }));
  assert.deepEqual(plain(payload), { expectedOrderVersion: 8, expectedReceiptRevision: 1, evidenceFileIds: ['evidence'],
    items: [{ shipmentItemId: 'accepted', receivedQuantity: '2' }, { shipmentItemId: 'returned', receivedQuantity: '3' }] });
});

test('receipt evidence is required before a new native submission and failures remain retryable', async () => {
  let writes = 0, attempts = 0;
  const store = page('store', async (path, options) => {
    if (options) { writes++; return { id: 'r', revision: 1 }; }
    return { id: 's', supplierOrderVersion: 1, currentReceiptRevision: 0, items: [{ id: 'i', shippedQuantity: '1' }] };
  }, { chooseEvidence: async () => [{ path: 'photo' }], uploadEvidence: async (path, purpose) => {
    assert.equal(purpose, 'RECEIPT'); if (++attempts === 1) throw new Error('断网'); return { id: 'file', mimeType: 'image/jpeg' };
  } });
  await store.selectShipment(tap('s'));
  await store.receiveShipment(tap('', { mode: 'FULL' })); assert.equal(writes, 0); assert.match(store.data.error, /凭证/);
  await store.chooseReceiptEvidence(); assert.equal(store.data.receiptEvidence[0].status, 'FAILED');
  await store.receiveShipment(tap('', { mode: 'FULL' })); assert.equal(writes, 0);
  await store.retryReceiptEvidence(tap('', { index: 0 })); assert.equal(store.data.receiptEvidence[0].status, 'READY');
  await store.receiveShipment(tap('', { mode: 'FULL' })); assert.equal(writes, 1); assert.equal(store.data.receiptEvidence.length, 0);
});

test('receipt upload locks navigation and cannot attach a stale image to another shipment', async () => {
  let complete;
  const store = page('store', async () => ({ id: 's', items: [{ id: 'i', shippedQuantity: '1' }] }), {
    chooseEvidence: async () => [{ path: 'photo' }], uploadEvidence: () => new Promise(resolve => { complete = resolve; })
  });
  await store.selectShipment(tap('s'));
  const pending = store.chooseReceiptEvidence();
  for (let index = 0; index < 5 && !complete; index++) await Promise.resolve();
  store.closeShipment(); await store.selectShipment(tap('other')); store.changeView(tap('', { view: 'orders' }));
  assert.equal(store.data.shipmentId, 's'); assert.equal(store.data.activeView, 'receive');
  complete({ id: 'file' }); await pending;
  store.removeReceiptEvidence(tap('', { index: 0 })); assert.equal(store.data.receiptEvidence.length, 0);
});

test('native evidence upload sends binary content with its session token before completion', async () => {
  const calls = [], module = { exports: {} };
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), { module, Uint8Array,
    getApp: () => ({ globalData: { apiBase: 'http://local/api/v1' } }),
    wx: { getStorageSync: key => key === 'procurexToken' ? 'test-token' : '',
      getFileSystemManager: () => ({ readFile: options => options.success({ data: bytes }) }),
      request: options => { calls.push(options); options.success({ statusCode: 201, data: { data: calls.length === 1 ? { id: 'file', uploadToken: 'upload-token' } : calls.length === 3 ? { status: 'READY' } : { uploaded: true } } }); }
    }
  });
  const file = await module.exports.uploadEvidence('photo', 'RECEIPT');
  assert.equal(file.id, 'file'); assert.equal(file.mimeType, 'image/png');
  assert.equal(calls[0].data.purpose, 'RECEIPT'); assert.equal(calls[0].data.sizeBytes, 8);
  assert.equal(calls[1].data, bytes); assert.equal(calls[1].header['content-type'], 'application/octet-stream');
  assert.equal(calls[1].header['x-upload-token'], 'upload-token');
  assert.equal(calls[1].header.authorization, 'Bearer test-token'); assert.match(calls[2].url, /\/complete$/);
});

test('unchanged submitted receipt cannot open an upload draft until a legal quantity correction', async () => {
  let selections = 0;
  const store = page('store', async () => ({ id: 's', currentReceiptRevision: 1, items: [{ id: 'i', shippedQuantity: '2', currentReceivedQuantity: '2' }] }),
    { chooseEvidence: async () => { selections++; return []; } });
  await store.selectShipment(tap('s')); await store.chooseReceiptEvidence(); assert.equal(selections, 0);
  store.onReceiptQuantity(input('i', '1')); await store.chooseReceiptEvidence(); assert.equal(selections, 1);
});

test('native evidence rejects unreadable or unsupported bytes before creating an upload session', async () => {
  const module = { exports: {} }; let calls = 0;
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), { module, Uint8Array,
    wx: { getFileSystemManager: () => ({ readFile: options => options.success({ data: Uint8Array.from([1, 2, 3]).buffer }) }), request: () => { calls++; } }
  });
  await assert.rejects(module.exports.uploadEvidence('invalid', 'RECEIPT'), /JPEG/); assert.equal(calls, 0);
});

test('superseded upload responses cannot restore evidence after an account reset', async () => {
  let complete;
  const store = page('store', undefined, { uploadEvidence: () => new Promise(resolve => { complete = resolve; }) });
  store.receiptUploadSequence = 1; store.data.receiptEvidence = [{ path: 'old', status: 'UPLOADING' }];
  const upload = store.uploadReceiptEvidence('old');
  store.receiptUploadSequence++; store.data.receiptEvidence = [];
  complete({ id: 'old-file' }); await upload; assert.equal(store.data.receiptEvidence.length, 0);
});

test('supplier partial shipment uses remaining quantities and omits zero rows', async () => {
  let payload;
  const supplier = page('supplier', async (path, options) => {
    if (path.endsWith('/shipment-preview')) return { totals: { shipQuantity: '0.1' } };
    if (path.endsWith('/shipments')) { payload = options.data; return { id: 's1' }; }
    return { id: 'o1', version: 9, items: [
      { id: 'i1', productId: 'p1', quantity: '0.3', shippedQuantity: '0.2' },
      { id: 'i2', productId: 'p2', quantity: '3', shippedQuantity: '1' },
    ] };
  });
  await supplier.loadOrder('o1'); assert.equal(supplier.data.shipmentItems[0].shipQuantity, '0.1');
  supplier.onShipQuantity(input('i2', '0')); await supplier.shipOrder();
  assert.equal(payload, undefined); assert.match(supplier.data.error, /说明或上传凭证/);
  supplier.data.revisionNote = '库存不足，分批发货'; await supplier.shipOrder();
  assert.equal(payload.expectedVersion, 9);
  assert.equal(payload.note, '库存不足，分批发货');
  assert.deepEqual(plain(payload.items), [{ orderItemId: 'i1', shipQuantity: '0.1', permanentlyReduceQuantity: '0' }]);
  payload = null; await supplier.loadOrder('o1'); supplier.onShipQuantity(input('i1', '0.2'));
  await supplier.shipOrder(); assert.equal(payload, null); assert.match(supplier.data.error, /超过/);
});

test('supplier immediately explains shipment quantity above available amount', async () => {
  let requests = 0;
  const supplier = page('supplier', async () => { requests++; return {}; });
  supplier.data.shipmentItems = [{ id: 'item', remainingQuantity: '3', unitName: '箱', shipQuantity: '3' }];
  supplier.onShipQuantity(input('item', '4'));
  assert.equal(supplier.data.shipmentItems[0].shipQuantityError, '本次最多可发 3 箱');
  const markup = readFileSync('apps/miniprogram/pages/supplier/index.wxml', 'utf8');
  assert.match(markup, /shipment-quantity-error/);
  assert.match(markup, /disabled="\{\{shipping \|\| rejecting \|\| freightRequesting \|\| revisionUploading\}\}" loading="\{\{shipping\}\}" bindtap="shipOrder"/);
  assert.equal(requests, 0);
});

test('supplier rejects with operator reason and blocks an empty reason', async () => {
  let payload;
  const supplier = page('supplier', async (path, options) => { payload = options.data; return { status: 'REJECTED' }; });
  supplier.data.supplierOrderId = 'o1'; supplier.data.selectedOrder = { version: 4, supplierOrderNo: 'O1' };
  await supplier.rejectOrder(); assert.equal(payload, undefined);
  supplier.data.rejectionReason = '缺货'; await supplier.rejectOrder();
  assert.deepEqual(plain(payload), { expectedVersion: 4, reason: '缺货' });
});

test('purchaser reallocation includes only rejected order products', async () => {
  let payload;
  const purchaser = page('purchaser', async (path, options) => {
    if (path.endsWith('/reallocate')) { payload = options.data; return { status: 'CONFIRMED' }; }
    if (path.startsWith('/supplier-orders/')) return { id: 'o1', requestId: 'r1', status: 'REJECTED', items: [{ productId: 'p2' }] };
    return { id: 'r1', version: 6, supplierOrders: [{ id: 'o1', rejectionHandled: false }], items: [{ id: 'i1', productId: 'p1' }, { id: 'i2', productId: 'p2' }] };
  });
  Object.assign(purchaser.data, { requestId: 'r1', rejectedOrderId: 'o1', targetSupplierId: 's2' });
  await purchaser.reallocateRequest();
  assert.equal(payload.expectedVersion, 6);
  assert.equal(purchaser.data.result.status, 'REALLOCATED');
  assert.deepEqual(plain(payload.assignments), [{ requestItemId: 'i2', supplierId: 's2' }]);
});

test('rapid shipment selection ignores stale detail responses', async () => {
  let resolveFirst;
  const store = page('store', path => path.endsWith('/first') ? new Promise(resolve => { resolveFirst = resolve; })
    : Promise.resolve({ shipmentNo: 'SECOND', items: [] }));
  const first = store.selectShipment(tap('first'));
  await store.selectShipment(tap('second'));
  resolveFirst({ shipmentNo: 'FIRST', items: [] }); await first;
  assert.equal(store.data.selectedShipment.shipmentNo, 'SECOND');
});

test('single-role navigation hides other role entries and redirects unauthorized workspace', () => {
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), {
    module, wx: {
      getStorageSync: () => ({ id: 'u1', roles: ['STORE'] }),
      hideTabBar: () => calls.push('hide'), showTabBar: () => calls.push('show'),
      switchTab: options => calls.push(options.url), redirectTo: options => calls.push(options.url),
    },
  });
  assert.equal(module.exports.openWorkspace('supplier'), null);
  assert.deepEqual(calls, ['/pages/store/index']);
  assert.equal(module.exports.openWorkspace('store').id, 'u1');
});

test('workspace navigation follows role and assigned-store permissions', () => {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), { module });
  const names = user => plain(module.exports.workspaceNames(user));
  assert.deepEqual(names(null), []);
  for (const [role, expected] of [['STORE', 'store'], ['STORE_FINANCE', 'store'], ['SUPPLIER', 'supplier'], ['PURCHASER', 'purchaser'], ['HQ_FINANCE', 'finance']]) {
    assert.deepEqual(names({ roles: [role] }), [expected]);
  }
  assert.deepEqual(names({ roles: ['ADMIN'] }), []);
  assert.deepEqual(names({ roles: ['ADMIN', 'STORE', 'SUPPLIER'], scope: { type: 'ALL' } }), []);
  assert.deepEqual(names({ roles: ['STORE', 'SUPPLIER', 'STORE'] }), ['store', 'supplier']);
  for (const role of ['REGION_MANAGER', 'REGION_FINANCE', 'PURCHASE_FOLLOWER']) {
    assert.deepEqual(names({ roles: [role], scope: { type: 'MULTI_STORE', storeIds: ['s1'] } }), ['region']);
    assert.deepEqual(names({ roles: [role], scope: { type: 'MULTI_STORE', storeIds: [] } }), []);
  }
});

test('administrator root cannot open a business workspace directly', () => {
  const calls = []; const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), { module,
    wx: { getStorageSync: () => ({ roles: ['ADMIN'], testWorkbenchEnabled: true }), reLaunch: value => calls.push(value.url) } });
  assert.equal(module.exports.openWorkspace('purchaser'), null);
  assert.deepEqual(calls, ['/pages/test-workbench/index']);
});

test('admin login opens only the identity picker even with another role', async () => {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), { module });
  const calls = [];
  const login = page('login', undefined, {
    checkHealth: async () => ({}),
    login: async () => ({ id: 'admin', roles: ['ADMIN', 'STORE'], scope: { type: 'ALL' }, testWorkbenchEnabled: true }),
    workspaceNames: module.exports.workspaceNames,
  }, { setStorageSync() {}, switchTab: value => calls.push(value.url), reLaunch: value => calls.push(value.url) });
  login.setData({ username: 'admin', password: 'test' });
  await login.submit();
  assert.deepEqual(calls, ['/pages/test-workbench/index']);
  assert.equal(login.data.error, '');
});

test('custom navigation refreshes account permissions and guards workspace switches', () => {
  let user = { roles: ['PURCHASER', 'HQ_FINANCE'] };
  let route = 'pages/purchaser/index';
  let definition;
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), { module });
  vm.runInNewContext(readFileSync('apps/miniprogram/custom-tab-bar/index.js', 'utf8'), {
    require: () => ({ ...module.exports, currentUser: () => user }),
    Component: value => { definition = value; },
    getCurrentPages: () => [{ route }],
    wx: { switchTab: options => calls.push(options) },
  });
  const bar = { data: { ...definition.data }, ...definition.methods, setData(value) { Object.assign(this.data, value); } };
  definition.lifetimes.attached.call(bar);
  assert.deepEqual(plain(bar.data.items.map(item => item.name)), ['purchaser', 'finance']);
  assert.equal(bar.data.visible, true);
  assert.equal(bar.data.selected, 'purchaser');
  user = { roles: ['ADMIN'], testWorkbenchEnabled: true }; bar.refresh();
  assert.equal(bar.data.visible, false);
  assert.deepEqual(plain(bar.data.items), []);
  user = { roles: ['PURCHASER', 'HQ_FINANCE'] }; bar.refresh();
  bar.switchWorkspace({ currentTarget: { dataset: { name: 'store' } } });
  assert.equal(calls.length, 0);
  bar.switchWorkspace({ currentTarget: { dataset: { name: 'finance' } } });
  assert.equal(calls[0].url, '/pages/finance/index');
  assert.equal(bar.data.selected, 'purchaser');
  bar.switchWorkspace({ currentTarget: { dataset: { name: 'finance' } } });
  assert.equal(calls.length, 1);
  calls[0].complete();
  assert.equal(bar.data.switching, false);
  assert.equal(bar.data.selected, 'purchaser');
  bar.switchWorkspace({ currentTarget: { dataset: { name: 'finance' } } });
  route = 'pages/finance/index'; calls[1].complete();
  assert.equal(bar.data.selected, 'finance');
  user = { roles: ['STORE'] }; bar.refresh();
  assert.equal(bar.data.visible, false);
  assert.deepEqual(plain(bar.data.items.map(item => item.name)), ['store']);
  bar.switchWorkspace({ currentTarget: { dataset: { name: 'finance' } } });
  assert.equal(calls.length, 2);
  user = null; bar.refresh();
  assert.deepEqual(plain(bar.data.items), []);
  assert.equal(bar.data.visible, false);
});

test('supplier allocates replenishment gaps and uses only confirmed unused freight', async () => {
  let payload;
  let previews = 0;
  const supplier = page('supplier', async (path, options) => {
    if (path.endsWith('/shipment-preview')) { previews++; return { totals: { shipQuantity: '2' } }; }
    if (path.endsWith('/shipments')) { payload = options.data; return { id: 's1' }; }
    return { id: 'o1', status: 'PARTIAL_SHIPPED', version: 5, items: [
      { id: 'i1', quantity: '5', shippedQuantity: '3', replenishmentGaps: [{ id: 'g1', remainingQuantity: '2', status: 'PENDING' }] },
    ], freightConfirmations: [
      { id: 'f1', amount: '8.50', status: 'CONFIRMED', usedAt: null, reason: '补发' },
      { id: 'f2', amount: '3.00', status: 'PENDING', usedAt: null },
      { id: 'f3', amount: '2.00', status: 'CONFIRMED', usedAt: 'used' },
    ] };
  });
  await supplier.loadOrder('o1'); assert.equal(supplier.data.freightChoices.length, 2);
  supplier.onGapQuantity({ currentTarget: { dataset: { id: 'i1', gapId: 'g1' } }, detail: { value: '2' } });
  supplier.selectFreight({ detail: { value: '1' } }); await supplier.shipOrder();
  assert.equal(payload.freight, '8.50'); assert.equal(payload.freightConfirmationId, 'f1');
  assert.equal(supplier.data.result, null);
  assert.deepEqual(plain(payload.items[0].gapAllocations), [{ gapId: 'g1', quantity: '2' }]);
  await supplier.loadOrder('o1'); supplier.onShipQuantity(input('i1', '1'));
  supplier.onGapQuantity({ currentTarget: { dataset: { id: 'i1', gapId: 'g1' } }, detail: { value: '2' } });
  await supplier.shipOrder(); assert.equal(previews, 1); assert.match(supplier.data.error, /超过/);
});

test('fully shipped supplier order exposes only the open gap as replenishment capacity', async () => {
  const supplier = page('supplier', async () => ({ id: 'o1', status: 'SHIPPED', items: [
    { id: 'i1', quantity: '3', shippedQuantity: '3', replenishmentGaps: [{ id: 'g1', remainingQuantity: '1', status: 'PENDING' }] },
  ] }));
  await supplier.loadOrder('o1');
  assert.equal(supplier.data.selectedOrder.canShip, true);
  assert.equal(supplier.data.shipmentItems[0].remainingQuantity, '1');
  assert.equal(supplier.data.shipmentItems[0].shipQuantity, '0');
});

test('supplier finds authorized replenishment even without notification history', async () => {
  const supplier = page('supplier', async path => {
    if (path === '/discrepancies') return [{ id: 'gap-discrepancy', status: 'REPLENISH_PENDING' }];
    if (path === '/notifications') return { notifications: [] };
    if (path === '/discrepancies/gap-discrepancy') return { id: 'gap-discrepancy', status: 'REPLENISH_PENDING', replenishmentGap: { remainingQuantity: '2' } };
    throw new Error(`Unexpected request ${path}`);
  });
  await supplier.loadDiscrepancies();
  assert.equal(supplier.data.differenceTasks.length, 1);
  assert.equal(supplier.data.differenceTasks[0].replenishmentGap.remainingQuantity, '2');
});

test('supplier replenishment action fills its order line using discrepancy item identity', async () => {
  const supplier = page('supplier', async path => {
    if (path === '/discrepancies/d') return { id: 'd', supplierOrderId: 'o', orderItemId: 'i', replenishmentGap: { id: 'g', remainingQuantity: '2', status: 'PENDING' } };
    if (path === '/supplier-orders/o') return { id: 'o', status: 'SHIPPED', items: [{ id: 'i', quantity: '3', shippedQuantity: '3', replenishmentGaps: [{ id: 'g', remainingQuantity: '2', status: 'PENDING' }] }] };
    throw new Error(`Unexpected request ${path}`);
  });
  await supplier.loadDiscrepancy('d');
  assert.equal(supplier.data.selectedDiscrepancy.canReplenish, true);
  await supplier.startReplenishment();
  assert.equal(supplier.data.activeView, 'orders');
  assert.equal(supplier.data.orderMode, 'ship');
  assert.equal(supplier.data.selectedOrder.canShip, true);
  assert.equal(supplier.data.shipmentItems[0].shipQuantity, '2');
  assert.equal(supplier.data.shipmentItems[0].gaps[0].allocationQuantity, '2');
});

test('supplier cannot decide store shortage handling and return preserves displayed version', async () => {
  let payload;
  const supplier = page('supplier', async (path, options) => {
    if (path.endsWith('/resolve')) { payload = options.data; return { id: 'd1', status: 'OPEN', missingQuantity: '1' }; }
    return { id: 'd1', status: 'OPEN', version: 8, missingQuantity: '1', productName: '商品' };
  });
  await supplier.loadDiscrepancy('d1'); await supplier.resolveDiscrepancy(tap('', { action: 'REPLENISH' }));
  assert.equal(payload, undefined);
  supplier.data.discrepancyReason = '请门店复核';
  await supplier.resolveDiscrepancy(tap('', { action: 'RETURN' }));
  assert.equal(payload.expectedVersion, 8); assert.equal(supplier.data.selectedDiscrepancy.productName, '商品');
  payload = null; await supplier.resolveDiscrepancy(tap('', { action: 'ACCEPT' })); assert.equal(payload, null);
});

test('store can choose replenish or settle shortage using the current discrepancy version', async () => {
  const calls = [];
  const store = page('store', async (path, options) => {
    calls.push({ path, options });
    if (path === '/discrepancies') return [{ id: 'd1', version: 4, status: 'OPEN', productName: '大米', missingQuantity: '2' }];
    return { id: 'd1', status: 'REPLENISH_PENDING' };
  }, {}, { showModal: options => options.success({ confirm: true }) });
  await store.loadDiscrepancies(false);
  store.resolveReceiptDiscrepancy(tap('d1', { action: 'REPLENISH' }));
  await new Promise(resolve => setTimeout(resolve, 0));
  const command = calls.find(call => call.path.endsWith('/resolve'));
  assert.deepEqual(plain(command.options.data), { expectedVersion: 4, action: 'REPLENISH' });
  assert.ok(command.options.header['idempotency-key']);
});

test('payment rejection requires actual reason and keeps displayed version', async () => {
  let payload;
  const supplier = page('supplier', async (path, options) => {
    if (path.endsWith('/reject')) { payload = options.data; return { id: 'p1', status: 'REJECTED', amount: '90.00' }; }
    if (path.includes('/supplier-statements') || path.includes('?')) return [];
    return { id: 'p1', status: 'PENDING', version: 4, evidenceFiles: [{ id: 'file1', filename: '凭证.pdf' }] };
  });
  await supplier.loadPayment('p1'); await supplier.handlePayment(tap('', { action: 'reject' })); assert.equal(payload, undefined);
  supplier.data.paymentReason = '金额不符'; await supplier.handlePayment(tap('', { action: 'reject' }));
  assert.deepEqual(plain(payload), { expectedVersion: 4, reason: '金额不符' });
  assert.equal(supplier.data.selectedPayment.evidenceFiles[0].id, 'file1');
  payload = null; await supplier.handlePayment(tap('', { action: 'confirm' })); assert.equal(payload, null);
});

test('purchaser reviews selected freight version and blocks repeated review', async () => {
  let payload;
  const purchaser = page('purchaser', async (path, options) => {
    if (path.endsWith('/confirm')) { payload = options.data; return { id: 'f1', status: 'CONFIRMED', amount: '8.50' }; }
    return [];
  });
  purchaser.data.freightConfirmations = [{ id: 'f1', status: 'PENDING', version: 3, amount: '8.50', supplierOrderNo: 'O1' }];
  purchaser.selectFreight(tap('f1')); await purchaser.reviewFreight(tap('', { action: 'confirm' }));
  assert.deepEqual(plain(payload), { expectedVersion: 3 }); assert.equal(purchaser.data.selectedFreight.supplierOrderNo, 'O1');
  payload = null; await purchaser.reviewFreight(tap('', { action: 'confirm' })); assert.equal(payload, null);
});

test('store without an active template clears stale goods and blocks new requests', async () => {
  let calls = 0;
  const store = page('store', async () => {
    calls += 1;
    const error = new Error('Store does not have an active template');
    error.code = 'STORE_TEMPLATE_NOT_FOUND';
    throw error;
  });
  store.setData({ storeId: 'store', catalogLoaded: true, products: [{ id: 'old', name: '旧商品' }],
    cart: [{ productId: 'old', quantity: '1' }], preview: { items: [] }, orderStep: 'confirm', cartOpen: true });
  await store.loadCatalog();
  assert.equal(store.data.templateMissing, true);
  assert.match(store.data.catalogError, /未配置有效订货模板/);
  assert.equal(store.data.products.length, 0);
  assert.equal(store.data.cartCount, 0);
  assert.equal(store.data.preview, null);
  assert.equal(store.data.orderStep, 'catalog');
  assert.equal(store.data.cartOpen, false);
  store.updateCart({ id: 'old' }, '1');
  assert.equal(store.data.cart.length, 0);
  await store.previewOrder();
  assert.equal(calls, 1);
  assert.match(store.data.error, /未配置有效订货模板/);
});

test('missing store template preserves an uncertain submission for reconciliation', async () => {
  const store = page('store', async () => { const error = new Error('missing'); error.code = 'STORE_TEMPLATE_NOT_FOUND'; throw error; });
  const pending = { key: 'existing-command', body: { storeId: 'store', items: [] } };
  store.setData({ storeId: 'store', pendingOrder: pending });
  await store.loadCatalog();
  assert.equal(store.data.pendingOrder, pending);
  assert.equal(store.data.orderStep, 'confirm');
});

test('evidence download authenticates and never opens unsuccessful responses', async () => {
  let opened = false;
  let code = 403;
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), {
    module, getApp: () => ({ globalData: { apiBase: 'http://localhost/api/v1' } }), wx: {
      getStorageSync: key => key === 'procurexToken' ? 'test-token' : '',
      downloadFile: options => { assert.equal(options.header.authorization, 'Bearer test-token'); options.success({ statusCode: code, tempFilePath: '/temp/evidence' }); },
      openDocument: options => { opened = true; assert.equal(options.fileType, 'pdf'); options.success(); },
    },
  });
  await assert.rejects(module.exports.previewEvidence({ id: 'file1', mimeType: 'application/pdf' }), /下载失败/); assert.equal(opened, false);
  code = 200; await module.exports.previewEvidence({ id: 'file1', mimeType: 'application/pdf' }); assert.equal(opened, true);
});
