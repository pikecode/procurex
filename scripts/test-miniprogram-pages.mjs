import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

function page(role, request = async () => ({}), apiOverrides = {}, wxOverrides = {}) {
  let definition;
  const quantityModule = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/quantity.js', 'utf8'), { module: quantityModule });
  const viewModule = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/store-view.js', 'utf8'), { module: viewModule });
  vm.runInNewContext(readFileSync(`apps/miniprogram/pages/${role}/index.js`, 'utf8'), {
    Page: value => { definition = value; },
    require: path => path.includes('quantity') ? quantityModule.exports : path.includes('store-view') ? viewModule.exports : { request, roleCommand: (_role, path, options) => request(path, options), ...apiOverrides },
    wx: wxOverrides,
  });
  definition.setData = function (value) { Object.assign(this.data, value); };
  definition.loadWork = async () => {};
  definition.data.canWrite = true;
  return definition;
}

const tap = (id, extra = {}) => ({ currentTarget: { dataset: { id, ...extra } } });
const input = (id, value) => ({ ...tap(id), detail: { value } });
const plain = value => JSON.parse(JSON.stringify(value));

test('native own profiles require a binding and never enumerate foreign entities', async () => {
  const calls = [];
  const user = { id: 'supplier-user', roles: ['SUPPLIER'], scope: { supplierId: 'own' } };
  const profile = page('profile', async path => {
    calls.push(path);
    return path.endsWith('/catalog') ? { items: [{ id: 'p', name: 'Water', sku: 'W', supplyPrice: '8', isActive: true }] }
      : { id: 'own', name: 'Own supplier', bankAccount: 'own-bank', defaultSettlementMode: 'COMPANY_TERM', status: 'ACTIVE' };
  }, { currentUser: () => user });
  profile.onLoad({ kind: 'supplier' }); await profile.loadProfile();
  assert.deepEqual(calls, ['/suppliers/own', '/suppliers/own/catalog']);
  assert.equal(profile.data.profile.id, 'own');
  assert.equal(profile.data.fields.find(item => item.label === '银行账号').value, 'own-bank');
  profile.onSearch({ detail: { value: 'NO-MATCH' } }); assert.equal(profile.data.visibleProducts.length, 0);
  user.scope = {}; await profile.loadProfile();
  assert.equal(calls.length, 2); assert.equal(profile.data.profile, null); assert.match(profile.data.error, /尚未配置/);
});

test('native store profile uses independent receipt details and cannot save data', async () => {
  const store = page('profile', async path => {
    assert.equal(path, '/stores/own'); return { name: 'Store', address: 'Business', receiptAddress: 'Warehouse', receiptContactName: 'Receiver', status: 'ACTIVE' };
  }, { currentUser: () => ({ id: 'store-user', roles: ['STORE_FINANCE'], scope: { storeId: 'own' } }) });
  store.onLoad({ kind: 'store' }); await store.loadProfile();
  assert.equal(store.data.fields.find(item => item.label === '收货地址').value, 'Warehouse');
  assert.equal(store.saveProfile, undefined);
});

test('late native profile responses cannot repopulate an account after navigation', async () => {
  let resolve;
  const profile = page('profile', () => new Promise(done => { resolve = done; }), { currentUser: () => ({ id: 'user', roles: ['STORE'], scope: { storeId: 'own' } }) });
  profile.onLoad({ kind: 'store' }); const loading = profile.loadProfile(); profile.onHide(); resolve({ id: 'own', name: 'Hidden' }); await loading;
  assert.equal(profile.data.profile, null);
});

function prices(request = async () => ({}), overrides = {}) {
  const instance = page('prices', request, { currentUser: () => ({ id: 'buyer', roles: ['PURCHASER'] }),
    roleCommandState: () => ({ pending: null, history: [] }), ...overrides });
  instance.actorId = 'buyer'; instance.sequence = 1;
  Object.assign(instance.data, { allowed: true, productChoices: [{ id: 'product', name: 'Water', defaultSalesPrice: '12' }], productIndex: 0,
    supplierChoices: [{ id: 'supplier', name: 'Supplier' }], supplierIndex: 0, salesPrice: '12', supplyPrice: '8',
    effectiveDate: '2026-10-01', effectiveTime: '09:30', reason: 'New price' });
  return instance;
}
const priceImpact = { scopeId: 'scope', effectiveAt: '2026-10-01T01:30:00.000Z', affectedOrderCount: 1, salesDelta: '2', supplyDelta: '0',
  orders: [{ supplierOrderId: 'order', supplierOrderNo: 'SO', salesDelta: '2', supplyDelta: '0' }] };

test('native pricing denies supplier role before catalog or pricing requests', async () => {
  let calls = 0;
  const instance = prices(async () => { calls++; }, { currentUser: () => ({ id: 'supplier', roles: ['SUPPLIER'] }) });
  instance.onShow(); await instance.previewPrice(); await instance.publishPrice();
  assert.equal(instance.data.allowed, false); assert.equal(calls, 0);
});

test('native template pricing filters associated suppliers and locks shared cost', async () => {
  const instance = prices(async path => path.endsWith('/products') ? { supplierId: path.split('/')[2], productIds: ['product'] } : {});
  instance.data.template = { id: 'template', items: [{ productId: 'product', isEnabled: true, initialSalesPrice: '12', suppliers: [{ supplierId: 'supplier' }] }] };
  instance.data.suppliers = [{ id: 'supplier' }, { id: 'foreign' }];
  await instance.chooseProduct({ detail: { value: '0' } });
  assert.deepEqual(plain(instance.data.supplierChoices), [{ id: 'supplier' }]);
  instance.data.supplyPrice = '8';
  instance.onInput({ currentTarget: { dataset: { field: 'supplyPrice' } }, detail: { value: '9' } });
  assert.equal(instance.data.supplyPrice, '8');
});

test('native pricing rejects invalid decimals and missing reason before preview', async () => {
  let calls = 0; const instance = prices(async () => { calls++; return priceImpact; });
  instance.data.salesPrice = '1e2'; await instance.previewPrice(); assert.equal(calls, 0);
  instance.data.salesPrice = '12'; instance.data.reason = ' '; await instance.previewPrice(); assert.equal(calls, 0);
  instance.data.reason = 'Valid'; await instance.previewPrice(); assert.equal(calls, 1); assert.ok(instance.data.approvedBody);
  instance.onInput({ currentTarget: { dataset: { field: 'salesPrice' } }, detail: { value: '13' } });
  assert.equal(instance.data.approvedBody, ''); assert.equal(instance.data.impact, null);
});

test('native pricing rechecks impact and requires a second confirmation when orders change', async () => {
  let commands = 0, previews = 0;
  const instance = prices(async () => ++previews === 1 ? priceImpact : { ...priceImpact, salesDelta: '3' }, { roleCommand: async () => { commands++; } });
  await instance.previewPrice(); await instance.publishPrice();
  assert.equal(commands, 0); assert.equal(instance.data.impact.salesDelta, '3'); assert.match(instance.data.error, /影响订单已变化/);
});

test('native price publication keeps server result, versions and existing price-run controls', async () => {
  const published = { scopeId: 'scope', versionId: 'version', runId: 'run', salesPrice: '12', supplyPrice: '8' }; let commands = 0;
  const instance = prices(async path => path === '/prices/impact-preview' ? priceImpact : path.endsWith('/versions') ? [published] : { id: 'run', status: path.endsWith('/process') ? 'SUCCEEDED' : 'PENDING' },
    { roleCommand: async (role, path, options) => { commands++; assert.equal(role, 'purchaser'); assert.ok(options.header['idempotency-key']);
      if (path === '/jobs/run/process') return { id: 'run', status: 'SUCCEEDED' };
      assert.equal(path, '/price-changes'); return published; } });
  await instance.previewPrice(); await instance.publishPrice();
  assert.equal(commands, 1); assert.equal(instance.data.published.versionId, 'version'); assert.equal(instance.data.run.status, 'PENDING');
  await instance.processRun(); assert.equal(instance.data.run.status, 'SUCCEEDED');
});

test('native price recovery uses the persisted request and never creates a new publish', async () => {
  let retries = 0;
  const published = { scopeId: 'scope', versionId: 'version', salesPrice: '12', supplyPrice: '8' };
  const instance = prices(async () => [published], { retryRoleCommand: async role => { assert.equal(role, 'purchaser'); retries++; return published; } });
  instance.data.pendingCommand = { path: '/purchase-requests/request/confirm' }; await instance.recoverPrice(); assert.equal(retries, 0);
  instance.data.pendingCommand = { path: '/price-changes', key: 'original-key' }; await instance.recoverPrice(); assert.equal(retries, 1);
  assert.equal(instance.data.published.versionId, 'version'); assert.equal(instance.data.pendingCommand, null);
});

test('durable native price command history retains the actual version for page restoration', async () => {
  const harness = commandApi(), api = harness.reload();
  harness.handle(options => options.success({ statusCode: 201, data: { data: { versionId: 'version', scopeId: 'scope', runId: 'run' } } }));
  await api.roleCommand('purchaser', '/price-changes', commandOptions());
  const reloaded = harness.reload(); assert.equal(reloaded.roleCommandState('purchaser').history[0].result.versionId, 'version');
});

test('native pricing ignores late previews after navigation and resets loading on return', async () => {
  let resolve;
  const instance = prices(() => new Promise(done => { resolve = done; }));
  const preview = instance.previewPrice(); instance.onHide(); resolve(priceImpact); await preview;
  assert.equal(instance.data.impact, null); assert.equal(instance.data.approvedBody, '');
  instance.loadChoices = () => {};
  instance.onShow(); assert.equal(instance.data.previewing, false); assert.equal(instance.data.quoting, false);
});

test('native run controls cannot start during uncertain publication or resubmit a finished run', async () => {
  let calls = 0; const instance = prices(async () => { calls++; });
  instance.data.run = { id: 'run', status: 'PENDING' }; instance.data.pendingCommand = { path: '/price-changes' };
  await instance.processRun(); assert.equal(calls, 0);
  instance.data.pendingCommand = null; instance.data.run.status = 'SUCCEEDED'; await instance.processRun(); assert.equal(calls, 0);
});

