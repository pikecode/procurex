import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const miniRoot = resolve(root, 'apps/miniprogram');

async function read(path) {
  return readFile(resolve(root, path), 'utf8');
}

async function exists(path) {
  const fileStats = await stat(resolve(root, path)).catch(() => null);
  return Boolean(fileStats?.isFile());
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(child));
    else files.push(child);
  }
  return files;
}

function checkSyntax(path) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, path)], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${path} failed syntax check:\n${result.stderr || result.stdout}`);
  }
}

function assertIncludes(source, expected, label) {
  assert.ok(source.includes(expected), `${label} is missing expected fragment: ${expected}`);
}

const appJson = JSON.parse(await read('apps/miniprogram/app.json'));
assert.equal(appJson.tabBar.custom, true, 'workspace navigation must use permission-filtered custom tabs');
assert.equal(JSON.parse(await read('apps/miniprogram/custom-tab-bar/index.json')).component, true);
for (const extension of ['js', 'json', 'wxml', 'wxss']) {
  assert.ok(await exists(`apps/miniprogram/custom-tab-bar/index.${extension}`));
}
checkSyntax('apps/miniprogram/custom-tab-bar/index.js');
const projectConfig = JSON.parse(await read('apps/miniprogram/project.config.json'));
const packageJson = JSON.parse(await read('package.json'));

assert.equal(projectConfig.compileType, 'miniprogram', 'project config must target WeChat mini-program');
assert.deepEqual(appJson.pages, [
  'pages/login/index',
  'pages/test-workbench/index',
  'pages/store/index',
  'pages/supplier/index',
  'pages/purchaser/index',
  'pages/profile/index',
  'pages/supplier-products/index',
  'pages/finance/index',
  'pages/region/index',
  'pages/finance-accounts/index',
], 'mini-program must expose login, store, supplier, and purchaser pages');

for (const page of appJson.pages) {
  for (const ext of ['json', 'wxml', 'wxss', 'js']) {
    assert.ok(await exists(`apps/miniprogram/${page}.${ext}`), `${page}.${ext} is missing`);
  }
  checkSyntax(`apps/miniprogram/${page}.js`);
}

for (const path of [
  'apps/miniprogram/app.js',
  'apps/miniprogram/utils/api.js',
  'apps/miniprogram/utils/quantity.js',
  'apps/miniprogram/utils/store-view.js',
  'apps/miniprogram/components/order-center/index.js',
  'scripts/check-miniprogram-flow.mjs',
  'scripts/test-miniprogram-pages.mjs',
  'scripts/capture-miniprogram-journey.mjs',
  'scripts/capture-store-ui-evidence.mjs',
  'scripts/capture-role-ui-evidence.mjs',
  'scripts/prepare-native-acceptance-products.mjs',
  'scripts/capture-product-media-evidence.mjs',
  'scripts/capture-role-recovery-evidence.mjs',
  'scripts/capture-supplier-bill-details-evidence.mjs',
  'scripts/capture-native-profile-prices.mjs',
]) {
  assert.ok(await exists(path), `${path} is missing`);
  checkSyntax(path);
}

assertIncludes(packageJson.scripts['mini:flow-check'], 'check-miniprogram-flow.mjs', 'mini-program flow check script');
assertIncludes(packageJson.scripts['mini:flow-check'], 'main-flow:seed-demo', 'mini-program flow check seed dependency');

const files = await walk(miniRoot);
const purchaserMarkup = await read('apps/miniprogram/pages/purchaser/index.wxml');
assert.ok(!purchaserMarkup.includes('openProducts') && !purchaserMarkup.includes('openPrices'), 'master data maintenance belongs to web administration');
for (const folder of ['pages/products', 'pages/prices']) {
  assert.ok(projectConfig.packOptions.ignore.some(item => item.type === 'folder' && item.value === folder), `${folder} must not be packaged`);
}
const profileSource = await read('apps/miniprogram/pages/profile/index.js');
assertIncludes(profileSource, 'user.scope', 'own profile scope');
const supplierProductsSource = await read('apps/miniprogram/pages/supplier-products/index.js');
assertIncludes(supplierProductsSource, '/managed-products', 'own supplier catalog');
assertIncludes(supplierProductsSource, 'supplyEnabled', 'supplier listing state');
assert.ok(!supplierProductsSource.includes('/prices/'), 'supplier catalog cannot manage prices');
assert.equal(files.filter((file) => file.endsWith('.html')).length, 0, 'mini-program surface must not use HTML pages');

const loginJs = await read('apps/miniprogram/pages/login/index.js');
const storeJs = await read('apps/miniprogram/pages/store/index.js');
const supplierJs = await read('apps/miniprogram/pages/supplier/index.js');
const purchaserJs = await read('apps/miniprogram/pages/purchaser/index.js');
const apiJs = await read('apps/miniprogram/utils/api.js');
const regionJs = await read('apps/miniprogram/pages/region/index.js');
const regionWxml = await read('apps/miniprogram/pages/region/index.wxml');
for (const role of ['REGION_MANAGER', 'REGION_FINANCE', 'PURCHASE_FOLLOWER']) assertIncludes(regionJs, role, 'assigned-store roles');
for (const endpoint of ['/stores', 'store-statements', 'direct-statements', '/reports/order-amounts', '/reports/product-quantities']) assertIncludes(regionJs, endpoint, 'assigned-store queries');
assertIncludes(regionJs, 'storeIds.includes', 'authorized store picker');
assertIncludes(regionJs, 'expectedVersion', 'follower decision version');
assertIncludes(regionWxml, 'canConfirm', 'read-only decision visibility');
assert.ok(!regionJs.includes('/reports/profit') && !regionJs.includes('/price-changes') && !regionJs.includes("api.request('/suppliers')"), 'assigned-store workspace must not request headquarters master data or profit');
const storeWxml = await read('apps/miniprogram/pages/store/index.wxml');
const supplierWxml = await read('apps/miniprogram/pages/supplier/index.wxml');
const purchaserWxml = await read('apps/miniprogram/pages/purchaser/index.wxml');

assertIncludes(apiJs, "client: 'MINIPROGRAM'", 'mini-program login client marker');
assertIncludes(apiJs, 'wx.request', 'mini-program API client');
assertIncludes(apiJs, 'timeout: options.timeout || 10000', 'mini-program API timeout');
assertIncludes(apiJs, '/health/live', 'mini-program API health check');
assertIncludes(apiJs, 'app.globalData.apiBase', 'mini-program configured API base');
assertIncludes(loginJs, 'api.checkHealth()', 'login API connectivity check');
assertIncludes(loginJs, '真机不能使用 127.0.0.1', 'login local device diagnostic');
assertIncludes(loginJs, 'api.workspaceNames(user)[0]', 'shared login workspace routing');
assertIncludes(loginJs, 'wx.switchTab({ url: `/pages/${workspace}/index` })', 'workspace tab routing');

assertIncludes(storeJs, '/purchase-requests/preview', 'store order preview');
assertIncludes(storeJs, '/purchase-requests', 'store order creation');
assertIncludes(storeJs, '/account', 'store account endpoint');
assertIncludes(storeJs, '/ledgers', 'store ledger endpoint');
assertIncludes(storeJs, '/notifications', 'store shipment notification list');
assertIncludes(storeJs, '/shipments/${this.data.shipmentId}', 'store shipment detail');
assertIncludes(storeJs, '/receipts', 'store receipt creation');
assertIncludes(storeJs, 'evidenceFileIds: this.data.receiptEvidence.map', 'receipt attachment IDs persist with the original command');
assertIncludes(storeJs, 'receiptUploadSequence', 'receipt upload account isolation');
assertIncludes(storeWxml, 'chooseReceiptEvidence', 'receipt image selection');
assertIncludes(storeWxml, 'retryReceiptEvidence', 'per-image upload retry');
assertIncludes(storeWxml, '!receiptEvidenceReady', 'receipt upload readiness gate');
assertIncludes(storeWxml, 'evidence-files files="{{selectedShipment.evidenceFiles}}"', 'authenticated receipt evidence component');
assertIncludes(await read('apps/miniprogram/components/evidence/index.js'), 'api.downloadEvidence(file)', 'authenticated thumbnails');
assertIncludes(storeJs, '/reports/order-amounts', 'store order amount report');
assertIncludes(storeJs, '/reports/product-quantities', 'store product quantity report');
assertIncludes(storeJs, 'expectedOrderVersion', 'store receipt order version guard');
assertIncludes(storeJs, 'expectedReceiptRevision', 'store receipt revision guard');
assertIncludes(storeWxml, '商品目录', 'store catalog screen');
assertIncludes(storeWxml, '账户余额', 'store account screen');
assertIncludes(storeWxml, '核对下货单', 'store checkout button');
assertIncludes(storeWxml, '提交下货单', 'store request submit button');
assertIncludes(storeWxml, '下货记录', 'store purchase request list');
assertIncludes(storeWxml, '<order-center', 'store formal order center');
assertIncludes(await read('apps/miniprogram/components/order-center/index.wxml'), '来源下货单', 'formal order source trace');
assertIncludes(storeWxml, '收货处理', 'store shipment notification screen');
assertIncludes(storeWxml, 'class="order-entry shipment-todo"', 'store shipment notification list');
assertIncludes(storeWxml, '确认收货', 'store full receipt action');
assertIncludes(storeWxml, '提交收货差异', 'store short receipt action');
assertIncludes(storeWxml, '本月统计', 'store statistics screen');
assertIncludes(storeWxml, 'bindtap="stepProduct"', 'store product quantity stepper');
assertIncludes(storeWxml, 'class="fulfillment-group"', 'store fulfillment timeline');
assertIncludes(storeWxml, 'preview.funding.stored.shortfall', 'store shortfall display');
assertIncludes(storeWxml, 'canWrite', 'store read-only role guards');
assertIncludes(storeJs, 'pendingOrder', 'store unknown-result submission protection');

assertIncludes(supplierJs, '/supplier-orders', 'supplier order list');
assertIncludes(supplierJs, '/shipment-preview', 'supplier shipment preview');
assertIncludes(supplierJs, '/shipments', 'supplier shipment creation');
assertIncludes(supplierJs, '/reject', 'supplier rejection action');
assertIncludes(supplierJs, '/notifications', 'supplier discrepancy notification list');
assertIncludes(supplierJs, '/discrepancies/${this.data.discrepancyId}', 'supplier discrepancy detail');
assertIncludes(supplierJs, '/resolve', 'supplier discrepancy resolution');
assertIncludes(supplierJs, '/supplier-statements', 'supplier statement list');
assertIncludes(supplierJs, '/payment-records?direction=COMPANY_TO_SUPPLIER', 'supplier payment record list');
assertIncludes(supplierJs, '/payment-records/${this.data.paymentId}', 'supplier payment detail');
assertIncludes(supplierJs, '/${action}', 'supplier payment confirm reject action');
assertIncludes(supplierJs, '/reports/order-amounts', 'supplier order amount report');
assertIncludes(supplierJs, '/reports/product-quantities', 'supplier product quantity report');
assertIncludes(supplierJs, 'orderItemId', 'supplier shipment item binding');
assertIncludes(supplierJs, 'expectedVersion', 'supplier version guard');
assertIncludes(supplierWxml, '发货', 'supplier shipment screen');
assertIncludes(supplierWxml, '拒单', 'supplier rejection screen');
assertIncludes(supplierWxml, '退回门店核对', 'supplier discrepancy return action');
assertIncludes(supplierWxml, '等待门店确认处理方式', 'supplier waits for the store disposition');
assert.ok(!supplierWxml.includes('data-action="ACCEPT"') && !supplierWxml.includes('data-action="REPLENISH"'), 'supplier cannot decide the store shortage disposition');
assertIncludes(supplierWxml, '供应商账单', 'supplier statement screen');
assertIncludes(supplierJs, 'openStatementSource', 'supplier statement source navigation');
assertIncludes(supplierJs, 'statementRequestSequence', 'same-statement stale response protection');
assertIncludes(supplierWxml, 'statement-payment-source', 'supplier bill payment source');
assertIncludes(supplierWxml, 'statement-adjustment-source', 'supplier bill adjustment source');
assertIncludes(supplierWxml, '收款核对', 'supplier payment confirmation screen');
assertIncludes(supplierWxml, '确认收款', 'supplier payment confirm action');
assertIncludes(supplierWxml, '驳回付款', 'supplier payment reject action');
assertIncludes(supplierWxml, '统计概览', 'supplier statistics screen');
assert.ok(!supplierJs.includes('/reports/profit') && !supplierWxml.includes('reports.profit'), 'supplier must not request or render company profit');
for (const [name, markup, source] of [['supplier', supplierWxml, supplierJs], ['purchaser', purchaserWxml, purchaserJs]]) {
  assertIncludes(markup, 'business-nav', `${name} business navigation`);
  assertIncludes(markup, 'backToList', `${name} detail return path`);
  assertIncludes(markup, 'onSearch', `${name} searchable orders`);
  assertIncludes(source, name === 'purchaser' ? "view.reportPreset('month')" : 'view.monthRange()', `${name} current month reports`);
  assert.ok(!markup.includes('class="hero"'), `${name} operational screen must not use a hero`);
}

assertIncludes(purchaserJs, '/purchase-requests', 'purchaser request list');
assertIncludes(purchaserJs, '/purchase-requests/rejection-todos', 'purchaser authoritative rejection list');
assertIncludes(purchaserJs, '/purchase-requests/${id}', 'purchaser request detail');
assertIncludes(purchaserJs, '/confirm', 'purchaser confirmation');
assertIncludes(purchaserJs, '/reallocate', 'purchaser reallocation');
assertIncludes(purchaserJs, 'expectedVersion', 'purchaser version guard');
assertIncludes(purchaserJs, 'rejectedOrderId', 'purchaser rejection reallocation guard');
assertIncludes(purchaserJs, 'reallocateReason', 'purchaser rejection reallocation reason');
assertIncludes(purchaserJs, 'rejectionHandled', 'purchaser handled rejection guard');
assertIncludes(purchaserJs, '/reports/order-amounts', 'purchaser order amount report');
assertIncludes(purchaserJs, '/reports/product-quantities', 'purchaser product quantity report');
assert.ok(!purchaserJs.includes('/reports/profit'), 'procurement mini-program must not request profit reports');
assertIncludes(purchaserWxml, '确认并生成订单', 'purchaser confirmation screen');
assertIncludes(purchaserWxml, 'changeEditSupplier', 'purchaser execution-adjustment supplier assignment');
assert.ok(!purchaserWxml.includes('bindchange="changeItemSupplier"'), 'original request detail must remain read-only');
assertIncludes(purchaserWxml, '重试', 'purchaser request detail failure recovery');
assert.ok(!purchaserWxml.includes('刷新明细'), 'purchaser detail must not expose redundant refresh action');
assertIncludes(purchaserWxml, '下货单确认', 'purchaser request detail screen');
assertIncludes(purchaserWxml, '待补资金', 'purchaser shortfall signal');
assertIncludes(purchaserWxml, '拒单通知', 'purchaser rejection notification screen');
assertIncludes(purchaserWxml, '改派原因', 'purchaser reallocation reason screen');
assertIncludes(purchaserWxml, '确认改派', 'purchaser reallocation screen');
assertIncludes(purchaserWxml, '统计概览', 'purchaser statistics screen');
assert.ok(!purchaserWxml.includes('毛利') && !purchaserWxml.includes('reports.profit'), 'procurement mini-program must not render profit analysis');

const miniFlowCheck = await read('scripts/check-miniprogram-flow.mjs');
for (const endpoint of [
  '/stores/${seed.storeId}/account',
  '/purchase-requests/preview',
  '/purchase-requests/${requestId}',
  '/supplier-orders/${supplierOrderId}/shipment-preview',
  '/shipments/${shipmentId}',
  '/discrepancies/${discrepancyId}/resolve',
  '/supplier-statements',
  '/payment-records?direction=COMPANY_TO_SUPPLIER',
  '/payment-records/${payment.id}/confirm',
  '/purchase-requests/${rejectionRequest.id}/reallocate',
  '/reports/order-amounts?${reportRange}',
  '/reports/product-quantities?${reportRange}',
  '/reports/profit?${reportRange}',
]) {
  assertIncludes(miniFlowCheck, endpoint, 'mini-program flow check endpoint coverage');
}
assertIncludes(miniFlowCheck, 'apps/miniprogram/mini-flow-check.json', 'mini-program flow evidence output');

console.log('Mini-program surface check passed.');
