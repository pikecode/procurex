import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, openSync, closeSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const project = resolve('apps/miniprogram');
const stressOnly = process.argv.includes('--stress-only');
const output = resolve(stressOnly ? 'var/store-layout-stress-evidence' : 'var/store-ui-evidence');
const cli = process.env.WECHATIDE_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide';
const seed = JSON.parse(await readFile('apps/web/main-flow-demo-seed.json', 'utf8'));
const journey = JSON.parse(await readFile('var/miniprogram-extended-evidence/manifest.json', 'utf8'));
const base = process.env.PROCUREX_API_BASE || journey.fundingCheck?.apiBase;
assert.ok(base && journey.status === 'PASSED');
await mkdir(output, { recursive: true });
const evidence = { generatedAt: new Date().toISOString(), apiBase: base, status: 'RUNNING', realDevice: false,
  runtime: 'WeChat Developer Tools', mutations: 'UI-only: preview requests, no new orders/payments/receipts',
  stressCases: 'Synthetic long text and large amount; not production business evidence', screenshots: [] };

function tool(name, options = {}) {
  // WeChat skill calls are limited to 60/minute, including polling.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  const args = ['-c', 'Codex', name, '--project', project];
  for (const [key, value] of Object.entries(options)) args.push(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
  const responsePath = `/tmp/procurex-store-ui-${process.pid}.json`;
  const fd = openSync(responsePath, 'w', 0o600);
  let result;
  try {
    result = spawnSync(cli, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', fd, 'pipe'] });
    result.stdout = readFileSync(responsePath, 'utf8');
  } finally { closeSync(fd); unlinkSync(responsePath); }
  const start = result.stdout?.indexOf('{') ?? -1;
  if (start < 0) throw new Error(`${name}: no result`);
  const body = JSON.parse(result.stdout.slice(start));
  if (result.status !== 0 || !body.ok || body.result?.success === false) throw new Error(`${name}: ${body.message || body.result?.error || 'failed'}`);
  return body.result;
}
const data = path => tool('automation_page_action', { action: 'getData', dataPath: path }).data;
const tap = selector => tool('automation_element_action', { action: 'tap', selector, waitForSelector: selector });
const patch = value => tool('automation_page_action', { action: 'setData', patch: JSON.stringify(value) });
const method = (name, event) => {
  const argsFile = resolve(output, 'method-args.json');
  writeFileSync(argsFile, JSON.stringify(event ? [event] : []));
  return tool('automation_page_action', { action: 'callMethod', method: name, argsFile });
};
const event = (id, extra = {}) => ({ currentTarget: { dataset: { id, ...extra } } });
const view = name => method('changeView', event('', { view: name }));
function wait(path, predicate) { for (let index = 0; index < 30; index++) { const value = data(path); if (predicate(value)) return value; } throw new Error(`Missing state: ${path}`); }
function screenshot(name) {
  tool('simulator_screenshot', { path: resolve(output, `${name}.jpg`) });
  evidence.screenshots.push(`${name}.jpg`);
  console.log(`Store UI: ${name}`);
}

function captureStress(visible) {
  patch({ visibleProducts: [{ ...visible[0], name: '长名称排版测试：酒店客房清洁用品超长商品名称与包装说明', salesPrice: '999999999.99', displayPrice: '999999999.99' }] });
  wait('visibleProducts', value => value?.length === 1 && value[0].salesPrice === '999999999.99');
  assert.match(tool('automation_element_action', { action: 'text', selector: '.product-name', waitForSelector: '.product-name' }), /长名称排版测试/);
  assert.match(tool('automation_element_action', { action: 'text', selector: '.product-price', waitForSelector: '.product-price' }), /999999999\.99/);
  screenshot('long-text-large-money');
  method('refreshCatalogView');
}

try {
  tool('close_project_window');
  tool('open_project_window');
  tool('simulator_open_page', { page: '/pages/login/index' });
  tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
  patch({ username: seed.storeUsername, password: seed.password, apiBase: base });
  tap('.primary');
  wait('storeId', value => value === seed.storeId);
  const products = wait('products', value => value?.length);
  assert.ok(data('canWrite'));
  view('order'); method('backToCatalog');
  if (stressOnly) {
    captureStress(data('visibleProducts'));
  } else {
  screenshot('catalog');
  method('onSearch', { detail: { value: 'NO-MATCH-LOCAL-UI-CASE' } });
  assert.equal(data('visibleProducts').length, 0);
  screenshot('search-empty');
  method('onSearch', { detail: { value: '' } });
  tap('.step-add');
  assert.equal(data('cart').length, 1);
  assert.ok(Number(data('cart')[0].quantity) > 0);
  method('toggleCart'); screenshot('cart'); method('toggleCart');
  tap('.preview-order'); wait('preview', value => value?.items?.length === 1);
  screenshot('checkout');
  method('backToCatalog');
  const visible = data('visibleProducts');
  captureStress(visible);
  patch({ canWrite: false });
  screenshot('read-only-catalog');
  patch({ canWrite: true });
  view('orders');
  method('filterOrders', { currentTarget: { dataset: { filter: 'completed' } } });
  assert.ok(data('filteredRequests').some(order => order.id === journey.requestId));
  screenshot('completed-orders');
  method('selectRequest', event(journey.requestId));
  wait('selectedRequest', value => value?.id === journey.requestId);
  screenshot('order-detail');
  tool('automation_viewport_action', { action: 'pageScrollTo', scrollTop: 10000 });
  screenshot('fulfillment-timeline');
  method('selectShipment', event(journey.replenishmentShipmentId));
  wait('selectedShipment', value => value?.id === journey.replenishmentShipmentId);
  assert.equal(data('receiptCanSubmit'), false);
  tool('automation_viewport_action', { action: 'pageScrollTo', scrollTop: 0 });
  screenshot('completed-receipt');
  assert.ok(data('selectedShipment').evidenceFiles.length > 0);
  tool('automation_viewport_action', { action: 'pageScrollTo', scrollTop: 10000 });
  screenshot('completed-receipt-evidence');
  tool('automation_viewport_action', { action: 'pageScrollTo', scrollTop: 0 });
  view('account'); screenshot('account');
  view('mine'); screenshot('profile');
  const viewportResult = tool('automation_evaluate', { fnSource: 'function() { const info = wx.getWindowInfo(); return { width: info.windowWidth, height: info.windowHeight, safeArea: info.safeArea }; }' }).result;
  evidence.viewport = viewportResult.result || viewportResult;
  patch({ cart: [], preview: null, previewGroups: [], selectedRequest: null, selectedShipment: null, receiptItems: [], orderStep: 'catalog' });
  method('refreshCatalogView'); view('order');
  method('selectShipment', event(journey.replenishmentShipmentId));
  const receipt = wait('selectedShipment', value => value?.id === journey.replenishmentShipmentId);
  method('previewReceiptEvidence', event(receipt.evidenceFiles[0].id));
  screenshot('authenticated-receipt-evidence');
  evidence.receiptEvidence = 'READY file bound to actual native receipt; authorized preview of local fixture, not camera/album or real-device acceptance';
  }
  evidence.status = 'PASSED';
} catch (error) {
  evidence.status = 'FAILED'; evidence.error = error.message; process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Store UI evidence: ${output}`);
}
