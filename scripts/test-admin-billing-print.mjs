import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test, { after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from '../apps/admin/node_modules/vite/dist/node/index.js';
import { createElement } from '../apps/admin/node_modules/react/index.js';
import { renderToStaticMarkup } from '../apps/admin/node_modules/react-dom/server.node.js';

const vite = await createServer({ root: resolve('apps/admin'), server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(() => vite.close());
const { billingAccess, billingRowInScope } = await vite.ssrLoadModule('/src/lib/billingAccess.ts');
const { createCommandId } = await vite.ssrLoadModule('/src/lib/commandId.ts');
const { canAccessPage } = await vite.ssrLoadModule('/src/lib/access.ts');
const { default: Billing } = await vite.ssrLoadModule('/src/pages/Billing.tsx');
const { PurchasePrintSheet } = await vite.ssrLoadModule('/src/components/PurchasePrint.tsx');
test('command IDs remain secure on HTTP IP addresses', () => {
  assert.equal(createCommandId({ randomUUID: () => 'native-id' }), 'native-id');
  const source = { getRandomValues: bytes => webcrypto.getRandomValues(bytes) };
  const ids = Array.from({ length: 100 }, () => createCommandId(source));
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(ids).size, ids.length);
  assert.throws(() => createCommandId({}), /安全提交/);
});

for (const role of ['REGION_MANAGER', 'REGION_FINANCE', 'PURCHASE_FOLLOWER']) {
  test(`${role} has scoped read-only billing without global supplier or payment tabs`, () => {
    const user = { id: role, roles: [role], scope: { type: 'MULTI_STORE', storeIds: ['A', 'B'] } };
    assert.equal(canAccessPage(user, '/finance'), true);
    assert.deepEqual(billingAccess(user).tabs, ['store', 'supplier-store', 'direct']);
    assert.equal(billingAccess(user).readonly, true);
    assert.equal(billingRowInScope(user, { storeId: 'A' }), true);
    assert.equal(billingRowInScope(user, { storeId: 'C' }), false);
    assert.equal(billingRowInScope(user, { supplierId: 'supplier' }), false);
    const html = renderToStaticMarkup(createElement(Billing, { user }));
    assert.match(html, /门店账单/);
    assert.doesNotMatch(html, /登记付款|确认处理|付款记录/);
    assert.equal(billingRowInScope({ ...user, scope: { ...user.scope, storeIds: ['A'] } }, { storeId: 'B' }), false);
  });
}

test('billing separates purchaser, company finance, store finance and supplier operations', () => {
  for (const role of ['PURCHASER', 'STORE_FINANCE']) {
    const user = { id: role, roles: [role], ...(role === 'STORE_FINANCE' ? { scope: { type: 'STORE', storeId: 'A' } } : {}) };
    assert.equal(billingAccess(user).allowed, true);
    assert.equal(billingAccess(user).readonly, true);
  }
  for (const roles of [['ADMIN'], ['HQ_FINANCE'], ['PURCHASER', 'HQ_FINANCE']]) {
    const access = billingAccess({ id: 'company', roles });
    assert.equal(access.readonly, false);
    assert.ok(access.tabs.includes('payments'));
  }
  const supplier = { id: 'supplier', roles: ['SUPPLIER'], scope: { type: 'SUPPLIER', supplierId: 'S' } };
  assert.equal(billingAccess(supplier).readonly, false);
  assert.equal(billingRowInScope(supplier, { supplierId: 'T' }), false);
  assert.equal(billingRowInScope(supplier, { supplierId: 'S', direction: 'STORE_TO_COMPANY' }), false);
});

test('missing assignments and unknown roles cannot open billing', () => {
  for (const user of [
    { id: 'x', roles: ['UNKNOWN'] }, { id: 'x', roles: ['STORE_FINANCE'] },
    { id: 'x', roles: ['REGION_FINANCE'], scope: { type: 'MULTI_STORE', storeIds: [] } },
    { id: 'x', roles: ['SUPPLIER'], scope: { type: 'SUPPLIER' } },
  ]) {
    assert.equal(billingAccess(user).allowed, false);
    assert.equal(billingRowInScope(user, { storeId: 'A' }), false);
  }
});

test('A4 purchase sheet contains all rows, two decimal sales amounts and safely escaped names', async () => {
  const items = Array.from({ length: 65 }, (_, index) => ({
    id: `i${index}`, productName: `长名称商品${index}<script>alert(1)</script>`, unitName: '袋', quantity: '2',
    salesUnitPrice: '12.3', salesLineAmount: '24.6', supplyUnitPrice: '10', supplyLineAmount: '20',
  }));
  const html = renderToStaticMarkup(createElement(PurchasePrintSheet, { sheet: {
    purchase: { requestNo: '订单001', status: 'CONFIRMED', submittedAt: '2026-10-11T00:00:00Z', salesGoodsAmount: '1599', items },
    store: { name: '门店A', address: '广州市天河区测试路', contactName: '张经理', contactPhone: '13800000000' },
  } }));
  assert.equal((html.match(/<tr>/g) || []).length, 66);
  assert.match(html, /12\.30/); assert.match(html, /24\.60/); assert.match(html, /1599\.00/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|供货单价|供货金额/);
  const css = await readFile('apps/admin/src/components/PurchasePrint.css', 'utf8');
  assert.match(css, /size: A4 portrait/); assert.match(css, /table-header-group/); assert.match(css, /break-inside: avoid/);
});
