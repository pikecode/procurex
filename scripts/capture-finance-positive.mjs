import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

export async function captureFinancePositive({ page, db, api, token, store, supplier, orderId, storeFinance, supplierUser, admin, login, route, search, save, capture, step }) {
  const call = async (path, body, expectedError) => {
    const response = await fetch(`${api}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (expectedError) { assert.equal(response.status, 404); assert.equal(result.code, expectedError); return result; }
    assert.ok(response.ok, `${path}: ${result.code}`); return result.data;
  };
  const image = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#267fa1' } }).png().toBuffer();
  const receiptProof = async filename => {
    const file = await call('/files/upload-sessions', { purpose: 'RECEIPT', filename, mimeType: 'image/png', sizeBytes: image.length });
    const bytes = await fetch(`${api}/files/${file.id}/content`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-upload-token': file.uploadToken }, body: image }); assert.ok(bytes.ok);
    await call(`/files/${file.id}/complete`, {}); return file.id;
  };
  const snapshots = await db.settlementItemSnapshot.findMany({ where: { supplierOrderId: orderId }, orderBy: { kind: 'asc' } }); assert.equal(snapshots.length, 2);
  const original = await db.shipment.findFirstOrThrow({ where: { supplierOrderId: orderId } });
  let receipt = await call(`/shipments/${original.id}`);
  const revision = await call(`/shipments/${original.id}/receipts`, { expectedOrderVersion: receipt.supplierOrderVersion, expectedReceiptRevision: receipt.currentReceiptRevision,
    items: [{ shipmentItemId: receipt.items[0].id, receivedQuantity: '1' }], evidenceFileIds: [await receiptProof('positive-late-shortage.png')] });
  const discrepancy = await db.discrepancy.findFirstOrThrow({ where: { receiptItem: { receiptId: revision.id }, status: 'OPEN' } });
  await call(`/discrepancies/${discrepancy.id}/resolve`, { expectedVersion: discrepancy.version, action: 'REPLENISH' });
  const gap = await db.replenishmentGap.findUniqueOrThrow({ where: { discrepancyId: discrepancy.id } });
  const beforeFee = await db.supplierOrder.findUniqueOrThrow({ where: { id: orderId } });
  const fee = await call(`/supplier-orders/${orderId}/freight-confirmations`, { expectedVersion: beforeFee.version, amount: '3.50', reason: '隔离补发新增运费' });
  await call(`/freight-confirmations/${fee.id}/confirm`, { expectedVersion: fee.version });
  const order = await db.supplierOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  const sent = await call(`/supplier-orders/${orderId}/shipments`, { expectedVersion: order.version, freight: '3.50', freightConfirmationId: fee.id,
    items: [{ orderItemId: order.items[0].id, shipQuantity: '1', permanentlyReduceQuantity: '0', gapAllocations: [{ gapId: gap.id, quantity: '1' }] }] });
  receipt = await call(`/shipments/${sent.id}`);
  await call(`/shipments/${sent.id}/receipts`, { expectedOrderVersion: receipt.supplierOrderVersion, expectedReceiptRevision: 0,
    items: [{ shipmentItemId: receipt.items[0].id, receivedQuantity: '1' }], evidenceFileIds: [await receiptProof('positive-replenishment.png')] });
  const documents = await db.adjustmentDocument.findMany({ where: { sourceShipmentId: sent.id, shipmentAdjustmentKind: 'FREIGHT' } });
  assert.deepEqual(documents.map(document => document.amount.toFixed(2)), ['3.50', '3.50']);
  assert.deepEqual(await db.settlementItemSnapshot.findMany({ where: { supplierOrderId: orderId }, orderBy: { kind: 'asc' } }), snapshots);
  const select = async mode => {
    await route('finance'); await page.locator('[name="billMode"]').selectOption(mode); await search(mode === 'supplier' ? supplier.name : '');
    const endpoint = mode === 'supplier' ? '/supplier-statements' : '/store-statements';
    const bills = await call(endpoint);
    const bill = bills.find(row => row.supplierId === supplier.id && row.adjustmentItems.some(item => item.supplierOrderId === orderId && item.amount === '3.50')); assert.ok(bill);
    const detail = await call(`${endpoint}/${bill.id}`);
    const item = detail.adjustmentItems.find(row => row.supplierOrderId === orderId && row.amount === '3.50'); assert.ok(item);
    await page.locator(`[data-bill="${bill.id}"]`).click(); await page.locator(`[data-settlement="${item.settlementItemId}"]`).check();
    return item.settlementItemId;
  };
  const supplierItem = await select('supplier');
  const blocked = await call('/payment-records/preview', { settlementItemIds: [supplierItem] }, 'PAYMENT_PREVIEW_EMPTY');
  assert.ok(blocked.details.blockedItems.some(item => item.code === 'STORE_RECEIVABLE_UNSETTLED'));
  await page.locator('[data-register-payment]').click(); await page.getByText('门店对应应收尚未结清，暂不能向供应商付款。').waitFor();
  await capture('finance-positive-company-payment-blocked-desktop');
  await page.locator('#ws-logout').click(); await login(storeFinance);
  const storeItem = await select('store'); await page.locator('[data-register-payment]').click();
  await page.locator('.ws-dialog [name="paymentFile"]').setInputFiles({ name: 'positive-store-payment.png', mimeType: 'image/png', buffer: image });
  await page.getByText('positive-store-payment.png · 已上传').waitFor(); await page.setViewportSize({ width: 390, height: 844 }); await capture('finance-positive-store-preview-mobile'); await save();
  const storePayment = await db.paymentRecord.findFirstOrThrow({ where: { direction: 'STORE_TO_COMPANY', allocations: { some: { settlementItemId: storeItem } } } });
  assert.equal(storePayment.amount.toFixed(2), '3.50');
  await page.locator('#ws-logout').click(); await login(admin); await route('finance');
  await page.locator(`[data-finance-payment="${storePayment.id}"]`).click(); await save();
  const unblocked = await call('/payment-records/preview', { settlementItemIds: [supplierItem] });
  assert.deepEqual(unblocked.blockedItems, []); assert.equal(unblocked.totalPayableAmount, '3.50');
  await select('supplier'); await page.locator('[data-register-payment]').click();
  await page.locator('.ws-dialog [name="paymentFile"]').setInputFiles({ name: 'positive-supplier-payment.png', mimeType: 'image/png', buffer: image });
  await page.getByText('positive-supplier-payment.png · 已上传').waitFor(); await save();
  const supplierPayment = await db.paymentRecord.findFirstOrThrow({ where: { direction: 'COMPANY_TO_SUPPLIER', allocations: { some: { settlementItemId: supplierItem } } } });
  assert.equal(supplierPayment.amount.toFixed(2), '3.50');
  await page.locator('#ws-logout').click(); await login(supplierUser); await route('finance');
  await page.locator(`[data-finance-payment="${supplierPayment.id}"]`).click(); await page.locator('.ws-dialog [type="submit"]').waitFor(); await capture('finance-positive-supplier-confirm-mobile'); await save();
  assert.equal((await db.paymentAllocation.findFirstOrThrow({ where: { paymentId: supplierPayment.id } })).state, 'CONFIRMED');
  for (const id of [storeItem, supplierItem]) {
    const quote = await call('/payment-records/preview', { settlementItemIds: [id] }); assert.equal(quote.totalPayableAmount, '0.00');
  }
  assert.deepEqual(await db.settlementItemSnapshot.findMany({ where: { supplierOrderId: orderId }, orderBy: { kind: 'asc' } }), snapshots);
  assert.equal(await db.accountLedger.count({ where: { account: { storeId: store.id } } }), 0);
  step('real frozen paid company order replenishment adds approved freight3.50: source snapshots unchanged, supplier positive adjustment blocked until own StoreFinance collection confirmed, scoped Supplier confirms extra3.50 once');
  await page.locator('#ws-logout').click(); await login(admin);
  return { status: 'PASSED', orderId, storeExtra: '3.50', supplierExtra: '3.50', originalSnapshots: 'UNCHANGED', companyPaymentGate: 'BLOCKED_THEN_RELEASED', remainingAdjustmentPayable: '0.00', precursorSetup: 'Real API late short receipt/replenishment/approved freight, synthetic proofs, not real banking or full mode acceptance' };
}
