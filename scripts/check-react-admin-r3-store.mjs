import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const output = 'var/react-admin-r3-store-evidence'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const checks = [], screenshots = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/'); await page.getByLabel('用户名').fill('pxflow_user'); await page.getByLabel('密码', { exact: true }).fill('correct-password'); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.getByRole('heading', { name: '门店管理', exact: true }).waitFor();
  const id = n => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
  const storeId = id('1'), orderId = id('2'), supplierId = id('3'), shipmentId = id('4'), itemId = id('5');
  let role = 'STORE', missing = false, reads = 0, unknown = true; const receipts = [];
  const order = { id: orderId, requestNo: '门店验收订单', storeId, status: 'CONFIRMED', paymentStatus: 'UNPAID', salesGoodsAmount: '100', paidAmount: '0', shortfallAmount: '0', storedReservedAmount: '100', submittedAt: new Date().toISOString(), items: [{ id: itemId, productName: '东北大米', quantity: '5', unitName: '袋', salesUnitPrice: '20', salesLineAmount: '100', supplyUnitPrice: '秘密成本' }], supplierOrders: [{ id: supplierId, supplierName: '广州粮油配送', shipments: [{ id: shipmentId, shipmentNo: '门店验收发货单', shippedAt: new Date().toISOString() }] }] };
  const shipment = { id: shipmentId, shipmentNo: '门店验收发货单', supplierOrderId: supplierId, supplierOrderNo: '供应商单', supplierOrderVersion: 7, currentReceiptRevision: 0, items: [{ id: itemId, productName: '东北大米', unitName: '袋', shippedQuantity: '5', currentReceivedQuantity: null, receiptLocked: false }] };
  const templateId = id('7'), unitId = id('8'), purchaseUnitId = id('9'); const creates = [], previews = []; let createMode = 'conflict';
  const catalog = { storeId, templateId, store: { name: '广州测试门店' }, items: [{ product: { id: itemId, name: '东北大米', version: 3, baseUnitId: unitId, unitName: '袋', purchaseUnitName: '箱', minOrderQty: '2', orderMultiple: '1', purchaseUnitConversion: { purchaseUnitId, salesUnitsPerPurchaseUnit: '10' } }, suppliers: [{ supplierId, supplierName: '广州粮油配送' }] }] };
  await page.route('**/api/v1/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/v1/notifications') return route.fulfill({ json: { data: { unreadCount: 0, notifications: [] } } });
    const req = route.request(), path = new URL(req.url()).pathname.replace('/api/v1', ''); const data = value => route.fulfill({ json: { data: value } });
    if (path === '/me') return data({ user: { id: id('6'), roles: [role], displayName: '门店验收', scope: { type: role, ...(missing ? {} : { storeId }) } }, session: { expiresAt: new Date(Date.now() + 3600000).toISOString() } });
    if (path === `/shipments/${shipmentId}/receipts`) { receipts.push({ body: req.postDataJSON(), key: req.headers()['idempotency-key'] }); if (unknown) { unknown = false; return route.abort('failed'); } shipment.currentReceiptRevision = 1; shipment.items[0].receiptLocked = true; return data({ revision: 1 }); }
    if (path === `/stores/${storeId}/catalog`) return data(catalog);
    if (path === '/purchase-requests/preview') { const body = req.postDataJSON(); previews.push(body); return data({ storeId, templateId, items: [{ productId: itemId, quantity: '12.5', salesUnitPrice: '20', salesLineAmount: '250', supplyUnitPrice: '秘密成本', priceVersionId: id('a'), supplyPriceVersionId: id('b'), unitSnapshot: { salesUnitName: '袋' } }], totals: { salesGoodsAmount: '250', supplyGoodsAmount: '秘密成本' }, funding: { canConfirm: false, stored: { required: '150', available: '100', shortfall: '50' }, credit: { required: '100', available: '90', shortfall: '10' } } }); }
    if (path === '/purchase-requests' && req.method() === 'POST') { creates.push({ body: req.postDataJSON(), key: req.headers()['idempotency-key'] }); if (createMode === 'conflict') { createMode = 'unknown'; return route.fulfill({ status: 409, json: { error: { code: 'VERSION_CONFLICT', message: 'changed' } } }); } if (createMode === 'unknown') { createMode = 'success'; return route.abort('failed'); } return data(order); }
    assert.equal(req.method(), 'GET', `Unexpected write: ${path}`);
    if (path === '/purchase-requests') { reads++; assert.equal(new URL(req.url()).searchParams.get('storeId'), storeId); return data([order]); }
    if (path === `/purchase-requests/${orderId}`) { reads++; return data(order); }
    if (path === `/shipments/${shipmentId}`) return data(shipment);
    throw new Error(`Unexpected API access: ${path}`);
  });
  await page.goto('http://127.0.0.1:4174/'); await page.getByRole('heading', { name: '门店订单', exact: true }).waitFor();
  assert.equal(await page.getByRole('menuitem', { name: '价格管理' }).count(), 0);
  await page.getByRole('button', { name: order.requestNo, exact: true }).click(); await page.getByRole('button', { name: shipment.shipmentNo, exact: true }).click();
  for (const width of [1440, 320]) { await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(250); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: `${output}/store-${width}.png` }); screenshots.push(`store-${width}.png`); }
  assert.equal(await page.getByText('秘密成本').count(), 0);
  await page.getByRole('button', { name: '登记收货', exact: true }).click(); await page.getByRole('button', { name: '全部到货', exact: true }).click(); await page.getByRole('button', { name: '核对收货', exact: true }).click(); await page.getByRole('button', { name: '确认收货', exact: true }).click(); await page.locator('.ant-popconfirm:visible').getByRole('button', { name: '确定', exact: true }).click(); await page.getByText('待确认提交：确认收货', { exact: true }).waitFor();
  await page.reload(); await page.getByRole('button', { name: '恢复原提交', exact: true }).click(); await page.getByText('存在待确认提交：确认收货', { exact: true }).waitFor({ state: 'hidden' }); assert.equal(receipts.length, 2); assert.deepEqual(receipts[1], receipts[0]); assert.equal(receipts[0].body.expectedOrderVersion, 7); assert.equal(receipts[0].body.items[0].receivedQuantity, '5');
  checks.push('Store-scoped list/detail/shipment, no cost display, decimal receipt and identical-key reload recovery.');
  await page.goto('http://127.0.0.1:4174/store-orders'); await page.getByRole('button', { name: '门店订货', exact: true }).click();
  await page.getByLabel('订货商品1', { exact: true }).click(); await page.getByTitle('东北大米', { exact: true }).click();
  await page.getByLabel('订货数量1', { exact: true }).fill('1.25'); await page.getByLabel('订货单位1', { exact: true }).click(); await page.getByTitle('箱', { exact: true }).click();
  await page.getByRole('button', { name: '核对订单', exact: true }).click(); await page.getByRole('heading', { name: '订单核对', exact: true }).waitFor();
  assert.deepEqual(previews.at(-1), { storeId, expectedTemplateId: templateId, items: [{ productId: itemId, quantity: '1.25', unitId: purchaseUnitId, expectedProductVersion: 3 }] });
  await page.getByText('资金不足，提交后待补足', { exact: true }).waitFor(); assert.equal(await page.getByText('秘密成本').count(), 0);
  for (const width of [1440, 320]) { await page.setViewportSize({ width, height: 1100 }); await page.waitForTimeout(250); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); const name = `ordering-${width}.png`; await page.screenshot({ path: `${output}/${name}` }); screenshots.push(name); }
  await page.getByLabel('订货数量1', { exact: true }).fill('1.5'); assert.ok(await page.getByRole('button', { name: '提交订单', exact: true }).isDisabled());
  await page.getByRole('button', { name: '添加商品', exact: true }).click(); await page.getByLabel('订货商品2', { exact: true }).click(); await page.locator('.ant-select-dropdown:visible').getByTitle('东北大米', { exact: true }).click(); await page.getByLabel('订货数量2', { exact: true }).fill('1');
  const beforePreview = previews.length; await page.getByRole('button', { name: '核对订单', exact: true }).click(); await page.getByText('请选择商品，且同一商品不能重复。', { exact: true }).waitFor(); assert.equal(previews.length, beforePreview); await page.getByLabel('移除商品2', { exact: true }).click();
  const submit = async () => { await page.getByRole('heading', { name: '订单核对', exact: true }).waitFor({ state: 'hidden' }); await page.locator('.ant-popconfirm:visible').waitFor({ state: 'hidden' }); await page.getByRole('button', { name: '核对订单', exact: true }).click(); await page.getByRole('heading', { name: '订单核对', exact: true }).waitFor(); await page.getByRole('button', { name: '提交订单', exact: true }).click(); await page.locator('.ant-popconfirm:visible').getByRole('button', { name: '确定', exact: true }).click(); };
  await submit(); await page.waitForFunction(() => !localStorage.getItem('procurex-admin-purchase-command-v1:66666666-6666-4666-8666-666666666666')); assert.ok(await page.getByRole('button', { name: '提交订单', exact: true }).isDisabled());
  await submit(); await page.getByText('存在待确认提交：提交门店订单', { exact: true }).waitFor(); await page.reload(); await page.getByRole('button', { name: '恢复原提交', exact: true }).click(); await page.getByText('存在待确认提交：提交门店订单', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(creates.length, 3); assert.deepEqual(creates[2], creates[1]); assert.notEqual(creates[0].key, creates[1].key); assert.equal(creates[1].body.items[0].quantity, '1.5'); assert.equal(creates[1].body.items[0].expectedPriceVersionId, id('a')); assert.equal(creates[1].body.items[0].expectedSupplyPriceVersionId, id('b'));
  checks.push('Store ordering: catalog/unit snapshots, decimal input, server funding, no costs, duplicate rejection, preview invalidation, conflict re-preview, unknown create reload replay. No real writes.');
  role = 'STORE_FINANCE'; shipment.currentReceiptRevision = 0; shipment.items[0].receiptLocked = false;
  await page.goto(`http://127.0.0.1:4174/store-orders?order=${orderId}`); await page.getByRole('button', { name: shipment.shipmentNo, exact: true }).click(); await page.getByText('发货明细', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '登记收货', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '门店订货', exact: true }).count(), 0);
  await page.goto('http://127.0.0.1:4174/prices'); await page.getByText('无权访问此页面', { exact: true }).waitFor();
  const before = reads; missing = true; await page.goto('http://127.0.0.1:4174/store-orders'); await page.getByText('尚未绑定门店，无法查看订单', { exact: true }).waitFor(); assert.equal(reads, before);
  checks.push('Store finance read-only; central route denied; missing store blocks API reads.'); assert.deepEqual(errors, []);
  await writeFile(`${output}/manifest.json`, JSON.stringify({ status: 'PASS', checks, screenshots, errors }, null, 2)); console.log(checks.join('\n'));
} finally { await browser.close(); }
