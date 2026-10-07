import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

export async function captureFinanceDirect({ page, db, api, token, prefix, store, product, storeFinance, admin, createUser, login, route, search, save, capture, step }) {
  const call = async (path, body, method = 'POST') => {
    const response = await fetch(`${api}${path}`, { method: body ? method : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json(); assert.ok(response.ok, `${path}: ${result.code}`); return result.data;
  };
  const supplier = await call('/suppliers', { code: `${prefix}DIRECT`, name: `${prefix}直结供应商`, deliveryMode: 'SELF', defaultSettlementMode: 'SUPPLIER_TERM', defaultSettlementCycle: 'MONTHLY',
    contactName: '隔离联系人', contactPhone: '13900000000', address: '隔离验收地址', bankName: '验收银行', bankAccountName: '隔离直结供应商', bankAccount: 'TEST-DIRECT-ONLY', taxpayerId: 'TEST-TAX-ONLY', invoiceTitle: '隔离直结供应商' });
  await call(`/suppliers/${supplier.id}/products`, { expectedVersion: supplier.version, productIds: [product.id] }, 'PUT');
  await call('/price-changes', { productId: product.id, supplierId: supplier.id, salesPrice: '8.00', supplyPrice: '8.00', effectiveAt: '2026-10-01T00:00:00Z', reason: '隔离直结等价' });
  const binding = await db.storeTemplateBinding.findFirstOrThrow({ where: { storeId: store.id, expiredAt: null } });
  const old = await call(`/templates/${binding.templateId}`);
  await call(`/templates/${old.id}/stores`, { expectedVersion: old.version, storeIds: [] }, 'PUT');
  let template = await call('/templates', { code: `${prefix}DIRECT`, name: '隔离直结模板', tag: '直结验收' });
  await call(`/templates/${template.id}/items`, { expectedVersion: template.version, items: [{ productId: product.id, minOrderQty: '2', orderMultiple: '2', suppliers: [{ supplierId: supplier.id, priority: 1 }] }] }, 'PUT');
  template = await call(`/templates/${template.id}`);
  await call(`/templates/${template.id}/stores`, { expectedVersion: template.version, storeIds: [store.id] }, 'PUT');
  const request = await call('/purchase-requests', { storeId: store.id, items: [{ productId: product.id, quantity: '2' }] });
  await call(`/purchase-requests/${request.id}/confirm`, { expectedVersion: request.version });
  const order = await db.supplierOrder.findFirstOrThrow({ where: { requestId: request.id }, include: { items: true } });
  assert.equal(order.settlementMode, 'SUPPLIER_TERM'); assert.equal(order.salesGoodsAmount.toFixed(2), '16.00'); assert.equal(order.supplyGoodsAmount.toFixed(2), '16.00');
  const sent = await call(`/supplier-orders/${order.id}/shipments`, { expectedVersion: order.version, items: [{ orderItemId: order.items[0].id, shipQuantity: '2', permanentlyReduceQuantity: '0' }], freight: '0.00' });
  const detail = await call(`/shipments/${sent.id}`);
  const image = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#368b79' } }).png().toBuffer();
  const proof = await call('/files/upload-sessions', { purpose: 'RECEIPT', filename: 'direct-receipt.png', mimeType: 'image/png', sizeBytes: image.length });
  const upload = await fetch(`${api}/files/${proof.id}/content`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-upload-token': proof.uploadToken }, body: image }); assert.ok(upload.ok);
  await call(`/files/${proof.id}/complete`, {});
  await call(`/shipments/${sent.id}/receipts`, { expectedOrderVersion: detail.supplierOrderVersion, expectedReceiptRevision: 0,
    items: [{ shipmentItemId: detail.items[0].id, receivedQuantity: '2' }], evidenceFileIds: [proof.id] });
  const bills = await call('/direct-statements'); const bill = bills.find(item => item.storeId === store.id && item.supplierId === supplier.id); assert.ok(bill);
  const direct = await call(`/direct-statements/${bill.id}`); const line = direct.lines.find(item => item.supplierOrderId === order.id); assert.ok(line);
  for (const path of ['/store-statements', '/supplier-statements', '/supplier-store-statements']) {
    const company = (await call(path)).filter(item => item.supplierId === supplier.id); assert.equal(company.length, 0);
  }
  await page.locator('#ws-logout').click(); await login(storeFinance); await route('finance');
  await page.locator('[name="billMode"]').selectOption('direct'); await search(''); await page.locator(`[data-bill="${bill.id}"]`).click();
  await page.locator(`[data-settlement="${line.settlementItemId}"]`).check(); await page.locator('[data-register-payment]').click();
  await page.locator('.ws-dialog [name="paymentFile"]').setInputFiles({ name: 'direct-payment.png', mimeType: 'image/png', buffer: image });
  await page.getByText('direct-payment.png · 已上传').waitFor(); await page.setViewportSize({ width: 390, height: 844 }); await capture('finance-direct-payment-preview-mobile'); await save();
  const payment = await db.paymentRecord.findFirstOrThrow({ where: { allocations: { some: { supplierOrderId: order.id } } } }); assert.equal(payment.direction, 'STORE_TO_SUPPLIER');
  const supplierUser = await createUser('SUPPLIER', 'DIRECT');
  await db.userScope.create({ data: { userId: supplierUser.id, scopeType: 'SUPPLIER', supplierId: supplier.id } });
  await page.locator('#ws-logout').click(); await login(supplierUser); await route('finance');
  await page.locator(`[data-finance-payment="${payment.id}"]`).click();
  await page.locator('.ws-dialog [type="submit"]').waitFor();
  await capture('finance-direct-payment-confirm-mobile'); await save();
  assert.equal((await db.paymentRecord.findUniqueOrThrow({ where: { id: payment.id } })).status, 'CONFIRMED');
  assert.equal((await db.paymentAllocation.findFirstOrThrow({ where: { paymentId: payment.id } })).state, 'CONFIRMED');
  assert.equal((await call(`/direct-statements/${bill.id}`)).payableAmount, '0.00');
  assert.equal(await db.accountLedger.count({ where: { account: { storeId: store.id } } }), 0);
  step('real equal-price supplier-term order appears only in Direct statements; scoped StoreFinance registers proof and scoped Supplier confirms STORE_TO_SUPPLIER once, payable zero, no account money');
  await page.locator('#ws-logout').click(); await login(admin);
  return { status: 'PASSED', supplierId: supplier.id, orderId: order.id, direction: 'STORE_TO_SUPPLIER', amount: '16.00', payable: '0.00', companyStatements: 'EXCLUDED', precursorSetup: 'Real API isolated supplier/template/equal price/binding/fulfillment and synthetic proof, not actual banking/full mode acceptance' };
}
