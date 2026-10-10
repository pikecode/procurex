import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const project = resolve('apps/miniprogram');
const output = resolve(process.env.UI_CAPTURE_ROLE ? `var/five-role-ui-${process.env.UI_CAPTURE_ROLE}` : 'var/five-role-ui');
const password = process.env.LOCAL_TEST_PASSWORD;
assert.ok(password, 'LOCAL_TEST_PASSWORD is required');
mkdirSync(output, { recursive: true });
const manifest = { runtime: 'WeChat Developer Tools', realDevice: false, mutations: 'Login and read-only navigation only', screenshots: [], status: 'RUNNING' };
const cli = '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide';
function tool(name, options = {}) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  const args = ['-c', 'Codex', name, '--project', project];
  for (const [key, value] of Object.entries(options)) args.push('--' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), typeof value === 'object' ? JSON.stringify(value) : String(value));
  const result = spawnSync(cli, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  const start = result.stdout.indexOf('{');
  assert.ok(start >= 0, `${name}: missing result`);
  const body = JSON.parse(result.stdout.slice(start));
  assert.ok(result.status === 0 && body.ok && body.result?.success !== false, `${name}: ${body.message || body.result?.error || result.stderr}`);
  return body.result;
}
const data = path => tool('automation_page_action', { action: 'getData', dataPath: path }).data;
const tap = selector => tool('automation_element_action', { action: 'tap', selector, waitForSelector: selector });
function capture(name) {
  tool('simulator_screenshot', { path: resolve(output, name + '.jpg') });
  manifest.screenshots.push(name + '.jpg');
  console.log('Captured ' + name);
}
try {
  tool('open_project_window');
  for (const [role, username, expected] of [
    ['chef', 'test_store_1009', 'order'], ['store-finance', 'test_store_finance_1009', 'account'],
    ['purchaser', 'test_purchaser_1009', 'tasks'], ['supplier', 'test_supplier_1009', 'tasks'],
    ['finance', 'test_hq_finance_1009', 'tasks']
  ]) {
    if (process.env.UI_CAPTURE_ROLE && role !== process.env.UI_CAPTURE_ROLE) continue;
    tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
    tool('automation_page_action', { action: 'setData', patch: { username, password } });
    tap('.primary');
    let ready = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      if (data('user')?.username === username && data('loading') === false) { ready = true; break; }
    }
    assert.ok(ready, role + ': login/load timeout');
    assert.equal(data('activeView'), expected, role + ': wrong default screen');
    assert.equal(data('error'), '', role + ': page error');
    capture(role + '-home');
    const selector = role === 'finance' ? '[data-view="books"]' : '[data-view="orders"]';
    tap(selector);
    capture(role + '-records');
    const rows = role === 'supplier' ? data('visibleOrders') : role === 'purchaser' ? data('visibleRequests') : role === 'chef' || role === 'store-finance' ? data('filteredRequests') : [];
    if (rows?.length) {
      tap(`[data-id="${rows[0].id}"]`);
      const loadingKey = role === 'supplier' ? 'orderLoading' : role === 'purchaser' ? 'detailing' : 'requestLoading';
      for (let attempt = 0; attempt < 15 && data(loadingKey); attempt++) {}
      assert.equal(data('error'), '', role + ': detail error');
      capture(role + '-detail');
    }
  }
  manifest.status = 'PASSED';
} catch (error) { manifest.status = 'FAILED'; manifest.error = error.message; console.error(error.message); process.exitCode = 1; }
finally { writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'); }
