import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedRoutes, canEdit, createWorkspaceClient, resolveApiBase, SESSION_KEY } from '../apps/web/product-app/workspace-session.js';
import { purchasingSignature, repairDraftLines } from '../apps/web/product-app/workspace-purchasing.js';
import { shipmentSignature } from '../apps/web/product-app/workspace-supplier.js';
import { receiptChanged } from '../apps/web/product-app/workspace-store.js';
import { clearingSignature, filterCreditItems } from '../apps/web/product-app/workspace-finance.js';

test('store finance filters credit dates and supplier without retaining hidden selections', () => {
  const rows = [
    { id: 'a', occurredAt: '2026-10-01T12:00:00Z', supplierId: 'one' },
    { id: 'b', occurredAt: '2026-10-02T12:00:00Z', supplierId: 'two' },
    { id: 'c', occurredAt: '2026-10-02T12:00:00Z', supplierId: null },
  ];
  assert.deepEqual(filterCreditItems(rows, { from: '2026-10-02', to: '2026-10-02', supplierId: 'two' }).map(row => row.id), ['b']);
  assert.deepEqual(filterCreditItems(rows, { supplierId: 'unassigned' }).map(row => row.id), ['c']);
  assert.deepEqual(filterCreditItems(rows, { from: '2026-10-03', to: '2026-10-01' }), []);
  assert.equal(filterCreditItems(rows).length, 3);
  for (const role of ['STORE', 'STORE_FINANCE', 'SUPPLIER', 'PURCHASER']) {
    assert.ok(!allowedRoutes({ roles: [role] }).includes('collection-accounts'));
    assert.ok(!allowedRoutes({ roles: [role] }).includes('store-finance'));
  }
  assert.ok(allowedRoutes({ roles: ['HQ_FINANCE'] }).includes('store-finance'));
});
import { paymentSignature } from '../apps/web/product-app/workspace-payments.js';
import { differenceSignature } from '../apps/web/product-app/workspace-differences.js';
import { composeAddress, splitAddress } from '../apps/web/product-app/workspace-address.js';
import { navigationGroups } from '../apps/web/product-app/workspace-navigation.js';

test('grouped navigation covers each permitted route exactly once and hides empty groups', () => {
  for (const role of ['ADMIN', 'PURCHASER', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER']) {
    const routes = allowedRoutes({ roles: [role] });
    const groups = navigationGroups(routes);
    assert.deepEqual(groups.flatMap(group => group.routes).sort(), [...routes].sort());
    assert.ok(groups.every(group => group.routes.length));
  }
  assert.deepEqual(navigationGroups([]), []);
  assert.deepEqual(navigationGroups(allowedRoutes({ roles: ['STORE'] })).map(group => group.id), ['operations', 'finance', 'account']);
});

test('store addresses round trip selected regions and preserve legacy text', () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ address_province: '44', address_city: '4401', address_district: '440106', address: '体育西路100号' })) data.set(key, value);
  const address = composeAddress(data, 'address');
  assert.deepEqual(splitAddress(address), { province: '44', city: '4401', district: '440106', detail: '体育西路100号' });
  assert.equal(splitAddress('上海市门店路1号').detail, '上海市门店路1号');
  data.set('address_city', '1101'); assert.throws(() => composeAddress(data, 'address'));
  data.set('address_city', '4401'); data.set('address', 'x'.repeat(300)); assert.throws(() => composeAddress(data, 'address'));
  data.set('address_province', '11'); data.set('address_city', '1101'); data.set('address_district', '110101'); data.set('address', '1号');
  assert.equal(splitAddress(composeAddress(data, 'address')).district, '110101');
});

