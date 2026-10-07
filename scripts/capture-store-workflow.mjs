import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

export async function captureStoreWorkflow({ page, db, api, token, store, product, storeUser, route, search, save, capture, step }) {
  const call = async (path, body) => {
    const response = await fetch(`${api}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json(); assert.ok(response.ok, `${path}: ${result.code || response.status}`); return result.data;
  };
  const loseResponse = async (path, submit) => {
    const endpoint = `${api}${path}`;
    await page.route(endpoint, async intercepted => { const committed = await intercepted.fetch(); assert.ok(committed.ok()); await intercepted.abort('failed'); });
    try { await submit(); await page.getByText('提交结果暂未确认，请刷新列表核对后再操作。').waitFor(); }
    finally { await page.unroute(endpoint); }
    await page.reload(); await page.locator('#ws-recover').click(); await page.locator('#ws-recover').waitFor({ state: 'detached' });
  };
  await page.setViewportSize({ width: 390, height: 844 }); await route('store');
  const before = await db.purchaseRequest.count({ where: { storeId: store.id } });
  await page.locator('#ws-create').click(); await page.locator('#ws-draft-product option').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('[name="storeId"]').isDisabled(), true);
  assert.equal(await page.locator('[name="storeId"]').inputValue(), store.id);
  await page.locator('#ws-draft-product').selectOption(product.id); await page.locator('#ws-draft-add').click();
  await page.locator(`[name="quantity:${product.id}"]`).fill('2');
  await page.waitForFunction(() => document.querySelector('.ws-draft-name img')?.naturalWidth === 800);
  await page.locator('#ws-draft-preview').click(); await page.locator('#ws-draft-quote').getByText(/销售货款/).waitFor();
  assert.equal(/供货/.test(await page.locator('#ws-draft-quote').innerText()), false);
  await capture('store-order-preview-mobile');
  await page.setViewportSize({ width: 1440, height: 960 }); await capture('store-order-preview-desktop');
  await loseResponse('/purchase-requests', () => page.locator('.ws-dialog [type="submit"]').click());
  assert.equal(await db.purchaseRequest.count({ where: { storeId: store.id } }), before + 1);
  const createCommand = await db.commandRecord.findFirstOrThrow({ where: { actorUserId: storeUser.id, action: 'purchase-request.create', status: 'SUCCEEDED' } });
  const request = await db.purchaseRequest.findUniqueOrThrow({ where: { id: createCommand.resourceId } });
  assert.equal(request.storeId, store.id); assert.equal(await db.commandRecord.count({ where: { actorUserId: storeUser.id, action: 'purchase-request.create', status: 'SUCCEEDED' } }), 1);
  step('formal Store scoped catalog/cart/private product image/sales-only quote and actual order commit with exact recovery once');
  await call(`/purchase-requests/${request.id}/confirm`, { expectedVersion: request.version });
  const order = await db.supplierOrder.findFirstOrThrow({ where: { requestId: request.id }, include: { items: true } });
  const sent = await call(`/supplier-orders/${order.id}/shipments`, { expectedVersion: order.version, items: [{ orderItemId: order.items[0].id, shipQuantity: '2', permanentlyReduceQuantity: '0' }], freight: '0.00' });
  const openReceipt = async () => {
    await route('store'); await search(request.requestNo); await page.locator(`[data-store-order="${request.id}"]`).click();
    await page.locator(`[data-store-shipment="${sent.id}"]`).click(); await page.locator('.ws-dialog [name^="received:"]').waitFor();
  };
  const storeToken = await page.evaluate(base => JSON.parse(sessionStorage.getItem(`procurex-web-session-v1:${base}`)).accessToken, api);
  const shipmentDetail = await call(`/shipments/${sent.id}`); const key = randomUUID();
  const invalidBody = { expectedOrderVersion: shipmentDetail.supplierOrderVersion, expectedReceiptRevision: 0, items: [{ shipmentItemId: shipmentDetail.items[0].id, receivedQuantity: '3' }] };
  for (let attempt = 0; attempt < 2; attempt++) {
    const rejected = await fetch(`${api}/shipments/${sent.id}/receipts`, { method: 'POST', headers: { authorization: `Bearer ${storeToken}`, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(invalidBody) });
    assert.equal(rejected.status, 409); assert.notEqual((await rejected.json()).code, 'COMMAND_PROCESSING');
  }
  assert.equal((await db.commandRecord.findFirstOrThrow({ where: { actorUserId: storeUser.id, idempotencyKey: key } })).status, 'FAILED');
  assert.equal(await db.receipt.count({ where: { shipmentId: sent.id } }), 0);
  await openReceipt(); assert.equal(await page.locator('.ws-dialog [type="submit"]').isDisabled(), true);
  const bytes = await sharp({ create: { width: 160, height: 90, channels: 3, background: '#3d9578' } }).png().toBuffer();
  const picture = { name: 'store-local-receipt.png', mimeType: 'image/png', buffer: bytes };
  const uploadEndpoint = `${api}/files/upload-sessions`;
  await page.route(uploadEndpoint, intercepted => intercepted.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Local injected upload failure' }) }));
  await page.locator('[name="receiptPictures"]').setInputFiles(picture); await page.getByText(/上传失败/).waitFor();
  assert.equal(await page.locator('.ws-dialog [type="submit"]').isDisabled(), true); await page.unroute(uploadEndpoint);
  await page.locator('[data-upload-retry]').click(); await page.getByText(/已上传/).waitFor();
  await page.locator('.ws-dialog [name^="received:"]').fill('3');
  assert.equal(await page.locator('.ws-dialog form').evaluate(form => form.checkValidity()), false);
  await page.locator('.ws-dialog [name^="received:"]').fill('1'); await capture('store-short-receipt-desktop');
  await page.setViewportSize({ width: 390, height: 844 }); await capture('store-short-receipt-mobile');
  await loseResponse(`/shipments/${sent.id}/receipts`, () => page.locator('.ws-dialog [type="submit"]').click());
  assert.equal(await db.receipt.count({ where: { shipmentId: sent.id } }), 1);
  const receipt = await db.receipt.findFirstOrThrow({ where: { shipmentId: sent.id }, include: { evidenceFiles: true } });
  assert.equal(receipt.evidenceFiles.length, 1); assert.equal(receipt.evidenceFiles[0].ownerId, storeUser.id);
  assert.equal(await db.commandRecord.count({ where: { actorUserId: storeUser.id, action: 'shipment.receipt.create', status: 'SUCCEEDED' } }), 1);
  await openReceipt(); assert.equal(await page.locator('.ws-dialog [type="submit"]').isDisabled(), true);
  assert.equal(await page.locator('[name="receiptPictures"]').isVisible(), false);
  await page.waitForFunction(() => document.querySelector('.ws-dialog img[data-image]')?.naturalWidth === 160);
  await capture('store-current-receipt-evidence-mobile'); await page.getByRole('button', { name: '关闭', exact: true }).first().click();
  step('formal Store upload failure/retry, quantity max guard, evidenced short receipt and committed-response-loss recovery once; unchanged receipt cannot resubmit');
  const difference = await db.discrepancy.findFirstOrThrow({ where: { orderItem: { supplierOrderId: order.id }, status: 'OPEN' } });
  await call(`/discrepancies/${difference.id}/resolve`, { expectedVersion: difference.version, action: 'RETURN', reason: '隔离退回重收验证' });
  await openReceipt(); await page.locator('.ws-dialog [name^="received:"]').fill('2');
  await page.locator('[name="receiptPictures"]').setInputFiles({ ...picture, name: 'store-revised-receipt.png' }); await page.getByText(/已上传/).waitFor();
  await capture('store-returned-receipt-revision-mobile'); await save();
  assert.equal(await db.receipt.count({ where: { shipmentId: sent.id } }), 2);
  const revised = await db.receipt.findFirstOrThrow({ where: { shipmentId: sent.id, isCurrent: true }, include: { evidenceFiles: true } });
  assert.equal(revised.revision, 2); assert.equal(revised.evidenceFiles[0].filename, 'store-revised-receipt.png');
  assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).status, 'COMPLETED');
  step('formal Store returned receipt revised with fresh images/version and supplier order completed; original receipt retained');
  return { status: 'PASSED', requestId: request.id, shipmentId: sent.id, orderRecovery: 'ONE_COMMIT', receiptRecovery: 'ONE_REVISION', finalReceiptRevision: 2,
    currentEvidence: 'store-revised-receipt.png', precursorSetup: 'Procurement confirmation, shipment and RETURN use real API; not their additional UI acceptance', imageBasis: 'Local synthetic image, not camera or genuine receipt evidence' };
}