test('native uncertain price-run keeps original command despite refreshing a pending run', async () => {
  let calls = 0, pending = null;
  const instance = prices(async path => path.endsWith('/versions') ? [] : { id: 'run', status: 'PENDING' }, {
    roleCommand: async (role, path, options) => {
      calls++; assert.equal(role, 'purchaser'); assert.equal(path, '/jobs/run/process'); assert.ok(options.header['idempotency-key']);
      pending = { path, key: 'original-key' }; const error = new Error('Lost response'); error.uncertain = true; throw error;
    },
    roleCommandState: () => ({ pending, history: [] }),
    retryRoleCommand: async () => { assert.equal(pending.key, 'original-key'); pending = null; return { id: 'run', status: 'SUCCEEDED' }; }
  });
  instance.data.run = { id: 'run', status: 'PENDING' }; instance.data.published = { scopeId: 'scope', versionId: 'version', runId: 'run' };
  await instance.processRun(); assert.equal(instance.data.pendingRun, true);
  await instance.processRun(); assert.equal(calls, 1);
  await instance.refreshRun(); assert.equal(instance.data.pendingRun, true); assert.equal(instance.data.run.status, 'PENDING');
  await instance.processRun(); assert.equal(calls, 1);
  await instance.recoverRun(); assert.equal(instance.data.run.status, 'SUCCEEDED'); assert.equal(instance.data.pendingCommand, null);
});

test('native run recovery ignores results after navigation and refuses unrelated commands', async () => {
  let resolve, calls = 0;
  const instance = prices(async () => ({}), { retryRoleCommand: () => { calls++; return new Promise(done => { resolve = done; }); } });
  instance.data.pendingCommand = { path: '/price-changes' }; await instance.recoverRun(); assert.equal(calls, 0);
  instance.data.pendingRun = true; instance.data.pendingCommand = { path: '/jobs/run/process' };
  const recovery = instance.recoverRun(); instance.onHide(); resolve({ id: 'run', status: 'SUCCEEDED' }); await recovery;
  assert.equal(instance.data.run, null);
});

test('durable price-run response loss survives restart and replays the exact original key', async () => {
  const harness = commandApi(), api = harness.reload(); let original;
  harness.handle(options => { original = options.header['idempotency-key']; options.fail({ errMsg: 'Lost response' }); });
  await assert.rejects(api.roleCommand('purchaser', '/jobs/run/process', commandOptions()));
  const restored = harness.reload(); assert.equal(restored.roleCommandState('purchaser').pending.title, '价格重算');
  harness.handle(options => { assert.equal(options.url.endsWith('/jobs/run/process'), true); assert.equal(options.header['idempotency-key'], original);
    options.success({ statusCode: 200, data: { data: { id: 'run', status: 'SUCCEEDED' } } }); });
  await restored.retryRoleCommand('purchaser');
  assert.equal(harness.reload().roleCommandState('purchaser').history[0].result.id, 'run');
});

test('durable price-run definite failure retains the code and releases pending submission', async () => {
  const harness = commandApi(), api = harness.reload();
  harness.handle(options => options.success({ statusCode: 409, data: { error: { code: 'CREDIT_LIMIT_EXCEEDED', message: 'Credit limit exceeded' } } }));
  await assert.rejects(api.roleCommand('purchaser', '/jobs/run/process', commandOptions()));
  const state = harness.reload().roleCommandState('purchaser');
  assert.equal(state.pending, null); assert.equal(state.history[0].code, 'CREDIT_LIMIT_EXCEEDED'); assert.equal(state.history[0].status, 'FAILED');
});

test('administrator-closed rollback releases native pending only after original-key failure replay', async () => {
  const harness = commandApi(), api = harness.reload();
  harness.handle(options => options.fail({ errMsg: 'Lost response' }));
  await assert.rejects(api.roleCommand('purchaser', '/jobs/run/process', commandOptions()));
  const pending = harness.reload().roleCommandState('purchaser').pending;
  harness.handle(options => {
    assert.equal(options.header['idempotency-key'], pending.key);
    options.success({ statusCode: 409, data: { code: 'COMMAND_ROLLED_BACK', message: 'Rolled back' } });
  });
  await assert.rejects(harness.reload().retryRoleCommand('purchaser'), /原价格重算已回滚/);
  const state = harness.reload().roleCommandState('purchaser');
  assert.equal(state.pending, null); assert.equal(state.history[0].code, 'COMMAND_ROLLED_BACK'); assert.equal(state.history[0].key, pending.key);
});

test('uncommitted price closure replays native failure without automatically submitting again', async () => {
  const harness = commandApi(), api = harness.reload(); let calls = 0;
  harness.handle(options => { calls++; options.fail({ errMsg: 'Lost response' }); });
  await assert.rejects(api.roleCommand('purchaser', '/jobs/run/process', commandOptions()));
  const pending = harness.reload().roleCommandState('purchaser').pending;
  harness.handle(options => { calls++; assert.equal(options.header['idempotency-key'], pending.key);
    options.success({ statusCode: 409, data: { code: 'COMMAND_NOT_COMMITTED', message: 'Not committed' } }); });
  await assert.rejects(harness.reload().retryRoleCommand('purchaser'), /原价格重算未提交/);
  assert.equal(calls, 2); assert.equal(harness.reload().roleCommandState('purchaser').pending, null);
  assert.equal(harness.reload().roleCommandState('purchaser').history[0].code, 'COMMAND_NOT_COMMITTED');
});

test('native run history displays server outcomes without exposing private payloads', async () => {
  const instance = prices(async path => {
    assert.equal(path, '/jobs/run/submissions');
    return [{ id: 'failed', status: 'FAILED', startedAt: '2026-10-04T01:00:00Z', errorCode: 'COMMAND_ROLLED_BACK', responseBody: { secret: true } },
      { id: 'done', status: 'SUCCEEDED', startedAt: '2026-10-04T02:00:00Z', errorCode: null }];
  });
  instance.data.run = { id: 'run', status: 'SUCCEEDED' }; await instance.loadSubmissions();
  assert.equal(instance.data.submissions.length, 2); assert.equal(instance.data.submissions[0].errorText, '已回滚');
  assert.ok(instance.data.submissions[0].startedText); assert.ok(!JSON.stringify(instance.data.submissions).includes('secret'));
  assert.equal(instance.data.submissionsLoading, false);
});

test('native run history failure preserves task and existing records with independent retry', async () => {
  let fail = true;
  const instance = prices(async () => { if (fail) throw new Error('History unavailable'); return []; });
  instance.data.run = { id: 'run', status: 'PENDING' }; instance.data.submissionsRunId = 'run'; instance.data.submissions = [{ id: 'existing' }];
  await instance.loadSubmissions(); assert.equal(instance.data.run.status, 'PENDING'); assert.equal(instance.data.submissions.length, 1);
  assert.equal(instance.data.submissionsError, 'History unavailable'); assert.equal(instance.data.error, '');
  fail = false; await instance.loadSubmissions(); assert.equal(instance.data.submissionsError, ''); assert.equal(instance.data.submissions.length, 0);
});

test('native run history discards older overlapping refreshes', async () => {
  const responses = [];
  const instance = prices(() => new Promise(resolve => responses.push(resolve))); instance.data.run = { id: 'run' };
  const old = instance.loadSubmissions(), fresh = instance.loadSubmissions();
  responses[1]([{ id: 'fresh', status: 'SUCCEEDED' }]); await fresh;
  responses[0]([{ id: 'old', status: 'FAILED' }]); await old;
  assert.equal(instance.data.submissions[0].id, 'fresh'); assert.equal(instance.data.submissionsLoading, false);
});

for (const change of ['navigation', 'account', 'task']) {
  test(`native run history ignores late response after ${change}`, async () => {
    let resolve, actor = 'buyer';
    const instance = prices(() => new Promise(done => { resolve = done; }), { currentUser: () => ({ id: actor, roles: ['PURCHASER'] }) });
    instance.data.run = { id: 'run' }; const loading = instance.loadSubmissions();
    if (change === 'navigation') instance.onHide();
    if (change === 'account') actor = 'other';
    if (change === 'task') instance.data.run = { id: 'different' };
    resolve([{ id: 'late', status: 'SUCCEEDED' }]); await loading;
    assert.equal(instance.data.submissions.length, 0);
  });
}

test('native run history refuses malformed responses and clears records when changing task', async () => {
  const instance = prices(async () => ({ unexpected: true }));
  instance.data.run = { id: 'new' }; instance.data.submissionsRunId = 'old'; instance.data.submissions = [{ id: 'old-private' }];
  await instance.loadSubmissions(); assert.equal(instance.data.submissions.length, 0);
  assert.equal(instance.data.submissionsError, '重算记录加载失败'); assert.equal(instance.data.submissionsLoading, false);
});

for (const [status, code] of [[409, 'COMMAND_PROCESSING'], [500, 'INTERNAL_ERROR'], [401, 'UNAUTHORIZED']]) {
  test(`price-run recovery retains the original key on ${code}`, async () => {
    const harness = commandApi(), api = harness.reload();
    harness.handle(options => options.success({ statusCode: status, data: { error: { code, message: code } } }));
    await assert.rejects(api.roleCommand('purchaser', '/jobs/run/process', commandOptions()));
    const pending = plain(harness.reload().roleCommandState('purchaser').pending);
    await assert.rejects(harness.reload().retryRoleCommand('purchaser'));
    assert.deepEqual(plain(harness.reload().roleCommandState('purchaser').pending), pending);
    assert.equal(harness.reload().roleCommandState('purchaser').history.length, 0);
  });
}

test('a supplier cost version change invalidates the store quote even when its sale price is unchanged', () => {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/store-view.js', 'utf8'), { module });
  const preview = { items: [{ productId: 'product', quantity: '2', salesUnitPrice: '12', priceVersionId: 'sale', supplyPriceVersionId: 'cost-a' }], totals: { salesGoodsAmount: '24' } };
  const changed = { ...preview, items: [{ ...preview.items[0], supplyPriceVersionId: 'cost-b' }] };
  assert.notEqual(module.exports.previewSignature(preview), module.exports.previewSignature(changed));
});

