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
const projectConfig = JSON.parse(await read('apps/miniprogram/project.config.json'));

assert.equal(projectConfig.compileType, 'miniprogram', 'project config must target WeChat mini-program');
assert.deepEqual(appJson.pages, [
  'pages/login/index',
  'pages/store/index',
  'pages/supplier/index',
  'pages/purchaser/index',
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
]) {
  assert.ok(await exists(path), `${path} is missing`);
  checkSyntax(path);
}

const files = await walk(miniRoot);
assert.equal(files.filter((file) => file.endsWith('.html')).length, 0, 'mini-program surface must not use HTML pages');

const loginJs = await read('apps/miniprogram/pages/login/index.js');
const storeJs = await read('apps/miniprogram/pages/store/index.js');
const supplierJs = await read('apps/miniprogram/pages/supplier/index.js');
const purchaserJs = await read('apps/miniprogram/pages/purchaser/index.js');
const apiJs = await read('apps/miniprogram/utils/api.js');
const storeWxml = await read('apps/miniprogram/pages/store/index.wxml');
const supplierWxml = await read('apps/miniprogram/pages/supplier/index.wxml');
const purchaserWxml = await read('apps/miniprogram/pages/purchaser/index.wxml');

assertIncludes(apiJs, "client: 'MINIPROGRAM'", 'mini-program login client marker');
assertIncludes(apiJs, 'wx.request', 'mini-program API client');
assertIncludes(loginJs, "wx.switchTab({ url: '/pages/store/index' })", 'store role routing');
assertIncludes(loginJs, "wx.switchTab({ url: '/pages/supplier/index' })", 'supplier role routing');
assertIncludes(loginJs, "wx.switchTab({ url: '/pages/purchaser/index' })", 'purchaser role routing');

assertIncludes(storeJs, '/purchase-requests/preview', 'store order preview');
assertIncludes(storeJs, '/purchase-requests', 'store order creation');
assertIncludes(storeJs, '/notifications', 'store shipment notification list');
assertIncludes(storeJs, '/shipments/${this.data.shipmentId}', 'store shipment detail');
assertIncludes(storeJs, '/receipts', 'store receipt creation');
assertIncludes(storeJs, 'expectedOrderVersion', 'store receipt order version guard');
assertIncludes(storeJs, 'expectedReceiptRevision', 'store receipt revision guard');
assertIncludes(storeWxml, '快速订货', 'store order screen');
assertIncludes(storeWxml, '预览金额', 'store order preview button');
assertIncludes(storeWxml, '提交订货', 'store order submit button');
assertIncludes(storeWxml, '订单进度', 'store order progress screen');
assertIncludes(storeWxml, '待收货通知', 'store shipment notification screen');
assertIncludes(storeWxml, '确认收货', 'store full receipt action');
assertIncludes(storeWxml, '提交收货差异', 'store short receipt action');

assertIncludes(supplierJs, '/supplier-orders', 'supplier order list');
assertIncludes(supplierJs, '/shipment-preview', 'supplier shipment preview');
assertIncludes(supplierJs, '/shipments', 'supplier shipment creation');
assertIncludes(supplierJs, '/reject', 'supplier rejection action');
assertIncludes(supplierJs, '/notifications', 'supplier discrepancy notification list');
assertIncludes(supplierJs, '/discrepancies/${this.data.discrepancyId}', 'supplier discrepancy detail');
assertIncludes(supplierJs, '/resolve', 'supplier discrepancy resolution');
assertIncludes(supplierJs, 'orderItemId', 'supplier shipment item binding');
assertIncludes(supplierJs, 'expectedVersion', 'supplier version guard');
assertIncludes(supplierWxml, '发货', 'supplier shipment screen');
assertIncludes(supplierWxml, '拒单', 'supplier rejection screen');
assertIncludes(supplierWxml, '同意少收', 'supplier discrepancy accept action');
assertIncludes(supplierWxml, '安排补发', 'supplier discrepancy replenish action');
assertIncludes(supplierWxml, '退回核对', 'supplier discrepancy return action');

assertIncludes(purchaserJs, '/purchase-requests', 'purchaser request list');
assertIncludes(purchaserJs, '/notifications', 'purchaser rejection notification list');
assertIncludes(purchaserJs, '/confirm', 'purchaser confirmation');
assertIncludes(purchaserJs, '/reallocate', 'purchaser reallocation');
assertIncludes(purchaserJs, 'expectedVersion', 'purchaser version guard');
assertIncludes(purchaserJs, 'rejectedOrderId', 'purchaser rejection reallocation guard');
assertIncludes(purchaserJs, 'SUPPLIER_ORDER_REJECTED', 'purchaser supplier rejection notification filter');
assertIncludes(purchaserWxml, '确认并推送', 'purchaser confirmation screen');
assertIncludes(purchaserWxml, '拒单通知', 'purchaser rejection notification screen');
assertIncludes(purchaserWxml, '改派供应商', 'purchaser reallocation screen');

console.log('Mini-program surface check passed.');