test('invalid original draft configuration is retained for explicit removal, supplier and unit repair', () => {
  const product = { id: 'p', baseUnitId: 'piece', purchaseUnitConversion: { purchaseUnitId: 'box', salesUnitsPerPurchaseUnit: '6' } };
  const catalog = { items: [{ product, suppliers: [{ supplierId: 'new' }] }] };
  const detail = { items: [{ productId: 'p', productName: 'Original', supplierId: 'old', quantity: '12',
    unitSnapshot: { inputUnitId: 'box', inputQuantity: '2', salesUnitId: 'piece', salesUnitsPerPurchaseUnit: '5' } },
  { productId: 'gone', productName: 'Unavailable', supplierId: 'old', quantity: '3' }] };
  const lines = repairDraftLines(detail, catalog);
  assert.equal(lines.length, 2); assert.equal(lines[0].supplierId, ''); assert.equal(lines[0].unitId, '');
  assert.equal(lines[0].quantity, '2'); assert.equal(lines[1].unavailable, true); assert.equal(lines[1].quantity, '3');
  assert.equal(detail.items[0].supplierId, 'old');
  const valid = repairDraftLines({ items: [{ ...detail.items[0], supplierId: 'new', unitSnapshot: { ...detail.items[0].unitSnapshot, salesUnitsPerPurchaseUnit: '6' } }] }, catalog)[0];
  assert.equal(valid.unitId, 'box'); assert.equal(valid.supplierId, 'new');
});

test('difference approval tracks real credit identity, remaining money and existing disposal', () => {
  const detail = { id: 'row', storeId: 'a', supplierId: 'b', direction: 'STORE_RECEIVABLE_DECREASE', disposalCreditItemId: 'credit', pendingReturnOrOffsetAmount: '10.00', sourceRevision: 1, processingStatus: 'PENDING_DISPOSAL' };
  for (const change of [{ pendingReturnOrOffsetAmount: '0.00' }, { disposalCreditItemId: 'other' }, { sourceRevision: 2 }, { disposal: { disposalId: 'processed', version: 1 } }, { direction: 'SUPPLIER_PAYABLE_DECREASE' }]) {
    assert.notEqual(differenceSignature(detail), differenceSignature({ ...detail, ...change }));
  }
});

test('payment approval tracks reserved money, source versions, channel, parties and blockers', () => {
  const preview = { direction: 'STORE_TO_COMPANY', channel: 'COMPANY', storeId: 'a', supplierId: 'b', totalPayableAmount: '10.00', blockedItems: [], items: [{ settlementItemId: 'x', sourceVersion: 1, payableAmount: '10.00', pendingPaymentAmount: '0.00', confirmedPaidAmount: '0.00' }] };
  for (const change of [{ channel: 'DIRECT' }, { storeId: 'other' }, { totalPayableAmount: '9.00' }, { blockedItems: [{ settlementItemId: 'x', code: 'BLOCKED' }] }, { items: [{ ...preview.items[0], sourceVersion: 2 }] }, { items: [{ ...preview.items[0], pendingPaymentAmount: '1.00' }] }]) {
    assert.notEqual(paymentSignature(preview), paymentSignature({ ...preview, ...change }));
  }
});

test('clearing approval tracks exact amounts, versions, store and item identity, independent of sorting', () => {
  const preview = { storeId: 'store', totalAmount: '3.00', items: [{ fundingAllocationId: 'a', version: 1, clearableAmount: '1.00' }, { fundingAllocationId: 'b', version: 2, clearableAmount: '2.00' }] };
  assert.equal(clearingSignature(preview), clearingSignature({ ...preview, items: [...preview.items].reverse() }));
  for (const change of [{ storeId: 'other' }, { totalAmount: '3.01' }, { items: [{ ...preview.items[0], version: 2 }, preview.items[1]] }, { items: [{ ...preview.items[0], clearableAmount: '1.01' }, preview.items[1]] }, { items: [preview.items[0]] }]) {
    assert.notEqual(clearingSignature(preview), clearingSignature({ ...preview, ...change }));
  }
});

test('receipt edits compare exact decimal quantities and ignore locked rows', () => {
  const detail = { currentReceiptRevision: 1, items: [{ id: 'a', currentReceivedQuantity: '1.000001', receiptLocked: false }, { id: 'b', currentReceivedQuantity: '2', receiptLocked: true }] };
  assert.equal(receiptChanged(detail, [{ shipmentItemId: 'a', receivedQuantity: '01.000001' }, { shipmentItemId: 'b', receivedQuantity: '3' }]), false);
  assert.equal(receiptChanged(detail, [{ shipmentItemId: 'a', receivedQuantity: '1.000002' }]), true);
  assert.equal(receiptChanged({ ...detail, currentReceiptRevision: 0 }, []), true);
  assert.throws(() => receiptChanged(detail, [{ shipmentItemId: 'a', receivedQuantity: '1e0' }]));
});

