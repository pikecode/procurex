import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync, openSync, closeSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

const base = process.env.PROCUREX_API_BASE || 'http://127.0.0.1:3114/api/v1';
const connectionString = process.env.DATABASE_URL || 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
assert.equal(new URL(base).hostname, '127.0.0.1');
assertLocalFixtureDatabase(connectionString);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const pricesOnly = process.argv.includes('--prices-only');
const output = resolve(pricesOnly ? 'var/native-price-recovery-evidence' : 'var/native-profile-price-evidence'); await mkdir(output, { recursive: true });
const prefix = `PXNATIVE${Date.now()}`, password = randomBytes(20).toString('hex');
const withoutScreenshots = process.argv.includes('--without-screenshots');
const evidence = { generatedAt: new Date().toISOString(), fixturePrefix: prefix, apiBase: base, status: 'RUNNING', realDevice: false,
  runtime: 'WeChat Developer Tools', visualAcceptance: withoutScreenshots ? 'NOT_VERIFIED' : 'RUNNING',
  scope: 'Isolated real API company-term fixtures, native own-profile/catalog and price preview/publication/recovery/run; no bank or all-mode funding acceptance', checks: [], screenshots: [] };
const users = [];
let token = '';
async function cleanup(fixturePrefix) {
  assert.match(fixturePrefix, /^PXNATIVE\d+$/);
  const ownedUsers = await db.user.findMany({ where: { username: { startsWith: fixturePrefix } }, select: { id: true } });
  const ids = ownedUsers.map(user => user.id);
  const productIds = (await db.product.findMany({ where: { sku: fixturePrefix }, select: { id: true } })).map(product => product.id);
  await db.commandRecord.deleteMany({ where: { actorUserId: { in: ids } } });
  await db.priceChangeRun.deleteMany({ where: { versions: { some: { priceVersion: { scope: { productId: { in: productIds } } } } } } });
  await db.supplierOrder.deleteMany({ where: { store: { code: fixturePrefix } } });
  await db.purchaseRequest.deleteMany({ where: { store: { code: fixturePrefix } } });
  await db.priceScope.deleteMany({ where: { productId: { in: productIds } } });
  await db.storeTemplateBinding.deleteMany({ where: { template: { code: fixturePrefix } } });
  await db.orderTemplate.deleteMany({ where: { code: fixturePrefix } });
  await db.userScope.deleteMany({ where: { userId: { in: ids } } });
  await db.supplierProduct.deleteMany({ where: { supplier: { code: fixturePrefix } } });
  await db.product.deleteMany({ where: { sku: fixturePrefix } });
  await db.storeAccount.deleteMany({ where: { store: { code: fixturePrefix } } }); await db.store.deleteMany({ where: { code: fixturePrefix } });
  await db.supplier.deleteMany({ where: { code: fixturePrefix } }); await db.category.deleteMany({ where: { code: fixturePrefix } }); await db.unit.deleteMany({ where: { code: fixturePrefix } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  for (const [model, where] of [[db.user, { username: { startsWith: fixturePrefix } }],
    [db.product, { sku: fixturePrefix }], [db.store, { code: fixturePrefix }],
    [db.supplier, { code: fixturePrefix }], [db.orderTemplate, { code: fixturePrefix }]]) {
    assert.equal(await model.count({ where }), 0, 'Temporary fixture must be fully removed');
  }
}
const cleanupPrefix = process.argv.find(arg => arg.startsWith('--cleanup-prefix='))?.split('=')[1];
if (cleanupPrefix) {
  try { await cleanup(cleanupPrefix); console.log(`Isolated fixture cleanup passed: ${cleanupPrefix}`); }
  finally { await db.$disconnect(); }
  process.exit(0);
}
async function call(path, method = 'GET', body, auth = token, key) {
  const response = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json(); return { status: response.status, data: result.data, error: result };
}
async function ok(path, method = 'GET', body, key) {
  const result = await call(path, method, body, token, key);
  assert.ok(result.status >= 200 && result.status < 300, `${path}: ${result.status} ${JSON.stringify(result.error)}`); return result.data;
}
function tool(name, options = {}) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  const args = ['-c', 'Codex', name, '--project', resolve('apps/miniprogram')];
  for (const [key, value] of Object.entries(options)) args.push(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
  const responsePath = `/tmp/procurex-native-prices-${process.pid}.json`;
  const fd = openSync(responsePath, 'w', 0o600);
  let result;
  try {
    result = spawnSync(process.env.WECHATIDE_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide', args,
      { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', fd, 'pipe'] });
    result.stdout = readFileSync(responsePath, 'utf8');
  } finally { closeSync(fd); unlinkSync(responsePath); }
  const start = result.stdout?.indexOf('{') ?? -1; assert.ok(start >= 0, `${name}: no result`);
  const body = JSON.parse(result.stdout.slice(start));
  assert.ok(result.status === 0 && body.ok && body.result?.success !== false, `${name}: ${body.message || body.result?.error || 'failed'}`); return body.result;
}
const data = path => tool('automation_page_action', { action: 'getData', dataPath: path }).data;
const evaluate = fnSource => tool('automation_evaluate', { fnSource });
function method(name, event) {
  const argsFile = resolve(output, 'method-args.json'); writeFileSync(argsFile, JSON.stringify(event === undefined ? [] : [event]));
  return tool('automation_page_action', { action: 'callMethod', method: name, argsFile });
}
function wait(path, predicate) {
  for (let i = 0; i < 35; i++) { const value = data(path); if (predicate(value)) return value; }
  throw new Error(`Missing state: ${path}; ${JSON.stringify(data('error'))}`);
}
function screenshot(name, scrollTop = 0) {
  if (withoutScreenshots) { console.log(`Native state checked (no visual evidence): ${name}`); return; }
  tool('automation_viewport_action', { action: 'pageScrollTo', scrollTop });
  tool('simulator_screenshot', { path: resolve(output, `${name}.jpg`) }); evidence.screenshots.push(`${name}.jpg`); console.log(`Native profile/prices: ${name}`);
}
const navigate = url => tool('automation_navigate', { action: 'navigateTo', url });
function login(user, workspace) {
  if (tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path !== 'pages/login/index') {
    tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
  }
  tool('automation_page_action', { action: 'setData', waitForSelector: '.primary', patch: JSON.stringify({ username: user.username, password, apiBase: base }) });
  tool('automation_element_action', { action: 'tap', selector: '.primary', waitForSelector: '.primary' });
  for (let i = 0; i < 35; i++) if (tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path !== 'pages/login/index') break;
  if (tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path !== `pages/${workspace}/index`) {
    tool('automation_navigate', { action: 'switchTab', url: `/pages/${workspace}/index` });
  }
}
function select(name, index) { method(name, { detail: { value: String(index) } }); }
function input(field, value) { method('onInput', { currentTarget: { dataset: { field } }, detail: { value } }); }
function loseResponse(path = '/price-changes') {
  evaluate(`function() { const app=getApp(); if(app.globalData.nativePriceRequestOriginal) throw new Error('Already instrumented'); const original=wx.request;
    app.globalData.nativePriceRequestOriginal=original; wx.request=function(options) {
      if(options.method==='POST' && options.url===${JSON.stringify(`${base}${path}`)}) return original.call(wx,{...options,success:function(response) {
        wx.request=original;delete app.globalData.nativePriceRequestOriginal;
        if(response.statusCode<200 || response.statusCode>=300) {options.success(response);return;} options.fail({errMsg:'Injected response loss after actual publication'}); }});
      return original.call(wx,options); }; return true; }`);
}
async function makeUser(roleCode, scope) {
  const role = await db.role.upsert({ where: { code: roleCode }, update: {}, create: { code: roleCode, name: roleCode } });
  const user = await db.user.create({ data: { username: `${prefix}${roleCode}`, displayName: roleCode === 'SUPPLIER' ? '供货负责人' : roleCode === 'STORE' ? '门店负责人' : '采购负责人',
    passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } }, ...(scope ? { scopes: { create: scope } } : {}) } });
  users.push(user); return user;
}
try {
  tool('close_project_window'); tool('open_project_window'); tool('simulator_open_page', { page: '/pages/login/index' });
  const admin = await makeUser('ADMIN');
  token = (await call('/auth/login', 'POST', { username: admin.username, password, client: 'WEB' })).data.accessToken;
  const category = await db.category.create({ data: { code: prefix, name: '饮用水' } });
  const unit = await db.unit.create({ data: { code: prefix, name: '瓶' } });
  const product = await db.product.create({ data: { sku: prefix, name: '验收饮用水 · 500mL', specification: '500mL / 瓶', categoryId: category.id, baseUnitId: unit.id, defaultSalesPrice: '12.5' } });
  const supplier = await db.supplier.create({ data: { code: prefix, name: '验收供货中心', contactName: '陈经理', contactPhone: '13800000000', address: '验收物流园配送仓',
    bankName: '测试银行', bankAccountName: '验收供货中心', bankAccount: 'LOCAL-TEST-ACCOUNT', taxpayerId: 'LOCAL-TEST-TAX', invoiceTitle: '验收供货中心',
    deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY', products: { create: { productId: product.id } } } });
  const template = await db.orderTemplate.create({ data: { code: prefix, name: '验收门店订货模板', tag: '验收', items: { create: { productId: product.id, initialSalesPrice: '12.5', suppliers: { create: { supplierId: supplier.id } } } } } });
  const store = await db.store.create({ data: { code: prefix, name: '验收门店', address: '门店营业地址', receiptAddress: '验收门店独立收货仓', receiptContactName: '李主管', receiptContactPhone: '13900000000', bindings: { create: { templateId: template.id } } } });
  const supplierUser = await makeUser('SUPPLIER', { scopeType: 'SUPPLIER', supplierId: supplier.id });
  const storeUser = await makeUser('STORE', { scopeType: 'STORE', storeId: store.id });
  const buyer = await makeUser('PURCHASER');
  await ok('/price-changes', 'POST', { productId: product.id, supplierId: supplier.id, salesPrice: '12.5', supplyPrice: '10', effectiveAt: '2000-01-01T00:00:00Z', reason: 'Isolated initial price' }, `${prefix}-initial`);
  const request = await ok('/purchase-requests', 'POST', { storeId: store.id, items: [{ productId: product.id, quantity: '2' }] }, `${prefix}-request`);
  await ok(`/purchase-requests/${request.id}/confirm`, 'POST', { expectedVersion: request.version }, `${prefix}-confirm`);
  assert.equal(typeof request.id, 'string');
  const order = await db.supplierOrder.findFirstOrThrow({ where: { requestId: request.id, storeId: store.id, supplierId: supplier.id } });
  const ownToken = (await call('/auth/login', 'POST', { username: supplierUser.username, password, client: 'WEB' })).data.accessToken;
  assert.equal((await call('/price-changes', 'POST', { productId: product.id }, ownToken)).status, 403);
  assert.equal((await call(`/suppliers/${supplier.id}`, 'PATCH', { expectedVersion: 1, name: 'Forbidden' }, ownToken)).status, 403);
  assert.equal((await call(`/suppliers/${unit.id}/catalog`, 'GET', undefined, ownToken)).status, 403);
  evidence.checks.push('Own Supplier API cannot publish, edit profile or read foreign catalog');
  if (!pricesOnly) {
  login(supplierUser, 'supplier'); method('openProfile'); wait('profile', value => value?.id === supplier.id); wait('loading', value => value === false);
  screenshot('supplier-own-profile'); screenshot('supplier-own-banking', 500);
  method('changeView', { currentTarget: { dataset: { view: 'catalog' } } });
  const catalog = wait('visibleProducts', value => value?.some(item => item.id === product.id));
  assert.equal(catalog.find(item => item.id === product.id).supplyPrice, '10'); assert.equal(catalog[0].salesPrice, undefined); screenshot('supplier-own-catalog');
  method('onSearch', { detail: { value: 'NO-MATCH' } }); assert.equal(data('visibleProducts').length, 0); screenshot('supplier-catalog-empty');
  evidence.checks.push('Native supplier own profile/bank/catalog supply-price-only/search empty; no edit controls');
  login(storeUser, 'store'); method('openProfile'); wait('profile', value => value?.id === store.id);
  assert.equal(data('fields').find(item => item.label === '收货地址').value, '验收门店独立收货仓'); screenshot('store-own-profile');
  evidence.checks.push('Native Store own profile preserves independent receipt details');
  }
  login(buyer, 'purchaser'); method('openPrices'); wait('loading', value => value === false);
  select('chooseTemplate', data('templateChoices').findIndex(item => item.id === template.id)); wait('quoting', value => value === false);
  select('chooseProduct', data('productChoices').findIndex(item => item.id === product.id)); wait('quoting', value => value === false);
  select('chooseSupplier', data('supplierChoices').findIndex(item => item.id === supplier.id)); wait('quoting', value => value === false);
  assert.equal(data('supplyPrice'), '10'); input('supplyPrice', '99'); assert.equal(data('supplyPrice'), '10');
  const yesterday = new Date(Date.now() - 86400000); const pad = n => String(n).padStart(2, '0');
  method('changeTimestamp', { currentTarget: { dataset: { field: 'effectiveDate' } }, detail: { value: `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}` } }); wait('quoting', value => value === false);
  input('salesPrice', '14'); input('reason', '门店模板销售价调整'); method('previewPrice');
  const impact = wait('impact', value => value?.affectedOrderCount === 1); assert.equal(impact.salesDelta, '3.00'); assert.equal(impact.supplyDelta, '0.00');
  screenshot('template-price-editor'); screenshot('template-price-impact', 570);
  loseResponse(); method('publishPrice'); const pending = wait('pendingCommand', value => value?.path === '/price-changes');
  const committed = await db.commandRecord.findFirstOrThrow({ where: { actorUserId: buyer.id, idempotencyKey: pending.key } }); assert.equal(committed.status, 'SUCCEEDED');
  const versionId = committed.resourceId; const versionCount = await db.priceVersion.count({ where: { scope: { productId: product.id, templateKey: template.id } } }); assert.equal(versionCount, 1);
  screenshot('price-publication-uncertain');
  tool('automation_navigate', { action: 'navigateBack', delta: 1 }); method('openPrices');
  assert.equal(wait('pendingCommand', value => value?.key).key, pending.key); method('recoverPrice'); wait('published', value => value?.versionId === versionId); wait('recovering', value => value === false);
  assert.equal(await db.priceVersion.count({ where: { scope: { productId: product.id, templateKey: template.id } } }), 1);
  const run = wait('run', value => value?.affectedOrderCount === 1); assert.equal(run.status, 'PENDING');
  screenshot('price-publication-recovered-notice');
  screenshot('price-publication-recovered', 600); method('processRun'); wait('run', value => value?.status === 'SUCCEEDED');
  assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).salesGoodsAmount.toString(), '28');
  assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).supplyGoodsAmount.toString(), '20');
  assert.equal(await db.accountLedger.count({ where: { account: { storeId: store.id } } }), 0); screenshot('price-run-completed', 600);
  evidence.checks.push('Native template price cost readonly; real one-order 3.00/0.00 preview; committed response loss/navigation/replay exactly one version and run; actual run goods28/cost20/ledger0');
  select('chooseTemplate', 0); wait('quoting', value => value === false);
  select('chooseProduct', data('productChoices').findIndex(item => item.id === product.id)); wait('quoting', value => value === false);
  select('chooseSupplier', data('supplierChoices').findIndex(item => item.id === supplier.id)); wait('quoting', value => value === false);
  method('changeTimestamp', { currentTarget: { dataset: { field: 'effectiveDate' } }, detail: { value: `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}` } }); wait('quoting', value => value === false);
  input('salesPrice', '13'); input('supplyPrice', '9'); input('reason', '共享供货成本调整'); method('previewPrice');
  const sharedImpact = wait('impact', value => value?.affectedOrderCount === 1); assert.equal(sharedImpact.salesDelta, '0.00'); assert.equal(sharedImpact.supplyDelta, '-2.00');
  screenshot('shared-cost-impact', 570); method('publishPrice');
  const sharedPublished = wait('published', value => value?.templateId === null && value?.supplyPrice === '9'); wait('publishing', value => value === false);
  wait('run', value => value?.id === sharedPublished.runId && value.status === 'PENDING');
  loseResponse(`/jobs/${sharedPublished.runId}/process`); method('processRun');
  const pendingRun = wait('pendingCommand', value => value?.path === `/jobs/${sharedPublished.runId}/process`);
  assert.equal(data('pendingRun'), true);
  assert.equal((await db.priceChangeRun.findUniqueOrThrow({ where: { id: sharedPublished.runId } })).status, 'SUCCEEDED');
  method('processRun'); assert.equal(data('pendingCommand').key, pendingRun.key);
  screenshot('price-run-uncertain');
  method('refreshRun'); wait('run', value => value?.id === sharedPublished.runId && value.status === 'SUCCEEDED');
  assert.equal(data('pendingCommand').key, pendingRun.key, 'GET refresh must not discard the original command');
  method('recoverRun'); wait('notice', value => value === '原重算结果已确认'); wait('recovering', value => value === false);
  evaluate('function() { const pages=getCurrentPages(); const data=pages[pages.length-1].data; if(data.pendingCommand || data.pendingRun) throw new Error("Original command not cleared"); return true; }');
  const finalOrder = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(finalOrder.salesGoodsAmount.toString(), '28'); assert.equal(finalOrder.supplyGoodsAmount.toString(), '18');
  assert.equal(await db.priceChangeAdjustment.count({ where: { runId: sharedPublished.runId, supplierOrderId: order.id } }), 1);
  assert.equal(await db.accountLedger.count({ where: { account: { storeId: store.id } } }), 0);
  screenshot('shared-cost-run-recovered', 600);
  evidence.checks.push('Native shared supplier cost edit leaves template sale14 unchanged; impact0/-2; run response loss blocks resubmit, GET retains original key, exact-key recovery clears pending, one adjustment, final goods28/cost18/ledger0');
  evidence.priceWorkflow = { templateSalesPrice: '14', sharedSupplyPrice: '9', orderSalesGoodsAmount: '28', orderSupplyGoodsAmount: '18', accountLedgerCount: 0,
    publicationRecovery: 'One actual template version and same-key replay', runRecovery: 'One actual adjustment; GET retains pending and same-key replay confirms committed response loss' };
  evidence.status = 'PASSED';
  if (!withoutScreenshots) evidence.visualAcceptance = 'CAPTURED_PENDING_REVIEW';
} catch (error) { evidence.status = 'FAILED'; evidence.error = error.stack || error.message; process.exitCode = 1; }
finally {
  try { evaluate('function() { const app=getApp(); if(app.globalData.nativePriceRequestOriginal) {wx.request=app.globalData.nativePriceRequestOriginal;delete app.globalData.nativePriceRequestOriginal;} return true; }'); } catch {}
  try {
    const ids = users.map(user => user.id);
    try {
      evaluate(`function() { const u=wx.getStorageSync('procurexUser'); if(u && ${JSON.stringify(ids)}.includes(u.id)) {
        wx.getStorageInfoSync().keys.filter(k=>k.startsWith('procurexRoleCommands:') && ${JSON.stringify(ids)}.some(id=>k.includes(':'+id+':'))).forEach(k=>wx.removeStorageSync(k));
        wx.removeStorageSync('procurexToken');wx.removeStorageSync('procurexUser'); } return true; }`);
      tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
    } catch {}
    await cleanup(prefix); evidence.fixtureCleanup = 'PASSED';
  } catch (error) { evidence.fixtureCleanup = 'FAILED'; evidence.cleanupError = error.message; evidence.status = 'FAILED'; process.exitCode = 1; }
  await db.$disconnect(); await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  if (evidence.status === 'FAILED') await writeFile(resolve(output, `failed-${Date.now()}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Native profile/prices evidence: ${evidence.status}; cleanup ${evidence.fixtureCleanup}`);
}