test('store purchase-unit selection sends explicit unit/version, scales estimates, and never reinterprets cart quantities', async () => {
  const store = page('store', async () => ({ items: [{ product: { id: 'p', name: 'Water', baseUnitId: 'bottle', unitName: 'Bottle', purchaseUnitName: 'Pack', version: 42, isActive: true,
    minOrderQty: '2', orderMultiple: '2', purchaseUnitConversion: { purchaseUnitId: 'pack', salesUnitId: 'bottle', salesUnitsPerPurchaseUnit: '12' } },
    suppliers: [{ supplierId: 's', salesPrice: '1.234567', purchaseSalesPrice: '14.814804', priceVersionId: 'v' }] }] }));
  await store.loadCatalog();
  store.data.storeId = 'store';
  store.chooseProductUnit(input('p', '1'));
  store.stepProduct(tap('p', { direction: 1 }));
  assert.deepEqual(plain(store.orderInput().items), [{ productId: 'p', quantity: '1', unitId: 'pack', expectedProductVersion: 42 }]);
  assert.equal(store.data.cart[0].unitName, 'Pack');
  assert.equal(store.data.estimatedAmount, '14.81');
  assert.equal(store.data.visibleProducts[0].displayPrice, '14.814804'); assert.equal(store.data.visibleProducts[0].displayUnitName, 'Pack');
  store.data.pendingOrder = { key: 'pending' }; store.chooseProductUnit(input('p', '0'));
  assert.equal(store.data.cart[0].unitId, 'pack');
  store.data.pendingOrder = null; store.chooseProductUnit(input('p', '0'));
  assert.equal(store.data.cart.length, 0);
  store.stepProduct(tap('p', { direction: 1 }));
  assert.equal(store.data.cart[0].quantity, '2'); assert.equal(store.data.cart[0].unitId, 'bottle');
});

test('native product brand choices include registered brands even before a product uses them', async () => {
  const editor = page('products', async path => path === '/brands' ? [{ id: 'brand-unused', name: 'Unused registered brand' }] : path === '/products' ? [{ id: 'p', name: 'Product', brand: 'Legacy brand' }] : []);
  await editor.loadProducts();
  assert.deepEqual(plain(editor.data.brands), ['Legacy brand', 'Unused registered brand']);
});

test('supplier freight choices follow the order snapshot and legacy unknown remains compatible', async () => {
  let snapshot = false; let writes = 0;
  const supplier = page('supplier', async (_path, options) => {
    if (options?.method === 'POST') { writes++; return {}; }
    return { id: 'order', version: 1, status: 'PUSHED', fulfillmentStatus: 'PENDING', requiresFreightSnapshot: snapshot, items: [], freightConfirmations: [{ id: 'freight', amount: '5.00', status: 'CONFIRMED', reason: 'Delivery' }] };
  });
  await supplier.loadOrder('order');
  assert.equal(supplier.data.selectedOrder.canRequestFreight, false);
  assert.equal(supplier.data.freightChoices.length, 1);
  supplier.data.freightRequestAmount = '5.00'; supplier.data.freightRequestReason = 'Delivery';
  await supplier.requestFreight(); assert.equal(writes, 0); assert.match(supplier.data.error, /不允许/);
  for (snapshot of [null, true]) {
    await supplier.loadOrder('order');
    assert.equal(supplier.data.selectedOrder.canRequestFreight, true);
    assert.equal(supplier.data.freightChoices.length, 2);
  }
});

function commandApi() {
  const storage = new Map([['procurexUser', { id: 'actor-a' }], ['procurexToken', 'token-a']]);
  const calls = [];
  let handler = options => options.fail({});
  const reload = () => {
    const module = { exports: {} };
    vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), { module,
      getApp: () => ({ globalData: { apiBase: 'http://localhost/api/v1' } }),
      wx: { getStorageSync: key => storage.has(key) ? structuredClone(storage.get(key)) : '',
        setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
        request: options => { calls.push(options); handler(options); } } });
    return module.exports;
  };
  return { storage, calls, reload, handle: value => { handler = value; } };
}
const commandOptions = () => ({ method: 'POST', data: { expectedVersion: 7, items: [{ id: 'line', quantity: '2' }] }, header: { 'idempotency-key': 'original-key' } });

test('credit reincrease after an adjustment is a definite reconciliation failure', async () => {
  const harness = commandApi(), api = harness.reload();
  harness.handle(options => options.success({ statusCode: 409, data: { code: 'CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED' } }));
  await assert.rejects(api.request('/test'), failure => failure.code === 'CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED'
    && failure.uncertain === false && failure.message.includes('有效已付金额'));
});

test('cleared-credit adjustment blocker is readable and is not an uncertain network failure', async () => {
  const harness = commandApi(), api = harness.reload();
  harness.handle(options => options.success({ statusCode: 409, data: { error: { code: 'CLEARED_CREDIT_ADJUSTMENT_REQUIRED', message: 'Settlement adjustment required' } } }));
  await assert.rejects(api.request('/test'), error => error.code === 'CLEARED_CREDIT_ADJUSTMENT_REQUIRED'
    && error.uncertain === false && error.message.includes('独立结算调整'));
});

test('role command survives restart and replays the exact original request after response loss', async () => {
  const harness = commandApi(); let api = harness.reload(); const options = commandOptions();
  await assert.rejects(api.roleCommand('supplier', '/supplier-orders/order/shipments', options), /网络/);
  options.data.items[0].quantity = '9';
  const original = plain(api.roleCommandState('supplier').pending);
  assert.equal(original.body.items[0].quantity, '2');
  await assert.rejects(api.roleCommand('supplier', '/other', commandOptions()), /待确认/);
  api = harness.reload();
  harness.handle(options => options.success({ statusCode: 201, data: { data: { id: 'shipment' } } }));
  assert.equal((await api.retryRoleCommand('supplier')).id, 'shipment');
  assert.deepEqual(plain(harness.calls[1].data), original.body);
  assert.equal(harness.calls[1].header['idempotency-key'], original.key);
  assert.equal(api.roleCommandState('supplier').pending, null);
  assert.equal(api.roleCommandState('supplier').history[0].status, 'SUCCEEDED');
});

test('role recovery isolates actors, workspaces and servers and preserves authentication failures', async () => {
  const harness = commandApi(), api = harness.reload();
  await assert.rejects(api.roleCommand('purchaser', '/purchase-requests/id/confirm', commandOptions()));
  assert.equal(api.roleCommandState('supplier').pending, null);
  harness.storage.set('procurexUser', { id: 'actor-b' });
  assert.equal(api.roleCommandState('purchaser').pending, null);
  harness.storage.set('procurexUser', { id: 'actor-a' });
  harness.storage.set('procurexApiBase', 'http://other/api/v1');
  assert.equal(api.roleCommandState('purchaser').pending, null);
  harness.storage.delete('procurexApiBase');
  for (const status of [401, 403, 408, 429, 500]) {
    harness.handle(options => options.success({ statusCode: status, data: { message: 'Unavailable' } }));
    await assert.rejects(api.retryRoleCommand('purchaser')); assert.ok(api.roleCommandState('purchaser').pending);
  }
  harness.handle(options => options.success({ statusCode: 409, data: { code: 'COMMAND_PROCESSING' } }));
  await assert.rejects(api.retryRoleCommand('purchaser')); assert.ok(api.roleCommandState('purchaser').pending);
  harness.handle(options => options.success({ statusCode: 409, data: { code: 'VERSION_CONFLICT', message: '版本已变更' } }));
  await assert.rejects(api.retryRoleCommand('purchaser'));
  assert.equal(api.roleCommandState('purchaser').pending, null);
  assert.equal(api.roleCommandState('purchaser').history[0].status, 'FAILED');
});

test('double retry sends only one in-flight command and history retains only the latest twenty', async () => {
  const harness = commandApi(), api = harness.reload(); let response;
  harness.handle(options => { response = options; });
  const submitting = api.roleCommand('supplier', '/order/reject', commandOptions());
  await assert.rejects(api.retryRoleCommand('supplier'), /正在确认/); assert.equal(harness.calls.length, 1);
  response.success({ statusCode: 201, data: { data: { id: 'order' } } }); await submitting;
  harness.handle(options => options.success({ statusCode: 201, data: { data: { id: 'order' } } }));
  for (let i = 0; i < 25; i++) await api.roleCommand('supplier', `/order-${i}/reject`, commandOptions());
  assert.equal(api.roleCommandState('supplier').history.length, 20);
  assert.equal(api.roleCommandState('supplier').history[0].path, '/order-24/reject');
});

test('both role recovery pages refresh server state and clear stale selections', async () => {
  for (const role of ['purchaser', 'supplier']) {
    let retries = 0; let refreshed = 0;
    const instance = page(role, undefined, { retryRoleCommand: async workspace => { assert.equal(workspace, role); retries++; },
      roleCommandState: () => ({ pending: null, history: [{ key: 'key', status: 'SUCCEEDED' }] }) });
    instance.loadWork = async () => { refreshed++; };
    instance.data.selectedOrder = { id: 'old' }; instance.data.selectedRequest = { id: 'old' };
    await instance.recoverCommand(); assert.equal(retries, 1); assert.equal(refreshed, 1);
    assert.equal(instance.data.recovering, false); assert.equal(instance.data.pendingCommand, null);
    assert.equal(role === 'supplier' ? instance.data.selectedOrder : instance.data.selectedRequest, null);
  }
});

test('late command completion updates only its original actor record', async () => {
  const harness = commandApi(), api = harness.reload(); let response;
  harness.handle(options => { response = options; });
  const original = api.roleCommand('supplier', '/order/reject', commandOptions());
  harness.storage.set('procurexUser', { id: 'actor-b' });
  assert.equal(api.roleCommandState('supplier').pending, null);
  response.success({ statusCode: 201, data: { data: { id: 'order' } } }); await original;
  assert.equal(api.roleCommandState('supplier').history.length, 0);
  harness.storage.set('procurexUser', { id: 'actor-a' });
  assert.equal(api.roleCommandState('supplier').history[0].status, 'SUCCEEDED');
});