test('shipment approval includes versions, reductions, replenishment allocations and approved freight', () => {
  const item = { orderItemId: 'a', shipQuantity: '2', permanentlyReduceQuantity: '1', remainingQuantityBefore: '4', remainingQuantityAfter: '1', supplyLineAmount: '12', gapAllocations: [] };
  const quote = { version: 1, items: [item], totals: { supplyGoodsAmount: '12', freight: '0' } };
  for (const change of [{ shipQuantity: '3' }, { permanentlyReduceQuantity: '0' }, { remainingQuantityAfter: '2' }, { supplyLineAmount: '13' }, { gapAllocations: [{ gapId: 'g', quantity: '1' }] }]) {
    assert.notEqual(shipmentSignature(quote), shipmentSignature({ ...quote, items: [{ ...item, ...change }] }));
  }
  assert.notEqual(shipmentSignature(quote), shipmentSignature({ ...quote, version: 2 }));
  assert.notEqual(shipmentSignature(quote), shipmentSignature({ ...quote, freightConfirmationId: 'approved' }));
  assert.notEqual(shipmentSignature(quote), shipmentSignature({ ...quote, totals: { ...quote.totals, freight: '5' } }));
});

test('purchasing preview approval includes both price sources, units, quantities and eligibility', () => {
  const quote = { items: [{ productId: 'p', quantity: '2', priceVersionId: 'sale-a', supplyPriceVersionId: 'cost-a', eligible: true, unitSnapshot: { inputUnitId: 'bottle' } }], totals: { salesGoodsAmount: '20' } };
  for (const change of [{ quantity: '3' }, { priceVersionId: 'sale-b' }, { supplyPriceVersionId: 'cost-b' }, { eligible: false }, { unitSnapshot: { inputUnitId: 'box' } }]) {
    assert.notEqual(purchasingSignature(quote), purchasingSignature({ ...quote, items: [{ ...quote.items[0], ...change }] }));
  }
  assert.notEqual(purchasingSignature({ ...quote, templateId: 'original' }), purchasingSignature({ ...quote, templateId: 'replacement' }));
});

test('PATCH commands persist and recover their method with the original key and body', async () => {
  const store = storage(); store.setItem(`${SESSION_KEY}:${base}`, JSON.stringify(session)); const calls = [];
  const client = createWorkspaceClient({ base, storage: store, fetcher: async (_url, options) => {
    calls.push(options); if (calls.length === 1) throw new Error('lost'); return ok({ version: 2 });
  } });
  await assert.rejects(client.command('/purchase-requests/a/items', { expectedVersion: 1 }, 'PATCH'));
  await client.recoverCommand(); assert.equal(calls[0].method, 'PATCH'); assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[0].body, calls[1].body); assert.equal(calls[0].headers['idempotency-key'], calls[1].headers['idempotency-key']);
});

const storage = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const base = 'http://127.0.0.1:3113/api/v1';
const session = { accessToken: 'test-token', expiresAt: new Date(Date.now() + 60000).toISOString(), user: { id: 'user-a', roles: ['PURCHASER'] } };
const ok = data => new Response(JSON.stringify({ data }), { status: 200 });
const error = (status, code) => new Response(JSON.stringify({ code, message: code }), { status });

test('credit reincrease after an adjustment is a readable definite reconciliation blocker', async () => {
  const client = createWorkspaceClient({ base, storage: storage(), fetcher: async () => error(409, 'CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED') });
  await assert.rejects(client.request('/test'), failure => failure.code === 'CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED'
    && !failure.uncertain && failure.message.includes('有效已付金额'));
});

test('cleared-credit blocker describes independent adjustment without marking the response uncertain', async () => {
  const client = createWorkspaceClient({ base, storage: storage(), fetcher: async () => error(409, 'CLEARED_CREDIT_ADJUSTMENT_REQUIRED') });
  await assert.rejects(client.request('/test'), failure => failure.code === 'CLEARED_CREDIT_ADJUSTMENT_REQUIRED'
    && !failure.uncertain && failure.message.includes('独立结算调整'));
});

