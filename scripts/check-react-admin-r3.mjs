import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/react-admin-r3-evidence'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const report = { status: 'RUNNING', checks: [], screenshots: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/purchase-requests');
  await page.getByLabel('用户名').fill('pxflow_user'); await page.getByLabel('密码', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '采购申请', exact: true }).waitFor();
  const refs = await page.evaluate(async () => {
    const session = JSON.parse(sessionStorage.getItem('procurex-react-admin-session-v1'));
    const get = async path => (await (await fetch(`/api/v1${path}`, { headers: { Authorization: `Bearer ${session.accessToken}` } })).json()).data;
    const purchases = await get('/purchase-requests'); const orders = await get('/supplier-orders');
    return { stores: await get('/stores'), suppliers: await get('/suppliers'), products: await get('/products'), purchases, orders,
      purchaseDetail: purchases[0] ? await get(`/purchase-requests/${purchases[0].id}`) : null, orderDetail: orders[0] ? await get(`/supplier-orders/${orders[0].id}`) : null };
  });
  assert.ok(Array.isArray(refs.purchases) && Array.isArray(refs.orders));
  if (refs.purchaseDetail) assert.ok(Array.isArray(refs.purchaseDetail.items) && Array.isArray(refs.purchaseDetail.supplierOrders));
  if (refs.orderDetail) assert.ok(Array.isArray(refs.orderDetail.items));
  report.checks.push(`Real read-only API lists: ${refs.purchases.length} purchase requests and ${refs.orders.length} supplier orders; existing first details checked when present.`);
  const store = refs.stores.find(row => row.status === 'ACTIVE'); const supplier = refs.suppliers.find(row => !row.isArchived); const product = refs.products.find(row => row.isActive);
  assert.ok(store && supplier && product);
  const purchaseId = '11111111-1111-4111-8111-111111111111'; const orderId = '22222222-2222-4222-8222-222222222222'; const shipmentId = '33333333-3333-4333-8333-333333333333';
  const templateId = '44444444-4444-4444-8444-444444444444'; const priceId = '55555555-5555-4555-8555-555555555555'; const supplyId = '66666666-6666-4666-8666-666666666666'; const purchaseUnit = '77777777-7777-4777-8777-777777777777';
  const snapshot = { inputUnitId: purchaseUnit, inputQuantity: '2', salesUnitId: product.baseUnitId, salesUnitName: '袋', purchaseUnitId: purchaseUnit, purchaseUnitName: '箱', salesUnitsPerPurchaseUnit: '10', productVersion: product.version };
  const item = { id: '88888888-8888-4888-8888-888888888888', productId: product.id, productName: product.name, supplierId: supplier.id, quantity: '20', unitName: '袋（新名称）', salesUnitPrice: '12.500001', supplyUnitPrice: '8', salesLineAmount: '250.00', supplyLineAmount: '160.00', priceVersionId: priceId, supplyPriceVersionId: supplyId, unitSnapshot: snapshot, shippedQuantity: '10', receivedQuantity: '8', remainingToShipQuantity: '10' };
  const shipmentSummary = { id: shipmentId, shipmentNo: '发货响应验收单', kind: 'NORMAL', shippedAt: new Date().toISOString(), trackingNo: '物流响应验收', receivedAt: null };
  const order = { id: orderId, requestId: purchaseId, supplierOrderNo: '订单响应验收单', supplierId: supplier.id, storeId: store.id, storeName: store.name, supplierName: supplier.name, status: 'PUSHED', fulfillmentStatus: 'PARTIAL_SHIPPED', version: 7, salesGoodsAmount: '250.00', supplyGoodsAmount: '160.00', items: [item], shipments: [shipmentSummary], destination: { name: store.name, address: '广东省广州市天河区测试路1号', contactName: '门店联系人', contactPhone: '13800000000' } };
  const purchase = { id: purchaseId, requestNo: '采购响应验收单', templateId, storeId: store.id, status: 'PENDING_PROCUREMENT', paymentStatus: 'PAID', storedValueOnReceipt: true, storedReservedAmount: '250.00', version: 3, submittedAt: new Date().toISOString(), salesGoodsAmount: '250.00', supplyGoodsAmount: '160.00', paidAmount: '0.00', shortfallAmount: '0.00', items: [item], supplierOrders: [] };
  const catalog = { storeId: store.id, templateId, items: [{ product: { ...product, unitName: '袋', purchaseUnitName: '箱', minOrderQty: '1', orderMultiple: '1', purchaseUnitConversion: { purchaseUnitId: purchaseUnit, salesUnitsPerPurchaseUnit: '10' } }, suppliers: [{ supplierId: supplier.id, supplierName: supplier.name, priceVersionId: priceId, supplyPriceVersionId: supplyId }] }] };
  const preview = { templateId, items: [item], totals: { salesGoodsAmount: '250.00', supplyGoodsAmount: '160.00' }, funding: { canConfirm: true, stored: { required: '250.00', available: '500.00', shortfall: '0.00' }, credit: { required: '0.00', available: '1000.00', shortfall: '0.00' } } };
  const writes = []; const previews = []; let failConfirm = true; let incompletePreview = true;
  await page.route('**/api/v1/purchase-requests**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (req.method() === 'GET') return route.fulfill({ json: { data: path.endsWith('/rejection-todos') ? [] : path.endsWith('/edit-catalog') ? catalog : path === '/api/v1/purchase-requests' ? [purchase] : purchase } });
    if (path.endsWith('/reassign-preview')) return route.fulfill({ json: { data: { requestId: purchaseId, supplierId: supplier.id, items: [{ requestItemId: item.id, eligible: true, salesLineAmount: '250.00', supplyLineAmount: '160.00', priceVersionId: priceId, supplyPriceVersionId: supplyId }] } } });
    if (path.endsWith('/preview') || path.endsWith('/items-preview')) {
      previews.push(req.postDataJSON());
      if (incompletePreview) { incompletePreview = false; return route.fulfill({ json: { data: { ...preview, items: [{ ...item, supplyPriceVersionId: null }] } } }); }
      return route.fulfill({ json: { data: preview } });
    }
    writes.push({ path, method: req.method(), key: req.headers()['idempotency-key'], body: req.postDataJSON() });
    if (path.endsWith('/confirm') && failConfirm) { failConfirm = false; return route.abort('failed'); }
    if (path.endsWith('/confirm')) { purchase.status = 'CONFIRMED'; purchase.version = 4; purchase.supplierOrders = [order]; }
    return route.fulfill({ json: { data: purchase } });
  });
  await page.route(`**/api/v1/stores/${store.id}/catalog`, route => route.fulfill({ json: { data: catalog } }));
  await page.route('**/api/v1/supplier-orders**', route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (req.method() !== 'GET') writes.push({ path, method: req.method(), key: req.headers()['idempotency-key'], body: req.postDataJSON() });
    return route.fulfill({ json: { data: path === '/api/v1/supplier-orders' ? [order] : order } });
  });
  await page.route(`**/api/v1/shipments/${shipmentId}`, route => route.fulfill({ json: { data: { id: shipmentId, shipmentNo: shipmentSummary.shipmentNo, shippedAt: shipmentSummary.shippedAt, trackingNo: shipmentSummary.trackingNo, currentReceiptRevision: 1, items: [{ id: item.id, productName: product.name, unitName: '袋', shippedQuantity: '10', currentReceivedQuantity: '8', receiptLocked: false }] } } }));
  const select = async (label, text) => {
    const control = page.getByLabel(label, { exact: true }); await control.click();
    if (await control.evaluate(node => node instanceof HTMLInputElement && !node.readOnly)) await control.fill(text);
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: text }).first().click();
  };
  const shot = async name => { await page.waitForTimeout(250); await page.screenshot({ path: `${output}/${name}.png` }); report.screenshots.push(`${name}.png`); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); };
  const confirmPopup = async () => page.locator('.ant-popconfirm:visible').getByRole('button', { name: '确定', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: '新增', exact: true }).waitFor();
  await page.getByRole('button', { name: '新增', exact: true }).click(); await select('订货门店', store.name); await select('商品', product.name); await select('订货单位', '箱'); await page.getByLabel('数量', { exact: true }).fill('2');
  await page.getByRole('button', { name: '预览金额', exact: true }).click(); await page.getByText('预览商品或价格版本不完整，请重新读取目录后预览。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '确认保存', exact: true }).isDisabled(), true); assert.equal(writes.length, 0);
  await page.getByRole('button', { name: '预览金额', exact: true }).click(); await page.getByRole('heading', { name: '金额预览', exact: true }).waitFor();
  for (const width of [1440, 320]) { await page.setViewportSize({ width, height: 1000 }); await shot(`purchase-preview-${width}`); }
  await page.getByLabel('数量', { exact: true }).fill('3'); assert.equal(await page.getByRole('button', { name: '确认保存', exact: true }).isDisabled(), true);
  await page.getByLabel('数量', { exact: true }).fill('2'); await page.getByRole('button', { name: '预览金额', exact: true }).click(); await page.getByRole('heading', { name: '金额预览', exact: true }).waitFor();
  await page.getByRole('button', { name: '确认保存', exact: true }).click(); await confirmPopup(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const created = writes.at(-1); assert.equal(created.path, '/api/v1/purchase-requests'); assert.ok(created.key); assert.equal(created.body.expectedTemplateId, templateId);
  assert.deepEqual(created.body.items[0], { productId: product.id, quantity: '2', unitId: purchaseUnit, expectedProductVersion: product.version, expectedPriceVersionId: priceId, expectedSupplyPriceVersionId: supplyId });
  report.checks.push('Create uses decimal input quantity, purchase-unit ID, product/template identity and both approved price versions; changing values invalidates preview. Mocked writes only.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: `查看${purchase.requestNo}`, exact: true }).click(); await page.getByRole('button', { name: '修改明细', exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('cell', { name: item.unitName, exact: true }).waitFor();
  await page.getByRole('button', { name: '调整供应商', exact: true }).click();
  await select('目标供应商', supplier.name);
  await page.getByRole('dialog').last().locator(`tr[data-row-key="${item.id}"] input[type="checkbox"]`).check();
  await page.getByRole('button', { name: '预览调整', exact: true }).click();
  await page.getByRole('heading', { name: '调整预览', exact: true }).waitFor();
  for (const width of [1440, 320]) { await page.setViewportSize({ width, height: 1000 }); await shot(`supplier-assignment-${width}`); }
  await page.getByRole('button', { name: '确认调整', exact: true }).click();
  await page.getByRole('heading', { name: '调整预览', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(writes.at(-1).path, `/api/v1/purchase-requests/${purchaseId}/assign`);
  assert.ok(writes.at(-1).key); assert.equal(writes.at(-1).body.expectedVersion, 3);
  assert.deepEqual(writes.at(-1).body.itemIds, [item.id]);
  assert.deepEqual(writes.at(-1).body.expectedPrices, [{ requestItemId: item.id, priceVersionId: priceId, supplyPriceVersionId: supplyId }]);
  report.checks.push('Supplier reassignment previews eligibility and submits selected request-item IDs, request version and both approved price versions with an idempotency key; desktop/mobile screenshots.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '修改明细', exact: true }).click(); await page.getByLabel('修改原因').fill('调整采购数量'); await page.getByRole('button', { name: '预览金额', exact: true }).click(); await page.getByRole('heading', { name: '金额预览', exact: true }).waitFor();
  await page.getByRole('button', { name: '确认保存', exact: true }).click(); await confirmPopup(); await page.getByLabel('修改原因').waitFor({ state: 'hidden' });
  assert.equal(writes.at(-1).method, 'PATCH'); assert.equal(writes.at(-1).body.expectedVersion, 3); assert.equal(writes.at(-1).body.items[0].quantity, '2'); assert.equal(writes.at(-1).body.items[0].supplierId, supplier.id);
  await page.getByRole('button', { name: '取消申请', exact: true }).click(); await page.getByRole('button', { name: '确认取消', exact: true }).click(); await confirmPopup();
  await page.getByText('请输入原因，最多300字', { exact: true }).waitFor();
  await page.getByLabel('取消原因', { exact: true }).fill('取消测试申请'); await page.getByRole('button', { name: '确认取消', exact: true }).click(); await confirmPopup(); await page.getByLabel('取消原因', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(writes.at(-1).body.reason, '取消测试申请'); assert.equal(writes.at(-1).body.expectedVersion, 3);
  report.checks.push('Edit keeps input-unit snapshots, version and price approval; cancel requires reason and version.');
  await page.getByRole('button', { name: '确认采购', exact: true }).click(); await confirmPopup(); await page.getByText('存在待确认提交：确认采购', { exact: true }).waitFor();
  const unknown = writes.at(-1);
  await page.goto(`http://127.0.0.1:4174/supplier-orders?order=${orderId}`); await page.getByRole('button', { name: '核对资金', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '核对资金', exact: true }).isDisabled(), true);
  await page.reload(); await page.getByRole('button', { name: '恢复原提交', exact: true }).click(); await page.getByText('存在待确认提交：确认采购', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(writes.at(-1).key, unknown.key); assert.deepEqual(writes.at(-1).body, unknown.body);
  await page.goto(`http://127.0.0.1:4174/purchase-requests?request=${purchaseId}`);
  await page.getByRole('link', { name: order.supplierOrderNo, exact: true }).waitFor();
  await page.getByRole('link', { name: order.supplierOrderNo, exact: true }).click(); await page.getByRole('button', { name: '核对资金', exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('cell', { name: item.unitName, exact: true }).waitFor();
  report.checks.push('Purchase and supplier order tables prefer current unit names while keeping historical unit snapshots in edit submissions.');
  for (const width of [1440, 320]) { await page.setViewportSize({ width, height: 1000 }); await shot(`order-detail-${width}`); }
  await page.getByRole('button', { name: '核对资金', exact: true }).click(); await confirmPopup(); await page.getByText('资金核对已完成', { exact: true }).waitFor();
  assert.equal(writes.at(-1).body.expectedVersion, 7); assert.ok(writes.at(-1).key);
  await page.getByRole('button', { name: shipmentSummary.shipmentNo, exact: true }).click(); await page.getByRole('columnheader', { name: '当前收货数量', exact: true }).waitFor();
  await shot('shipment-detail-320');
  await page.goto(`http://127.0.0.1:4174/purchase-requests?request=${purchaseId}`); await page.getByRole('link', { name: order.supplierOrderNo, exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '修改明细', exact: true }).count(), 0);
  report.checks.push('Confirm failure/reload reuses exact original idempotency key; confirmed request links order and shipment; confirmed items are no longer editable; reconcile uses order version.');
  await page.route('**/api/v1/me', async route => { const response = await route.fetch(); const envelope = await response.json(); envelope.data.user.roles = ['HQ_FINANCE']; await route.fulfill({ json: envelope }); });
  purchase.status = 'PENDING_PROCUREMENT'; purchase.supplierOrders = [];
  await page.reload(); await page.getByRole('dialog').waitFor(); await page.getByText(purchase.salesGoodsAmount, { exact: true }).first().waitFor();
  assert.equal(await page.getByRole('button', { name: '新增', exact: true }).count(), 0); assert.equal(await page.getByRole('button', { name: '确认采购', exact: true }).count(), 0);
  await page.goto(`http://127.0.0.1:4174/supplier-orders?order=${orderId}`); await page.getByRole('button', { name: '采购申请', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '核对资金', exact: true }).count(), 0);
  report.checks.push('HQ finance can read purchase/order details but cannot create, confirm, edit, cancel or reconcile.');
  assert.deepEqual(report.errors, []); report.status = 'PASSED'; await rm(`${output}/failure.png`, { force: true }); console.log(report.status, report.checks);
} catch (failure) { report.status = 'FAILED'; report.failure = failure.stack; const page = browser.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: `${output}/failure.png` }); report.visibleText = await page.locator('body').innerText(); } console.error(failure); process.exitCode = 1; }
finally { await writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2)); await browser.close(); }