test('failed durable storage prevents sending a role command', () => {
  const module = { exports: {} }; let sent = false;
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), { module,
    getApp: () => ({ globalData: { apiBase: 'http://localhost/api/v1' } }),
    wx: { getStorageSync: key => key === 'procurexUser' ? { id: 'actor' } : '',
      setStorageSync: () => { throw new Error('Storage full'); }, request: () => { sent = true; } } });
  assert.throws(() => module.exports.roleCommand('supplier', '/order/reject', commandOptions()), /Storage full/);
  assert.equal(sent, false);
});

test('new products require a valid default price but allow an empty SKU', async () => {
  const writes = [];
  const products = page('products', async (path, options) => { writes.push({ path, ...plain(options) }); return { id: 'product' }; });
  products.loadProducts = async () => {};
  Object.assign(products.data.draft, { name: '水', categoryId: 'category', baseUnitId: 'unit', sku: '' });
  for (const price of ['', '-1', '1.0000001', '100000000000000']) {
    products.data.draft.defaultSalesPrice = price;
    await products.saveProduct();
    assert.equal(writes.length, 0);
  }
  products.data.draft.defaultSalesPrice = '0';
  await products.saveProduct();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/products');
  assert.equal(writes[0].data.sku, null);
  assert.equal(writes[0].data.defaultSalesPrice, '0');
});

test('removed product image cannot reappear from an older download', async () => {
  let complete;
  const products = page('products', undefined, { imagePath: () => new Promise(resolve => { complete = resolve; }) });
  products.data.imageFile = { id: 'old' };
  const loading = products.loadImage(products.data.imageFile);
  products.removeImage(); complete('/temp/old'); await loading;
  assert.equal(products.data.imageUrl, ''); assert.equal(products.data.draft.imageFileId, null);
});

test('product metadata save keeps price changes outside the ordinary editor', async () => {
  let write;
  const products = page('products', async (path, options) => { write = { path, ...plain(options) }; return { id: 'product' }; });
  products.loadProducts = async () => {};
  products.data.selectedId = 'product'; products.data.draft = { sku: 'SKU', name: '水', categoryId: 'category', baseUnitId: 'unit', version: 4,
    minOrderQty: '1', orderMultiple: '2', specification: '500mL', brand: '品牌', storageCondition: 'AMBIENT', imageFileId: 'image', isActive: true };
  await products.saveProduct();
  assert.equal(write.path, '/products/product'); assert.equal(write.data.expectedVersion, 4);
  assert.equal(write.data.specification, '500mL'); assert.equal(write.data.imageFileId, 'image');
  assert.equal('salesPrice' in write.data, false); assert.equal('supplyPrice' in write.data, false);
});

test('product crop creates a square bounded preview and uploads only the rendered image', async () => {
  let drawn, uploaded;
  const products = page('products', undefined, { uploadEvidence: async (path, purpose) => { uploaded = { path, purpose }; return { id: 'image' }; } }, {
    getImageInfo: options => options.success({ width: 100, height: 200, path: 'source' }),
    createCanvasContext: () => ({ setFillStyle() {}, fillRect() {}, drawImage: (...args) => { drawn = args; }, draw: (_, callback) => callback() }),
    canvasToTempFilePath: options => { assert.equal(options.destWidth, options.destHeight); assert.equal(options.fileType, 'jpg'); options.success({ tempFilePath: 'cropped' }); }
  });
  await products.prepareCrop('source'); assert.equal(products.data.crop.width, 240); assert.equal(products.data.crop.height, 480);
  products.onCropZoom({ detail: { value: 2 } });
  products.onCropMove({ detail: { x: 1000, y: -1000 } });
  await products.confirmCrop();
  assert.deepEqual(drawn, ['source', 0, -720, 480, 960]);
  assert.deepEqual(uploaded, { path: 'cropped', purpose: 'PRODUCT' }); assert.equal(products.data.draft.imageFileId, 'image'); assert.equal(products.data.crop, null);
});

test('failed product upload retains the crop for retry and version conflicts retain the draft', async () => {
  const products = page('products', async () => { const error = new Error('版本冲突'); error.code = 'VERSION_CONFLICT'; throw error; }, { uploadEvidence: async () => { throw new Error('断网'); } }, {
    createCanvasContext: () => ({ setFillStyle() {}, fillRect() {}, drawImage() {}, draw: (_, callback) => callback() }),
    canvasToTempFilePath: options => options.success({ tempFilePath: 'cropped' })
  });
  products.data.crop = { path: 'source', x: 0, y: 0, width: 240, height: 240 };
  await products.confirmCrop(); assert.ok(products.data.crop); assert.equal(products.data.draft.imageFileId, null);
  products.data.crop = null; products.data.selectedId = 'product'; Object.assign(products.data.draft, { name: '水', categoryId: 'c', baseUnitId: 'u', version: 3 });
  await products.saveProduct(); assert.equal(products.data.conflict, true); assert.equal(products.data.draft.name, '水');
});

test('product image downloads cannot overwrite a refreshed catalog generation', async () => {
  let complete;
  const store = page('store', undefined, { imagePath: () => new Promise(resolve => { complete = resolve; }) });
  const product = { id: 'product', imageFileId: 'old', imageFile: { id: 'old' } };
  store.catalogRequestSequence = 1; store.data.products = [product];
  const pending = store.loadProductImage(product, 1);
  store.catalogRequestSequence = 2; store.data.products = [{ ...product, imageFileId: 'new', imageUrl: 'new-path' }];
  complete('old-path'); await pending; assert.equal(store.data.products[0].imageUrl, 'new-path');
});

test('purchaser rejection work reads current orders rather than notification history', async () => {
  const paths = [];
  const purchaser = page('purchaser', async path => { paths.push(path); return [{ id: 'rejected', supplierOrderId: 'rejected' }]; });
  await purchaser.loadRejections();
  assert.deepEqual(paths, ['/purchase-requests/rejection-todos']);
  assert.equal(purchaser.data.rejectionTodos.length, 1);
});

test('supplier statement displays business dates with the exclusive end converted to its last day', async () => {
  const supplier = page('supplier', async () => ({ id: 'bill', periodStart: '2024-02-01', periodEndExclusive: '2024-03-01', lines: [] }));
  await supplier.selectStatement(tap('bill'));
  assert.equal(supplier.data.selectedStatement.periodText, '2024-02-01 至 2024-02-29');
});

test('supplier total opens only exact-parent store bills and returns through source to fresh child and parent', async () => {
  let parentReads = 0, childReads = 0;
  const supplier = page('supplier', async path => {
    if (path.startsWith('/payment-records')) return [];
    if (path.startsWith('/supplier-store-statements?')) return [
      { id: 'child/id', parentStatementId: 'parent' }, { id: 'other', parentStatementId: 'different-parent' },
    ];
    if (path === '/supplier-store-statements/child%2Fid') return { id: 'child/id', type: 'SUPPLIER_STORE', parentStatementId: 'parent',
      payableAmount: String(++childReads), lines: [{ supplierOrderId: 'order', settlementItemId: 'base', products: [] }] };
    if (path.startsWith('/supplier-orders/')) return { id: 'order', status: 'COMPLETED', items: [] };
    return { id: 'parent', type: 'SUPPLIER_TOTAL', supplierId: 'supplier', cycle: 'MONTHLY', payableAmount: String(++parentReads), lines: [] };
  });
  await supplier.selectStatement(tap('parent'));
  assert.deepEqual(plain(supplier.data.statementStores.map(item => item.id)), ['child/id']);
  await supplier.selectStoreStatement(tap('other')); assert.equal(supplier.data.statementId, 'parent');
  await supplier.selectStoreStatement(tap('child/id')); assert.equal(supplier.data.statementKind, 'store');
  await supplier.openStatementSource(tap('order', { kind: 'order' }));
  assert.equal(supplier.data.statementReturnKind, 'store');
  await supplier.backToList(); assert.equal(supplier.data.selectedStatement.payableAmount, '2');
  assert.equal(supplier.data.statementKind, 'store');
  await supplier.backToList(); assert.equal(supplier.data.selectedStatement.id, 'parent');
  assert.equal(supplier.data.selectedStatement.payableAmount, '2'); assert.equal(supplier.data.statementKind, 'total');
});

test('store bill membership mismatch is rejected and retry retains the correct endpoint', async () => {
  let attempts = 0;
  const supplier = page('supplier', async path => path.startsWith('/payment-records') ? [] : {
    id: 'child', type: 'SUPPLIER_STORE', parentStatementId: ++attempts === 1 ? 'foreign' : 'parent', lines: [],
  });
  await supplier.selectStatement(tap('child', { statementKind: 'store', parentId: 'parent' }));
  assert.equal(supplier.data.selectedStatement, null); assert.match(supplier.data.error, /不属于/);
  await supplier.retryStatement(); assert.equal(supplier.data.selectedStatement.id, 'child'); assert.equal(supplier.data.error, '');
});

test('store bill list failure preserves total amounts and can retry independently', async () => {
  let attempts = 0, reads = 0;
  const supplier = page('supplier', async path => {
    if (path.startsWith('/payment-records')) return [];
    if (path.startsWith('/supplier-store-statements?')) { if (++attempts === 1) throw new Error('分店连接失败'); return [{ id: 'child', parentStatementId: 'parent' }]; }
    reads++; return { id: 'parent', type: 'SUPPLIER_TOTAL', supplierId: 'supplier', cycle: 'MONTHLY', payableAmount: '20.00', lines: [] };
  });
  await supplier.selectStatement(tap('parent'));
  assert.equal(supplier.data.selectedStatement.payableAmount, '20.00'); assert.match(supplier.data.statementStoresError, /连接失败/);
  await supplier.retryStatementStores(); assert.equal(reads, 1); assert.equal(supplier.data.statementStores.length, 1);
  assert.equal(supplier.data.statementStoresError, '');
});