test('empty payment preview exposes the actual collection blocker without changing its error code', async () => {
  const client = createWorkspaceClient({ base, storage: storage(), fetcher: async () => new Response(JSON.stringify({ code: 'PAYMENT_PREVIEW_EMPTY',
    details: { blockedItems: [{ code: 'STORE_RECEIVABLE_UNSETTLED', message: 'Store receivable is not settled' }] } }), { status: 404 }) });
  await assert.rejects(client.request('/payment-records/preview', { method: 'POST', body: {} }), failure => {
    assert.equal(failure.code, 'PAYMENT_PREVIEW_EMPTY'); assert.equal(failure.message, '门店对应应收尚未结清，暂不能向供应商付款。'); return true;
  });
});

test('workspace API configuration uses local default, production same-origin and explicit local override', () => {
  assert.equal(resolveApiBase('http://localhost:4173/app.html'), 'http://localhost:3114/api/v1');
  assert.equal(resolveApiBase('https://procure.example/app.html'), 'https://procure.example/api/v1');
  assert.equal(resolveApiBase(`http://localhost:4173/app.html?api=${encodeURIComponent(base)}`), base);
  assert.equal(resolveApiBase('http://localhost:4173/app.html#/stores', base), base);
  assert.equal(resolveApiBase('http://127.0.0.1:4173/app.html'), 'http://127.0.0.1:3114/api/v1');
  assert.equal(resolveApiBase('http://[::1]:4173/app.html'), 'http://[::1]:3114/api/v1');
  assert.throws(() => resolveApiBase('http://localhost/', 'https://user:pass@host/api'));
  for (const value of ['file:///etc/passwd', 'https://user:pass@host/api', 'https://host/api?token=abc']) assert.throws(() => resolveApiBase(`http://localhost/?api=${encodeURIComponent(value)}`));
});

test('navigation and edit permissions do not expose master-data writes to finance/store/supplier', () => {
  assert.ok(allowedRoutes({ roles: ['ADMIN'] }).includes('templates'));
  assert.ok(!allowedRoutes({ roles: ['HQ_FINANCE'] }).includes('templates'));
  for (const route of ['brands', 'categories', 'units']) { assert.ok(allowedRoutes({ roles: ['HQ_FINANCE'] }).includes(route)); assert.equal(canEdit({ roles: ['HQ_FINANCE'] }, route), false); }
  assert.deepEqual(allowedRoutes({ roles: ['SUPPLIER'] }), ['supplier', 'finance', 'profile', 'supplier-products']);
  assert.deepEqual(allowedRoutes({ roles: ['STORE'] }), ['store', 'finance', 'profile']);
  assert.equal(canEdit({ roles: ['PURCHASER'] }, 'stores'), false);
  assert.equal(canEdit({ roles: ['HQ_FINANCE'] }, 'products'), false);
});

test('login stores no password and restore reads current server role/scope', async () => {
  const store = storage(); const calls = [];
  const client = createWorkspaceClient({ base, storage: store, fetcher: async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/auth/login') ? ok(session) : ok({ user: { id: 'user-a', roles: ['STORE'], scope: { storeId: 'store-a' } }, session: { expiresAt: session.expiresAt } });
  } });
  await client.login('account', 'private-password');
  assert.ok(!JSON.stringify([...store.values.values()]).includes('private-password'));
  await client.restore(); assert.deepEqual(client.session.user.roles, ['STORE']);
  assert.equal(calls[1].options.headers.authorization, 'Bearer test-token');
});

test('session and recovery records are isolated by API base and actor', async () => {
  const store = storage(); store.setItem(`${SESSION_KEY}:${base}`, JSON.stringify(session));
  const client = createWorkspaceClient({ base, storage: store, fetcher: async () => { throw new Error('offline'); } });
  await assert.rejects(client.command('/purchase-requests/a/confirm', { expectedVersion: 2 }));
  assert.ok(client.pendingCommand);
  assert.equal(createWorkspaceClient({ base: 'https://other/api/v1', storage: store }).session, null);
  store.setItem(`${SESSION_KEY}:${base}`, JSON.stringify({ ...session, user: { id: 'user-b' } }));
  assert.equal(createWorkspaceClient({ base, storage: store }).pendingCommand, null);
});

