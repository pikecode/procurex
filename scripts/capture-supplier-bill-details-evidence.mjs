import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.env.PROCUREX_API_BASE || 'http://127.0.0.1:3112/api/v1';
assert.equal(new URL(base).hostname, '127.0.0.1');
const seed = JSON.parse(await readFile('apps/web/main-flow-demo-seed.json', 'utf8'));
const output = resolve('var/supplier-bill-details-evidence'); await mkdir(output, { recursive: true });
const evidence = { generatedAt: new Date().toISOString(), apiBase: base, status: 'RUNNING', realDevice: false,
  mutations: 'Read-only native bill/source navigation; no orders, payments or ledgers changed', screenshots: [], checks: [] };
function tool(name, options = {}) {
  const args = ['-c', 'Codex', name, '--project', resolve('apps/miniprogram')];
  for (const [key, value] of Object.entries(options)) args.push(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
  const result = spawnSync(process.env.WECHATIDE_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  const start = result.stdout?.indexOf('{') ?? -1; assert.ok(start >= 0, `${name}: no result`);
  const body = JSON.parse(result.stdout.slice(start));
  assert.ok(result.status === 0 && body.ok && body.result?.success !== false, `${name}: ${body.message || body.result?.error || 'failed'}`);
  return body.result;
}
const data = path => tool('automation_page_action', { action: 'getData', dataPath: path }).data;
function inspect(fnSource) { const result = tool('automation_evaluate', { fnSource }); return result.result?.result ?? result.result; }
function method(name, event) {
  const argsFile = resolve(output, 'method-args.json'); writeFileSync(argsFile, JSON.stringify(event ? [event] : []));
  return tool('automation_page_action', { action: 'callMethod', method: name, argsFile });
}
const event = (id, extra = {}) => ({ currentTarget: { dataset: { id, ...extra } } });
function wait(path, predicate) {
  for (let i = 0; i < 30; i++) { const value = data(path); if (predicate(value)) return value; }
  throw new Error(`Missing state: ${path}`);
}
function screenshot(name, scrollTop = 0) {
  tool('automation_viewport_action', { action: 'pageScrollTo', scrollTop });
  tool('simulator_screenshot', { path: resolve(output, `${name}.jpg`) });
  evidence.screenshots.push(`${name}.jpg`); console.log(`Supplier bill: ${name}`);
}
function summary() {
  return inspect('function() { const p=getCurrentPages(); const d=p[p.length-1].data, b=d.selectedStatement, l=b && b.lines[0]; return { id:b && b.id, parent:b && b.parentStatementId, goods:b && b.goodsAmount, payable:b && b.payableAmount, order:l && l.supplierOrderId, products:l && l.products, productGoods:l && l.productGoodsAmount, basis:l && l.productAmountBasis }; }');
}
try {
  tool('automation_runtime_info', { action: 'currentPage' });
  tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
  tool('automation_page_action', { action: 'setData', waitForSelector: '.primary', patch: JSON.stringify({ username: seed.supplierUsername, password: seed.password, apiBase: base }) });
  tool('automation_element_action', { action: 'tap', selector: '.primary', waitForSelector: '.primary' });
  for (let i = 0; i < 30; i++) if (tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path !== 'pages/login/index') break;
  tool('automation_navigate', { action: 'switchTab', url: '/pages/supplier/index' });
  const bills = wait('statements', value => value?.some(item => item.lineCount > 0));
  const parent = bills.find(item => item.cycle === 'MONTHLY' && item.lineCount > 0) || bills.find(item => item.lineCount > 0);
  method('changeView', event('', { view: 'reports' })); method('selectStatement', event(parent.id));
  const children = wait('statementStores', value => value?.some(item => item.storeId === seed.storeId && item.lineCount > 0));
  assert.ok(children.every(item => item.parentStatementId === parent.id));
  const child = children.find(item => item.storeId === seed.storeId && item.lineCount > 0);
  screenshot('supplier-total-store-bills');
  method('selectStoreStatement', event(child.id)); wait('statementId', value => value === child.id);
  const initial = summary(); assert.equal(initial.parent, parent.id); assert.equal(initial.goods, child.goodsAmount);
  assert.ok(initial.products.length); assert.equal(initial.basis, 'CURRENT_ORDER');
  screenshot('store-bill-summary');
  method('toggleStatementProducts', event(initial.order)); screenshot('store-bill-products', 420);
  method('openStatementSource', event(initial.order, { kind: 'order' }));
  wait('selectedOrder', value => value?.id === initial.order); screenshot('store-bill-source-order');
  method('backToList'); wait('statementId', value => value === child.id);
  assert.equal(summary().id, child.id); assert.equal(data('statementKind'), 'store');
  screenshot('returned-store-bill');
  method('backToList'); wait('statementId', value => value === parent.id);
  wait('statementStores', value => value?.some(item => item.id === child.id));
  assert.equal(data('statementKind'), 'total'); screenshot('returned-supplier-total');
  evidence.checks.push('Exact-parent child membership, product basis and source order, fresh child/total returns');
  evidence.status = 'PASSED'; evidence.child = { storeName: child.storeName, goodsAmount: child.goodsAmount, freightAmount: child.freightAmount, payableAmount: child.payableAmount };
  evidence.productCount = initial.products.length;
  evidence.viewport = inspect('function() { const info=wx.getWindowInfo(); return {width:info.windowWidth,height:info.windowHeight}; }');
} catch (error) { evidence.status = 'FAILED'; evidence.error = error.message; process.exitCode = 1; }
finally { await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(evidence, null, 2)}\n`); console.log(`Supplier bill evidence: ${evidence.status}`); }
