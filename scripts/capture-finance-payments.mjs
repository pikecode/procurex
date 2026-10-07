import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

export async function captureFinancePayments({ page, db, api, token, store, supplier, product, admin, supplierUser, login, route, search, save, capture, step, exerciseBranches = true }) {
  const call = async (path, body) => {
    const response = await fetch(`${api}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json(); assert.ok(response.ok, `${path}: ${result.code}`); return result.data;
  };
  const image = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#248b72' } }).png().toBuffer();
  const proof = await call('/files/upload-sessions', { purpose: 'RECEIPT', filename: 'finance-order-receipt.png', mimeType: 'image/png', sizeBytes: image.length });
  const upload = await fetch(`${api}/files/${proof.id}/content`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-upload-token': proof.uploadToken }, body: image }); assert.ok(upload.ok); await call(`/files/${proof.id}/complete`, {});
  const request = await call('/purchase-requests', { storeId: store.id, items: [{ productId: product.id, quantity: '2' }] });
  await call(`/purchase-requests/${request.id}/confirm`, { expectedVersion: request.version });
  const order = await db.supplierOrder.findFirstOrThrow({ where: { requestId: request.id }, include: { items: true } });
  const sent = await call(`/supplier-orders/${order.id}/shipments`, { expectedVersion: order.version, items: [{ orderItemId: order.items[0].id, shipQuantity: '2', permanentlyReduceQuantity: '0' }], freight: '0.00' });
  const detail = await call(`/shipments/${sent.id}`);
  await call(`/shipments/${sent.id}/receipts`, { expectedOrderVersion: detail.supplierOrderVersion, expectedReceiptRevision: 0, items: [{ shipmentItemId: detail.items[0].id, receivedQuantity: '2' }], evidenceFileIds: [proof.id] });
  const selectBill = async mode => {
    await route('finance'); await page.locator('[name="billMode"]').selectOption(mode); await search(mode === 'supplier' ? supplier.name : '');
    const bills = await call(mode === 'supplier' ? '/supplier-statements' : '/store-statements');
    const bill = bills.find(item => item.supplierId === supplier.id && (mode === 'supplier' || item.storeId === store.id)); assert.ok(bill);
    await page.locator(`[data-bill="${bill.id}"]`).click();
    const billDetail = await call(`${mode === 'supplier' ? '/supplier-statements' : '/store-statements'}/${bill.id}`);
    const line = billDetail.lines.find(item => item.supplierOrderId === order.id); assert.ok(line);
    await page.locator(`[data-settlement="${line.settlementItemId}"]`).check();
    await page.locator('[data-register-payment]').click(); await page.locator('.ws-dialog [name="paymentFile"]').waitFor({ state: 'attached' });
  };
  let failUpload = true;
  await page.route('**/files/upload-sessions', async intercepted => {
    if (failUpload) { failUpload = false; await intercepted.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'TEST_UPLOAD_FAILURE', message: '测试上传失败' }) }); }
    else await intercepted.continue();
  });
  await selectBill('store');
  await page.locator('.ws-dialog [name="paymentFile"]').setInputFiles({ name: 'store-payment.png', mimeType: 'image/png', buffer: image });
  await page.locator('[data-payment-retry]').click(); await page.getByText('store-payment.png · 已上传').waitFor(); await page.unroute('**/files/upload-sessions');
  await capture('finance-payment-preview-mobile');
  let lost = false;
  await page.route(`${api}/payment-records`, async intercepted => {
    if (intercepted.request().method() !== 'POST' || lost) return intercepted.continue();
    const response = await intercepted.fetch(); assert.equal(response.status(), 201); lost = true; await intercepted.abort('failed');
  });
  await page.locator('.ws-dialog [type="submit"]').click(); await page.locator('.ws-form-error:not([hidden])').waitFor(); assert.ok(lost);
  await page.unroute(`${api}/payment-records`); await route('finance'); await page.locator('[data-finance-recover]').click(); await page.locator('[data-finance-recover]').waitFor({ state: 'detached' });
  let first = await db.paymentRecord.findFirstOrThrow({ where: { allocations: { some: { supplierOrderId: order.id } }, direction: 'STORE_TO_COMPANY' } });
  assert.equal(await db.paymentRecord.count({ where: { allocations: { some: { supplierOrderId: order.id } } } }), 1);
  if (exerciseBranches) {
    await page.locator(`[data-finance-payment="${first.id}"]`).click();
    await page.locator('.ws-dialog [name="decision"]').selectOption('cancel');
    await page.locator('.ws-dialog [type="submit"]').click(); await page.getByText('请填写驳回或撤销原因。').waitFor();
    await page.locator('.ws-dialog [name="reason"]').fill('撤销重复登记');
    let cancelLost = false;
    await page.route(`${api}/payment-records/${first.id}/cancel`, async intercepted => {
      const response = await intercepted.fetch(); assert.equal(response.status(), 201); cancelLost = true; await intercepted.abort('failed');
    });
    await page.locator('.ws-dialog [type="submit"]').click(); await page.locator('.ws-form-error:not([hidden])').waitFor(); assert.ok(cancelLost);
    await page.unroute(`${api}/payment-records/${first.id}/cancel`); await route('finance');
    await page.locator('[data-finance-recover]').click(); await page.locator('[data-finance-recover]').waitFor({ state: 'detached' });
    assert.equal((await db.paymentRecord.findUniqueOrThrow({ where: { id: first.id } })).status, 'CANCELLED');
    assert.equal((await db.paymentAllocation.findFirstOrThrow({ where: { paymentId: first.id } })).state, 'RELEASED');
    await page.locator(`[data-finance-payment="${first.id}"]`).click(); assert.equal(await page.locator('.ws-dialog [type="submit"]').count(), 0);
    await capture('finance-cancelled-payment-mobile'); await page.locator('.ws-dialog [data-close]').click();
    await selectBill('store');
    await page.locator('.ws-dialog [name="paymentFile"]').setInputFiles({ name: 'stale-payment-preview.png', mimeType: 'image/png', buffer: image });
    await page.getByText('stale-payment-preview.png · 已上传').waitFor();
    const proof = await call('/files/upload-sessions', { purpose: 'PAYMENT', filename: 'competing-reservation.png', mimeType: 'image/png', sizeBytes: image.length });
    const bytes = await fetch(`${api}/files/${proof.id}/content`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-upload-token': proof.uploadToken }, body: image }); assert.ok(bytes.ok);
    await call(`/files/${proof.id}/complete`, {});
    const storeBills = await call('/store-statements'); const bill = storeBills.find(item => item.storeId === store.id && item.supplierId === supplier.id);
    const line = (await call(`/store-statements/${bill.id}`)).lines.find(item => item.supplierOrderId === order.id);
    const competingQuote = await call('/payment-records/preview', { settlementItemIds: [line.settlementItemId] });
    const competing = await call('/payment-records', { direction: competingQuote.direction, businessDate: '2026-10-04', evidenceFileIds: [proof.id],
      items: competingQuote.items.map(item => ({ settlementItemId: item.settlementItemId, expectedVersion: item.sourceVersion, expectedAmount: item.payableAmount })) });
    await page.locator('.ws-dialog [type="submit"]').click(); await page.getByText('结算明细已变化，请关闭后重新预览。').waitFor();
    assert.equal(await db.paymentRecord.count({ where: { allocations: { some: { supplierOrderId: order.id } } } }), 2);
    await capture('finance-stale-payment-preview-mobile');
    await call(`/payment-records/${competing.id}/cancel`, { expectedVersion: competing.version, reason: '结束隔离竞争预约' });
    await page.locator('.ws-dialog [data-close]').click(); await selectBill('store');
    await page.locator('.ws-dialog [name="paymentFile"]').setInputFiles({ name: 'reapproved-payment.png', mimeType: 'image/png', buffer: image });
    await page.getByText('reapproved-payment.png · 已上传').waitFor(); await save();
    first = await db.paymentRecord.findFirstOrThrow({ where: { status: 'PENDING', direction: 'STORE_TO_COMPANY', allocations: { some: { supplierOrderId: order.id } } } });
    step('scoped StoreFinance cancellation validates reason, committed-response loss recovers CANCELLED/RELEASED once; competing real reservation invalidates payment preview without a new record');
  }
  await page.locator('#ws-logout').click(); await login(admin); await route('finance');
  await page.locator(`[data-finance-payment="${first.id}"]`).click();
  const downloaded = page.waitForEvent('download'); await page.locator('.ws-dialog [data-evidence]').click(); assert.equal((await downloaded).suggestedFilename(), exerciseBranches ? 'reapproved-payment.png' : 'store-payment.png');
  await page.locator('.ws-dialog [name="decision"]').selectOption('reject'); await page.locator('.ws-dialog [name="reason"]').fill('更正付款凭证'); await save();
  assert.equal((await db.paymentAllocation.findFirstOrThrow({ where: { paymentId: first.id } })).state, 'RELEASED');
  await selectBill('store'); await page.locator('.ws-dialog [name="paymentFile"]').setInputFiles({ name: 'corrected-payment.png', mimeType: 'image/png', buffer: image });
  await page.getByText('corrected-payment.png · 已上传').waitFor(); await save();
  const second = await db.paymentRecord.findFirstOrThrow({ where: { direction: 'STORE_TO_COMPANY', status: 'PENDING', allocations: { some: { supplierOrderId: order.id } } } });
  await page.locator(`[data-finance-payment="${second.id}"]`).click(); await save();
  assert.equal((await db.paymentAllocation.findFirstOrThrow({ where: { paymentId: second.id } })).state, 'CONFIRMED');
  await selectBill('supplier'); await page.locator('.ws-dialog [name="paymentFile"]').setInputFiles({ name: 'supplier-payment.png', mimeType: 'image/png', buffer: image });
  await page.getByText('supplier-payment.png · 已上传').waitFor(); await page.setViewportSize({ width: 1440, height: 960 }); await capture('finance-supplier-payment-preview-desktop'); await save();
  const third = await db.paymentRecord.findFirstOrThrow({ where: { direction: 'COMPANY_TO_SUPPLIER', status: 'PENDING', allocations: { some: { supplierOrderId: order.id } } } });
  await page.locator('#ws-logout').click(); await login(supplierUser); await route('finance');
  await page.locator(`[data-finance-payment="${third.id}"]`).click(); await page.setViewportSize({ width: 390, height: 844 }); await capture('finance-supplier-payment-review-mobile'); await save();
  assert.equal((await db.paymentAllocation.findFirstOrThrow({ where: { paymentId: third.id } })).state, 'CONFIRMED');
  step('formal finance bill payment preview/evidence upload retry/download, create lost-response recovery once, reject/release/corrected confirm, central supplier payment and supplier scoped review');
  await page.locator('#ws-logout').click(); await login(admin);
  return { status: 'PASSED', orderId: order.id, paymentCreateRecovery: 'ONE_RECORD', cancellationRecovery: exerciseBranches ? 'CANCELLED_RELEASED_ONCE' : 'NOT_REPEATED', stalePreview: exerciseBranches ? 'REAL_RESERVATION_BLOCKED' : 'NOT_REPEATED', uploadRetry: 'PASS', rejectionRelease: 'PASS', storeCollection: 'CONFIRMED', supplierPayment: 'CONFIRMED', precursorSetup: 'Actual API order/ship/evidenced receipt; synthetic proof, not real funds/full four-mode acceptance' };
}
