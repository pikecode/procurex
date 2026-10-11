import 'reflect-metadata';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { DatabaseService } from '../dist/apps/api/src/database/database.service.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

assertLocalFixtureDatabase(process.env.DATABASE_URL);
const run = promisify(execFile), project = resolve('apps/miniprogram');
const output = resolve('var/native-assigned-stores'), prefix = `NATIVE_SCOPE_${Date.now()}`;
await mkdir(output, { recursive: true });
const evidence = { status: 'RUNNING', runtime: 'WeChat Developer Tools', realDevice: false, checks: [], screenshots: [] };
let app, db, previous;
async function tool(name, options = {}) {
  await new Promise(resolve => setTimeout(resolve, 1200));
  const args = ['-c', 'Codex', name, '--project', project];
  for (const [key, value] of Object.entries(options)) args.push(`--${key}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
  const { stdout } = await run('/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide', args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const body = JSON.parse(stdout.slice(stdout.indexOf('{')));
  assert.ok(body.ok && body.result?.success !== false, body.message || body.result?.error || `${name} failed`);
  return body.result;
}
const evaluate = source => tool('automation_evaluate', { 'fn-source': source });
const data = async path => (await tool('automation_page_action', { action: 'getData', 'data-path': path })).data;
async function method(name, event) {
  const argsFile = resolve(output, 'method-args.json');
  await writeFile(argsFile, JSON.stringify(event ? [event] : []));
  return tool('automation_page_action', { action: 'callMethod', method: name, 'args-file': argsFile });
}
async function wait(path, predicate) {
  for (let i = 0; i < 20; i++) {
    const value = await data(path);
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out: ${path}, error: ${await data('error')}`);
}
try {
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1'); db = app.get(DatabaseService).client;
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const stores = [];
  for (const name of ['A', 'B', 'C']) stores.push(await db.store.create({ data: { code: `${prefix}_${name}`, name: `角色验收门店${name}` } }));
  const template = await db.orderTemplate.create({ data: { code: prefix, name: '角色验收模板' } });
  for (const store of stores) await db.purchaseRequest.create({ data: { requestNo: `${prefix}_${store.id}`, storeId: store.id, templateId: template.id, status: 'PENDING_PROCUREMENT' } });
  await tool('compile_wxml', { 'file-path': 'pages/region/index.wxml' });
  await tool('simulator_open_page', { page: '/pages/login/index' });
  await tool('automation_element_action', { action: 'text', selector: '.primary', 'wait-for-selector': '.primary' });
  // Keep simulator state in memory only; never write tokens to evidence files.
  await evaluate('function() { getApp().globalData.assignedAcceptanceBackup = { apiBase: getApp().globalData.apiBase, token: wx.getStorageSync("procurexToken"), user: wx.getStorageSync("procurexUser"), last: wx.getStorageSync("procurexLastUsername") }; return true; }');
  previous = true;
  await evaluate(`function() { getApp().globalData.apiBase = ${JSON.stringify(base)}; return true; }`);
  for (const roleCode of ['REGION_MANAGER', 'REGION_FINANCE', 'PURCHASE_FOLLOWER']) {
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const username = `${prefix}_${roleCode}`;
    await db.user.create({ data: { username, displayName: `角色验收${role.name}`, passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } },
      scopes: { create: { scopeType: 'MULTI_STORE', stores: { create: stores.slice(0, 2).map(store => ({ storeId: store.id })) } } } } });
    await tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
    await tool('automation_element_action', { action: 'text', selector: '.primary', 'wait-for-selector': '.primary' });
    await tool('automation_page_action', { action: 'setData', patch: { username, password: 'correct-password' } });
    await tool('automation_element_action', { action: 'tap', selector: '.primary', 'wait-for-selector': '.primary' });
    for (let i = 0; i < 20; i++) {
      if ((await tool('automation_runtime_info', { action: 'currentPage' })).currentPage.path === 'pages/region/index') break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    assert.equal((await tool('automation_runtime_info', { action: 'currentPage' })).currentPage.path, 'pages/region/index');
    await wait('loading', value => value === false);
    assert.equal(await data('error'), '');
    assert.deepEqual((await data('stores')).map(store => store.id).sort(), stores.slice(0, 2).map(store => store.id).sort());
    assert.equal(await data('canConfirm'), roleCode === 'PURCHASE_FOLLOWER');
    for (const view of ['orders', 'books', 'reports', 'mine']) {
      await method('changeView', { currentTarget: { dataset: { view } } });
      await wait('loading', value => value === false);
      assert.equal(await data('error'), '', `${roleCode}/${view}`);
      if (view === 'orders') {
        const rows = await data('visibleRows'); assert.equal(rows.length, 2);
        await method('openRecord', { currentTarget: { dataset: { id: rows[0].id } } });
        await wait('detailing', value => value === false);
        assert.equal(await data('error'), ''); assert.ok(await data('selected'));
      }
      const filename = `${roleCode}-${view}.jpg`;
      await tool('simulator_screenshot', { path: resolve(output, filename) });
      evidence.screenshots.push(filename);
    }
    evidence.checks.push({ role: roleCode, authorizedStores: 2, excludedStore: stores[2].id, views: ['orders', 'books', 'reports', 'mine'], canConfirm: roleCode === 'PURCHASE_FOLLOWER' });
  }
  evidence.status = 'PASSED';
} catch (error) { evidence.status = 'FAILED'; evidence.error = error.message; throw error; }
finally {
  try {
    if (previous) {
      await evaluate('function() { const state = getApp().globalData.assignedAcceptanceBackup; getApp().globalData.apiBase = state.apiBase; for (const pair of [["procurexToken", state.token], ["procurexUser", state.user], ["procurexLastUsername", state.last]]) { if (pair[1]) wx.setStorageSync(pair[0], pair[1]); else wx.removeStorageSync(pair[0]); } delete getApp().globalData.assignedAcceptanceBackup; return true; }');
      await tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
    }
  } finally {
    if (db) {
      await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
      await db.purchaseRequest.deleteMany({ where: { requestNo: { startsWith: prefix } } });
      await db.orderTemplate.deleteMany({ where: { code: prefix } });
      await db.store.deleteMany({ where: { code: { startsWith: prefix } } });
    }
    await app?.close();
    await writeFile(resolve(output, 'manifest.json'), JSON.stringify(evidence, null, 2));
  }
}
console.log(JSON.stringify(evidence));
