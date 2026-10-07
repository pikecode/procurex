import assert from 'node:assert/strict';
import sharp from 'sharp';

export async function captureCrossRoleJourney({ page, db, api, store, supplier, product, storeUser, supplierUser,
  storeFinance, finance, purchaser, admin, login, route, search, save, capture, step, mode = 'COMPANY_TERM', verifyRepricing = false }) {
  const switchRole = async user => {
    await page.locator('#ws-logout').click();
    await page.locator('#ws-login-form').waitFor();
    await login(user);
  };
  const proof = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#248b72' } }).png().toBuffer();
  const orderIdsBefore = new Set((await db.purchaseRequest.findMany({ where: { storeId: store.id }, select: { id: true } })).map(row => row.id));
  await switchRole(storeUser); await page.setViewportSize({ width: 390, height: 844 }); await route('store');
  await page.locator('#ws-create').click();
  await page.locator('#ws-draft-product option').first().waitFor({ state: 'attached' });
  await page.locator('#ws-draft-product').selectOption(product.id); await page.locator('#ws-draft-add').click();
  await page.locator(`[name="quantity:${product.id}"]`).fill('2');
  await page.locator('#ws-draft-preview').click(); await page.locator('#ws-draft-quote').getByText(/销售货款/).waitFor();
  await capture('journey-store-order-mobile'); await save();
  const requests = await db.purchaseRequest.findMany({ where: { storeId: store.id } });
  const created = requests.filter(row => !orderIdsBefore.has(row.id)); assert.equal(created.length, 1);
  const request = created[0];
  assert.equal(request.status, 'PENDING_PROCUREMENT');
  assert.equal(await db.supplierOrder.count({ where: { requestId: request.id } }), 0);
  step('same-order journey: scoped Store creates pending request through formal mobile UI, no supplier push before approval');

  await switchRole(purchaser); await route('purchaser'); await search(request.requestNo);
  await page.getByRole('button', { name: '打开申请', exact: true }).click(); await page.locator('#ws-confirm').click();
  await capture('journey-purchaser-confirm-mobile'); await save();
  const order = await db.supplierOrder.findFirstOrThrow({ where: { requestId: request.id }, include: { items: true } });
  assert.equal(order.supplierId, supplier.id); assert.equal(order.settlementMode, mode);
  assert.equal(await db.supplierOrder.count({ where: { requestId: request.id } }), 1);
  step(`same-order journey: Purchaser approves exact Store request through formal UI, creating one ${mode} supplier order`);

  await switchRole(supplierUser); await route('supplier'); await search(order.supplierOrderNo);
  await page.locator(`[data-supplier-order="${order.id}"]`).click(); await page.locator('#ws-open-shipment').click();
  await page.locator(`[name="ship:${order.items[0].id}"]`).fill('2');
  await page.locator(`[name="reduce:${order.items[0].id}"]`).fill('0');
  await page.locator('#ws-shipment-preview').click(); await page.locator('#ws-shipment-quote').getByText(/供货货款/).waitFor();
  await capture('journey-supplier-shipment-mobile'); await save();
  const shipment = await db.shipment.findFirstOrThrow({ where: { supplierOrderId: order.id } });
  assert.equal(await db.shipment.count({ where: { supplierOrderId: order.id } }), 1);
  step('same-order journey: own Supplier ships exact approved order through formal UI');

  await switchRole(storeUser); await route('store'); await search(request.requestNo);
  await page.locator(`[data-store-order="${request.id}"]`).click();
  await page.locator(`[data-store-shipment="${shipment.id}"]`).click();
  await page.locator('.ws-dialog [name^="received:"]').fill('2');
  await page.locator('[name="receiptPictures"]').setInputFiles({ name: 'journey-receipt.png', mimeType: 'image/png', buffer: proof });
  await page.getByText(/已上传/).waitFor(); await capture('journey-store-receipt-mobile'); await save();
  const receipt = await db.receipt.findFirstOrThrow({ where: { shipmentId: shipment.id }, include: { evidenceFiles: true } });
  assert.equal(receipt.evidenceFiles.length, 1); assert.equal(receipt.evidenceFiles[0].ownerId, storeUser.id);
  assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).status, 'COMPLETED');
  step('same-order journey: original Store uploads private receipt proof and completes original shipment through formal UI');

  const read = async path => {
    const token = await page.evaluate(base => JSON.parse(sessionStorage.getItem(`procurex-web-session-v1:${base}`)).accessToken, api);
    const response = await fetch(`${api}${path}`, { headers: { authorization: `Bearer ${token}` } });
    assert.ok(response.ok, `Journey readonly lookup ${path}: ${response.status}`);
    return (await response.json()).data;
  };
  const register = async (mode, direction, filename) => {
    await route('finance'); await page.locator('[name="billMode"]').selectOption(mode); await search('');
    const path = mode === 'store' ? '/store-statements' : mode === 'direct' ? '/direct-statements' : '/supplier-statements';
    const bill = (await read(path)).find(row => row.supplierId === supplier.id && (mode === 'supplier' || row.storeId === store.id));
    assert.ok(bill); const detail = await read(`${path}/${bill.id}`);
    const line = detail.lines.find(row => row.supplierOrderId === order.id); assert.ok(line);
    await page.locator(`[data-bill="${bill.id}"]`).click();
    await page.locator(`[data-settlement="${line.settlementItemId}"]`).check(); await page.locator('[data-register-payment]').click();
    await page.locator('.ws-dialog [name="paymentFile"]').setInputFiles({ name: filename, mimeType: 'image/png', buffer: proof });
    await page.getByText(`${filename} · 已上传`).waitFor(); await capture(`journey-${mode}-payment-mobile`); await save();
    const payments = await db.paymentRecord.findMany({ where: { direction, allocations: { some: { supplierOrderId: order.id } } } });
    assert.equal(payments.length, 1);
    return { payment: payments[0], billId: bill.id, path, settlementItemId: line.settlementItemId, totalAmount: line.totalAmount };
  };
  const assertSettled = async registration => {
    const allocation = await db.paymentAllocation.findFirstOrThrow({ where: { paymentId: registration.payment.id,
      supplierOrderId: order.id, settlementItemId: registration.settlementItemId } });
    assert.equal(allocation.state, 'CONFIRMED');
    assert.equal(allocation.amount.toFixed(2), registration.totalAmount);
    const detail = await read(`${registration.path}/${registration.billId}`);
    assert.equal(detail.lines.find(row => row.supplierOrderId === order.id).totalAmount, registration.totalAmount);
  };
  const paymentIds = [];
  if (mode === 'COMPANY_TERM') {
    await switchRole(storeFinance);
    const collection = await register('store', 'STORE_TO_COMPANY', 'journey-store-payment.png');
    await switchRole(finance); await route('finance');
    await page.locator(`[data-finance-payment="${collection.payment.id}"]`).click();
    await capture('journey-hq-collection-confirm-mobile'); await save();
    assert.equal((await db.paymentRecord.findUniqueOrThrow({ where: { id: collection.payment.id } })).status, 'CONFIRMED');
    await assertSettled(collection); paymentIds.push(collection.payment.id);
    step('same-order journey: own StoreFinance registers original order collection; HQ_FINANCE confirms through formal UI');
  } else if (mode === 'CREDIT') {
    const funding = await db.fundingAllocation.findFirstOrThrow({ where: { requestId: request.id } });
    await switchRole(finance); await route('finance'); await page.locator('[name="accountStore"]').selectOption(store.id);
    await page.locator(`[data-credit-item="${funding.id}"]`).check(); await page.locator('[data-clearing]').click();
    await page.locator('[name="accountProofFile"]').setInputFiles({ name: 'journey-clearing.png', mimeType: 'image/png', buffer: proof });
    await page.getByText('journey-clearing.png · 已上传').waitFor(); await capture('journey-clearing-mobile'); await save();
    const cleared = await db.fundingAllocation.findUniqueOrThrow({ where: { id: funding.id } });
    assert.equal(cleared.creditOutstanding.toFixed(2), '0.00'); assert.equal(cleared.netPaid.toFixed(2), order.salesGoodsAmount.toFixed(2));
    assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } })).creditUsed.toFixed(2), '0.00');
    step('same-order journey: HQ_FINANCE clears actual procurement credit with private image; original paid history retained');
  }
  await switchRole(mode === 'SUPPLIER_TERM' ? storeFinance : finance);
  const payment = await register(mode === 'SUPPLIER_TERM' ? 'direct' : 'supplier', mode === 'SUPPLIER_TERM' ? 'STORE_TO_SUPPLIER' : 'COMPANY_TO_SUPPLIER', 'journey-supplier-payment.png');
  await switchRole(supplierUser); await route('finance');
  await page.locator(`[data-finance-payment="${payment.payment.id}"]`).click();
  await capture('journey-supplier-payment-confirm-mobile'); await save();
  assert.equal((await db.paymentRecord.findUniqueOrThrow({ where: { id: payment.payment.id } })).status, 'CONFIRMED');
  await assertSettled(payment);
  paymentIds.push(payment.payment.id);
  assert.equal(await db.paymentAllocation.count({ where: { supplierOrderId: order.id, state: 'CONFIRMED' } }), mode === 'COMPANY_TERM' ? 2 : 1);
  if (verifyRepricing) assert.equal((await read(`${payment.path}/${payment.billId}`)).payableAmount, '0.00');
  if (mode === 'COMPANY_TERM' || mode === 'SUPPLIER_TERM') assert.equal(await db.accountLedger.count({ where: { account: { storeId: store.id } } }), 0);
  if (mode === 'CREDIT' || mode === 'STORED_VALUE') {
    assert.equal(await db.paymentRecord.count({ where: { direction: 'STORE_TO_COMPANY', allocations: { some: { supplierOrderId: order.id } } } }), 0);
    const settledRequest = await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(settledRequest.paidAmount.toFixed(2), order.salesGoodsAmount.toFixed(2)); assert.equal(settledRequest.paymentStatus, 'PAID');
  }
  step(`same-order journey: ${mode} applicable payment confirmed, no duplicate account collection or company/direct crossover`);
  await switchRole(admin);
  if (mode === 'SUPPLIER_TERM') for (const path of ['/store-statements', '/supplier-statements', '/supplier-store-statements'])
    assert.equal((await read(path)).filter(row => row.supplierId === supplier.id).length, 0);
  let repricing;
  if (verifyRepricing) {
    const historical = async () => ({
      order: await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } }),
      request: await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } }),
      snapshots: await db.settlementItemSnapshot.findMany({ where: { supplierOrderId: order.id }, orderBy: { id: 'asc' } }),
      payments: await db.paymentRecord.findMany({ where: { id: { in: paymentIds } }, orderBy: { id: 'asc' } }),
      allocations: await db.paymentAllocation.findMany({ where: { supplierOrderId: order.id }, orderBy: { id: 'asc' } }),
      funding: await db.fundingAllocation.findMany({ where: { requestId: request.id }, orderBy: { id: 'asc' } }),
      clearingItems: await db.clearingItem.findMany({ where: { fundingAllocation: { requestId: request.id } }, orderBy: { id: 'asc' } }),
    });
    const paidHistory = await historical(); assert.ok(paidHistory.snapshots.length > 0);
    const createNext = async name => {
      const ids = new Set((await db.purchaseRequest.findMany({ where: { storeId: store.id }, select: { id: true } })).map(row => row.id));
      await switchRole(storeUser); await route('store'); await page.locator('#ws-create').click();
      await page.locator('#ws-draft-product').selectOption(product.id); await page.locator('#ws-draft-add').click();
      await page.locator(`[name="quantity:${product.id}"]`).fill('2'); await page.locator('#ws-draft-preview').click();
      await page.locator('#ws-draft-quote').getByText(/销售货款/).waitFor(); await capture(name); await save();
      const added = (await db.purchaseRequest.findMany({ where: { storeId: store.id } })).filter(row => !ids.has(row.id)); assert.equal(added.length, 1); return added[0];
    };
    const unfinishedRequest = await createNext('journey-unfinished-before-price-mobile');
    await switchRole(purchaser); await route('purchaser'); await search(unfinishedRequest.requestNo);
    await page.getByRole('button', { name: '打开申请', exact: true }).click(); await page.locator('#ws-confirm').click(); await save();
    const unfinished = await db.supplierOrder.findFirstOrThrow({ where: { requestId: unfinishedRequest.id } });
    await switchRole(admin); await route('prices');
    await page.locator('[name="productId"]').selectOption(product.id); await page.locator('[name="supplierId"]').selectOption(supplier.id);
    const sales = mode === 'SUPPLIER_TERM' ? '10' : '13';
    await page.locator('[name="salesPrice"]').fill(sales); await page.locator('[name="supplyPrice"]').fill('10');
    await page.locator('[name="effectiveAt"]').fill('2000-01-02T00:00'); await page.locator('[name="reason"]').fill('已付冻结与未完成单联合验收');
    await page.locator('#ws-price-preview').click(); await page.getByText('影响预览', { exact: true }).waitFor(); await capture('journey-historical-price-preview-mobile');
    await page.locator('[type="submit"]').click(); await page.getByText('价格版本', { exact: true }).waitFor();
    await page.locator('#ws-process-price').click(); await page.waitForFunction(() => document.getElementById('ws-price-job')?.textContent.includes('已完成'));
    assert.deepEqual(await historical(), paidHistory);
    const repriced = await db.supplierOrder.findUniqueOrThrow({ where: { id: unfinished.id } });
    assert.equal(repriced.salesGoodsAmount.toFixed(2), `${Number(sales) * 2}.00`); assert.equal(repriced.supplyGoodsAmount.toFixed(2), '20.00');
    assert.equal(repriced.status, 'PUSHED');
    const fresh = await createNext('journey-fresh-after-price-mobile'); assert.equal(fresh.salesGoodsAmount.toFixed(2), `${Number(sales) * 2}.00`);
    assert.deepEqual(await historical(), paidHistory);
    await page.setViewportSize({ width: 1440, height: 1000 }); await route('store'); await search(request.requestNo); await capture('journey-paid-history-desktop');
    repricing = { status: 'PASSED', paidSnapshots: paidHistory.snapshots.length, unfinishedOrderId: unfinished.id, freshRequestId: fresh.id, paidHistory: 'UNCHANGED', newSalesAmount: fresh.salesGoodsAmount.toFixed(2), businessWrites: 'FORMAL_UI_ONLY' };
    step(`${mode}: historical price changes unfinished/new order, actual confirmed-payment snapshots and paid/cleared source remain unchanged`);
    await switchRole(admin);
  }
  return { status: 'PASSED', requestId: request.id, orderId: order.id, shipmentId: shipment.id, receiptId: receipt.id,
    paymentIds, mode, repricing, businessWrites: 'FORMAL_UI_ONLY',
    readonlyLookups: 'GET statements and database assertions', setup: 'Existing isolated master data and scoped accounts',
    proofBasis: 'Synthetic local images, not genuine funds, OSS or device evidence' };
}