test('late store-bill list cannot overwrite a newer parent or a child selection', async () => {
  let complete;
  const supplier = page('supplier', async path => {
    if (path.startsWith('/payment-records')) return [];
    if (path.startsWith('/supplier-store-statements?')) return new Promise(resolve => { complete = resolve; });
    return { id: path.endsWith('/parent') ? 'parent' : 'new', type: path.endsWith('/parent') ? 'SUPPLIER_TOTAL' : 'SUPPLIER_STORE', parentStatementId: 'parent', supplierId: 'supplier', cycle: 'MONTHLY', lines: [] };
  });
  const old = supplier.selectStatement(tap('parent'));
  await new Promise(resolve => setImmediate(resolve));
  await supplier.selectStatement(tap('new', { statementKind: 'store', parentId: 'parent' }));
  complete([{ id: 'old', parentStatementId: 'parent' }]); await old;
  assert.equal(supplier.data.statementId, 'new'); assert.equal(supplier.data.statementStores.length, 0);
  assert.equal(supplier.data.statementStoresLoading, false);
});

test('product expansion requires current bill membership and view change does not reopen its parent', async () => {
  let reads = 0;
  const supplier = page('supplier', async () => { reads++; return {}; });
  Object.assign(supplier.data, { selectedStatement: { lines: [{ supplierOrderId: 'order' }] }, statementId: 'child', statementKind: 'store', statementParentId: 'parent', activeView: 'reports' });
  supplier.toggleStatementProducts(tap('foreign')); assert.equal(supplier.data.expandedStatementOrderId, '');
  supplier.toggleStatementProducts(tap('order')); assert.equal(supplier.data.expandedStatementOrderId, 'order');
  supplier.toggleStatementProducts(tap('order')); assert.equal(supplier.data.expandedStatementOrderId, '');
  supplier.changeView(tap('', { view: 'orders' })); assert.equal(reads, 0); assert.equal(supplier.data.statementId, '');
});

test('bill quantities and unit prices trim display zeros without floating-point conversion', async () => {
  const supplier = page('supplier', async path => path.startsWith('/payment-records') ? [] : { id: 'bill', lines: [{ products: [{
    orderedQuantity: '99999999999999.123000', effectiveQuantity: '10.000000', receivedQuantity: '0.000000', supplyUnitPrice: '9.500000',
  }] }] });
  await supplier.selectStatement(tap('bill'));
  const product = supplier.data.selectedStatement.lines[0].products[0];
  assert.equal(product.orderedText, '99999999999999.123'); assert.equal(product.effectiveText, '10');
  assert.equal(product.receivedText, '0'); assert.equal(product.priceText, '9.5');
});

test('supplier bill detail encodes statement identity and ignores a closed or stale response', async () => {
  const pending = new Map();
  const supplier = page('supplier', path => path.startsWith('/payment-records') ? Promise.resolve([]) : new Promise(resolve => pending.set(path, resolve)));
  const old = supplier.selectStatement(tap('bill/old'));
  const next = supplier.selectStatement(tap('bill/new'));
  pending.get('/supplier-statements/bill%2Fnew')({ id: 'bill/new', lines: [] }); await next;
  pending.get('/supplier-statements/bill%2Fold')({ id: 'bill/old', lines: [] }); await old;
  assert.equal(supplier.data.selectedStatement.id, 'bill/new');
  const closed = supplier.selectStatement(tap('bill/closed')); supplier.backToList();
  pending.get('/supplier-statements/bill%2Fclosed')({ id: 'bill/closed' }); await closed;
  assert.equal(supplier.data.selectedStatement, null); assert.equal(supplier.data.statementLoading, false);
});

test('handled rejection cannot be reallocated again from a stale selection', async () => {
  let writes = 0;
  const purchaser = page('purchaser', async (path, options) => {
    if (options?.method === 'POST') writes++;
    return path.startsWith('/supplier-orders/') ? { id: 'o1', requestId: 'r1', status: 'REJECTED' }
      : { id: 'r1', supplierOrders: [{ id: 'o1', rejectionHandled: true }] };
  });
  Object.assign(purchaser.data, { requestId: 'r1', rejectedOrderId: 'o1', targetSupplierId: 's2' });
  await purchaser.reallocateRequest(); assert.equal(writes, 0); assert.match(purchaser.data.error, /已处理/);
});

test('bill payment sources match settlement identities, not whole payment or order totals', async () => {
  const supplier = page('supplier', async path => path.startsWith('/payment-records') ? [
    { id: 'related', amount: '100.00', allocations: [{ id: 'a', settlementItemId: 'base', amount: '30.00', state: 'CONFIRMED' }, { id: 'b', settlementItemId: 'elsewhere', amount: '70.00' }] },
    { id: 'rejected', allocations: [{ id: 'c', settlementItemId: 'adjustment', amount: '5.00', state: 'RELEASED' }] },
    { id: 'other', allocations: [{ id: 'd', settlementItemId: 'elsewhere', amount: '70.00' }] }
  ] : { id: 'bill', lines: [{ settlementItemId: 'base' }], adjustmentItems: [{ settlementItemId: 'adjustment' }] });
  await supplier.selectStatement(tap('bill'));
  assert.deepEqual(plain(supplier.data.statementPayments.map(item => item.id)), ['related', 'rejected']);
  assert.equal(supplier.data.statementPayments[0].statementAllocations.length, 1);
  assert.equal(supplier.data.statementPayments[0].statementAllocations[0].amount, '30.00');
});

test('source navigation verifies membership and rereads the bill on return', async () => {
  let reads = 0;
  const supplier = page('supplier', async path => {
    if (path.startsWith('/payment-records')) return [];
    if (path.startsWith('/supplier-orders')) return { id: 'order', status: 'COMPLETED', items: [] };
    return { id: 'bill', payableAmount: String(++reads), lines: [{ supplierOrderId: 'order', settlementItemId: 'base' }] };
  });
  await supplier.selectStatement(tap('bill'));
  await supplier.openStatementSource(tap('unrelated', { kind: 'order' })); assert.equal(supplier.data.statementId, 'bill');
  await supplier.openStatementSource(tap('order', { kind: 'order' }));
  assert.equal(supplier.data.activeView, 'orders'); assert.equal(supplier.data.statementReturnId, 'bill');
  await supplier.backToList(); assert.equal(supplier.data.activeView, 'reports');
  assert.equal(supplier.data.selectedStatement.payableAmount, '2');
  await supplier.openStatementSource(tap('order', { kind: 'order' }));
  supplier.changeView(tap('', { view: 'payments' }));
  assert.equal(supplier.data.statementReturnId, ''); assert.equal(supplier.data.statementId, '');
});

test('bill stays visible when related payments fail and can retry without rereading money', async () => {
  let attempts = 0;
  const supplier = page('supplier', async path => {
    if (path.startsWith('/payment-records')) { if (++attempts === 1) throw new Error('连接失败'); return []; }
    return { id: 'bill', payableAmount: '12.00', lines: [] };
  });
  await supplier.selectStatement(tap('bill'));
  assert.equal(supplier.data.selectedStatement.payableAmount, '12.00'); assert.equal(supplier.data.statementLoading, false);
  assert.match(supplier.data.statementPaymentError, /连接失败/); assert.equal(supplier.data.error, '');
  await supplier.retryStatementPayments(); assert.equal(supplier.data.statementPaymentError, '');
});

test('reopening the same bill cannot let an older response replace its latest balance', async () => {
  const resolves = [];
  const supplier = page('supplier', path => path.startsWith('/payment-records') ? Promise.resolve([]) : new Promise(resolve => resolves.push(resolve)));
  const old = supplier.selectStatement(tap('bill')); const current = supplier.selectStatement(tap('bill'));
  resolves[1]({ id: 'bill', payableAmount: '20.00', lines: [] }); await current;
  resolves[0]({ id: 'bill', payableAmount: '99.00', lines: [] }); await old;
  assert.equal(supplier.data.selectedStatement.payableAmount, '20.00');
});

test('bill payment and adjustment details keep a working return path and encoded source identity', async () => {
  const paths = [];
  const supplier = page('supplier', async path => {
    paths.push(path);
    if (path.startsWith('/payment-records?')) return [{ id: 'payment', allocations: [{ settlementItemId: 'base' }] }];
    if (path.startsWith('/payment-records/')) return { id: 'payment', status: 'CONFIRMED', allocations: [], evidenceFiles: [] };
    if (path.startsWith('/adjustments/')) return { id: 'adjustment/id', lines: [], periodStart: '2026-10-01', periodEndExclusive: '2026-11-01', originalPeriodStart: '2026-09-01', originalPeriodEndExclusive: '2026-10-01' };
    return { id: 'bill', lines: [{ settlementItemId: 'base' }], adjustmentItems: [{ settlementItemId: 'credit', adjustmentId: 'adjustment/id' }] };
  });
  await supplier.selectStatement(tap('bill'));
  await supplier.openStatementSource(tap('payment', { kind: 'payment' }));
  assert.equal(supplier.data.activeView, 'payments'); assert.equal(supplier.data.selectedPayment.id, 'payment');
  await supplier.backToList();
  await supplier.openStatementSource(tap('adjustment/id', { kind: 'adjustment' }));
  assert.equal(supplier.data.activeView, 'reports'); assert.equal(supplier.data.selectedAdjustment.periodText, '2026-10-01 至 2026-10-31');
  assert.equal(supplier.data.selectedAdjustment.originalPeriodText, '2026-09-01 至 2026-09-30');
  assert.ok(paths.includes('/adjustments/adjustment%2Fid'));
  await supplier.backToList(); assert.equal(supplier.data.selectedStatement.id, 'bill');
});

test('role order lists search and filter without silently truncating twenty rows', async () => {
  for (const role of ['supplier', 'purchaser']) {
    const rows = Array.from({ length: 25 }, (_, index) => ({ id: String(index), requestNo: `REQ-${index}`, supplierOrderNo: `SO-${index}`, status: index === 24 ? 'COMPLETED' : 'PUSHED' }));
    const screen = page(role, async () => rows);
    await screen[role === 'supplier' ? 'loadOrders' : 'loadRequests']();
    const list = role === 'supplier' ? 'visibleOrders' : 'visibleRequests';
    assert.equal(screen.data[list].length, 25);
    screen.onSearch({ detail: { value: '24' } });
    assert.equal(screen.data[list][0].id, '24');
    screen.filterStatus(tap('', { filter: 'PUSHED' }));
    assert.equal(screen.data[list].length, 0);
    screen.onSearch({ detail: { value: '' } });
    assert.equal(screen.data[list].length, 24);
    assert.match(screen.data.reportRange.from, /^\d{4}-\d{2}-01$/);
    assert.ok(screen.data.reportRange.to >= screen.data.reportRange.from);
  }
});

