import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, openSync, closeSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const project = resolve('apps/miniprogram');
const navigationOnly = process.argv.includes('--navigation-only');
const output = resolve(navigationOnly ? 'var/native-multirole-navigation-evidence' : 'var/role-ui-evidence');
const cli = process.env.WECHATIDE_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide';
const seed = JSON.parse(await readFile('apps/web/main-flow-demo-seed.json', 'utf8'));
const journey = JSON.parse(await readFile('var/miniprogram-extended-evidence/manifest.json', 'utf8'));
const base = process.env.PROCUREX_API_BASE || 'http://127.0.0.1:3114/api/v1';
assert.ok(base && journey.status === 'PASSED');
assert.equal(new URL(base).hostname, '127.0.0.1');
await mkdir(output, { recursive: true });
const evidence = { generatedAt: new Date().toISOString(), apiBase: base, status: 'RUNNING', realDevice: false,
  runtime: 'WeChat Developer Tools', mutations: 'UI-only: preview requests, no new orders/payments/receipts',
  stressCases: 'Search empty state; local seeded data, not production acceptance', screenshots: [] };

function tool(name, options = {}) {
  // WeChat skill calls are limited to 60/minute, including polling.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  const args = ['-c', 'Codex', name, '--project', project];
  for (const [key, value] of Object.entries(options)) args.push(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
  const responsePath = `/tmp/procurex-role-ui-${process.pid}.json`;
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
  console.log(`Role UI: ${name}`);
}

try {
  tool('close_project_window');
  tool('open_project_window');
  tool('simulator_open_page', { page: '/pages/login/index' });
  if (navigationOnly) evidence.viewport = tool('automation_evaluate', { fnSource: 'function() { const info=wx.getWindowInfo(); return {width:info.windowWidth,height:info.windowHeight,safeArea:info.safeArea}; }' });
  for (const role of navigationOnly ? ['store', 'supplier', 'purchaser'] : ['supplier', 'purchaser']) {
    if (tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path !== 'pages/login/index') {
      tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
    }
    tool('automation_element_action', { action: 'text', selector: '.primary', waitForSelector: '.primary' });
    patch({ username: !navigationOnly && role === 'supplier' ? seed.supplierUsername : seed.username, password: seed.password, apiBase: base });
    tap('.primary');
    for (let attempt = 0; attempt < 20; attempt++) {
      if (tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path !== 'pages/login/index') break;
    }
    const rolePath = 'pages/' + role + '/index';
    if (tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path !== rolePath) {
      tool('automation_navigate', { action: 'switchTab', url: '/' + rolePath });
    }
    const field = role === 'store' ? 'products' : role === 'supplier' ? 'orders' : 'requests';
    const rows = navigationOnly ? [] : wait(field, value => value?.length);
    if (navigationOnly) {
      wait('loading', value => value === false);
      assert.equal(data('error'), '');
      tool('automation_evaluate', { fnSource: `function() { const user=wx.getStorageSync('procurexUser');
        if(!user || !['STORE','SUPPLIER','PURCHASER'].every(role=>user.roles.includes(role))) throw new Error('Multi-role account required');
        const pages=getCurrentPages(); if(pages[pages.length-1].route!==${JSON.stringify(rolePath)}) throw new Error('Wrong workspace'); return true; }` });
      evidence.scopeBindings = tool('automation_evaluate', { fnSource: 'function() { const user=wx.getStorageSync("procurexUser"); return {storeBound:!!user.scope?.storeId,supplierBound:!!user.scope?.supplierId}; }' });
      tool('automation_viewport_action', { action: 'pageScrollTo', scrollTop: 0 }); screenshot(role + '-navigation-top');
      tool('automation_viewport_action', { action: 'pageScrollTo', scrollTop: 10000 }); screenshot(role + '-navigation-bottom');
      evidence.multiRoleWorkspaces = [...(evidence.multiRoleWorkspaces || []), role];
      continue;
    }
    method('backToList'); view('orders'); screenshot(role + '-orders');
    method('onSearch', { detail: { value: 'NO-MATCH-UI-CASE' } });
    assert.equal(data(role === 'supplier' ? 'visibleOrders' : 'visibleRequests').length, 0);
    screenshot(role + '-search-empty');
    method('onSearch', { detail: { value: '' } });
    const chosen = rows.find(item => role === 'supplier' ? ['PUSHED', 'ACCEPTED', 'PARTIAL_SHIPPED'].includes(item.status) : item.status === 'PENDING_PROCUREMENT') || rows[0];
    method(role === 'supplier' ? 'selectOrder' : 'selectRequest', event(chosen.id));
    wait(role === 'supplier' ? 'selectedOrder' : 'selectedRequest', value => value?.id === chosen.id);
    if (role === 'supplier') {
      const destination = data('selectedOrder').destination;
      assert.ok(destination && typeof destination.name === 'string');
      evidence.destinationMetadata = 'Current scoped store data; missing contact/address remain explicit';
    }
    screenshot(role + '-detail');
    method('backToList');
    for (const section of role === 'supplier' ? ['differences', 'payments', 'reports'] : ['rejections', 'freight', 'reports']) {
      view(section); screenshot(role + '-' + section);
    }
    if (role === 'supplier') {
      const statements = wait('statements', value => value?.length);
      method('selectStatement', event(statements[0].id));
      const statement = wait('selectedStatement', value => value?.id === statements[0].id);
      assert.ok(Array.isArray(statement.lines) && statement.lines.length);
      screenshot('supplier-statement-detail');
      method('openStatementSource', event(statement.lines[0].supplierOrderId, { kind: 'order' }));
      wait('selectedOrder', value => value?.id === statement.lines[0].supplierOrderId);
      assert.equal(data('statementReturnId'), statement.id);
      screenshot('supplier-statement-order-source');
      method('backToList');
      wait('selectedStatement', value => value?.id === statement.id);
      wait('statementPaymentsLoading', value => value === false);
      const payments = data('statementPayments');
      if (payments.length) {
        method('openStatementSource', event(payments[0].id, { kind: 'payment' }));
        wait('selectedPayment', value => value?.id === payments[0].id);
        screenshot('supplier-statement-payment-source');
        method('backToList');
        wait('selectedStatement', value => value?.id === statement.id);
      }
      screenshot('supplier-statement-source-return');
      evidence.statementSources = { order: true, payment: payments.length > 0, returnRefresh: true,
        adjustment: 'Document identity and amount verified by database integration; no native capture claimed' };
      method('backToList');
    }
  }
  evidence.status = 'PASSED';
  if (navigationOnly) {
    evidence.visualAcceptance = 'CAPTURED_PENDING_REVIEW';
    evidence.stressCases = 'Existing multi-role account, three actual workspaces at current simulator viewport; no width mocking';
    evidence.scopeBoundary = 'Multi-role demo account has no own store/supplier binding; navigation layout only, not scoped business-data or ordering acceptance';
  }
} catch (error) {
  evidence.status = 'FAILED'; evidence.error = error.message; process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(evidence, null, 2) + '\n');
  if (evidence.status === 'FAILED') await writeFile(resolve(output, `failed-${Date.now()}.json`), JSON.stringify(evidence, null, 2) + '\n');
  console.log('Role UI evidence: ' + output);
}
