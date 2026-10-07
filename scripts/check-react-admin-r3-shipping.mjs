import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/react-admin-r3-shipping-evidence'; await mkdir(output, { recursive: true });
const report = { status: 'RUNNING', checks: [], screenshots: [], errors: [] };
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/supplier-orders');
  await page.getByLabel('用户名').fill('pxflow_user'); await page.getByLabel('密码', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: '登录', exact: true }).click(); await page.getByRole('heading', { name: '供应商订单', exact: true }).waitFor();
  const id = '22222222-2222-4222-8222-222222222222', itemId = '33333333-3333-4333-8333-333333333333', gapId = '44444444-4444-4444-8444-444444444444', freightId = '55555555-5555-4555-8555-555555555555';
  const item = { id: itemId, productId: gapId, productName: '测试大米', quantity: '10', shippedQuantity: '2', receivedQuantity: '0', remainingToShipQuantity: '8', salesLineAmount: '100.00', supplyLineAmount: '80.00', replenishmentGaps: [{ id: gapId, quantity: '2', remainingQuantity: '2', status: 'PENDING' }] };
  const order = { id, requestId: gapId, storeId: gapId, supplierId: gapId, supplierOrderNo: '发货链验收单', version: 7, status: 'PARTIAL_SHIPPED', fulfillmentStatus: 'PARTIAL_SHIPPED', salesGoodsAmount: '100.00', supplyGoodsAmount: '80.00', items: [item], freightConfirmations: [{ id: freightId, supplierOrderId: id, amount: '12.50', reason: '配送费用', status: 'CONFIRMED', version: 3, usedAt: null, createdAt: new Date().toISOString() }] };
  const writes = []; let fail = true; let previewBody;
  await page.route('**/api/v1/purchase-requests**', route => { assert.equal(route.request().method(), 'GET'); return route.fulfill({ json: { data: { id: gapId, status: 'PUSHED', supplierOrders: [{ ...order, shipments: [] }] } } }); });
  await page.route('**/api/v1/supplier-orders**', route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() === 'GET') return route.fulfill({ json: { data: path.endsWith('/supplier-orders') ? [order] : order } });
    const body = req.postDataJSON();
    if (path.endsWith('/shipment-preview')) { previewBody = body; return route.fulfill({ json: { data: { supplierOrderId: id, version: 7, freightConfirmationId: body.freightConfirmationId || null, items: body.items.map(row => ({ ...row, productId: gapId, remainingQuantityAfter: '5', salesLineAmount: '50.00', supplyLineAmount: '40.00' })), totals: { shipQuantity: '3', permanentlyReduceQuantity: '1', remainingQuantity: '5', salesGoodsAmount: '50.00', supplyGoodsAmount: '40.00', freight: body.freight } } } }); }
    writes.push({ path, body, key: req.headers()['idempotency-key'] });
    if (path.endsWith('/shipments') && fail) { fail = false; return route.abort('failed'); }
    return route.fulfill({ json: { data: order } });
  });
  await page.route('**/api/v1/freight-confirmations/**', route => { writes.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] }); return route.fulfill({ json: { data: order.freightConfirmations[0] } }); });
  const popup = () => page.locator('.ant-popconfirm:visible').getByRole('button', { name: '确定', exact: true }).click();
  const shot = async name => { await page.waitForTimeout(350); await page.screenshot({ path: `${output}/${name}.png` }); report.screenshots.push(`${name}.png`); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); };
  await page.goto(`http://127.0.0.1:4174/supplier-orders?order=${id}`);
  await page.getByRole('button', { name: '发货与补发', exact: true }).click();
  await page.getByLabel(`发货数量${itemId}`, { exact: true }).fill('3'); await page.getByLabel(`永久减量${itemId}`, { exact: true }).fill('1'); await page.getByLabel(`补发数量${gapId}`, { exact: true }).fill('2');
  await page.getByLabel('运费确认', { exact: true }).click(); await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '12.50' }).click();
  await page.getByRole('button', { name: '预览发货', exact: true }).click(); await page.getByRole('heading', { name: '发货预览', exact: true }).waitFor();
  assert.equal(previewBody.expectedVersion, 7); assert.equal(previewBody.freight, '12.50'); assert.deepEqual(previewBody.items[0].gapAllocations, [{ gapId, quantity: '2' }]);
  for (const width of [1440, 320]) { await page.setViewportSize({ width, height: 1000 }); await shot(`shipment-${width}`); }
  await page.getByLabel(`发货数量${itemId}`, { exact: true }).fill('4'); assert.ok(await page.getByRole('button', { name: '确认发货', exact: true }).isDisabled());
  await page.getByRole('button', { name: '预览发货', exact: true }).click(); await page.getByRole('heading', { name: '发货预览', exact: true }).waitFor();
  await page.getByRole('button', { name: '确认发货', exact: true }).click(); await popup(); await page.getByText('待确认提交：订单发货', { exact: true }).waitFor();
  const original = writes.at(-1); await page.reload(); await page.getByRole('button', { name: '恢复原提交', exact: true }).click(); await page.getByText('存在待确认提交：订单发货', { exact: true }).waitFor({ state: 'hidden' }); assert.deepEqual(writes.at(-1), original); assert.ok(original.key);
  report.checks.push('Decimal shipment, reduction, replenishment allocation and confirmed freight; preview invalidation; unknown response recovered after reload with identical body/key. Mock writes only.');
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.getByRole('button', { name: '申请运费', exact: true }).click();
  await page.getByLabel('运费金额', { exact: true }).fill('15.20'); await page.getByLabel('申请原因', { exact: true }).fill('增加配送费用'); await shot('freight-request');
  await page.getByRole('button', { name: '确认提交', exact: true }).click(); await popup(); await page.getByLabel('申请原因', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(writes.at(-1).body.expectedVersion, 7); assert.equal(writes.at(-1).body.amount, '15.2'); assert.ok(writes.at(-1).key);
  order.freightConfirmations[0].status = 'PENDING'; await page.reload(); await page.getByRole('button', { name: `确认运费${freightId}`, exact: true }).click(); await page.getByLabel('审核备注', { exact: true }).fill('运费核对通过');
  await page.getByRole('button', { name: '确认提交', exact: true }).click(); await popup(); await page.getByLabel('审核备注', { exact: true }).waitFor({ state: 'hidden' }); assert.equal(writes.at(-1).body.expectedVersion, 3); assert.equal(writes.at(-1).path, `/api/v1/freight-confirmations/${freightId}/confirm`);
  report.checks.push('Freight request uses order version; approval uses separate confirmation version and idempotency key.');
  await page.getByRole('button', { name: `驳回运费${freightId}`, exact: true }).click(); await page.getByLabel('审核备注', { exact: true }).fill('重复申请'); await page.getByRole('button', { name: '确认提交', exact: true }).click(); await popup(); await page.getByLabel('审核备注', { exact: true }).waitFor({ state: 'hidden' }); assert.equal(writes.at(-1).path, `/api/v1/freight-confirmations/${freightId}/reject`); assert.equal(writes.at(-1).body.expectedVersion, 3);
  const admin = await page.evaluate(() => JSON.parse(sessionStorage.getItem('procurex-react-admin-session-v1')));
  for (const role of ['PURCHASER', 'HQ_FINANCE']) {
    await page.unroute('**/api/v1/me'); await page.route('**/api/v1/me', async route => { const response = await route.fetch(); const envelope = await response.json(); envelope.data.user.roles = [role]; await route.fulfill({ json: envelope }); });
    await page.evaluate(({ admin, role }) => sessionStorage.setItem('procurex-react-admin-session-v1', JSON.stringify({ ...admin, user: { ...admin.user, roles: [role] } })), { admin, role }); await page.reload(); await page.getByText('发货链验收单', { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: '发货与补发', exact: true }).count(), 0); assert.equal(await page.getByRole('button', { name: '申请运费', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: `确认运费${freightId}`, exact: true }).count(), role === 'PURCHASER' ? 1 : 0);
  }
  report.checks.push('Freight rejection uses confirmation version; purchaser may review but not ship/request freight; HQ finance is read-only. Role fixtures only.');
  assert.deepEqual(report.errors, []); report.status = 'PASSED';
} catch (error) { report.status = 'FAILED'; report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2)); await browser.close(); console.log(JSON.stringify(report)); }
