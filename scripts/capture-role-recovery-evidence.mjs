import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';

const base = process.env.PROCUREX_API_BASE || 'http://127.0.0.1:3112/api/v1';
const connectionString = process.env.DATABASE_URL || 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
assert.equal(new URL(base).hostname, '127.0.0.1');
assert.ok(['localhost', '127.0.0.1'].includes(new URL(connectionString).hostname));
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const seed = JSON.parse(await readFile('apps/web/main-flow-demo-seed.json', 'utf8'));
const output = resolve('var/role-recovery-evidence'); await mkdir(output, { recursive: true });
const reason = `PXRECOVERY-UI-${Date.now()}`;
const evidence = { generatedAt: new Date().toISOString(), status: 'RUNNING', apiBase: base, realDevice: false,
  scenario: 'Injected client response loss after actual HTTP commit, then same-key replay', screenshots: [], checks: [] };
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
const evaluate = fnSource => tool('automation_evaluate', { fnSource });
const patch = value => evaluate(`function() { const p=getCurrentPages(); p[p.length-1].setData(${JSON.stringify(value)}); return true; }`);
function method(name, event) {
  const argsFile = resolve(output, 'method-args.json'); writeFileSync(argsFile, JSON.stringify(event ? [event] : []));
  return tool('automation_page_action', { action: 'callMethod', method: name, argsFile });
}
function wait(path, predicate) {
  for (let i = 0; i < 30; i++) { const value = data(path); if (predicate(value)) return value; }
  throw new Error(`Missing state: ${path}`);
}
function screenshot(name) {
  tool('automation_viewport_action', { action: 'pageScrollTo', scrollTop: 0 });
  tool('simulator_screenshot', { path: resolve(output, `${name}.jpg`) });
  evidence.screenshots.push(`${name}.jpg`); console.log(`Recovery: ${name}`);
}
function login(username, workspace) {
  tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
  tool('automation_page_action', { action: 'setData', waitForSelector: '.primary', patch: JSON.stringify({ username, password: seed.password, apiBase: base }) });
  tool('automation_element_action', { action: 'tap', selector: '.primary', waitForSelector: '.primary' });
  for (let i = 0; i < 30; i++) if (tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path !== 'pages/login/index') break;
  tool('automation_navigate', { action: 'switchTab', url: `/pages/${workspace}/index` });
  const pending = data('pendingCommand'); assert.ok(!pending?.key, 'Never overwrite an existing recovery command');
}
function loseResponse(path) {
  evaluate(`function() { const app=getApp(); if(app.globalData.recoveryRequestOriginal) throw new Error('Already instrumented'); const original=wx.request;
    app.globalData.recoveryRequestOriginal=original;
    wx.request=function(options) { if(options.method==='POST' && options.url===${JSON.stringify(`${base}${path}`)}) {
      return original.call(wx,{...options,success:function(response) { wx.request=original; delete app.globalData.recoveryRequestOriginal;
        if(response.statusCode<200 || response.statusCode>=300) {options.success(response);return;} options.fail({errMsg:'Injected response loss after commit'}); }});
    } return original.call(wx,options); }; return true; }`);
}
try {
  const store = await db.store.findUniqueOrThrow({ where: { id: seed.storeId } }); assert.equal(store.code, 'PXFLOW-STORE');
  const order = await db.supplierOrder.findFirstOrThrow({ where: { storeId: seed.storeId, supplierId: seed.supplierId, status: { notIn: ['REJECTED', 'CANCELED'] } }, orderBy: { createdAt: 'desc' } });
  login(seed.supplierUsername, 'supplier');
  method('loadOrder', order.id); wait('selectedOrder', value => value?.id === order.id);
  patch({ freightRequestAmount: '0.01', freightRequestReason: reason });
  loseResponse(`/supplier-orders/${order.id}/freight-confirmations`); method('requestFreight');
  const supplierPending = wait('pendingCommand', value => value?.key);
  const freight = await db.freightConfirmation.findFirstOrThrow({ where: { reason, supplierOrderId: order.id } });
  assert.equal(freight.status, 'PENDING'); assert.equal(await db.freightConfirmation.count({ where: { reason } }), 1);
  screenshot('supplier-uncertain');
  tool('automation_navigate', { action: 'switchTab', url: '/pages/store/index' });
  tool('automation_navigate', { action: 'switchTab', url: '/pages/supplier/index' });
  assert.equal(wait('pendingCommand', value => value?.key).key, supplierPending.key);
  method('recoverCommand'); wait('commandHistory', value => value?.some(item => item.key === supplierPending.key && item.status === 'SUCCEEDED'));
  assert.equal(await db.freightConfirmation.count({ where: { reason } }), 1);
  method('changeView', { currentTarget: { dataset: { view: 'history' } } }); screenshot('supplier-recovered-history');
  evidence.checks.push('Supplier commit survived response loss/navigation; one freight row after replay');
  login(seed.username, 'purchaser'); wait('freightConfirmations', value => value?.some(item => item.id === freight.id));
  method('selectFreight', { currentTarget: { dataset: { id: freight.id } } });
  loseResponse(`/freight-confirmations/${freight.id}/confirm`);
  method('reviewFreight', { currentTarget: { dataset: { action: 'confirm' } } });
  const purchaserPending = wait('pendingCommand', value => value?.key);
  assert.equal((await db.freightConfirmation.findUniqueOrThrow({ where: { id: freight.id } })).status, 'CONFIRMED');
  screenshot('purchaser-uncertain');
  method('recoverCommand'); wait('commandHistory', value => value?.some(item => item.key === purchaserPending.key && item.status === 'SUCCEEDED'));
  const current = await db.freightConfirmation.findUniqueOrThrow({ where: { id: freight.id } });
  assert.equal(current.version, 2); assert.equal(current.usedAt, null);
  assert.equal(await db.commandRecord.count({ where: { resourceId: freight.id, status: 'SUCCEEDED' } }), 2);
  method('changeView', { currentTarget: { dataset: { view: 'history' } } }); screenshot('purchaser-recovered-history');
  evidence.checks.push('Purchaser review replay: version2, one confirmation, unused freight, exactly two successful commands');
  evidence.status = 'PASSED'; evidence.mutations = 'Temporary 0.01 freight request/review only; no shipment/payment/ledger mutation';
} catch (error) { evidence.status = 'FAILED'; evidence.error = error.message; process.exitCode = 1; }
finally {
  try { evaluate('function() { const app=getApp(); if(app.globalData.recoveryRequestOriginal) {wx.request=app.globalData.recoveryRequestOriginal;delete app.globalData.recoveryRequestOriginal;} return true; }'); } catch {}
  const files = await db.freightConfirmation.findMany({ where: { reason } });
  const ids = files.map(item => item.id);
  if (ids.length) {
    assert.ok(files.every(item => !item.usedAt));
    await db.auditLog.deleteMany({ where: { entityType: 'FreightConfirmation', entityId: { in: ids } } });
    await db.commandRecord.deleteMany({ where: { resourceId: { in: ids } } });
    await db.freightConfirmation.deleteMany({ where: { id: { in: ids } } });
  }
  await db.$disconnect();
  await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Recovery evidence: ${evidence.status}`);
}
