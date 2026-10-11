import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseService } from '../dist/apps/api/src/database/database.service.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

assertLocalFixtureDatabase(process.env.DATABASE_URL);
const database = new DatabaseService(), db = database.client;
const username = `NATIVE_ADMIN_${Date.now()}`, password = randomUUID();
const output = resolve('var/native-admin-evidence');
mkdirSync(output, { recursive: true });
const evidence = { status: 'RUNNING', role: 'ADMIN', realDevice: false, generatedAt: new Date().toISOString() };
function tool(name, options = {}) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  const args = ['-c', 'Codex', name, '--project', resolve('apps/miniprogram')];
  for (const [key, value] of Object.entries(options)) args.push(`--${key}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
  const result = spawnSync('/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide', args, { encoding: 'utf8', timeout: 30000 });
  const body = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  assert.ok(result.status === 0 && body.ok && body.result?.success !== false, `${name} failed`);
  return body.result;
}
let created = false;
try {
  const role = await db.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  await db.user.create({ data: { username, displayName: '管理员登录验收', passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } } } });
  created = true;
  tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
  tool('automation_page_action', { action: 'setData', 'wait-for-selector': '.primary', patch: { username, password } });
  tool('automation_element_action', { action: 'tap', selector: '.primary', 'wait-for-selector': '.primary' });
  for (let attempt = 0; attempt < 15; attempt++) {
    if (tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path === 'pages/purchaser/index') break;
  }
  assert.equal(tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path, 'pages/purchaser/index');
  const user = tool('automation_page_action', { action: 'getData', 'data-path': 'user' }).data;
  assert.equal(user.username, username); assert.ok(user.roles.includes('ADMIN'));
  assert.equal(tool('automation_page_action', { action: 'getData', 'data-path': 'error' }).data || '', '');
  const navigation = () => tool('automation_evaluate', { 'fn-source': 'function() { var pages = getCurrentPages(); var bar = pages[pages.length - 1].getTabBar(); return bar ? bar.data : null; }' }).result.result;
  const initial = navigation();
  evidence.navigation = initial;
  assert.deepEqual(initial.items.map(item => item.name), ['purchaser', 'finance']);
  assert.equal(initial.selected, 'purchaser');
  assert.equal(initial.visible, true);
  tool('simulator_screenshot', { path: `${output}/admin-workspace.jpg` });
  const switchWorkspace = name => tool('automation_evaluate', { 'fn-source': `function() { var pages = getCurrentPages(); pages[pages.length - 1].getTabBar().switchWorkspace({ currentTarget: { dataset: { name: ${JSON.stringify(name)} } } }); return true; }` });
  switchWorkspace('finance');
  assert.equal(tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path, 'pages/finance/index');
  assert.equal(navigation().selected, 'finance');
  tool('simulator_screenshot', { path: `${output}/admin-finance-navigation.jpg` });
  switchWorkspace('purchaser');
  assert.equal(tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path, 'pages/purchaser/index');
  evidence.status = 'PASSED';
  console.log('Native ADMIN real login and permission-filtered navigation passed');
} catch (error) { evidence.status = 'FAILED'; evidence.error = error.message; throw error; }
finally {
  try {
    tool('automation_evaluate', { 'fn-source': 'function() { wx.removeStorageSync("procurexToken"); wx.removeStorageSync("procurexUser"); return true; }' });
    tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
    if (created) await db.user.delete({ where: { username } });
    evidence.cleanup = 'PASSED';
  } finally {
    await database.onApplicationShutdown();
    writeFileSync(`${output}/manifest.json`, JSON.stringify(evidence, null, 2));
  }
}