test('role detail return preserves in-flight operations and clears completed selection', () => {
  const supplier = page('supplier');
  supplier.data.selectedOrder = { id: 'order' }; supplier.data.shipping = true;
  supplier.changeView(tap('', { view: 'payments' })); assert.equal(supplier.data.activeView, 'orders');
  supplier.backToList(); assert.equal(supplier.data.selectedOrder.id, 'order');
  supplier.data.shipping = false; supplier.backToList(); assert.equal(supplier.data.selectedOrder, null);
  const purchaser = page('purchaser');
  purchaser.data.requestId = 'request'; purchaser.data.confirming = true;
  purchaser.backToList(); assert.equal(purchaser.data.requestId, 'request');
  purchaser.data.confirming = false; purchaser.backToList(); assert.equal(purchaser.data.requestId, '');
  purchaser.data.requestId = 'old'; purchaser.data.selectedRequest = { id: 'old' };
  purchaser.changeView(tap('', { view: 'rejections' }));
  assert.equal(purchaser.data.requestId, ''); assert.equal(purchaser.data.selectedRequest, null);
});

test('store catalog searches and filters real product units and hides invalid prices', async () => {
  const store = page('store', async () => ({ store: { name: '门店一', address: '上海市' }, items: [
    { product: { id: 'p1', name: '大米', sku: 'RICE', isActive: true, categoryId: 'food', categoryName: '粮食', unitName: '袋', minOrderQty: '2', orderMultiple: '2' }, suppliers: [{ supplierId: 's1', supplierName: '粮食供应商', salesPrice: '12', priceVersionId: 'v1' }] },
    { product: { id: 'p2', name: '清洁剂', isActive: true, categoryId: 'clean', categoryName: '清洁', unitName: '瓶', minOrderQty: '1', orderMultiple: '1' }, suppliers: [] },
  ] }));
  await store.loadCatalog();
  assert.equal(store.data.store.name, '门店一');
  assert.equal(store.data.visibleProducts.length, 2);
  assert.equal(store.data.visibleProducts[1].canOrder, false);
  store.stepProduct(tap('p2', { direction: 1 })); assert.equal(store.data.cart.length, 0);
  store.onSearch({ detail: { value: 'rice' } }); assert.equal(store.data.visibleProducts.length, 1);
  store.stepProduct(tap('p1', { direction: 1 })); assert.equal(store.data.cart[0].quantity, '2');
  assert.equal(store.data.estimatedAmount, '24.00');
  store.stepProduct(tap('p1', { direction: 1 })); assert.equal(store.data.cart[0].quantity, '4');
  store.stepProduct(tap('p1', { direction: -1 })); assert.equal(store.data.cart[0].quantity, '2');
  store.stepProduct(tap('p1', { direction: -1 })); assert.equal(store.data.cart.length, 0);
  store.onSearch({ detail: { value: '' } }); store.chooseCategory(tap('clean'));
  assert.equal(store.data.visibleProducts[0].id, 'p2');
});

test('unbound store shows a binding state before loading and cannot expose checkout controls', () => {
  const user = { id: 'multi-role', roles: ['STORE', 'SUPPLIER', 'PURCHASER'] };
  const store = page('store', async () => { throw new Error('No catalog request expected'); },
    { openWorkspace: () => user }, { getStorageSync: () => null });
  store.onShow();
  assert.equal(store.data.storeId, '');
  assert.equal(store.data.products.length, 0);
  const template = readFileSync('apps/miniprogram/pages/store/index.wxml', 'utf8');
  const binding = template.indexOf('class="empty-state store-unbound" wx:if="{{!storeId}}"');
  assert.ok(binding >= 0 && binding < template.indexOf('class="catalog-skeleton"'));
  assert.match(template, /class="order-bar" wx:if="\{\{canWrite && storeId\}\}"/);
  assert.match(template, /class="search-input"[^>]*disabled="\{\{!storeId\}\}"/);
  user.scope = { storeId: 'own-store' }; store.onShow();
  assert.equal(store.data.storeId, 'own-store');
  assert.equal(store.data.canWrite, true);
});

function orderPreview(price = '12', version = 'v1') {
  return { items: [{ productId: 'p1', supplierId: 's1', quantity: '2', salesUnitPrice: price, salesLineAmount: String(Number(price) * 2), priceVersionId: version }],
    totals: { salesGoodsAmount: String(Number(price) * 2) }, funding: { stored: { required: '24', available: '100', paid: '0', shortfall: '0.00' }, canConfirm: true } };
}

function prepareCart(store) {
  store.data.storeId = 'store'; store.data.user = { id: 'user' };
  store.data.products = [{ id: 'p1', name: '大米', unitName: '袋', supplierName: '粮食供应商', minOrderQty: '2', orderMultiple: '2' }];
  store.data.cart = [{ productId: 'p1', name: '大米', quantity: '2' }];
}

test('store checkout groups suppliers and requires a second review when prices change', async () => {
  let calls = 0, writes = 0;
  const store = page('store', async path => {
    if (path.endsWith('/preview')) return ++calls === 1 ? orderPreview() : orderPreview('14', 'v2');
    writes++; return { id: 'request' };
  });
  prepareCart(store); await store.previewOrder();
  assert.equal(store.data.orderStep, 'confirm');
  assert.equal(store.data.previewGroups[0].supplierName, '粮食供应商');
  assert.equal(store.data.previewGroups[0].items[0].unitName, '袋');
  await store.submitOrder(); assert.equal(writes, 0);
  assert.match(store.data.error, /重新核对/);
  assert.equal(store.data.preview.items[0].priceVersionId, 'v2');
});

test('native unit labels prefer current names while leaving transaction snapshots unchanged', () => {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/store-view.js', 'utf8'), { module });
  const unitSnapshot = { salesUnitName: '旧单位', salesUnitsPerPurchaseUnit: '12' };
  const preview = { items: [{ productId: 'p', supplierId: 's', unitName: '新单位', quantity: '24', unitSnapshot }] };
  const groups = module.exports.previewGroups(preview, [{ id: 'p', name: '水', unitName: '其他单位' }]);
  assert.equal(groups[0].items[0].unitName, '新单位');
  assert.equal(preview.items[0].unitSnapshot.salesUnitName, '旧单位');
  assert.equal(preview.items[0].quantity, '24');
});

test('uncertain order submission retains the same key and body while cart changes are locked', async () => {
  const submissions = []; let failed = false;
  const store = page('store', async (path, options) => {
    if (path.endsWith('/preview')) return orderPreview();
    if (path === '/purchase-requests' && options) {
      submissions.push(plain(options));
      if (!failed) { failed = true; const error = new Error('断网'); error.uncertain = true; throw error; }
      return { id: 'r1' };
    }
    if (path === '/purchase-requests/r1') return { items: [], supplierOrders: [] };
    return [];
  });
  prepareCart(store); await store.previewOrder(); await store.submitOrder();
  assert.ok(store.data.pendingOrder);
  store.removeCartItem(tap('p1')); assert.equal(store.data.cart.length, 1);
  await store.submitOrder(); assert.equal(store.data.pendingOrder, null);
  assert.deepEqual(submissions[0].header, submissions[1].header);
  assert.deepEqual(submissions[0].data, submissions[1].data);
  assert.equal(store.data.activeView, 'orders');
});

test('credit shortfall blocks checkout without sending a create command', async () => {
  let writes = 0;
  const preview = { ...orderPreview(), funding: { ...orderPreview().funding, credit: { required: '24', available: '10', shortfall: '14.00' } } };
  const store = page('store', async path => { if (path.endsWith('/preview')) return preview; writes++; return {}; });
  prepareCart(store); await store.previewOrder(); await store.submitOrder();
  assert.equal(writes, 0); assert.match(store.data.error, /挂账额度不足/);
});

test('order filters use aggregate completion rather than procurement CONFIRMED status', async () => {
  const store = page('store', async () => [
    { id: 'r1', status: 'CONFIRMED', supplierCount: 2, completedSupplierCount: 2, paymentStatus: 'PAID' },
    { id: 'r2', status: 'CONFIRMED', supplierCount: 2, completedSupplierCount: 1, paymentStatus: 'UNPAID' },
    { id: 'r3', status: 'PENDING_FUNDS', paymentStatus: 'UNPAID' },
  ]);
  await store.loadRequests(); store.filterOrders({ currentTarget: { dataset: { filter: 'completed' } } });
  assert.deepEqual(plain(store.data.filteredRequests.map(order => order.id)), ['r1']);
  store.filterOrders({ currentTarget: { dataset: { filter: 'receive' } } });
  assert.deepEqual(plain(store.data.filteredRequests.map(order => order.id)), ['r2']);
  store.filterFunding({ detail: { value: true } }); assert.equal(store.data.filteredRequests.length, 1);
});

test('receipt retry keeps the original revision and quantities after a network failure', async () => {
  const writes = [];
  const store = page('store', async (path, options) => {
    if (!options) return { id: 's1', shipmentNo: 'SH1', supplierOrderVersion: 8, currentReceiptRevision: 1, items: [{ id: 'i1', shippedQuantity: '3' }] };
    writes.push(plain(options));
    if (writes.length === 1) { const error = new Error('断网'); error.uncertain = true; throw error; }
    return { id: 'receipt', revision: 2 };
  });
  store.data.user = { id: 'user' }; await store.selectShipment(tap('s1'));
  store.data.receiptEvidence = [{ id: 'evidence', status: 'READY' }];
  store.onReceiptQuantity(input('i1', '2')); await store.receiveShipment(tap('', { mode: 'SHORT' }));
  store.onReceiptQuantity(input('i1', '3')); assert.equal(store.data.receiptItems[0].receivedQuantity, '2');
  await store.receiveShipment(tap('', { mode: 'FULL' }));
  assert.deepEqual(writes[0], writes[1]); assert.equal(store.data.pendingReceipt, null);
});

