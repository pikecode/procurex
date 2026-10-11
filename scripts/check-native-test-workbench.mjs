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
process.env.NODE_ENV = 'development';
process.env.TEST_WORKBENCH_ENABLED = 'true';
process.env.TEST_WORKBENCH_USERNAMES = 'test_chef_stored,test_finance_stored,test_supplier_stored,test_purchase,test_hq_finance';
const run = promisify(execFile), project = resolve('apps/miniprogram'), output = resolve('var/native-test-workbench');
await mkdir(output, { recursive: true });
const evidence = { status: 'RUNNING', realDevice: false, businessApi: 'real local API/database', confirmation: 'showModal auto-confirmed only', checks: [] };
let app, db, user, backup = false;
async function tool(name, options = {}) {
  await new Promise(resolve => setTimeout(resolve, 800));
  const args = ['-c', 'Codex', name, '--project', project];
  for (const [key, value] of Object.entries(options)) args.push(`--${key}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
  const { stdout } = await run('/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide', args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const body = JSON.parse(stdout.slice(stdout.indexOf('{')));
  assert.ok(body.ok && body.result?.success !== false, body.message || body.result?.error || name);
  return body.result;
}
const evaluate = source => tool('automation_evaluate', { 'fn-source': source });
const data = async path => (await tool('automation_page_action', { action: 'getData', 'data-path': path })).data;
async function wait(path) {
  for (let i = 0; i < 15; i++) {
    if ((await tool('automation_runtime_info', { action: 'currentPage' })).currentPage.path === path && !(await data('loading'))) return;
  }
  throw new Error(`Page not ready: ${path}`);
}
try {
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1'); db = app.get(DatabaseService).client;
  const role = await db.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  user = await db.user.create({ data: { username: `native_workbench_${Date.now()}`, displayName: '测试工作台验收管理员', passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } } } });
  await tool('close_project_window'); await tool('open_project_window');
  await tool('simulator_open_page', { page: '/pages/login/index' });
  await evaluate('function(){ getApp().globalData.workbenchBackup={apiBase:getApp().globalData.apiBase, token:wx.getStorageSync("procurexToken"),user:wx.getStorageSync("procurexUser"),last:wx.getStorageSync("procurexLastUsername")};return true;}'); backup = true;
  await evaluate(`function(){getApp().globalData.apiBase=${JSON.stringify(`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`)};return true;}`);
  await tool('automation_page_action', { action: 'setData', patch: { username: user.username, password: 'correct-password' } });
  await tool('automation_element_action', { action: 'tap', selector: '.primary', 'wait-for-selector': '.primary' });
  await wait('pages/purchaser/index');
  await tool('automation_wx_api', { action: 'mock', method: 'showModal', result: { confirm: true, cancel: false } });
  for (const [username, page] of [['test_chef_stored','store'],['test_purchase','purchaser'],['test_supplier_stored','supplier'],['test_finance_stored','store'],['test_hq_finance','finance']]) {
    await tool('automation_navigate', { action: 'navigateTo', url: '/pages/test-workbench/index' });
    await wait('pages/test-workbench/index');
    assert.equal(await data('error'), '');
    const items = await data('items'), target = items.find(item => item.username === username);
    assert.ok(target, username);
    const argsFile = resolve(output, 'method-args.json');
    await writeFile(argsFile, JSON.stringify([{ currentTarget: { dataset: { id: target.id } } }]));
    await tool('automation_page_action', { action: 'callMethod', method: 'select', 'args-file': argsFile });
    await wait(`pages/${page}/index`);
    assert.equal(await data('error'), '', username);
    const state = (await evaluate('function(){const u=wx.getStorageSync("procurexUser");return {id:u.id,roles:u.roles,actor:u.actorUserId,test:u.testIdentity};}')).result.result;
    assert.equal(state.id, target.id); assert.equal(state.actor, user.id); assert.ok(!state.roles.includes('ADMIN'));
    await tool('simulator_screenshot', { path: resolve(output, `${username}.jpg`) });
    evidence.checks.push({ username, page, roles: state.roles });
  }
  await tool('automation_navigate', { action: 'navigateTo', url: '/pages/test-workbench/index' }); await wait('pages/test-workbench/index');
  await tool('simulator_screenshot', { path: resolve(output, 'identity-picker.jpg') });
  const argsFile = resolve(output, 'method-args.json'); await writeFile(argsFile, JSON.stringify([{ currentTarget: { dataset: {} } }]));
  await tool('automation_page_action', { action: 'callMethod', method: 'select', 'args-file': argsFile }); await wait('pages/purchaser/index');
  const root = (await evaluate('function(){const u=wx.getStorageSync("procurexUser");return {id:u.id,roles:u.roles,test:u.testIdentity||null};}')).result.result;
  assert.equal(root.id, user.id); assert.deepEqual(root.roles, ['ADMIN']); assert.equal(root.test, null);
  evidence.checks.push({ returnedToAdministrator: true }); evidence.status = 'PASSED';
} catch (error) { evidence.status = 'FAILED'; evidence.error = error.message; throw error; }
finally {
  try {
    await tool('automation_wx_api', { action: 'restore', method: 'showModal' });
    if (backup) await evaluate('function(){const s=getApp().globalData.workbenchBackup;if(!s){wx.removeStorageSync("procurexToken");wx.removeStorageSync("procurexUser");return false;}getApp().globalData.apiBase=s.apiBase;for(const [k,v] of [["procurexToken",s.token],["procurexUser",s.user],["procurexLastUsername",s.last]]){if(v)wx.setStorageSync(k,v);else wx.removeStorageSync(k);}delete getApp().globalData.workbenchBackup;return true;}');
    await tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
  } finally {
    if (user) await db.user.delete({ where: { id: user.id } });
    await app?.close(); await writeFile(resolve(output, 'manifest.json'), JSON.stringify(evidence, null, 2));
  }
}
console.log(JSON.stringify(evidence));
