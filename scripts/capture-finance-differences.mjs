import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

export async function captureFinanceDifferences({ page, db, api, token, store, supplier, product, orderId, storeFinance, supplierUser, admin, login, route, save, capture, step, storeMethod = 'OFFLINE_RETURN', supplierMethod = 'OFFSET' }) {
  const call = async (path, body) => {
    const response = await fetch(`${api}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json(); assert.ok(response.ok, `${path}: ${result.code}`); return result.data;
  };
  const image = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#267fa1' } }).png().toBuffer();
  const receiptProof = async filename => {
    const file = await call('/files/upload-sessions', { purpose: 'RECEIPT', filename, mimeType: 'image/png', sizeBytes: image.length });
    const response = await fetch(`${api}/files/${file.id}/content`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-upload-token': file.uploadToken }, body: image }); assert.ok(response.ok);
    await call(`/files/${file.id}/complete`, {}); return file.id;
  };
  const snapshots = await db.settlementItemSnapshot.findMany({ where: { supplierOrderId: orderId }, orderBy: { kind: 'asc' } });
  assert.equal(snapshots.length, 2);
  const sent = await db.shipment.findFirstOrThrow({ where: { supplierOrderId: orderId } });
  const receipt = await call(`/shipments/${sent.id}`);
  const revision = await call(`/shipments/${sent.id}/receipts`, { expectedOrderVersion: receipt.supplierOrderVersion, expectedReceiptRevision: receipt.currentReceiptRevision,
    items: [{ shipmentItemId: receipt.items[0].id, receivedQuantity: '1' }], evidenceFileIds: [await receiptProof('late-financial-shortage.png')] });
  const gap = await db.discrepancy.findFirstOrThrow({ where: { receiptItem: { receiptId: revision.id }, status: 'OPEN' } });
  await call(`/discrepancies/${gap.id}/resolve`, { expectedVersion: gap.version, action: 'ACCEPT' });
  const after = await db.settlementItemSnapshot.findMany({ where: { supplierOrderId: orderId }, orderBy: { kind: 'asc' } });
  assert.deepEqual(after, snapshots);
  const rows = await call(`/adjustments?storeId=${store.id}&supplierId=${supplier.id}`);
  const storeCredit = rows.find(row => row.sourceDiscrepancyId === gap.id && row.direction === 'STORE_RECEIVABLE_DECREASE');
  const supplierCredit = rows.find(row => row.sourceDiscrepancyId === gap.id && row.direction === 'SUPPLIER_PAYABLE_DECREASE');
  assert.ok(storeCredit?.disposalCreditItemId); assert.ok(supplierCredit?.disposalCreditItemId);
  const createTarget = async () => {
    const request = await call('/purchase-requests', { storeId: store.id, items: [{ productId: product.id, quantity: '2' }] });
    await call(`/purchase-requests/${request.id}/confirm`, { expectedVersion: request.version });
    const order = await db.supplierOrder.findFirstOrThrow({ where: { requestId: request.id }, include: { items: true } });
    const shipment = await call(`/supplier-orders/${order.id}/shipments`, { expectedVersion: order.version, items: [{ orderItemId: order.items[0].id, shipQuantity: '2', permanentlyReduceQuantity: '0' }], freight: '0.00' });
    const detail = await call(`/shipments/${shipment.id}`);
    await call(`/shipments/${shipment.id}/receipts`, { expectedOrderVersion: detail.supplierOrderVersion, expectedReceiptRevision: 0,
      items: [{ shipmentItemId: detail.items[0].id, receivedQuantity: '2' }], evidenceFileIds: [await receiptProof('offset-target-receipt.png')] });
    return order;
  };
  const targetOrder = await createTarget();
  const selectTarget = async () => {
    const id = await page.locator('.ws-dialog [name="target"] option').evaluateAll((options, orderNo) => options.find(option => option.textContent === orderNo)?.value, targetOrder.supplierOrderNo); assert.ok(id);
    await page.locator('.ws-dialog [name="target"]').selectOption(id); return id;
  };
  await route('finance'); await page.locator(`[data-adjustment="${storeCredit.id}"]`).click();
  await page.locator('.ws-dialog [name="method"]').selectOption(storeMethod);
  const storeTarget = storeMethod === 'OFFSET' ? await selectTarget() : null;
  await capture('finance-store-return-preview-mobile');
  let lost = false;
  await page.route(`${api}/difference-disposals`, async intercepted => {
    if (intercepted.request().method() !== 'POST' || lost) return intercepted.continue();
    const response = await intercepted.fetch(); assert.equal(response.status(), 201); lost = true; await intercepted.abort('failed');
  });
  await page.locator('.ws-dialog [type="submit"]').click(); await page.locator('.ws-form-error:not([hidden])').waitFor(); assert.ok(lost);
  await page.unroute(`${api}/difference-disposals`); await route('finance'); await page.locator('[data-finance-recover]').click(); await page.locator('[data-finance-recover]').waitFor({ state: 'detached' });
  const storeDisposal = await db.differenceDisposal.findFirstOrThrow({ where: { items: { some: { adjustmentDocumentId: storeCredit.disposalCreditItemId } } } });
  assert.equal(await db.differenceDisposalItem.count({ where: { adjustmentDocumentId: storeCredit.disposalCreditItemId } }), 1);
  await page.locator('#ws-logout').click(); await login(storeFinance); await route('finance');
  assert.equal(await page.locator(`[data-adjustment="${supplierCredit.id}"]`).count(), 0);
  await page.locator(`[data-adjustment="${storeCredit.id}"]`).click(); await capture('finance-store-return-confirm-mobile'); await save();
  assert.equal((await db.differenceDisposal.findUniqueOrThrow({ where: { id: storeDisposal.id } })).status, 'CONFIRMED');
  assert.equal(storeDisposal.method, storeMethod);
  assert.equal((await db.differenceDisposalItem.findFirstOrThrow({ where: { disposalId: storeDisposal.id } })).targetDebitItemId, storeTarget);
  await page.locator(`[data-adjustment="${storeCredit.id}"]`).click(); assert.equal(await page.locator('.ws-dialog [type="submit"]').count(), 0);
  await page.locator('.ws-dialog [data-close]').click();
  await page.locator('#ws-logout').click(); await login(admin);
  await route('finance'); await page.locator(`[data-adjustment="${supplierCredit.id}"]`).click();
  await page.locator('.ws-dialog [name="method"]').selectOption(supplierMethod);
  const targetId = supplierMethod === 'OFFSET' ? await selectTarget() : null;
  await page.setViewportSize({ width: 1440, height: 960 }); await capture('finance-supplier-offset-preview-desktop'); await save();
  const supplierDisposal = await db.differenceDisposal.findFirstOrThrow({ where: { items: { some: { adjustmentDocumentId: supplierCredit.disposalCreditItemId } } } });
  await page.locator('#ws-logout').click(); await login(supplierUser); await route('finance');
  assert.equal(await page.locator(`[data-adjustment="${storeCredit.id}"]`).count(), 0);
  await page.locator(`[data-adjustment="${supplierCredit.id}"]`).click();
  if (supplierMethod === 'OFFSET') await page.locator('.ws-dialog').getByText(targetOrder.supplierOrderNo, { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); await capture('finance-supplier-offset-confirm-mobile'); await save();
  assert.equal((await db.differenceDisposal.findUniqueOrThrow({ where: { id: supplierDisposal.id } })).status, 'CONFIRMED');
  assert.equal(supplierDisposal.method, supplierMethod);
  assert.equal((await db.differenceDisposalItem.findFirstOrThrow({ where: { disposalId: supplierDisposal.id } })).targetDebitItemId, targetId);
  assert.equal(await db.accountLedger.count({ where: { account: { storeId: store.id } } }), 0);
  step(`actual frozen paid order late-shortage credit: Store ${storeMethod} recovery once and scoped confirmation, Supplier ${supplierMethod} scoped confirmation, original snapshots untouched, no account ledger mutation`);
  await page.locator('#ws-logout').click(); await login(admin);
  return { status: 'PASSED', sourceOrderId: orderId, storeReturnAmount: storeCredit.pendingReturnOrOffsetAmount, supplierOffsetAmount: supplierCredit.pendingReturnOrOffsetAmount,
    storeMethod, supplierMethod, createRecovery: 'ONE_DISPOSAL', originalSnapshots: 'UNCHANGED', storeReturn: 'CONFIRMED', supplierOffset: 'CONFIRMED', precursorSetup: 'Actual API evidenced late-short receipt/ACCEPT and offset-target order fulfillment; not their extra UI or real funds acceptance' };
}
