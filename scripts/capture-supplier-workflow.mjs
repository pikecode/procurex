import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

// The caller supplies isolated master data and owns teardown of all resulting facts.
export async function captureSupplierWorkflow({ page, db, api, token, store, supplier, product, supplierUser, route, search, save, capture, step }) {
  let frame = 0;
  const screenshot = name => capture(`${name}-${++frame}`);
  const call = async (path, body, options = {}) => {
    const response = await fetch(`${api}${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...options.headers },
      body: body === undefined ? undefined : options.binary ? body : JSON.stringify(body) });
    const result = await response.json(); assert.ok(response.ok, `${path}: ${result.code || response.status}`); return result.data;
  };
  const upload = async (purpose, bytes, mimeType, filename) => {
    const session = await call('/files/upload-sessions', { purpose, filename, mimeType, sizeBytes: bytes.length });
    await call(`/files/${session.id}/content`, bytes, { binary: true, headers: { 'content-type': 'application/octet-stream', 'x-upload-token': session.uploadToken } });
    await call(`/files/${session.id}/complete`, {}); return session.id;
  };
  const image = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#268c72' } }).png().toBuffer();
  const newOrder = async quantity => {
    const request = await call('/purchase-requests', { storeId: store.id, items: [{ productId: product.id, quantity }] });
    await call(`/purchase-requests/${request.id}/confirm`, { expectedVersion: request.version });
    const order = await db.supplierOrder.findFirstOrThrow({ where: { requestId: request.id }, include: { items: true } });
    assert.equal(order.supplierId, supplier.id); return order;
  };
  const openOrder = async order => {
    await route('supplier'); await search(order.supplierOrderNo);
    await page.locator(`[data-supplier-order="${order.id}"]`).click(); await page.locator('#ws-open-shipment').waitFor();
  };
  const preview = async () => {
    await page.locator('#ws-shipment-preview').click(); await page.locator('#ws-shipment-quote').getByText(/供货货款/).waitFor();
    assert.equal(await page.locator('.ws-dialog [type="submit"]').isEnabled(), true);
  };
  const loseResponse = async (path, submit) => {
    const endpoint = `${api}${path}`;
    await page.route(endpoint, async intercepted => { const result = await intercepted.fetch(); assert.ok(result.ok()); await intercepted.abort('failed'); });
    try { await submit(); await page.getByText('提交结果暂未确认，请刷新列表核对后再操作。').waitFor(); }
    finally { await page.unroute(endpoint); }
    await screenshot('supplier-workflow-uncertain'); await page.reload(); await page.locator('#ws-recover').click();
    await page.locator('#ws-recover').waitFor({ state: 'detached' });
  };
  const shipment = async (order, { quantity, reduction = '0', gap, lost = false, freightConfirmation }) => {
    await openOrder(order); await page.locator('#ws-open-shipment').click();
    if (gap) { await page.locator('[name="shipmentMode"]').selectOption('REPLENISH'); await page.locator(`[name="gap:${gap.id}"]`).fill(quantity); }
    await page.locator(`[name="ship:${order.items[0].id}"]`).fill(quantity);
    if (!gap) await page.locator(`[name="reduce:${order.items[0].id}"]`).fill(reduction);
    if (freightConfirmation) await page.locator('[name="freightConfirmationId"]').selectOption(freightConfirmation.id);
    await preview(); await screenshot(gap ? 'supplier-replenishment-preview' : 'supplier-partial-shipment-preview');
    const before = await db.shipment.count({ where: { supplierOrderId: order.id } });
    if (lost) await loseResponse(`/supplier-orders/${order.id}/shipments`, () => page.locator('.ws-dialog [type="submit"]').click());
    else await save();
    assert.equal(await db.shipment.count({ where: { supplierOrderId: order.id } }), before + 1);
    return db.shipment.findFirstOrThrow({ where: { supplierOrderId: order.id }, orderBy: { sequence: 'desc' }, include: { items: true } });
  };
  const receipt = async (sent, quantity, evidence = false) => {
    const detail = await call(`/shipments/${sent.id}`);
    const evidenceFileIds = evidence ? [await upload('RECEIPT', image, 'image/png', 'local-short-receipt.png')] : undefined;
    return call(`/shipments/${sent.id}/receipts`, { expectedOrderVersion: detail.supplierOrderVersion,
      expectedReceiptRevision: detail.currentReceiptRevision, items: detail.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: quantity })),
      ...(evidenceFileIds ? { evidenceFileIds } : {}) });
  };
  const resolve = async (order, action) => {
    const difference = await db.discrepancy.findFirstOrThrow({ where: { orderItem: { supplierOrderId: order.id }, status: 'OPEN' } });
    await route('supplier');
    try { await page.locator(`[data-discrepancy="${difference.id}"]`).click(); }
    catch (failure) { await screenshot('supplier-task-failure'); throw new Error(`${failure.message}; supplier tasks: ${await page.locator('#ws-supplier-tasks').innerText()}`); }
    await page.locator('.ws-dialog [name="action"]').selectOption(action);
    await page.locator('.ws-dialog [name="reason"]').fill('隔离本地流程验收');
    assert.equal(await page.locator('.ws-dialog [data-download]').count(), 1);
    await screenshot(`supplier-difference-${action.toLowerCase()}`); await save();
    return db.discrepancy.findUniqueOrThrow({ where: { id: difference.id }, include: { replenishmentGap: true, returnRecord: true } });
  };

  const order = await newOrder('6');
  const first = await shipment(order, { quantity: '3', reduction: '1', lost: true });
  assert.equal(first.items[0].permanentlyReduced.toString(), '1');
  assert.equal((await call(`/supplier-orders/${order.id}`)).items[0].remainingToShipQuantity, '2');
  assert.equal(await db.commandRecord.count({ where: { actorUserId: supplierUser.id, action: 'supplier-order.shipment.create', resourceId: first.id, status: 'SUCCEEDED' } }), 1);
  await receipt(first, '2', true);
  const replenishing = await resolve(order, 'REPLENISH'); assert.equal(replenishing.status, 'REPLENISH_PENDING');
  assert.equal(replenishing.replenishmentGap.remainingQuantity.toString(), '1');
  const supplement = await shipment(order, { quantity: '1', gap: replenishing.replenishmentGap }); await receipt(supplement, '1');
  assert.equal((await call(`/supplier-orders/${order.id}`)).items[0].remainingToShipQuantity, '2');
  assert.equal((await db.replenishmentGap.findUniqueOrThrow({ where: { id: replenishing.replenishmentGap.id } })).remainingQuantity.toString(), '0');
  const last = await shipment(order, { quantity: '2' }); await receipt(last, '2');
  const completed = await call(`/supplier-orders/${order.id}`);
  assert.equal(completed.status, 'COMPLETED'); assert.equal(completed.items[0].remainingToShipQuantity, '0');
  assert.equal(completed.items[0].receivedQuantity, '5'); assert.equal(completed.supplyGoodsAmount, '50.00');
  step('formal supplier partial shipment, permanent reduction and committed response-loss recovery; evidenced short receipt, replenish gap, final receipt and exact payable50');

  for (const action of ['ACCEPT', 'RETURN']) {
    const other = await newOrder('2'); const sent = await shipment(other, { quantity: '2' }); await receipt(sent, '1', true);
    const resolved = await resolve(other, action);
    assert.equal(resolved.status, 'RESOLVED');
    if (action === 'RETURN') { assert.equal(resolved.returnRecord.quantity.toString(), '1'); await receipt(sent, '2'); }
    else assert.equal(resolved.returnRecord, null);
    const effective = await call(`/supplier-orders/${other.id}`);
    assert.equal(effective.status, 'COMPLETED'); assert.equal(effective.supplyGoodsAmount, action === 'ACCEPT' ? '10.00' : '20.00');
  }
  step('formal supplier ACCEPT shortage changes payable to10; RETURN permits fresh receipt revision and payable20');

  const freightOrder = await newOrder('2'); await openOrder(freightOrder); await page.locator('#ws-request-freight').click();
  await page.locator('.ws-dialog [name="amount"]').fill('3.50'); await page.locator('.ws-dialog [name="reason"]').fill('隔离运费申请验收');
  await screenshot('supplier-freight-request'); await save();
  const freightConfirmation = await db.freightConfirmation.findFirstOrThrow({ where: { supplierOrderId: freightOrder.id, status: 'PENDING' } });
  await call(`/freight-confirmations/${freightConfirmation.id}/confirm`, { expectedVersion: freightConfirmation.version });
  const freightShipment = await shipment(freightOrder, { quantity: '2', freightConfirmation }); await receipt(freightShipment, '2');
  assert.equal(freightShipment.freight.toFixed(2), '3.50');
  assert.equal(freightShipment.freightConfirmationId, freightConfirmation.id);
  const usedFreight = await db.freightConfirmation.findUniqueOrThrow({ where: { id: freightConfirmation.id } });
  assert.equal(usedFreight.status, 'USED'); assert.ok(usedFreight.usedAt);
  step('formal supplier freight request, real purchaser API approval and shipment consuming exactly approved3.50 once');

  const settlementItemId = Buffer.from(JSON.stringify({ kind: 'SUPPLIER_PAYABLE', supplierOrderId: order.id })).toString('base64url');
  const blocked = await fetch(`${api}/payment-records/preview`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ settlementItemIds: [settlementItemId] }) });
  assert.equal(blocked.status, 404); const blockedBody = await blocked.json();
  assert.equal(blockedBody.code, 'PAYMENT_PREVIEW_EMPTY'); assert.equal(blockedBody.details.blockedItems[0].code, 'STORE_RECEIVABLE_UNSETTLED');
  const registerPayment = async (itemId = settlementItemId, expectedAmount = '50.00') => {
    const quote = await call('/payment-records/preview', { settlementItemIds: [itemId] });
    assert.equal(quote.totalPayableAmount, expectedAmount); assert.equal(quote.blockedItems.length, 0);
    const evidenceFileId = await upload('PAYMENT', image, 'image/png', 'local-payment-proof.png');
    return call('/payment-records', { direction: quote.direction, businessDate: new Date().toISOString().slice(0, 10), remark: '本地隔离付款验收，非真实资金', evidenceFileIds: [evidenceFileId],
      items: quote.items.map(item => ({ settlementItemId: item.settlementItemId, expectedVersion: item.sourceVersion, expectedAmount: item.payableAmount })) });
  };
  const receivableId = Buffer.from(JSON.stringify({ kind: 'STORE_RECEIVABLE', supplierOrderId: order.id })).toString('base64url');
  const storePayment = await registerPayment(receivableId, completed.salesGoodsAmount);
  assert.equal(storePayment.direction, 'STORE_TO_COMPANY');
  await call(`/payment-records/${storePayment.id}/confirm`, { expectedVersion: storePayment.version });
  assert.equal((await call('/payment-records/preview', { settlementItemIds: [receivableId] })).totalPayableAmount, '0.00');
  const openPayment = async payment => { await route('supplier'); await page.locator(`[data-payment="${payment.id}"]`).click(); await page.locator('.ws-dialog [name="decision"]').waitFor(); };
  const rejected = await registerPayment(); await openPayment(rejected);
  const download = page.waitForEvent('download'); await page.locator('.ws-dialog [data-download]').click(); assert.equal((await download).suggestedFilename(), 'local-payment-proof.png');
  await page.locator('[name="decision"]').selectOption('reject'); await page.locator('[name="reason"]').fill('凭证需重新核对');
  await screenshot('supplier-payment-reject'); await save();
  assert.equal((await db.paymentRecord.findUniqueOrThrow({ where: { id: rejected.id } })).status, 'REJECTED');
  assert.equal((await db.paymentAllocation.findFirstOrThrow({ where: { paymentId: rejected.id } })).state, 'RELEASED');
  const paid = await registerPayment(); await openPayment(paid); await screenshot('supplier-payment-confirm');
  await loseResponse(`/payment-records/${paid.id}/confirm`, () => page.locator('.ws-dialog [type="submit"]').click());
  assert.equal((await db.paymentRecord.findUniqueOrThrow({ where: { id: paid.id } })).status, 'CONFIRMED');
  assert.equal((await db.paymentAllocation.findFirstOrThrow({ where: { paymentId: paid.id } })).state, 'CONFIRMED');
  assert.equal(await db.commandRecord.count({ where: { actorUserId: supplierUser.id, action: 'payment-record.confirm', resourceId: paid.id, status: 'SUCCEEDED' } }), 1);
  const balance = await call('/payment-records/preview', { settlementItemIds: [settlementItemId] }); assert.equal(balance.totalPayableAmount, '0.00');
  step('formal supplier authenticated evidence download, real allocated payment reject/release, corrected payment confirm and lost-response recovery once; payable0');
  return { status: 'PASSED', orderedQuantity: '6', permanentlyReduced: '1', receivedQuantity: completed.items[0].receivedQuantity,
    replenishmentDoesNotConsumeNormalRemaining: '2', supplyGoodsAmount: completed.supplyGoodsAmount, finalPayable: balance.totalPayableAmount,
    shipmentRecovery: 'ONE_COMMIT', paymentRecovery: 'ONE_CONFIRMATION', companyPaymentRequiresCollectedStoreReceivable: 'PASSED',
    receiptAndStorePaymentSetup: 'Real API with local synthetic evidence, not Store/finance UI or genuine payment/device acceptance' };
}
