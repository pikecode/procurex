import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const errorsOnly = process.argv.includes('--errors-only');
const output = resolve(errorsOnly ? 'var/native-entry-error-evidence' : 'var/native-entry-visual-evidence');
mkdirSync(output, { recursive: true });
const project = resolve('apps/miniprogram');
const base = process.env.PROCUREX_API_BASE || 'http://127.0.0.1:3114/api/v1';
assert.equal(new URL(base).hostname, '127.0.0.1');
const seed = JSON.parse(readFileSync('apps/web/main-flow-demo-seed.json', 'utf8'));
const evidence = { generatedAt: new Date().toISOString(), status: 'RUNNING', runtime: 'WeChat Developer Tools', realDevice: false,
  scope: 'Existing local data, authenticated reads only; no product save, price publication or business submission',
  simulatedStates: 'Loading/failure data injected for layout only, not real network failure acceptance', screenshots: [] };
function tool(name, options = {}) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  const args = ['-c', 'Codex', name, '--project', project];
  for (const [key, value] of Object.entries(options)) args.push(`--${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
  const path = `/tmp/procurex-native-entry-${process.pid}.json`;
  const fd = openSync(path, 'w', 0o600);
  let result, stdout;
  try {
    result = spawnSync(process.env.WECHATIDE_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide', args,
      { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', fd, 'pipe'] });
    stdout = readFileSync(path, 'utf8');
  } finally { closeSync(fd); unlinkSync(path); }
  const start = stdout.indexOf('{');
  assert.ok(start >= 0, `${name}: missing tool response`);
  const body = JSON.parse(stdout.slice(start));
  assert.ok(result.status === 0 && body.ok && body.result?.success !== false, `${name}: ${body.message || body.result?.error || result.error?.message || 'failed'}`);
  return body.result;
}
const data = path => tool('automation_page_action', { action: 'getData', dataPath: path }).data;
const patch = value => tool('automation_page_action', { action: 'setData', patch: JSON.stringify(value) });
const method = (name, event) => {
  const argsFile = resolve(output, 'method-args.json');
  writeFileSync(argsFile, JSON.stringify(event === undefined ? [] : [event]));
  return tool('automation_page_action', { action: 'callMethod', method: name, argsFile });
};
function wait(path, predicate) {
  for (let i = 0; i < 20; i++) { const value = data(path); if (predicate(value)) return value; }
  throw new Error(`Missing ${path}: ${data('error')}`);
}
function screenshot(name, scrollTop = 0) {
  tool('automation_viewport_action', { action: 'pageScrollTo', scrollTop });
  tool('simulator_screenshot', { path: resolve(output, `${name}.jpg`) });
  evidence.screenshots.push(`${name}.jpg`);
  console.log(`Native entry: ${name}`);
}
function login(username, workspace) {
  tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
  patch({ username, password: seed.password, apiBase: base });
  tool('automation_element_action', { action: 'tap', selector: '.primary', waitForSelector: '.primary' });
  let loggedIn = false;
  for (let i = 0; i < 20; i++) if (tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path !== 'pages/login/index') { loggedIn = true; break; }
  assert.ok(loggedIn, 'Native login must navigate away from login');
  if (tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path !== `pages/${workspace}/index`) {
    tool('automation_navigate', { action: 'switchTab', url: `/pages/${workspace}/index` });
  }
}
try {
  tool('close_project_window'); tool('open_project_window'); tool('simulator_open_page', { page: '/pages/login/index' });
  if (errorsOnly) {
    login(seed.supplierUsername, 'supplier'); method('openProfile'); wait('loading', value => value === false);
    patch({ profile: null, fields: [], loading: false, error: '网络连接失败，请稍后重试' });
    assert.match(tool('automation_element_action', { action: 'text', selector: '.error-banner', waitForSelector: '.error-banner' }), /网络连接失败/);
    screenshot('profile-error-simulated'); method('loadProfile'); wait('loading', value => value === false);
    login(seed.username, 'purchaser'); method('openProducts'); wait('loading', value => value === false);
    patch({ error: '网络连接失败，请稍后重试' }); screenshot('products-error-simulated');
    method('loadProducts'); wait('loading', value => value === false);
    tool('automation_navigate', { action: 'navigateBack', delta: 1 }); method('openPrices'); wait('loading', value => value === false);
    patch({ error: '价格读取失败，请重新加载' }); screenshot('prices-error-simulated'); patch({ error: '' });
  } else {
  for (const [role, username] of [['supplier', seed.supplierUsername], ['store', seed.storeUsername]]) {
    login(username, role); method('openProfile');
    wait('loading', value => value === false);
    const profile = wait('profile', value => Boolean(value?.id));
    assert.ok(data('fields').length > 0);
    screenshot(`${role}-profile`); screenshot(`${role}-profile-fields`, 500);
    if (role === 'supplier') {
      method('changeView', { currentTarget: { dataset: { view: 'catalog' } } });
      const products = wait('visibleProducts', value => value?.length > 0);
      assert.ok(products.every(product => product.salesPrice === undefined));
      screenshot('supplier-catalog');
      method('onSearch', { detail: { value: 'NO-MATCH-NATIVE-ENTRY' } });
      assert.equal(data('visibleProducts').length, 0); screenshot('supplier-catalog-empty');
    }
    patch({ activeView: 'profile', profile: null, fields: [], loading: true, error: '' });
    screenshot(`${role}-profile-loading-simulated`);
    patch({ loading: false, error: '网络连接失败，请稍后重试' });
    assert.match(tool('automation_element_action', { action: 'text', selector: '.error-banner', waitForSelector: '.error-banner' }), /网络连接失败/);
    screenshot(`${role}-profile-error-simulated`);
    method('loadProfile'); wait('loading', value => value === false);
    assert.equal(data('profile').id, profile.id);
  }
  login(seed.username, 'purchaser'); method('openProducts');
  wait('loading', value => value === false);
  const products = wait('products', value => value?.length > 0);
  screenshot('products-list');
  method('onSearch', { detail: { value: 'NO-MATCH-NATIVE-ENTRY' } });
  assert.equal(data('visibleProducts').length, 0); screenshot('products-empty');
  method('onSearch', { detail: { value: '' } });
  const chosen = products.find(product => product.imageFile) || products[0];
  method('selectProduct', { currentTarget: { dataset: { id: chosen.id } } });
  assert.equal(data('selectedId'), chosen.id);
  if (chosen.imageFile) {
    wait('imageUrl', value => typeof value === 'string' && value.length > 0);
    evidence.productImage = 'Existing authenticated private image loaded; screenshot still requires visual inspection';
  } else evidence.productImage = 'NOT_AVAILABLE: no imageFile on existing products; not an image rendering pass';
  screenshot('product-editor'); screenshot('product-editor-image', 600);
  method('closeEditor'); patch({ loading: true, error: '' }); screenshot('products-loading-simulated');
  patch({ loading: false, error: '网络连接失败，请稍后重试' }); screenshot('products-error-simulated');
  method('loadProducts'); wait('loading', value => value === false);
  tool('automation_navigate', { action: 'navigateBack', delta: 1 }); method('openPrices');
  wait('loading', value => value === false); assert.equal(data('allowed'), true);
  assert.ok(data('productChoices').length > 0);
  screenshot('prices-editor'); screenshot('prices-actions', 600);
  patch({ error: '价格读取失败，请重新加载' }); screenshot('prices-error-simulated');
  patch({ error: '' });
  }
  evidence.status = 'PASSED';
} catch (error) { evidence.status = 'FAILED'; evidence.error = error.message; process.exitCode = 1; }
finally {
  writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(evidence, null, 2) + '\n');
  if (evidence.status === 'FAILED') writeFileSync(resolve(output, `failed-${Date.now()}.json`), JSON.stringify(evidence, null, 2) + '\n');
}
