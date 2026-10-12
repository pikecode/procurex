import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Decimal } from 'decimal.js';

const access = JSON.parse(await readFile('.env.server-acceptance-access.json', 'utf8'));
const manifest = JSON.parse(await readFile('.env.server-acceptance-manifest.json', 'utf8'));
assert.equal(manifest.status, 'READY');
const base = 'https://pr.moshuo.fun/api/v1';
const tokens = new Map();
const checks = [];
async function call(path, who, body, expected) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(tokens.get(who) ? { authorization: `Bearer ${tokens.get(who)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  if (expected) { assert.equal(response.status, expected, `${path}: ${result.code || result.message}`); return result; }
  assert.ok(response.ok, `${path}: ${response.status} ${result.code || result.message}`);
  return result.data ?? result;
}
function check(name) { checks.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); }
async function rejectedPreview(name, who, storeId, productId, quantity) {
  const response = await fetch(`${base}/purchase-requests/preview`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.get(who)}` }, body: JSON.stringify({ storeId, items: [{ productId, quantity }] }) });
  const result = await response.json();
  assert.ok([400, 404, 409].includes(response.status), `${name}: ${response.status}`);
  checks.push({ name, status: 'PASS', rejectionCode: result.code }); console.log(`PASS ${name}`);
}
try {
  for (const account of access.accounts) {
    if (account.username === 'disabled_user') {
      await call('/auth/login', '', { username: account.username, password: access.password, client: 'PUBLIC_ACCEPTANCE_CHECK' }, 401);
      check('disabled account login rejected'); continue;
    }
    const auth = await call('/auth/login', '', { username: account.username, password: access.password, client: 'PUBLIC_ACCEPTANCE_CHECK' });
    assert.ok(auth.user.roles.includes(account.role)); tokens.set(account.username, auth.accessToken);
    const me = await call('/me', account.username); assert.equal(me.user.username, account.username);
    if (account.storeId) assert.equal(me.user.scope.storeId, account.storeId);
    if (account.supplierId) assert.equal(me.user.scope.supplierId, account.supplierId);
    if (account.storeIds) assert.deepEqual([...me.user.scope.storeIds].sort(), [...account.storeIds].sort());
    check(`login and scope ${account.username}`);
  }
  for (const number of [1, 2, 3, 4]) {
    const account = access.accounts.find(row => row.username === `store${number}`);
    const catalog = await call(`/stores/${account.storeId}/catalog`, account.username);
    assert.ok(catalog.items.length >= 10);
    assert.ok(!catalog.items.some(item => ['停用乌龙茶（验收）', '未进模板的红茶（验收）'].includes(item.product.name)));
    const tea = catalog.items.find(item => item.product.name === '茉莉花茶'); assert.ok(tea);
    assert.equal(new Decimal(tea.suppliers[0].salesPrice).toFixed(2), '24.00');
    assert.equal(tea.product.purchaseUnitName, '箱');
    const shelf = catalog.items.find(item => item.product.name.includes('仅供货商已下架'));
    assert.ok(!shelf || shelf.suppliers.length === 0);
    if (number === 1) {
      const lettuce = catalog.items.find(item => item.product.name === '生菜');
      const mainSupplierId = access.accounts.find(row => row.username === 'supplier2').supplierId;
      assert.equal(lettuce.suppliers.length, 1); assert.equal(lettuce.suppliers[0].supplierId, mainSupplierId);
    }
    check(`catalog, prices, conversion and availability store${number}`);
  }
  const storedId = access.accounts.find(row => row.username === 'store1').storeId;
  const companyId = access.accounts.find(row => row.username === 'store3').storeId;
  await call(`/stores/${companyId}/account`, 'region', undefined, 403);
  await call('/users', 'supplier2', undefined, 403);
  await call(`/stores/${companyId}/account`, 'store_fin1', undefined, 403);
  const emptyId = access.accounts.find(row => row.username === 'store_empty').storeId;
  const noTemplate = await call(`/stores/${emptyId}/catalog`, 'store_empty', undefined, 404); assert.equal(noTemplate.code, 'STORE_TEMPLATE_NOT_FOUND');
  check('cross-store data scope and no-template protection');
  for (const [key, qty, name] of [['oil', '4', 'minimum order five'], ['rice', '4', 'order multiple three'], ['tea', '0', 'zero quantity'], ['tea', '-1', 'negative quantity'], ['off', '1', 'inactive product'], ['unbound', '1', 'product outside template'], ['shelf', '1', 'only supplier unlisted']]) {
    await rejectedPreview(name, 'store1', storedId, manifest.objects[`product:${key}`].id, qty);
  }
  await rejectedPreview('store without template', 'store_empty', emptyId, manifest.objects['product:tea'].id, '1');
  const disabledStoreId = access.accounts.find(row => row.username === 'store_disabled').storeId;
  await rejectedPreview('disabled store', 'store_disabled', disabledStoreId, manifest.objects['product:tea'].id, '1');
  for (const who of ['supplier1', 'supplier2', 'supplier3', 'supplier4', 'supplier5']) {
    const id = access.accounts.find(row => row.username === who).supplierId;
    const managed = await call(`/suppliers/${id}/managed-products`, who);
    assert.ok(managed.items.length >= 10);
    assert.ok(managed.items.every(item => !Object.hasOwn(item, 'supplyPrice')));
    check(`supplier scope and price privacy ${who}`);
  }
  const expected = { S01: [], S02: ['PUSHED', 'PUSHED'], S03: [], S04: [], S05: ['REJECTED'], S06: ['SHIPPED'], S07: ['PARTIAL_SHIPPED'], S08: ['PARTIAL_SHIPPED'], S09: ['PARTIAL_SHIPPED'], S10: ['PARTIAL_SHIPPED'], S11: ['SHIPPED'], S12: ['COMPLETED'], S13: ['COMPLETED'], S14: ['PARTIAL_SHIPPED'], S15: ['COMPLETED'], S16: ['PUSHED'], S17: ['PUSHED', 'REJECTED'], C01: ['COMPLETED'], C02: ['COMPLETED'], C03: ['PUSHED'], C04: ['PUSHED'], C05: ['COMPLETED'], T01: ['COMPLETED'], T02: ['COMPLETED'], T03: ['COMPLETED'], T04: ['COMPLETED'], T05: ['COMPLETED'], D01: ['COMPLETED'], D02: ['COMPLETED'], D03: ['COMPLETED'] };
  for (const row of Object.values(manifest.cases)) {
    if (row.boundary) { assert.equal(row.rejectedCode, 'CREDIT_LIMIT_EXCEEDED'); check(`scenario ${row.code}: ${row.label}`); continue; }
    const request = await call(`/purchase-requests/${row.requestId}`, 'buyer');
    assert.deepEqual(request.supplierOrders.map(order => order.status).sort(), [...(expected[row.code] || [])].sort(), row.code);
    if (row.code === 'U01') assert.equal(request.status, 'PENDING_FUNDS');
    if (row.code === 'S04') assert.equal(request.status, 'CANCELED');
    if (['S01', 'S03'].includes(row.code)) assert.equal(request.status, 'PENDING_PROCUREMENT');
    if (['S12', 'S13', 'S15', 'C02'].includes(row.code)) assert.equal(request.paymentStatus, 'PAID');
    if (row.code === 'S10') {
      const difference = await call(`/discrepancies/${row.discrepancyId}`, 'supplier2');
      assert.equal(Number(difference.replenishmentGap.remainingQuantity), 2);
    }
    if (row.code === 'S13') {
      const difference = await call(`/discrepancies/${row.discrepancyId}`, 'supplier2');
      assert.equal(Number(difference.replenishmentGap.remainingQuantity), 0);
    }
    for (const item of row.payments || []) {
      const record = await call(`/payment-records/${item.id}`, 'fin');
      assert.equal(record.status, item.status === 'confirm' ? 'CONFIRMED' : item.status === 'reject' ? 'REJECTED' : 'PENDING');
    }
    check(`scenario ${row.code}: ${row.label}`);
  }
  const stored = await call(`/stores/${storedId}/account`, 'store_fin1');
  assert.equal(stored.balance, '9516.00'); assert.equal(stored.reservedBalance, '2073.86'); assert.equal(stored.availableBalance, '7442.14');
  const creditId = access.accounts.find(row => row.username === 'store2').storeId;
  const credit = await call(`/stores/${creditId}/account`, 'store_fin2');
  assert.equal(credit.creditUsed, '317.00'); assert.equal(credit.creditCumulative, '437.00'); assert.equal(credit.creditAvailable, '4683.00');
  check('stored value recharge minus actual receipts; credit clearing and cumulative algebra');
  const todos = await call('/discrepancies', 'store1');
  assert.ok(todos.some(row => row.id === manifest.cases.S10.discrepancyId));
  assert.ok(!todos.some(row => [manifest.cases.S11.discrepancyId, manifest.cases.S13.discrepancyId].includes(row.id)));
  check('pending replenishment present; shipped and fulfilled replenishment absent from todos');
  const productImage = manifest.objects['product-image'];
  const response = await fetch(`${base}/files/${productImage}/download`, { headers: { authorization: `Bearer ${tokens.get('store1')}` } });
  assert.equal(response.status, 200); assert.ok((await response.arrayBuffer()).byteLength > 0);
  assert.equal((await fetch(`${base}/files/${productImage}/download`)).status, 401);
  check('private image download and anonymous rejection');
  await writeFile('.env.server-acceptance-verification.json', JSON.stringify({ checkedAt: new Date(), base, status: 'PASS', checks }, null, 2), { mode: 0o600 });
  console.log(`Completed ${checks.length} public API checks. No business state was advanced.`);
} catch (error) {
  await writeFile('.env.server-acceptance-verification.json', JSON.stringify({ checkedAt: new Date(), status: 'FAILED', error: error.message, checks }, null, 2), { mode: 0o600 });
  console.error(error.message); process.exitCode = 1;
} finally { for (const who of tokens.keys()) await call('/auth/logout', who, {}).catch(() => {}); }
