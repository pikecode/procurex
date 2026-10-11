import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const password = process.env.LOCAL_TEST_PASSWORD;
assert.ok(password, 'LOCAL_TEST_PASSWORD required');
const project = resolve('apps/miniprogram');
const output = resolve('var/native-current-regression');
mkdirSync(output, { recursive: true });
const evidence = { generatedAt: new Date().toISOString(), runtime: 'WeChat Developer Tools', realDevice: false, steps: [], screenshots: [] };
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
const method = (name, event) => {
  const path = resolve(output, 'args.json');
  writeFileSync(path, JSON.stringify(event ? [event] : []));
  return tool('automation_page_action', { action: 'callMethod', method: name, 'args-file': path });
};
function wait(path, predicate) {
  for (let i = 0; i < 15; i++) { const value = data(path); if (predicate(value)) return value; }
  throw new Error(`Missing ${path}: ${data('error')}`);
}
try {
  tool('close_project_window'); tool('open_project_window');
  tool('simulator_open_page', { page: '/pages/login/index' });
  for (const [username, role] of [['test_chef_stored', 'store'], ['test_finance_stored', 'store'], ['test_supplier_stored', 'supplier'], ['test_purchase', 'purchaser'], ['test_hq_finance', 'finance']]) {
    tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
    tool('automation_element_action', { action: 'text', selector: '.primary', 'wait-for-selector': '.primary' });
    tool('automation_page_action', { action: 'setData', 'wait-for-selector': '.primary', patch: JSON.stringify({ username, password }) });
    tool('automation_element_action', { action: 'tap', selector: '.primary', 'wait-for-selector': '.primary' });
    let current;
    for (let i = 0; i < 15; i++) { current = tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path; if (current !== 'pages/login/index') break; }
    assert.notEqual(current, 'pages/login/index', `Login failed for ${username}: ${data('error')}`);
    tool('automation_navigate', { action: 'switchTab', url: `/pages/${role}/index` });
    wait('loading', value => value === false);
    assert.equal(data('error') || '', '', username);
    const navigation = tool('automation_evaluate', { 'fn-source': 'function() { var pages = getCurrentPages(); return pages[pages.length - 1].getTabBar().data; }' }).result.result;
    assert.equal(navigation.visible, false, `${username}: single-role navigation should be hidden`);
    assert.deepEqual(navigation.items.map(item => item.name), [role]);
    if (role === 'supplier') {
      method('openProfile'); wait('loading', value => value === false);
      method('changeView', { currentTarget: { dataset: { view: 'catalog' } } });
      const products = wait('visibleProducts', value => value?.length > 0);
      assert.ok(products.every(row => !('supplyPrice' in row) && typeof row.supplyEnabled === 'boolean'));
    }
    const name = `${username}.jpg`;
    tool('simulator_screenshot', { path: resolve(output, name) });
    evidence.steps.push({ username, status: 'PASSED', page: tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path });
    evidence.screenshots.push(name);
    console.log(`Native role passed: ${username}`);
  }
  evidence.status = 'PASSED';
} catch (error) { evidence.status = 'FAILED'; evidence.error = error.message; throw error; }
finally { writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(evidence, null, 2)); }
