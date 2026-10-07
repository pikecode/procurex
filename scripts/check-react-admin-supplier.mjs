import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/react-admin-supplier-evidence'; await mkdir(output, { recursive: true });
const id = n => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const supplierId = id('1'), orderId = id('2'), itemId = id('3');
const user = { id: id('4'), displayName: '华南配送供应商', roles: ['SUPPLIER'], scope: { type: 'SUPPLIER', supplierId } };
const discrepancy = { id: id('9'), supplierOrderId: orderId, productName: '东北大米', supplierOrderNo: '华南配送订单001', shipmentNo: '配送发货001', status: 'OPEN', version: 2, missingQuantity: '1', shippedQuantity: '3', receivedQuantity: '2' };
const order = { id: orderId, supplierId, supplierOrderNo: '华南配送订单001', storeName: '广州天河门店', storeId: id('5'), status: 'PUSHED', fulfillmentStatus: 'PENDING', version: 3, supplyGoodsAmount: '30.00', createdAt: '2026-10-06', destination: { address: '广东省广州市天河区体育西路', contactName: '李店长', contactPhone: '13800000000' }, items: [{ id: itemId, productName: '东北大米', quantity: '3', shippedQuantity: '0', receivedQuantity: '0', remainingToShipQuantity: '3', supplyLineAmount: '30.00', unitName: '袋' }], freightConfirmations: [] };
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const writes = [], reads = [], errors = [], screenshots = []; let unknown = true, foreign = false, missing = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(user => sessionStorage.setItem('procurex-react-admin-session-v1', JSON.stringify({ accessToken: 'supplier-fixture', expiresAt: new Date(Date.now() + 3600000).toISOString(), user })), user);
  await page.route('**/api/v1/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/v1/notifications') return route.fulfill({ json: { data: { unreadCount: 0, notifications: [] } } });
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/api/v1', '');
    const data = value => route.fulfill({ json: { data: value } }); reads.push(path);
    if (path === '/me') return data({ user: { ...user, scope: { type: 'SUPPLIER', ...(missing ? {} : { supplierId }) } }, session: { expiresAt: new Date(Date.now() + 3600000).toISOString() } });
    if (path === '/supplier-orders') { assert.equal(url.searchParams.get('supplierId'), supplierId); return data([order, { ...order, id: id('6'), supplierId: id('7'), supplierOrderNo: '其他供应商订单' }]); }
    if (path === `/supplier-orders/${orderId}`) return data({ ...order, ...(foreign ? { supplierId: id('7') } : {}) });
    if (path === '/discrepancies') return data([discrepancy]);
    if (path === `/discrepancies/${discrepancy.id}`) return data(discrepancy);
    if (path === `/discrepancies/${discrepancy.id}/resolve`) { writes.push({ path, key: req.headers()['idempotency-key'], body: req.postDataJSON() }); discrepancy.status = 'RESOLVED'; discrepancy.version++; return data(discrepancy); }
    if (path.endsWith('/shipment-preview')) { const body = req.postDataJSON(); return data({ supplierOrderId: orderId, version: order.version, freightConfirmationId: null, items: body.items.map(item => ({ ...item, remainingQuantityAfter: '2', supplyLineAmount: '10.00' })), totals: { shipQuantity: '1', permanentlyReduceQuantity: '0', remainingQuantity: '2', supplyGoodsAmount: '10.00', freight: '0.00' } }); }
    if (req.method() === 'POST' && /^\/supplier-orders\/.+\/(reject|shipments|freight-confirmations)$/.test(path)) {
      writes.push({ path, key: req.headers()['idempotency-key'], body: req.postDataJSON() });
      if (unknown) { unknown = false; return route.abort('failed'); }
      if (path.endsWith('/reject')) { order.status = 'REJECTED'; order.version++; }
      return data({ id: id('8') });
    }
    throw new Error(`Unexpected request: ${req.method()} ${path}`);
  });
  const open = async () => { await page.getByRole('button', { name: '查看', exact: true }).click(); await page.getByText('广东省广州市天河区体育西路', { exact: true }).waitFor(); };
  const shot = async name => { await page.waitForTimeout(250); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: `${output}/${name}.png` }); screenshots.push(`${name}.png`); };
  await page.goto('http://127.0.0.1:4174/supplier-orders'); await page.getByRole('heading', { name: '供应商工作台', exact: true }).waitFor();
  assert.equal(await page.getByText('其他供应商订单').count(), 0); assert.equal(await page.getByRole('menuitem', { name: '门店管理' }).count(), 0); await shot('orders-desktop'); await open();
  await page.getByRole('button', { name: '发货与补发', exact: true }).click(); await page.getByLabel(`发货数量${itemId}`, { exact: true }).fill('1'); await page.getByRole('button', { name: '预览发货', exact: true }).click(); await page.getByRole('heading', { name: '发货预览' }).waitFor(); assert.equal(await page.getByText('销售金额', { exact: true }).count(), 0);
  await shot('shipment-desktop'); await page.setViewportSize({ width: 320, height: 1000 }); await shot('shipment-mobile'); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '确认发货', exact: true }).click(); await page.getByRole('button', { name: '确定', exact: true }).click(); await page.getByRole('dialog', { name: '发货与补发' }).getByText('待确认提交：订单发货', { exact: true }).waitFor();
  await page.reload(); await page.getByRole('button', { name: '恢复原提交', exact: true }).click(); await page.getByText('待确认提交：订单发货', { exact: true }).waitFor({ state: 'hidden' }); assert.equal(writes.length, 2); assert.deepEqual(writes[0], writes[1]);
  await open(); await page.getByRole('button', { name: '申请运费', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '申请运费' }); await dialog.getByRole('spinbutton').fill('5.50'); await dialog.getByLabel('申请原因').fill('配送运费'); await dialog.getByRole('button', { name: '确认提交' }).click(); await page.getByRole('button', { name: '确定', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); assert.equal(writes[2].body.amount, '5.5'); assert.equal(writes[2].body.expectedVersion, 3);
  await open(); await page.getByRole('button', { name: '拒单', exact: true }).click(); await page.getByLabel('拒单原因').fill('库存不足'); order.version++;
  await page.getByRole('button', { name: '确认拒单', exact: true }).click(); await page.getByText('订单已变化，请重新核对后操作。', { exact: true }).waitFor(); assert.equal(writes.length, 3);
  await page.getByRole('button', { name: '拒单', exact: true }).click(); await page.getByLabel('拒单原因').fill('库存不足'); await page.getByRole('button', { name: '确认拒单', exact: true }).click(); await page.getByLabel('拒单原因').waitFor({ state: 'hidden' }); assert.equal(writes[3].body.reason, '库存不足'); assert.equal(writes[3].body.expectedVersion, 4);
  await open(); assert.equal(await page.getByRole('button', { name: '拒单', exact: true }).count(), 0); await page.goto('http://127.0.0.1:4174/supplier-orders');
  foreign = true; await page.getByRole('button', { name: '查看', exact: true }).click(); await page.getByText('订单不属于当前供应商。', { exact: true }).waitFor(); assert.equal(await page.getByRole('dialog').count(), 0);
  foreign = false;
  for (const [action, label] of [['ACCEPT', '接受短缺'], ['REPLENISH', '安排补发'], ['RETURN', '退回收货修订']]) {
    discrepancy.status = 'OPEN'; await page.goto(`http://127.0.0.1:4174/discrepancies?discrepancy=${discrepancy.id}`); await page.getByLabel('处理方式').click(); await page.getByText(label, { exact: true }).click(); await page.getByLabel('处理原因').fill('供应商核对短缺');
    await page.getByRole('button', { name: '确认处理', exact: true }).click(); await page.getByRole('button', { name: '确定', exact: true }).click(); await page.getByText('已处理', { exact: true }).first().waitFor(); assert.equal(writes.at(-1).body.action, action);
  }
  foreign = true; await page.reload(); await page.getByText('差异不属于当前供应商。', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '确认处理', exact: true }).count(), 0);
  await page.evaluate(({ userId, path }) => localStorage.setItem(`procurex-admin-purchase-command-v1:${userId}`, JSON.stringify({ key: 'scoped-recovery', path, method: 'POST', body: { expectedVersion: 2, action: 'ACCEPT', reason: '核查' }, label: '供应商差异恢复' })), { userId: user.id, path: `/discrepancies/${discrepancy.id}/resolve` });
  const writeCount = writes.length; await page.goto('http://127.0.0.1:4174/discrepancies'); await page.getByRole('button', { name: '恢复原提交', exact: true }).click(); await page.getByText('差异不属于当前供应商。', { exact: true }).waitFor(); assert.equal(writes.length, writeCount);
  foreign = false; await page.getByRole('button', { name: '恢复原提交', exact: true }).click(); await page.getByRole('button', { name: '恢复原提交', exact: true }).waitFor({ state: 'hidden' }); assert.equal(writes.at(-1).key, 'scoped-recovery');
  await page.goto('http://127.0.0.1:4174/purchase-requests'); await page.getByText('无权访问此页面', { exact: true }).waitFor(); assert.ok(!reads.includes('/purchase-requests'));
  missing = true; const before = reads.filter(p => p === '/supplier-orders').length; await page.goto('http://127.0.0.1:4174/supplier-orders'); await page.getByText('供应商账号尚未绑定供应商', { exact: true }).waitFor(); assert.equal(reads.filter(p => p === '/supplier-orders').length, before);
  assert.deepEqual(errors, []); await writeFile(`${output}/manifest.json`, JSON.stringify({ boundary: 'All API responses are fixtures; no business, financial or OSS writes.', writes, screenshots, checks: ['supplier scope and foreign list/detail', 'company sales fields absent', 'shipment preview without sales data', 'same-key recovery after reload', 'freight request with version and decimal', 'rejection and terminal-state protection', 'central-route denied', 'missing binding makes no order requests', '1440/320 layout'] }, null, 2));
  console.log('Supplier workspace checks passed.');
} finally { await browser.close(); }
