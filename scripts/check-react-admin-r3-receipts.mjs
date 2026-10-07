import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/react-admin-r3-receipts-evidence'; await mkdir(output, { recursive: true });
const report = { status: 'RUNNING', checks: [], screenshots: [], errors: [] };
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/supplier-orders'); await page.getByLabel('用户名').fill('pxflow_user'); await page.getByLabel('密码', { exact: true }).fill('correct-password'); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.getByRole('heading', { name: '供应商订单', exact: true }).waitFor();
  const real = await page.evaluate(async () => { const session = JSON.parse(sessionStorage.getItem('procurex-react-admin-session-v1')); const response = await fetch('/api/v1/discrepancies', { headers: { Authorization: `Bearer ${session.accessToken}` } }); return { status: response.status, rows: (await response.json()).data }; }); assert.equal(real.status, 200); assert.ok(Array.isArray(real.rows)); report.checks.push(`Real login and read-only discrepancies API: ${real.rows.length} rows. All following business/file writes intercepted.`);
  const uuid = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
  const orderId = uuid(1), shipmentId = uuid(2), itemId = uuid(3), lockedId = uuid(4), discrepancyId = uuid(5), fileId = uuid(6), requestId = uuid(7);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9sAAAAASUVORK5CYII=', 'base64');
  const evidence = { id: fileId, filename: '收货凭证.png', mimeType: 'image/png', sizeBytes: String(png.length) };
  const shipment = { id: shipmentId, shipmentNo: '收货链验收发货单', supplierOrderId: orderId, supplierOrderNo: '收货链验收订单', supplierOrderVersion: 7, currentReceiptRevision: 2, evidenceFiles: [evidence], items: [{ id: itemId, productName: '测试大米', unitName: '袋', shippedQuantity: '5', currentReceivedQuantity: '4', receiptLocked: false }, { id: lockedId, productName: '测试食用油', unitName: '桶', shippedQuantity: '3', currentReceivedQuantity: '3', receiptLocked: true }] };
  const summary = { id: shipmentId, shipmentNo: shipment.shipmentNo, kind: 'NORMAL', shippedAt: new Date().toISOString() };
  const order = { id: orderId, requestId, supplierOrderNo: shipment.supplierOrderNo, version: 7, status: 'SHIPPED', fulfillmentStatus: 'PARTIAL_RECEIVED', storeId: requestId, supplierId: requestId, items: [], salesGoodsAmount: '100.00', supplyGoodsAmount: '80.00' };
  const discrepancy = { id: discrepancyId, status: 'OPEN', missingQuantity: '1', productName: '测试大米', supplierOrderId: orderId, supplierOrderNo: order.supplierOrderNo, shipmentNo: shipment.shipmentNo, version: 4, shippedQuantity: '5', receivedQuantity: '4', evidenceFiles: [evidence] };
  const receipts = [], resolutions = [], uploads = []; let receiptMode = 'conflict', failComplete = true, resolveUnknown = false, discrepancyReads = 0, downloadCount = 0;
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname.replace('/api/v1', ''), method = req.method();
    const data = value => route.fulfill({ json: { data: value } });
    if (path === '/me') return route.continue();
    if (method === 'GET' && path.startsWith('/supplier-orders')) return data(path === '/supplier-orders' ? [order] : order);
    if (method === 'GET' && path.startsWith('/purchase-requests')) return data({ id: requestId, status: 'PUSHED', supplierOrders: [{ ...order, shipments: [summary] }] });
    if (path === `/shipments/${shipmentId}` && method === 'GET') return data(shipment);
    if (path === `/shipments/${shipmentId}/receipts`) {
      receipts.push({ body: req.postDataJSON(), key: req.headers()['idempotency-key'] });
      if (receiptMode === 'conflict') { receiptMode = 'unknown'; return route.fulfill({ status: 409, json: { error: { code: 'RECEIPT_REVISION_CONFLICT', message: 'changed' } } }); }
      if (receiptMode === 'unknown') { receiptMode = 'success'; return route.abort('failed'); }
      shipment.currentReceiptRevision = 4; shipment.supplierOrderVersion = 9; shipment.items.forEach(item => { item.receiptLocked = true; }); return data({ id: fileId, revision: 4 });
    }
    if (path === '/files/upload-sessions') { const body = req.postDataJSON(); uploads.push(body); return data({ id: uuid(8), uploadToken: 'fixture-token' }); }
    if (path.endsWith('/content') && path.startsWith('/files/')) { assert.equal(req.headers()['x-upload-token'], 'fixture-token'); assert.equal(req.headers()['content-type'], 'application/octet-stream'); assert.ok(req.postDataBuffer().equals(png)); return data({ uploaded: true }); }
    if (path.endsWith('/complete') && path.startsWith('/files/')) { if (failComplete) { failComplete = false; return route.fulfill({ status: 409, json: { error: { code: 'FILE_CONTENT_INVALID', message: 'invalid' } } }); } return data({ id: uuid(8), status: 'READY' }); }
    if (path.endsWith('/download') && path.startsWith('/files/')) { downloadCount++; assert.ok(req.headers().authorization?.startsWith('Bearer ')); return route.fulfill({ contentType: 'image/png', body: png }); }
    if (path === '/discrepancies' && method === 'GET') { discrepancyReads++; return data(['OPEN', 'REPLENISH_PENDING'].includes(discrepancy.status) ? [discrepancy] : []); }
    if (path === `/discrepancies/${discrepancyId}` && method === 'GET') { discrepancyReads++; return data(discrepancy); }
    if (path === `/discrepancies/${discrepancyId}/resolve`) {
      resolutions.push({ body: req.postDataJSON(), key: req.headers()['idempotency-key'] }); if (resolveUnknown) { resolveUnknown = false; return route.abort('failed'); }
      discrepancy.status = req.postDataJSON().action === 'REPLENISH' ? 'REPLENISH_PENDING' : 'RESOLVED'; discrepancy.version++; return data(discrepancy);
    }
    assert.equal(method, 'GET', `Unmocked write prohibited: ${method} ${path}`); return route.continue();
  });
  const shot = async name => { await page.waitForTimeout(350); await page.screenshot({ path: `${output}/${name}.png` }); report.screenshots.push(`${name}.png`); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); };
  const popup = () => page.locator('.ant-popconfirm:visible').getByRole('button', { name: '确定', exact: true }).click();
  await page.goto(`http://127.0.0.1:4174/supplier-orders?order=${orderId}`); await page.getByRole('button', { name: shipment.shipmentNo, exact: true }).click(); await page.getByRole('button', { name: '修订收货', exact: true }).click();
  assert.ok(await page.getByLabel(`收货数量${lockedId}`, { exact: true }).isDisabled()); await page.getByLabel(`收货数量${itemId}`, { exact: true }).fill('4.5');
  const fileInput = page.locator('.ant-modal:visible').last().locator('input[type=file]');
  await fileInput.setInputFiles({ name: '无效.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-') }); await page.getByText('收货凭证须为不超过10MB的JPEG或PNG图片，最多6张', { exact: true }).waitFor(); assert.equal(uploads.length, 0);
  await fileInput.setInputFiles({ name: '收货凭证.png', mimeType: 'image/png', buffer: png }); await page.getByText('凭证内容与图片类型不符，请重新选择。', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '移除收货凭证.png', exact: true }).count(), 0);
  await fileInput.setInputFiles({ name: '收货凭证.png', mimeType: 'image/png', buffer: png }); await page.getByRole('button', { name: '移除收货凭证.png', exact: true }).waitFor(); assert.equal(uploads.at(-1).purpose, 'RECEIPT'); assert.equal(uploads.at(-1).sizeBytes, png.length);
  await page.waitForFunction(() => [...document.querySelectorAll('img[alt="收货凭证.png"]')].some(img => img.complete && img.naturalWidth > 0));
  await page.locator('.ant-modal:visible').last().getByAltText('收货凭证.png').first().click(); await page.locator('.ant-image-preview:visible').waitFor(); await shot('receipt-image-preview'); await page.locator('.ant-image-preview-close').click(); await page.locator('.ant-image-preview:visible').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '核对收货', exact: true }).click(); await page.getByRole('heading', { name: '收货核对', exact: true }).waitFor();
  for (const width of [1440, 320]) { await page.setViewportSize({ width, height: 1100 }); await shot(`receipt-review-${width}`); }
  await page.getByLabel(`收货数量${itemId}`, { exact: true }).fill('4.6'); assert.ok(await page.getByRole('button', { name: '确认收货', exact: true }).isDisabled()); await page.getByLabel(`收货数量${itemId}`, { exact: true }).fill('4.5');
  await page.getByRole('button', { name: '核对收货', exact: true }).click(); await page.getByRole('button', { name: '确认收货', exact: true }).click(); await popup(); await page.getByText('收货修订已变更，请重新读取。', { exact: true }).waitFor();
  assert.deepEqual(receipts[0].body, { expectedOrderVersion: 7, expectedReceiptRevision: 2, items: [{ shipmentItemId: itemId, receivedQuantity: '4.5' }, { shipmentItemId: lockedId, receivedQuantity: '3' }], evidenceFileIds: [uuid(8)] });
  shipment.supplierOrderVersion = 8; shipment.currentReceiptRevision = 3;
  await page.getByRole('button', { name: '重新读取收货明细', exact: true }).click(); await page.getByLabel(`收货数量${itemId}`, { exact: true }).fill('4.5'); await page.getByRole('button', { name: '核对收货', exact: true }).click(); await page.getByRole('button', { name: '确认收货', exact: true }).click(); await popup(); await page.getByText('待确认提交：确认收货', { exact: true }).waitFor();
  const original = receipts.at(-1); assert.equal(original.body.expectedOrderVersion, 8); assert.equal(original.body.expectedReceiptRevision, 3);
  await page.goto('http://127.0.0.1:4174/discrepancies'); await page.getByRole('button', { name: '恢复原提交', exact: true }).click(); await page.getByText('存在待确认提交：确认收货', { exact: true }).waitFor({ state: 'hidden' }); assert.deepEqual(receipts.at(-1), original); assert.ok(original.key);
  report.checks.push('Exact receipt-item coverage with immutable locked quantity, decimal quantity, order+revision versions, 409 fresh read, unknown-result cross-page replay with identical body/key.');
  report.checks.push('JPEG/PNG validation, failed completion cannot attach; READY receipt image upload metadata, binary token and authenticated private thumbnails verified. No real OSS writes.');
  await page.goto(`http://127.0.0.1:4174/supplier-orders?order=${orderId}`); await page.getByRole('button', { name: shipment.shipmentNo, exact: true }).click(); await page.getByRole('columnheader', { name: '当前收货数量', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '修订收货', exact: true }).count(), 0);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const select = async value => { await page.getByLabel('处理方式', { exact: true }).click(); await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: value }).click(); };
  for (const [action, label] of [['ACCEPT', '接受短缺'], ['REPLENISH', '安排补发'], ['RETURN', '退回收货修订']]) {
    discrepancy.status = 'OPEN'; await page.goto(`http://127.0.0.1:4174/discrepancies?discrepancy=${discrepancyId}`); await select(label); await page.getByLabel('处理原因', { exact: true }).fill('核对收货差异');
    if (action === 'ACCEPT') for (const width of [1440, 320]) { await page.setViewportSize({ width, height: 1000 }); await shot(`discrepancy-${width}`); }
    const version = discrepancy.version; await page.getByRole('button', { name: '确认处理', exact: true }).click(); await popup(); await page.getByRole('button', { name: '确认处理', exact: true }).waitFor({ state: 'hidden' }); assert.equal(resolutions.at(-1).body.action, action); assert.equal(resolutions.at(-1).body.expectedVersion, version); assert.ok(resolutions.at(-1).key);
  }
  discrepancy.status = 'OPEN'; resolveUnknown = true; await page.goto(`http://127.0.0.1:4174/discrepancies?discrepancy=${discrepancyId}`); await select('接受短缺'); await page.getByLabel('处理原因', { exact: true }).fill('原提交恢复测试'); await page.getByRole('button', { name: '确认处理', exact: true }).click(); await popup(); await page.getByText('存在待确认提交：处理收货差异', { exact: true }).waitFor(); const unknown = resolutions.at(-1); await page.reload(); await page.getByRole('button', { name: '恢复原提交', exact: true }).click(); await page.getByText('存在待确认提交：处理收货差异', { exact: true }).waitFor({ state: 'hidden' }); assert.deepEqual(resolutions.at(-1), unknown);
  report.checks.push('ACCEPT/REPLENISH/RETURN use discrepancy version and reason; resolved/pending status disables repeat processing; unknown result survives reload and reuses original request.');
  shipment.currentReceiptRevision = 0; shipment.supplierOrderVersion = 10; shipment.evidenceFiles = []; shipment.items.forEach(item => { item.receiptLocked = false; item.currentReceivedQuantity = null; });
  await page.setViewportSize({ width: 1440, height: 1100 }); await page.goto(`http://127.0.0.1:4174/supplier-orders?order=${orderId}`); await page.getByRole('button', { name: shipment.shipmentNo, exact: true }).click(); await page.getByRole('button', { name: '登记收货', exact: true }).click();
  await page.getByLabel(`收货数量${itemId}`, { exact: true }).waitFor(); assert.equal(await page.getByLabel(`收货数量${itemId}`, { exact: true }).inputValue(), ''); await page.getByRole('button', { name: '核对收货', exact: true }).click(); assert.ok(await page.getByRole('button', { name: '确认收货', exact: true }).isDisabled());
  await page.getByRole('button', { name: '全部到货', exact: true }).nth(0).click(); await page.getByRole('button', { name: '全部到货', exact: true }).nth(1).click(); await page.getByRole('button', { name: '核对收货', exact: true }).click(); await shot('receipt-first'); await page.getByRole('button', { name: '确认收货', exact: true }).click(); await popup(); await page.getByRole('button', { name: '核对收货', exact: true }).waitFor({ state: 'hidden' });
  assert.deepEqual(receipts.at(-1).body, { expectedOrderVersion: 10, expectedReceiptRevision: 0, items: [{ shipmentItemId: itemId, receivedQuantity: '5' }, { shipmentItemId: lockedId, receivedQuantity: '3' }] }); report.checks.push('First receipt starts empty, requires explicit quantities; full-arrival actions and revision zero verified; no empty evidenceFileIds array.');
  for (const role of ['HQ_FINANCE', 'PURCHASER']) {
    await page.unroute('**/api/v1/me'); await page.route('**/api/v1/me', async route => { const response = await route.fetch(); const envelope = await response.json(); envelope.data.user.roles = [role]; await route.fulfill({ json: envelope }); });
    const before = discrepancyReads; await page.goto(`http://127.0.0.1:4174/discrepancies?discrepancy=${discrepancyId}`); await page.getByText('无权访问此页面', { exact: true }).waitFor(); assert.equal(discrepancyReads, before);
    await page.goto(`http://127.0.0.1:4174/supplier-orders?order=${orderId}`); await page.getByText(order.supplierOrderNo, { exact: true }).first().waitFor();
    if (role === 'HQ_FINANCE') { await page.getByRole('button', { name: shipment.shipmentNo, exact: true }).click(); await page.getByRole('columnheader', { name: '当前收货数量', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '修订收货', exact: true }).count(), 0); assert.equal(await page.getByRole('button', { name: '登记收货', exact: true }).count(), 0); }
    else assert.equal(await page.getByRole('button', { name: shipment.shipmentNo, exact: true }).count(), 0);
    await page.goto(`http://127.0.0.1:4174/discrepancies?discrepancy=${discrepancyId}`);
  }
  assert.ok(downloadCount > 0); report.checks.push('HQ finance/purchaser direct discrepancy URLs denied without API reads; HQ shipment is read-only; purchaser cannot read shipment endpoint.'); assert.deepEqual(report.errors, []); report.status = 'PASSED';
} catch (error) { report.status = 'FAILED'; report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2)); await browser.close(); console.log(JSON.stringify(report)); }