test('unchanged submitted receipts cannot create another revision but correction remains available', async () => {
  let writes = 0;
  const store = page('store', async (path, options) => {
    if (options) { writes++; return { id: 'receipt', revision: 2 }; }
    return { id: 's1', supplierOrderVersion: 8, currentReceiptRevision: 1, items: [{ id: 'i1', shippedQuantity: '3', currentReceivedQuantity: '3', receiptLocked: false }] };
  });
  await store.selectShipment(tap('s1')); assert.equal(store.data.receiptCanSubmit, false);
  store.data.receiptEvidence = [{ id: 'evidence', status: 'READY' }];
  await store.receiveShipment(tap('', { mode: 'FULL' })); assert.equal(writes, 0);
  store.onReceiptQuantity(input('i1', '2')); assert.equal(store.data.receiptCanSubmit, true);
  await store.receiveShipment(tap('', { mode: 'SHORT' })); assert.equal(writes, 1);
});

test('store finance role cannot invoke order or receipt write handlers', async () => {
  let calls = 0;
  const store = page('store', async () => { calls++; return {}; });
  prepareCart(store); store.data.canWrite = false;
  store.stepProduct(tap('p1', { direction: 1 })); await store.previewOrder(); await store.submitOrder();
  await store.receiveShipment(tap('', { mode: 'FULL' }));
  assert.equal(calls, 0); assert.equal(store.data.cart[0].quantity, '2');
});

test('store cart submits multiple products and validates minimum/multiple', () => {
  const store = page('store');
  store.data.storeId = 'store';
  store.data.products = [
    { id: 'p1', name: '商品一', minOrderQty: '2', orderMultiple: '2' },
    { id: 'p2', name: '商品二', minOrderQty: '0.1', orderMultiple: '0.1' },
  ];
  store.selectProduct({ detail: { value: '0' } });
  store.data.quantity = '3'; store.addToCart(); assert.equal(store.data.cart.length, 0);
  store.data.quantity = '4'; store.addToCart();
  store.selectProduct({ detail: { value: '1' } }); store.data.quantity = '0.3'; store.addToCart();
  assert.deepEqual(plain(store.orderInput()), { storeId: 'store', items: [{ productId: 'p1', quantity: '4' }, { productId: 'p2', quantity: '0.3' }] });
  store.data.quantity = '0.5'; store.addToCart(); assert.equal(store.data.cart.length, 2);
  assert.equal(store.data.cart[1].quantity, '0.5');
  store.removeCartItem(tap('p1')); assert.equal(store.data.cart.length, 1);
});

test('store receipts preserve per-item counts and displayed version; reject over-receipt', async () => {
  let payload;
  const shipment = { id: 's1', shipmentNo: 'S1', supplierOrderVersion: 7, currentReceiptRevision: 2,
    items: [{ id: 'i1', shippedQuantity: '4' }, { id: 'i2', shippedQuantity: '3' }] };
  const store = page('store', async (path, options) => {
    if (path.endsWith('/receipts')) { payload = options.data; return { id: 'r1', revision: 3 }; }
    return shipment;
  });
  await store.selectShipment(tap('s1'));
  store.onReceiptQuantity(input('i1', '2')); store.onReceiptQuantity(input('i2', '0'));
  store.data.receiptEvidence = [{ id: 'evidence', status: 'READY' }];
  await store.receiveShipment(tap('', { mode: 'SHORT' }));
  assert.deepEqual(plain(payload), { expectedOrderVersion: 7, expectedReceiptRevision: 2, evidenceFileIds: ['evidence'],
    items: [{ shipmentItemId: 'i1', receivedQuantity: '2' }, { shipmentItemId: 'i2', receivedQuantity: '0' }] });
  payload = null; await store.selectShipment(tap('s1')); store.onReceiptQuantity(input('i2', '4'));
  await store.receiveShipment(tap('', { mode: 'SHORT' })); assert.equal(payload, null); assert.match(store.data.error, /超过/);
});

test('returned receipt review preserves finalized rows and applies only the revised quantity delta', async () => {
  let payload;
  const store = page('store', async (path, options) => {
    if (path.endsWith('/receipts')) { payload = options.data; return { revision: 2 }; }
    return { id: 's1', supplierOrderVersion: 8, currentReceiptRevision: 1, items: [
      { id: 'accepted', shippedQuantity: '3', currentReceivedQuantity: '2', receiptLocked: true },
      { id: 'returned', shippedQuantity: '3', currentReceivedQuantity: '2', receiptLocked: false },
    ] };
  });
  await store.selectShipment(tap('s1'));
  store.onReceiptQuantity(input('accepted', '3'));
  store.data.receiptEvidence = [{ id: 'evidence', status: 'READY' }];
  assert.equal(store.data.receiptItems[0].receivedQuantity, '2');
  await store.receiveShipment(tap('', { mode: 'FULL' }));
  assert.deepEqual(plain(payload), { expectedOrderVersion: 8, expectedReceiptRevision: 1, evidenceFileIds: ['evidence'],
    items: [{ shipmentItemId: 'accepted', receivedQuantity: '2' }, { shipmentItemId: 'returned', receivedQuantity: '3' }] });
});

test('receipt evidence is required before a new native submission and failures remain retryable', async () => {
  let writes = 0, attempts = 0;
  const store = page('store', async (path, options) => {
    if (options) { writes++; return { id: 'r', revision: 1 }; }
    return { id: 's', supplierOrderVersion: 1, currentReceiptRevision: 0, items: [{ id: 'i', shippedQuantity: '1' }] };
  }, { chooseEvidence: async () => [{ path: 'photo' }], uploadEvidence: async (path, purpose) => {
    assert.equal(purpose, 'RECEIPT'); if (++attempts === 1) throw new Error('断网'); return { id: 'file', mimeType: 'image/jpeg' };
  } });
  await store.selectShipment(tap('s'));
  await store.receiveShipment(tap('', { mode: 'FULL' })); assert.equal(writes, 0); assert.match(store.data.error, /凭证/);
  await store.chooseReceiptEvidence(); assert.equal(store.data.receiptEvidence[0].status, 'FAILED');
  await store.receiveShipment(tap('', { mode: 'FULL' })); assert.equal(writes, 0);
  await store.retryReceiptEvidence(tap('', { index: 0 })); assert.equal(store.data.receiptEvidence[0].status, 'READY');
  await store.receiveShipment(tap('', { mode: 'FULL' })); assert.equal(writes, 1); assert.equal(store.data.receiptEvidence.length, 0);
});

test('receipt upload locks navigation and cannot attach a stale image to another shipment', async () => {
  let complete;
  const store = page('store', async () => ({ id: 's', items: [{ id: 'i', shippedQuantity: '1' }] }), {
    chooseEvidence: async () => [{ path: 'photo' }], uploadEvidence: () => new Promise(resolve => { complete = resolve; })
  });
  await store.selectShipment(tap('s'));
  const pending = store.chooseReceiptEvidence();
  for (let index = 0; index < 5 && !complete; index++) await Promise.resolve();
  store.closeShipment(); await store.selectShipment(tap('other')); store.changeView(tap('', { view: 'orders' }));
  assert.equal(store.data.shipmentId, 's'); assert.equal(store.data.activeView, 'receive');
  complete({ id: 'file' }); await pending;
  store.removeReceiptEvidence(tap('', { index: 0 })); assert.equal(store.data.receiptEvidence.length, 0);
});

test('native evidence upload sends binary content with its session token before completion', async () => {
  const calls = [], module = { exports: {} };
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), { module, Uint8Array,
    getApp: () => ({ globalData: { apiBase: 'http://local/api/v1' } }),
    wx: { getStorageSync: key => key === 'procurexToken' ? 'test-token' : '',
      getFileSystemManager: () => ({ readFile: options => options.success({ data: bytes }) }),
      request: options => { calls.push(options); options.success({ statusCode: 201, data: { data: calls.length === 1 ? { id: 'file', uploadToken: 'upload-token' } : calls.length === 3 ? { status: 'READY' } : { uploaded: true } } }); }
    }
  });
  const file = await module.exports.uploadEvidence('photo', 'RECEIPT');
  assert.equal(file.id, 'file'); assert.equal(file.mimeType, 'image/png');
  assert.equal(calls[0].data.purpose, 'RECEIPT'); assert.equal(calls[0].data.sizeBytes, 8);
  assert.equal(calls[1].data, bytes); assert.equal(calls[1].header['content-type'], 'application/octet-stream');
  assert.equal(calls[1].header['x-upload-token'], 'upload-token');
  assert.equal(calls[1].header.authorization, 'Bearer test-token'); assert.match(calls[2].url, /\/complete$/);
});

test('unchanged submitted receipt cannot open an upload draft until a legal quantity correction', async () => {
  let selections = 0;
  const store = page('store', async () => ({ id: 's', currentReceiptRevision: 1, items: [{ id: 'i', shippedQuantity: '2', currentReceivedQuantity: '2' }] }),
    { chooseEvidence: async () => { selections++; return []; } });
  await store.selectShipment(tap('s')); await store.chooseReceiptEvidence(); assert.equal(selections, 0);
  store.onReceiptQuantity(input('i', '1')); await store.chooseReceiptEvidence(); assert.equal(selections, 1);
});

test('native evidence rejects unreadable or unsupported bytes before creating an upload session', async () => {
  const module = { exports: {} }; let calls = 0;
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), { module, Uint8Array,
    wx: { getFileSystemManager: () => ({ readFile: options => options.success({ data: Uint8Array.from([1, 2, 3]).buffer }) }), request: () => { calls++; } }
  });
  await assert.rejects(module.exports.uploadEvidence('invalid', 'RECEIPT'), /JPEG/); assert.equal(calls, 0);
});

test('superseded upload responses cannot restore evidence after an account reset', async () => {
  let complete;
  const store = page('store', undefined, { uploadEvidence: () => new Promise(resolve => { complete = resolve; }) });
  store.receiptUploadSequence = 1; store.data.receiptEvidence = [{ path: 'old', status: 'UPLOADING' }];
  const upload = store.uploadReceiptEvidence('old');
  store.receiptUploadSequence++; store.data.receiptEvidence = [];
  complete({ id: 'old-file' }); await upload; assert.equal(store.data.receiptEvidence.length, 0);
});