test('uncertain commands persist exact original body/key and explicit recovery cannot create a second command', async () => {
  const store = storage(); store.setItem(`${SESSION_KEY}:${base}`, JSON.stringify(session)); const calls = [];
  const client = createWorkspaceClient({ base, storage: store, fetcher: async (url, options) => {
    calls.push({ url, options }); if (calls.length === 1) throw new Error('response lost'); return ok({ version: 3 });
  } });
  await assert.rejects(client.command('/purchase-requests/a/confirm', { expectedVersion: 2 }));
  await assert.rejects(client.command('/purchase-requests/b/confirm', { expectedVersion: 5 })); assert.equal(calls.length, 1);
  await client.recoverCommand(); assert.equal(calls[1].options.body, calls[0].options.body);
  assert.equal(calls[1].options.headers['idempotency-key'], calls[0].options.headers['idempotency-key']); assert.equal(client.pendingCommand, null);
});

test('processing, rate-limit and unauthorized results retain recovery; definitive conflict clears it', async () => {
  for (const [status, code, remains] of [[409, 'COMMAND_PROCESSING', true], [429, 'RATE_LIMIT', true], [401, 'SESSION_EXPIRED', true], [409, 'VERSION_CONFLICT', false]]) {
    const store = storage(); store.setItem(`${SESSION_KEY}:${base}`, JSON.stringify(session));
    const client = createWorkspaceClient({ base, storage: store, fetcher: async () => error(status, code) });
    await assert.rejects(client.command('/purchase-requests/a/confirm', { expectedVersion: 2 }));
    assert.equal(store.values.has(`${SESSION_KEY}:${base}:command:user-a`), remains);
    if (status === 401) assert.equal(client.session, null);
  }
});

test('storage failure prevents sending a financial-effect command', async () => {
  let calls = 0; const store = storage(); store.setItem(`${SESSION_KEY}:${base}`, JSON.stringify(session));
  store.setItem = () => { throw new Error('storage unavailable'); };
  const client = createWorkspaceClient({ base, storage: store, fetcher: async () => { calls += 1; return ok({}); } });
  await assert.rejects(client.command('/purchase-requests/a/confirm', {})); assert.equal(calls, 0);
});

test('old actor responses cannot populate the new session', async () => {
  const store = storage(); store.setItem(`${SESSION_KEY}:${base}`, JSON.stringify(session)); let finish;
  const client = createWorkspaceClient({ base, storage: store, fetcher: () => new Promise(resolve => { finish = resolve; }) });
  const read = client.request('/products'); client.clear(); finish(ok(['private-product']));
  await assert.rejects(read, /账号已切换/); assert.equal(client.session, null);
});

test('private images use authentication and binary uploads are not serialized as JSON', async () => {
  const store = storage(); store.setItem(`${SESSION_KEY}:${base}`, JSON.stringify(session)); const calls = [];
  const client = createWorkspaceClient({ base, storage: store, fetcher: async (url, options) => {
    calls.push(options); return url.endsWith('/download') ? new Response('pixels', { headers: { 'content-type': 'image/png' } }) : ok({ uploaded: true });
  } });
  const blob = await client.request('/files/a/download', { binary: true }); assert.equal(await blob.text(), 'pixels');
  await client.request('/files/a/content', { method: 'POST', body: blob, rawBody: true, headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(calls[0].headers.authorization, 'Bearer test-token'); assert.equal(calls[1].body, blob);
});

test('metadata writes mark network and malformed responses uncertain and never retry automatically', async () => {
  let calls = 0;
  const client = createWorkspaceClient({ base, storage: storage(), fetcher: async () => { calls += 1; return new Response('<html>gateway</html>'); } });
  await assert.rejects(client.request('/stores', { method: 'POST', body: {} }), failure => failure.uncertain === true);
  assert.equal(calls, 1);
});
