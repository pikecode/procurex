import 'reflect-metadata';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { DatabaseService } from '../dist/apps/api/src/database/database.service.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';
import { PrivateStorage } from '../dist/apps/api/src/files/private-storage.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

assertLocalFixtureDatabase(process.env.DATABASE_URL);
assert.equal(process.env.FILE_STORAGE, 'local', 'This acceptance must not upload to production OSS');
const run = promisify(execFile), project = resolve('apps/miniprogram'), output = resolve('var/native-finance-evidence');
const prefix = `NATIVE_FINANCE_${Date.now()}`, evidence = { status: 'RUNNING', realDevice: false,
  imageSelection: 'Generated image uploaded through real API; camera/album selection not tested', steps: [] };
await mkdir(output, { recursive: true });
let app, db, backup, store, token, base;
async function tool(name, options = {}) {
  await new Promise(resolve => setTimeout(resolve, 1200));
  const args = ['-c', 'Codex', name, '--project', project];
  for (const [key, value] of Object.entries(options)) args.push(`--${key}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
  const { stdout } = await run('/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide', args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const body = JSON.parse(stdout.slice(stdout.indexOf('{')));
  assert.ok(body.ok && body.result?.success !== false, body.message || body.result?.error || name);
  return body.result;
}
const evaluate = source => tool('automation_evaluate', { 'fn-source': source });
const data = async path => (await tool('automation_page_action', { action: 'getData', 'data-path': path })).data;
const event = (id, extra = {}) => ({ currentTarget: { dataset: { id, ...extra } } });
async function method(name, arg) {
  const path = resolve(output, 'args.json'); await writeFile(path, JSON.stringify(arg ? [arg] : []));
  await tool('automation_page_action', { action: 'callMethod', method: name, 'args-file': path });
}
async function wait(path, predicate) {
  for (let i = 0; i < 20; i++) { const value = await data(path); if (predicate(value)) return value; }
  throw new Error(`Timed out ${path}: ${await data('error')}`);
}
async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { authorization: `Bearer ${token}`, ...options.headers } });
  const body = await response.json(); assert.ok(response.ok, `${path}: ${body.message || response.status}`); return body.data || body;
}
async function proof(purpose) {
  const bytes = await sharp({ create: { width: 320, height: 160, channels: 3, background: '#dcece6' } }).png().toBuffer();
  const file = await api('/files/upload-sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ purpose, filename: `${purpose}.png`, mimeType: 'image/png', sizeBytes: bytes.length }) });
  await api(`/files/${file.id}/content`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-upload-token': file.uploadToken }, body: bytes });
  await api(`/files/${file.id}/complete`, { method: 'POST' });
  return { id: file.id, filename: `${purpose}.png`, mimeType: 'image/png' };
}
async function step(name) {
  assert.equal(await data('error'), '', name);
  await tool('simulator_screenshot', { path: resolve(output, `${name}.jpg`) }); evidence.steps.push(name);
  console.log(`Native finance passed: ${name}`);
}
try {
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1'); db = app.get(DatabaseService).client;
  base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const role = await db.role.findUniqueOrThrow({ where: { code: 'HQ_FINANCE' } });
  await db.user.create({ data: { username: prefix, displayName: '总部财务验收', passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } } } });
  store = await db.store.create({ data: { code: prefix, name: '财务操作验收门店' } });
  const collection = await db.collectionAccount.create({ data: { name: prefix, bankName: '验收银行', accountName: '验收账户', accountNo: '1234567890' } });
  // Seed only the initial debt; all account changes below run through native page methods and real API commands.
  await db.storeAccount.create({ data: { storeId: store.id, creditLimit: '100.00', creditUsed: '20.00', creditCumulative: '20.00' } });
  const allocation = await db.fundingAllocation.create({ data: { storeId: store.id, method: 'CREDIT', targetAmount: '20.00', creditOutstanding: '20.00' } });
  const auth = await api('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: prefix, password: 'correct-password', client: 'MINIPROGRAM' }) }); token = auth.accessToken;
  const rechargeProof = await proof('RECHARGE'), clearingProof = await proof('CLEARING');
  await tool('compile_wxml', { 'file-path': 'pages/finance-accounts/index.wxml' });
  await tool('simulator_open_page', { page: '/pages/login/index' });
  await tool('automation_element_action', { action: 'text', selector: '.primary', 'wait-for-selector': '.primary' });
  await evaluate('function() { getApp().globalData.financeAcceptanceBackup = { apiBase: getApp().globalData.apiBase, token: wx.getStorageSync("procurexToken"), user: wx.getStorageSync("procurexUser"), last: wx.getStorageSync("procurexLastUsername") }; return true; }'); backup = true;
  await evaluate(`function() { getApp().globalData.apiBase = ${JSON.stringify(base)}; return true; }`);
  await tool('automation_page_action', { action: 'setData', patch: { username: prefix, password: 'correct-password' } });
  await tool('automation_element_action', { action: 'tap', selector: '.primary', 'wait-for-selector': '.primary' });
  await wait('user', user => user?.username === prefix); await wait('loading', value => value === false);
  await method('openAccounts'); await wait('loading', value => value === false);
  assert.equal((await tool('automation_runtime_info', { action: 'currentPage' })).currentPage.path, 'pages/finance-accounts/index');
  await method('openStore', event(store.id)); await wait('loading', value => value === false); await step('account-overview');
  await method('startAction', event('', { mode: 'credit' }));
  assert.equal(await data('mode'), 'credit', 'Credit form must be open before editing');
  await tool('automation_page_action', { action: 'setData', patch: { amount: '200.00', reason: '验收额度调整' } });
  await method('prepare'); assert.equal(await data('confirming'), true, await data('error')); await step('credit-confirmation');
  await method('submit'); await wait('submitting', value => value === false); assert.equal((await data('account')).creditLimit, '200.00');
  await method('startAction', event('', { mode: 'recharge' }));
  const collectionIndex = (await data('collectionAccounts')).findIndex(row => row.id === collection.id); assert.ok(collectionIndex >= 0);
  await tool('automation_page_action', { action: 'setData', patch: { amount: '50.00', collectionIndex, evidenceFiles: [rechargeProof], remark: '自动验收，不代表实际收款' } });
  await method('prepare'); assert.equal(await data('confirming'), true); await step('recharge-confirmation');
  await method('submit'); await wait('submitting', value => value === false); assert.equal((await data('account')).balance, '50.00');
  await method('startAction', event('', { mode: 'clearing' })); await method('selectAll');
  assert.deepEqual(await data('chosen'), [allocation.id]);
  await tool('automation_page_action', { action: 'setData', patch: { evidenceFiles: [clearingProof], remark: '自动验收销账' } });
  await method('prepare'); assert.equal((await data('preview')).totalAmount, '20.00'); await step('clearing-confirmation');
  await method('submit'); await wait('submitting', value => value === false);
  assert.equal((await data('account')).creditUsed, '0.00'); assert.equal((await data('account')).creditAvailable, '200.00');
  const history = await data('history'); assert.equal(history.length, 2); await step('account-history');
  for (const row of history) {
    await method('openDocument', event(row.id, { kind: row.kind })); await wait('loading', value => value === false);
    assert.equal((await data('document')).evidenceFiles.length, 1); assert.equal((await data('document')).operatorName, '总部财务验收');
    await step(`${row.kind}-document`); await method('closeDocument');
  }
  assert.equal(await db.rechargeDocument.count({ where: { storeId: store.id } }), 1);
  assert.equal(await db.clearingDocument.count({ where: { storeId: store.id } }), 1);
  evidence.status = 'PASSED';
} catch (error) { evidence.status = 'FAILED'; evidence.error = error.message; throw error; }
finally {
  try {
    if (backup) {
      await evaluate('function() { const state = getApp().globalData.financeAcceptanceBackup; getApp().globalData.apiBase = state.apiBase; for (const pair of [["procurexToken", state.token], ["procurexUser", state.user], ["procurexLastUsername", state.last]]) { if (pair[1]) wx.setStorageSync(pair[0], pair[1]); else wx.removeStorageSync(pair[0]); } delete getApp().globalData.financeAcceptanceBackup; return true; }');
      await tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
    }
  } finally {
    try {
    if (db) {
      const owner = { username: prefix }, own = { store: { code: prefix } };
      const files = await db.fileObject.findMany({ where: { owner } });
      for (const file of files) await new PrivateStorage().remove(file.objectKey);
      await db.fileObject.deleteMany({ where: { owner } });
      await db.auditLog.deleteMany({ where: { actor: owner } }); await db.commandRecord.deleteMany({ where: { actor: owner } });
      await db.creditMovement.deleteMany({ where: { account: own } }); await db.accountLedger.deleteMany({ where: { account: own } });
      await db.clearingItem.deleteMany({ where: { clearing: own } }); await db.clearingDocument.deleteMany({ where: own }); await db.rechargeDocument.deleteMany({ where: own });
      const storeIds = (await db.store.findMany({ where: { code: prefix }, select: { id: true } })).map(row => row.id);
      await db.fundingAllocation.deleteMany({ where: { storeId: { in: storeIds } } }); await db.storeAccount.deleteMany({ where: own });
      await db.store.deleteMany({ where: { code: prefix } }); await db.collectionAccount.deleteMany({ where: { name: prefix } }); await db.user.deleteMany({ where: { username: prefix } });
    }
    } catch (error) {
      evidence.status = 'FAILED'; evidence.cleanupError = error.message; throw error;
    } finally {
      await app?.close(); await writeFile(resolve(output, 'manifest.json'), JSON.stringify(evidence, null, 2));
    }
  }
}
console.log(JSON.stringify(evidence));