test('supplier partial shipment uses remaining quantities and omits zero rows', async () => {
  let payload;
  const supplier = page('supplier', async (path, options) => {
    if (path.endsWith('/shipment-preview')) return { totals: { shipQuantity: '0.1' } };
    if (path.endsWith('/shipments')) { payload = options.data; return { id: 's1' }; }
    return { id: 'o1', version: 9, items: [
      { id: 'i1', productId: 'p1', quantity: '0.3', shippedQuantity: '0.2' },
      { id: 'i2', productId: 'p2', quantity: '3', shippedQuantity: '1' },
    ] };
  });
  await supplier.loadOrder('o1'); assert.equal(supplier.data.shipmentItems[0].shipQuantity, '0.1');
  supplier.onShipQuantity(input('i2', '0')); await supplier.shipOrder();
  assert.equal(payload.expectedVersion, 9);
  assert.deepEqual(plain(payload.items), [{ orderItemId: 'i1', shipQuantity: '0.1', permanentlyReduceQuantity: '0' }]);
  payload = null; await supplier.loadOrder('o1'); supplier.onShipQuantity(input('i1', '0.2'));
  await supplier.shipOrder(); assert.equal(payload, null); assert.match(supplier.data.error, /超过/);
});

test('supplier rejects with operator reason and blocks an empty reason', async () => {
  let payload;
  const supplier = page('supplier', async (path, options) => { payload = options.data; return { status: 'REJECTED' }; });
  supplier.data.supplierOrderId = 'o1'; supplier.data.selectedOrder = { version: 4, supplierOrderNo: 'O1' };
  await supplier.rejectOrder(); assert.equal(payload, undefined);
  supplier.data.rejectionReason = '缺货'; await supplier.rejectOrder();
  assert.deepEqual(plain(payload), { expectedVersion: 4, reason: '缺货' });
});

test('purchaser reallocation includes only rejected order products', async () => {
  let payload;
  const purchaser = page('purchaser', async (path, options) => {
    if (path.endsWith('/reallocate')) { payload = options.data; return { status: 'CONFIRMED' }; }
    if (path.startsWith('/supplier-orders/')) return { id: 'o1', requestId: 'r1', status: 'REJECTED', items: [{ productId: 'p2' }] };
    return { id: 'r1', version: 6, supplierOrders: [{ id: 'o1', rejectionHandled: false }], items: [{ id: 'i1', productId: 'p1' }, { id: 'i2', productId: 'p2' }] };
  });
  Object.assign(purchaser.data, { requestId: 'r1', rejectedOrderId: 'o1', targetSupplierId: 's2' });
  await purchaser.reallocateRequest();
  assert.equal(payload.expectedVersion, 6);
  assert.equal(purchaser.data.result.status, 'REALLOCATED');
  assert.deepEqual(plain(payload.assignments), [{ requestItemId: 'i2', supplierId: 's2' }]);
});

test('rapid shipment selection ignores stale detail responses', async () => {
  let resolveFirst;
  const store = page('store', path => path.endsWith('/first') ? new Promise(resolve => { resolveFirst = resolve; })
    : Promise.resolve({ shipmentNo: 'SECOND', items: [] }));
  const first = store.selectShipment(tap('first'));
  await store.selectShipment(tap('second'));
  resolveFirst({ shipmentNo: 'FIRST', items: [] }); await first;
  assert.equal(store.data.selectedShipment.shipmentNo, 'SECOND');
});

test('single-role navigation hides other role entries and redirects unauthorized workspace', () => {
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), {
    module, wx: {
      getStorageSync: () => ({ id: 'u1', roles: ['STORE'] }),
      hideTabBar: () => calls.push('hide'), showTabBar: () => calls.push('show'),
      switchTab: options => calls.push(options.url), redirectTo: options => calls.push(options.url),
    },
  });
  assert.equal(module.exports.openWorkspace('supplier'), null);
  assert.deepEqual(calls, ['hide', '/pages/store/index']);
  assert.equal(module.exports.openWorkspace('store').id, 'u1');
});

test('supplier allocates replenishment gaps and uses only confirmed unused freight', async () => {
  let payload;
  let previews = 0;
  const supplier = page('supplier', async (path, options) => {
    if (path.endsWith('/shipment-preview')) { previews++; return { totals: { shipQuantity: '2' } }; }
    if (path.endsWith('/shipments')) { payload = options.data; return { id: 's1' }; }
    return { id: 'o1', status: 'PARTIAL_SHIPPED', version: 5, items: [
      { id: 'i1', quantity: '5', shippedQuantity: '3', replenishmentGaps: [{ id: 'g1', remainingQuantity: '2', status: 'PENDING' }] },
    ], freightConfirmations: [
      { id: 'f1', amount: '8.50', status: 'CONFIRMED', usedAt: null, reason: '补发' },
      { id: 'f2', amount: '3.00', status: 'PENDING', usedAt: null },
      { id: 'f3', amount: '2.00', status: 'CONFIRMED', usedAt: 'used' },
    ] };
  });
  await supplier.loadOrder('o1'); assert.equal(supplier.data.freightChoices.length, 2);
  supplier.onGapQuantity({ currentTarget: { dataset: { id: 'i1', gapId: 'g1' } }, detail: { value: '2' } });
  supplier.selectFreight({ detail: { value: '1' } }); await supplier.shipOrder();
  assert.equal(payload.freight, '8.50'); assert.equal(payload.freightConfirmationId, 'f1');
  assert.deepEqual(plain(payload.items[0].gapAllocations), [{ gapId: 'g1', quantity: '2' }]);
  await supplier.loadOrder('o1'); supplier.onShipQuantity(input('i1', '1'));
  supplier.onGapQuantity({ currentTarget: { dataset: { id: 'i1', gapId: 'g1' } }, detail: { value: '2' } });
  await supplier.shipOrder(); assert.equal(previews, 1); assert.match(supplier.data.error, /超过/);
});

test('fully shipped supplier order exposes only the open gap as replenishment capacity', async () => {
  const supplier = page('supplier', async () => ({ id: 'o1', status: 'SHIPPED', items: [
    { id: 'i1', quantity: '3', shippedQuantity: '3', replenishmentGaps: [{ id: 'g1', remainingQuantity: '1', status: 'PENDING' }] },
  ] }));
  await supplier.loadOrder('o1');
  assert.equal(supplier.data.selectedOrder.canShip, true);
  assert.equal(supplier.data.shipmentItems[0].remainingQuantity, '1');
  assert.equal(supplier.data.shipmentItems[0].shipQuantity, '0');
});

test('resolved discrepancy is read-only and replenish preserves displayed version', async () => {
  let payload;
  const supplier = page('supplier', async (path, options) => {
    if (path.endsWith('/resolve')) { payload = options.data; return { id: 'd1', status: 'REPLENISH_PENDING', missingQuantity: '1', replenishmentGap: { id: 'g1', remainingQuantity: '1' } }; }
    return { id: 'd1', status: 'OPEN', version: 8, missingQuantity: '1', productName: '商品' };
  });
  await supplier.loadDiscrepancy('d1'); await supplier.resolveDiscrepancy(tap('', { action: 'REPLENISH' }));
  assert.equal(payload.expectedVersion, 8); assert.equal(supplier.data.selectedDiscrepancy.productName, '商品');
  payload = null; await supplier.resolveDiscrepancy(tap('', { action: 'ACCEPT' })); assert.equal(payload, null);
});

test('payment rejection requires actual reason and keeps displayed version', async () => {
  let payload;
  const supplier = page('supplier', async (path, options) => {
    if (path.endsWith('/reject')) { payload = options.data; return { id: 'p1', status: 'REJECTED', amount: '90.00' }; }
    if (path.includes('/supplier-statements') || path.includes('?')) return [];
    return { id: 'p1', status: 'PENDING', version: 4, evidenceFiles: [{ id: 'file1', filename: '凭证.pdf' }] };
  });
  await supplier.loadPayment('p1'); await supplier.handlePayment(tap('', { action: 'reject' })); assert.equal(payload, undefined);
  supplier.data.paymentReason = '金额不符'; await supplier.handlePayment(tap('', { action: 'reject' }));
  assert.deepEqual(plain(payload), { expectedVersion: 4, reason: '金额不符' });
  assert.equal(supplier.data.selectedPayment.evidenceFiles[0].id, 'file1');
  payload = null; await supplier.handlePayment(tap('', { action: 'confirm' })); assert.equal(payload, null);
});

test('purchaser reviews selected freight version and blocks repeated review', async () => {
  let payload;
  const purchaser = page('purchaser', async (path, options) => {
    if (path.endsWith('/confirm')) { payload = options.data; return { id: 'f1', status: 'CONFIRMED', amount: '8.50' }; }
    return [];
  });
  purchaser.data.freightConfirmations = [{ id: 'f1', status: 'PENDING', version: 3, amount: '8.50', supplierOrderNo: 'O1' }];
  purchaser.selectFreight(tap('f1')); await purchaser.reviewFreight(tap('', { action: 'confirm' }));
  assert.deepEqual(plain(payload), { expectedVersion: 3 }); assert.equal(purchaser.data.selectedFreight.supplierOrderNo, 'O1');
  payload = null; await purchaser.reviewFreight(tap('', { action: 'confirm' })); assert.equal(payload, null);
});

test('evidence download authenticates and never opens unsuccessful responses', async () => {
  let opened = false;
  let code = 403;
  const module = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/api.js', 'utf8'), {
    module, getApp: () => ({ globalData: { apiBase: 'http://localhost/api/v1' } }), wx: {
      getStorageSync: key => key === 'procurexToken' ? 'test-token' : '',
      downloadFile: options => { assert.equal(options.header.authorization, 'Bearer test-token'); options.success({ statusCode: code, tempFilePath: '/temp/evidence' }); },
      openDocument: options => { opened = true; assert.equal(options.fileType, 'pdf'); options.success(); },
    },
  });
  await assert.rejects(module.exports.previewEvidence({ id: 'file1', mimeType: 'application/pdf' }), /下载失败/); assert.equal(opened, false);
  code = 200; await module.exports.previewEvidence({ id: 'file1', mimeType: 'application/pdf' }); assert.equal(opened, true);
});
