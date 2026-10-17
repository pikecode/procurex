import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { SupplierOrdersService } from '../../apps/api/src/supplier-orders/supplier-orders.service.js';
import { ShipmentsService } from '../../apps/api/src/shipments/shipments.service.js';
import { transitionDelivery, type DeliveryAction, type DeliveryInput } from '../../apps/api/src/supplier-orders/delivery-workflow.js';
import { lockFundingRequest, synchronizeRequestFunding } from '../../apps/api/src/purchase-requests/request-funding.js';

type Mode = 'STORED_VALUE' | 'CREDIT' | 'COMPANY_TERM' | 'SUPPLIER_TERM';
const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
async function fixture(mode: Mode, run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const code = `BD${randomUUID().slice(0, 8)}`;
  try { await run(await setup(db, code, mode)); }
  finally {
    const ids = (await db.store.findMany({ where: { code }, select: { id: true } })).map(row => row.id);
    const own = { storeId: { in: ids } };
    await db.userScope.deleteMany({ where: { user: { username: code } } });
    await db.fileObject.deleteMany({ where: { owner: { username: code } } });
    await db.adjustmentDocument.deleteMany({ where: { storeId: { in: ids } } });
    await db.fundingAllocation.deleteMany({ where: own });
    await db.accountLedger.deleteMany({ where: { account: own } });
    await db.shipmentGapAllocation.deleteMany({ where: { shipmentItem: { shipment: { supplierOrder: own } } } });
    await db.replenishmentGap.deleteMany({ where: { orderItem: { supplierOrder: own } } });
    await db.discrepancyReturn.deleteMany({ where: { orderItem: { supplierOrder: own } } });
    await db.discrepancy.deleteMany({ where: { orderItem: { supplierOrder: own } } });
    await db.receiptExceptionReply.deleteMany({ where: { receipt: { shipment: { supplierOrder: own } } } });
    await db.receipt.deleteMany({ where: { shipment: { supplierOrder: own } } });
    await db.shipmentRevisionItem.deleteMany({ where: { shipmentItem: { shipment: { supplierOrder: own } } } });
    await db.shipmentRevision.deleteMany({ where: { shipment: { supplierOrder: own } } });
    await db.shipmentItem.deleteMany({ where: { shipment: { supplierOrder: own } } });
    await db.shipment.deleteMany({ where: { supplierOrder: own } });
    await db.supplierOrder.deleteMany({ where: own });
    await db.purchaseRequest.deleteMany({ where: own });
    await db.priceScope.deleteMany({ where: { supplier: { code } } });
    await db.orderTemplate.deleteMany({ where: { code } });
    await db.product.deleteMany({ where: { category: { code } } });
    await db.supplier.deleteMany({ where: { code } });
    await db.storeAccount.deleteMany({ where: own });
    await db.store.deleteMany({ where: { code } });
    await db.category.deleteMany({ where: { code } });
    await db.unit.deleteMany({ where: { code } });
    await db.user.deleteMany({ where: { username: code } });
    await db.$disconnect();
  }
}

async function setup(db: PrismaClient, code: string, mode: Mode) {
  const actor = await db.user.create({ data: { username: code, displayName: code } });
  const proof = async (purpose = 'SHIPMENT_ADJUSTMENT') => db.fileObject.create({ data: { filename: 'shipment.jpg', mimeType: 'image/jpeg', sizeBytes: 1, objectKey: randomUUID(), uploadTokenHash: 'fixture', purpose, status: 'READY', ownerId: actor.id } });
  const store = await db.store.create({ data: { code, name: code } });
  const supplier = await db.supplier.create({ data: { code, name: code, deliveryMode: 'SELF', defaultSettlementMode: mode, defaultSettlementCycle: 'MONTHLY' } });
  const category = await db.category.create({ data: { code, name: code } });
  const unit = await db.unit.create({ data: { code, name: code } });
  const template = await db.orderTemplate.create({ data: { code, name: code } });
  const products = [];
  for (let i = 0; i < 2; i++) {
    const product = await db.product.create({ data: { sku: `${code}${i}`, name: `${code}${i}`, categoryId: category.id, baseUnitId: unit.id } });
    products.push(product);
    const scope = await db.priceScope.create({ data: { productId: product.id, supplierId: supplier.id } });
    await db.priceVersion.create({ data: { scopeId: scope.id, salesPrice: '10', supplyPrice: '8', effectiveAt: new Date('2000-01-01') } });
  }
  await db.storeAccount.create({ data: { storeId: store.id, balance: '1000', creditLimit: '1000' } });
  const lines = products.map(product => ({ productId: product.id, quantity: '10', salesUnitPrice: '10', supplyUnitPrice: '8', salesLineAmount: '100', supplyLineAmount: '80' }));
  const request = await db.purchaseRequest.create({ data: { requestNo: code, storeId: store.id, templateId: template.id, status: 'CONFIRMED', storedValueOnReceipt: true,
    salesGoodsAmount: '200', supplyGoodsAmount: '160', items: { create: lines.map(line => ({ ...line, supplierId: supplier.id })) } } });
  const order = await db.supplierOrder.create({ data: { supplierOrderNo: code, requestId: request.id, storeId: store.id, supplierId: supplier.id, settlementMode: mode,
    status: 'PUSHED', salesGoodsAmount: '200', supplyGoodsAmount: '160', items: { create: lines } }, include: { items: true } });
  await db.$transaction(async tx => { await lockFundingRequest(tx, store.id, request.id); await synchronizeRequestFunding(tx, request.id, { initial: true, sourceId: request.id }); });
  const shipping = new SupplierOrdersService({ client: db } as never);
  const receiving = new ShipmentsService({ client: db } as never);
  const current = () => db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
  const act = async (action: DeliveryAction, input: Omit<DeliveryInput, 'expectedVersion'> = {}) => {
    const row = await current();
    return db.$transaction(tx => transitionDelivery(tx, order.id, action, { expectedVersion: row.version, ...input }, undefined, actor.id));
  };
  const ship = async (indices: number[], amount = '10', completeDelivery = true, note?: string) => {
    const row = await current();
    return shipping.createShipment(order.id, row.version, { completeDelivery, freight: '0', note, ...(note ? { evidenceFileIds: [(await proof()).id] } : {}),
      items: indices.map(index => ({ orderItemId: order.items[index]!.id, shipQuantity: amount, permanentlyReduceQuantity: '0' })) }, undefined, undefined, actor.id);
  };
  const receive = async (batch: Awaited<ReturnType<typeof ship>>, amount = '10') => receiving.createReceipt(batch.id, {
    note: '到货核对',
    ...(batch.items.some(item => Number(amount) < Number(item.quantity)) ? { hasException: true, evidenceFileIds: [(await proof('RECEIPT')).id] } : {}),
    expectedOrderVersion: (await current()).version, expectedReceiptRevision: 0,
    items: batch.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: amount })),
  }, undefined, actor.id);
  return { db, store, supplier, order, request, shipping, receiving, current, act, ship, receive, proof, actor };
}

test('quality receipt stores an exception at full quantity and exposes its remark and evidence to supplier', () => fixture('COMPANY_TERM', async f => {
  const role = await f.db.role.findUniqueOrThrow({ where: { code: 'SUPPLIER' } });
  await f.db.userRole.create({ data: { userId: f.actor.id, roleId: role.id } });
  await f.db.userScope.create({ data: { userId: f.actor.id, scopeType: 'SUPPLIER', supplierId: f.supplier.id } });
  const batch = await f.ship([0, 1]);
  const proof = await f.proof('RECEIPT');
  const input = { expectedOrderVersion: (await f.current()).version, expectedReceiptRevision: 0, hasException: true,
    items: batch.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: '10' })), evidenceFileIds: [proof.id] };
  await assert.rejects(f.receiving.createReceipt(batch.id, input, undefined, f.actor.id), /异常收货备注/);
  await assert.rejects(f.receiving.createReceipt(batch.id, { ...input, note: '包装破损', evidenceFileIds: [] }, undefined, f.actor.id), /上传收货凭证/);
  const receipt = await f.receiving.createReceipt(batch.id, { ...input, note: '数量齐全，包装破损' }, undefined, f.actor.id);
  assert.equal(receipt.hasException, true);
  assert.equal(receipt.exceptionStatus, 'SUBMITTED');
  const notices = await f.db.notification.findMany({ where: { recipientId: f.actor.id, eventKey: `RECEIPT_DISCREPANCY:${receipt.id}` } });
  assert.equal(notices.length, 1);
  assert.equal((notices[0]!.payload as { supplierOrderId: string }).supplierOrderId, f.order.id);
  assert.equal((await f.shipping.list({ supplierId: f.supplier.id }))[0]!.pendingSupplierReceiptExceptionCount, 1);
  assert.ok(receipt.items.every(item => item.receivedQuantity === '10'));
  const detail = await f.receiving.get(batch.id);
  assert.equal(detail.receiptHasException, true);
  assert.equal(detail.receiptNote, '数量齐全，包装破损');
  const order = await f.shipping.get(f.order.id, { type: 'SUPPLIER', supplierId: f.supplier.id });
  assert.equal(order.shipments[0]!.receiptHasException, true);
  assert.equal(order.shipments[0]!.receiptEvidenceFiles?.[0]?.id, proof.id);
  assert.equal((await f.current()).salesGoodsAmount.toFixed(2), '200.00');
  await assert.rejects(f.act('confirm-receipt'), /未解决的收货异常/);
  const submit = { receiptId: receipt.id, reason: '请核实包装破损并说明处理措施' };
  const staleVersion = (await f.current()).version;
  await assert.rejects(f.act('submit-receipt-exception', { ...submit, receiptId: randomUUID() }), /没有这条/);
  await assert.rejects(f.db.$transaction(tx => transitionDelivery(tx, f.order.id, 'submit-receipt-exception', { expectedVersion: staleVersion, ...submit }, { type: 'STORE', storeId: randomUUID() })), /无权访问/);
  const replyProof = await f.proof('RECEIPT_EXCEPTION_REPLY');
  const invalidProof = await f.proof('RECEIPT');
  await assert.rejects(f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'HANDLED', reason: '图片过多', evidenceFileIds: Array.from({ length: 7 }, () => randomUUID()) }), /最多上传6张/);
  await f.db.fileObject.update({ where: { id: replyProof.id }, data: { status: 'UPLOADING' } });
  await assert.rejects(f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'HANDLED', reason: '上传未完成', evidenceFileIds: [replyProof.id] }), /未上传完成/);
  const otherOwner = await f.db.user.findFirstOrThrow({ where: { id: { not: f.actor.id } }, select: { id: true } });
  await f.db.fileObject.update({ where: { id: replyProof.id }, data: { status: 'READY', ownerId: otherOwner.id } });
  try { await assert.rejects(f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'HANDLED', reason: '他人图片', evidenceFileIds: [replyProof.id] }), /不属于当前账号/); }
  finally { await f.db.fileObject.update({ where: { id: replyProof.id }, data: { ownerId: f.actor.id } }); }
  await assert.rejects(f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'HANDLED', reason: '错误用途凭证', evidenceFileIds: [invalidProof.id] }), /处理凭证无效/);
  assert.equal(await f.db.receiptExceptionReply.count({ where: { receiptId: receipt.id } }), 0);
  await assert.rejects(f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'HANDLED', reason: '重复凭证', evidenceFileIds: [replyProof.id, replyProof.id] }), /不同的处理凭证/);
  await f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'DECLINED', reason: '暂时无法处理', evidenceFileIds: [replyProof.id] });
  await f.act('submit-receipt-exception', submit);
  const replyHistory = (await f.shipping.get(f.order.id)).shipments[0]!.receiptExceptionReplies!;
  assert.equal(replyHistory.length, 1);
  assert.equal(replyHistory[0]!.evidenceFiles[0]!.id, replyProof.id);
  await assert.rejects(f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'HANDLED', reason: '重复使用图片', evidenceFileIds: [replyProof.id] }), /已使用/);
  await assert.rejects(f.db.$transaction(tx => transitionDelivery(tx, f.order.id, 'submit-receipt-exception', { expectedVersion: staleVersion, ...submit })), /订单已变化/);
  assert.equal((await f.shipping.list({ supplierId: f.supplier.id }))[0]!.pendingSupplierReceiptExceptionCount, 1);
  await assert.rejects(f.act('submit-receipt-exception', submit), /不能重复提交/);
  await assert.rejects(f.act('confirm-receipt-exception', { receiptId: receipt.id, reason: '解决' }), /等待供应商回复/);
  await assert.rejects(f.receiving.createReceipt(batch.id, { ...input, expectedOrderVersion: (await f.current()).version, expectedReceiptRevision: 1, note: '覆盖异常' }, undefined, f.actor.id), /异常已提交/);
  await assert.rejects(f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'HANDLED' }), /填写处理说明/);
  await f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'DECLINED', reason: '暂不能安排现场处理' });
  await assert.rejects(f.act('confirm-receipt'), /未解决的收货异常/);
  await f.act('submit-receipt-exception', { receiptId: receipt.id, reason: '请提供后续处理方案' });
  await f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'HANDLED', reason: '已现场核查并更换包装，商品可正常使用' });
  await f.act('confirm-receipt-exception', { receiptId: receipt.id, reason: '已核查，认可处理结果' });
  const history = (await f.shipping.get(f.order.id)).shipments[0]!.receiptExceptionReplies!;
  assert.equal(history.length, 3);
  assert.equal(history[0]!.evidenceFiles[0]!.id, replyProof.id);
  assert.equal(history[2]!.note, '已现场核查并更换包装，商品可正常使用');
  assert.equal((await f.shipping.list({ storeId: f.store.id }))[0]!.openReceiptExceptionCount, 0);
  await f.act('confirm-receipt');
  assert.equal((await f.current()).status, 'COMPLETED');
  assert.equal((await f.current()).salesGoodsAmount.toFixed(2), '200.00');
}));

test('ending a short delivery requires both remark and owned evidence', () => fixture('COMPANY_TERM', async f => {
  await f.ship([0], '8', false);
  await assert.rejects(f.act('finish-delivery', { reason: '库存不足' }), /填写备注并上传发货凭证/);
  const proof = await f.proof();
  await assert.rejects(f.act('finish-delivery', { evidenceFileIds: [proof.id] }), /说明不再发货/);
  await f.act('finish-delivery', { reason: '库存不足', evidenceFileIds: [proof.id] });
  assert.equal((await f.current()).deliveryState, 'FINISHED');
  assert.ok((await f.db.fileObject.findUniqueOrThrow({ where: { id: proof.id } })).shipmentRevisionId);
}));

test('normal batches remain normal and require supplier finish and store final confirmation', () => fixture('COMPANY_TERM', async f => {
  const first = await f.ship([0], '10', false);
  assert.equal(first.kind, 'INITIAL');
  const ownPending = await f.receiving.pendingReceipts({ type: 'STORE', storeId: f.store.id });
  assert.equal(ownPending.length, 1);
  assert.equal(ownPending[0]!.id, first.id);
  assert.equal((await f.receiving.pendingReceipts({ type: 'STORE', storeId: randomUUID() })).length, 0);
  assert.equal((await f.shipping.list({ storeId: f.store.id }))[0]!.pendingReceiptCount, 1);
  assert.equal((await f.current()).deliveryState, 'IN_PROGRESS');
  await f.receive(first);
  assert.equal((await f.receiving.pendingReceipts({ type: 'STORE', storeId: f.store.id })).length, 0);
  assert.equal((await f.shipping.list({ storeId: f.store.id }))[0]!.pendingReceiptCount, 0);
  await assert.rejects(f.act('confirm-receipt'), /供应商尚未结束发货/);
  const second = await f.ship([1]);
  assert.equal(second.kind, 'INITIAL');
  await assert.rejects(f.act('confirm-receipt'), /请先核对所有发货批次/);
  await f.receive(second);
  assert.equal((await f.current()).status, 'SHIPPED');
  await f.act('confirm-receipt');
  assert.equal((await f.current()).status, 'COMPLETED');
  await assert.rejects(f.act('confirm-receipt'), /当前订单不能/);
}));

for (const mode of ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM'] as Mode[]) {
  test(`${mode}: store accepts reduced deliveries at actual quantity without double charging`, () => fixture(mode, async f => {
    await assert.rejects(f.ship([0, 1], '8'), /填写备注并上传发货凭证/);
    const batch = await f.ship([0, 1], '8', true, '库存不足，余量不发');
    const receipt = await f.receive(batch, '8');
    assert.equal(receipt.note, '到货核对');
    assert.equal((await f.current()).salesGoodsAmount.toFixed(2), '200.00');
    if (mode === 'STORED_VALUE') assert.equal((await f.db.storeAccount.findUniqueOrThrow({ where: { storeId: f.store.id } })).balance.toFixed(2), '1000.00');
    await assert.rejects(f.act('confirm-receipt'), /未经双方确认的少收/);
    await f.act('raise-objection', { reason: '核对未供数量', items: f.order.items.map(item => ({ orderItemId: item.id, quantity: '2' })) });
    await f.act('respond-objection', { response: 'DECLINE', reason: '确认余量不再供货，请门店按实收确认' });
    await f.act('confirm-receipt');
    const completed = await f.current();
    assert.equal(completed.salesGoodsAmount.toFixed(2), '160.00');
    assert.equal(completed.supplyGoodsAmount.toFixed(2), '128.00');
    const lines = await f.db.orderItem.findMany({ where: { supplierOrderId: completed.id } });
    assert.ok(lines.every(line => line.quantity.toString() === '10' && line.receivedQuantity.toString() === '8' && line.closedQuantity.toString() === '2'));
    const account = await f.db.storeAccount.findUniqueOrThrow({ where: { storeId: f.store.id } });
    if (mode === 'STORED_VALUE') assert.equal(account.balance.toFixed(2), '840.00');
    if (mode === 'CREDIT') assert.equal(account.creditUsed.toFixed(2), '160.00');
    await assert.rejects(f.ship([0], '1'), /发货已结束|不能/);
  }));
}

test('short receipt automatically submits an exception and replenishment requires final store agreement', () => fixture('STORED_VALUE', async f => {
  const batch = await f.ship([0, 1]);
  const receipt = await f.receive(batch, '8');
  const detail = await f.shipping.get(f.order.id);
  assert.equal(detail.shipments[0]!.receiptHasException, true);
  assert.equal(detail.shipments[0]!.receiptDifferences?.length, 2);
  assert.equal(detail.shipments[0]!.receiptDifferences?.[0]?.missingQuantity, '2');
  assert.equal(receipt.exceptionStatus, 'SUBMITTED');
  await assert.rejects(f.act('raise-objection', { reason: '重复提交', items: f.order.items.map(item => ({ orderItemId: item.id, quantity: '2' })) }), /无需重复提交/);
  await assert.rejects(f.act('confirm-receipt'), /未解决的收货异常/);
  await f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'REPLENISH', reason: '每种补发2件' });
  await assert.rejects(f.act('confirm-receipt-exception', { receiptId: receipt.id, reason: '尚未收到不能解决' }), /补发尚未收齐/);
  const gaps = await f.db.replenishmentGap.findMany({ where: { orderItem: { supplierOrderId: f.order.id } } });
  assert.equal(gaps.length, 2);
  const row = await f.current();
  const replacement = await f.shipping.createShipment(f.order.id, row.version, { completeDelivery: true, freight: '0',
    items: gaps.map(gap => ({ orderItemId: gap.orderItemId, shipQuantity: '2', permanentlyReduceQuantity: '0', gapAllocations: [{ gapId: gap.id, quantity: '2' }] })) });
  assert.equal(replacement.kind, 'REPLENISHMENT');
  await f.receive(replacement, '2');
  await assert.rejects(f.act('confirm-receipt'), /未解决的收货异常/);
  await f.act('confirm-receipt-exception', { receiptId: receipt.id, reason: '补发已收齐，问题已解决' });
  await f.act('confirm-receipt');
  assert.equal((await f.current()).salesGoodsAmount.toFixed(2), '200.00');
  assert.equal((await f.db.storeAccount.findUniqueOrThrow({ where: { storeId: f.store.id } })).balance.toFixed(2), '800.00');
}));

test('supplier decline requires reason and only store final acceptance closes the order', () => fixture('COMPANY_TERM', async f => {
  const batch = await f.ship([0, 1], '8', true, '少发');
  await f.receive(batch, '8');
  await f.act('raise-objection', { reason: '请补齐', items: f.order.items.map(item => ({ orderItemId: item.id, quantity: '2' })) });
  await assert.rejects(f.act('respond-objection', { response: 'DECLINE' }), /拒绝补发原因/);
  await f.act('respond-objection', { response: 'DECLINE', reason: '已无库存' });
  assert.equal((await f.current()).deliveryState, 'DECLINED');
  assert.notEqual((await f.current()).status, 'COMPLETED');
  const row = await f.current();
  await assert.rejects(f.db.$transaction(tx => transitionDelivery(tx, f.order.id, 'confirm-receipt', { expectedVersion: row.version }, { type: 'STORE', storeId: randomUUID() })), /无权访问/);
  await f.act('confirm-receipt');
  assert.equal((await f.current()).salesGoodsAmount.toFixed(2), '160.00');
}));

for (const mode of ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM'] as Mode[]) {
  test(`${mode}: shortage needs supplier agreement and store acceptance before money changes`, () => fixture(mode, async f => {
    const batch = await f.ship([0, 1]);
    const receipt = await f.receive(batch, '9');
    assert.equal(receipt.exceptionStatus, 'SUBMITTED');
    const detail = await f.shipping.get(f.order.id);
    assert.equal(detail.shortageAgreementRequired, true);
    assert.equal(detail.shipments[0]!.canRevise, false);
    assert.equal(detail.pendingSupplierReceiptExceptionCount, 1);
    await assert.rejects(f.act('confirm-receipt'), /未解决的收货异常/);
    await assert.rejects(f.act('confirm-receipt-exception', { receiptId: receipt.id, reason: '自行结单' }), /等待供应商回复/);
    await assert.rejects(f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'HANDLED', reason: '不能模糊处理数量异常' }), /请选择安排补发/);
    await assert.rejects(f.receiving.createReceipt(batch.id, { expectedOrderVersion: (await f.current()).version, expectedReceiptRevision: 1,
      items: batch.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: '10' })) }), /收货记录已锁定/);
    assert.equal((await f.current()).salesGoodsAmount.toFixed(2), '200.00');
    await f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'ACCEPT_SHORTAGE', reason: '确认每种少收1件，不再补发' });
    await assert.rejects(f.act('confirm-receipt'), /未解决的收货异常/);
    await f.act('confirm-receipt-exception', { receiptId: receipt.id, reason: '接受不再补发，按每种9件结算' });
    assert.equal((await f.current()).salesGoodsAmount.toFixed(2), '200.00');
    if (mode === 'STORED_VALUE') assert.equal((await f.db.storeAccount.findUniqueOrThrow({ where: { storeId: f.store.id } })).balance.toFixed(2), '1000.00');
    assert.equal((await f.shipping.get(f.order.id)).shortageAgreementRequired, false);
    await f.act('confirm-receipt');
    assert.equal((await f.current()).salesGoodsAmount.toFixed(2), '180.00');
    const account = await f.db.storeAccount.findUniqueOrThrow({ where: { storeId: f.store.id } });
    if (mode === 'STORED_VALUE') assert.equal(account.balance.toFixed(2), '820.00');
    if (mode === 'CREDIT') assert.equal(account.creditUsed.toFixed(2), '180.00');
  }));
}

test('partial batch shortage is handled without treating unshipped products as missing', () => fixture('COMPANY_TERM', async f => {
  const first = await f.ship([0], '10', false);
  const receipt = await f.receive(first, '9');
  await f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'REPLENISH', reason: '补发商品一1件，商品二正常后续发货' });
  const gaps = await f.db.replenishmentGap.findMany({ where: { orderItem: { supplierOrderId: f.order.id } } });
  assert.equal(gaps.length, 1); assert.equal(gaps[0]!.quantity.toString(), '1');
  assert.equal(gaps[0]!.orderItemId, f.order.items[0]!.id);
  const second = await f.ship([1], '10', false); await f.receive(second);
  const extra = await f.shipping.createShipment(f.order.id, (await f.current()).version, { completeDelivery: true, freight: '0',
    items: [{ orderItemId: f.order.items[0]!.id, shipQuantity: '1', permanentlyReduceQuantity: '0', gapAllocations: [{ gapId: gaps[0]!.id, quantity: '1' }] }] });
  await f.receive(extra, '1');
  await f.act('confirm-receipt-exception', { receiptId: receipt.id, reason: '补发已收到' });
  await f.act('confirm-receipt'); assert.equal((await f.current()).salesGoodsAmount.toFixed(2), '200.00');
}));

test('a short replenishment is a new exception and accepted shortage unblocks the original case', () => fixture('STORED_VALUE', async f => {
  const first = await f.ship([0, 1]); const original = await f.receive(first, '8');
  await f.act('respond-receipt-exception', { receiptId: original.id, decision: 'REPLENISH', reason: '每种补发2件' });
  const gaps = await f.db.replenishmentGap.findMany({ where: { orderItem: { supplierOrderId: f.order.id } } });
  const extra = await f.shipping.createShipment(f.order.id, (await f.current()).version, { completeDelivery: true, freight: '0',
    items: gaps.map(gap => ({ orderItemId: gap.orderItemId, shipQuantity: '2', permanentlyReduceQuantity: '0', gapAllocations: [{ gapId: gap.id, quantity: '2' }] })) });
  const repeated = await f.receive(extra, '1'); assert.equal(repeated.exceptionStatus, 'SUBMITTED');
  await assert.rejects(f.act('confirm-receipt-exception', { receiptId: original.id, reason: '仍少收' }), /补发尚未收齐/);
  await f.act('respond-receipt-exception', { receiptId: repeated.id, decision: 'ACCEPT_SHORTAGE', reason: '确认补发仍每种少1件，不再补发' });
  await f.act('confirm-receipt-exception', { receiptId: repeated.id, reason: '接受每种最终9件' });
  await f.act('confirm-receipt-exception', { receiptId: original.id, reason: '补发及再次少收已协商确认' });
  await f.act('confirm-receipt'); assert.equal((await f.current()).salesGoodsAmount.toFixed(2), '180.00');
}));

test('supplier may withdraw remaining replenishment and store may reject that proposal without duplicate gaps', () => fixture('COMPANY_TERM', async f => {
  const first = await f.ship([0, 1]); const receipt = await f.receive(first, '8');
  await f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'REPLENISH', reason: '安排补齐' });
  await f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'ACCEPT_SHORTAGE', reason: '暂时缺货，申请不再补发' });
  assert.equal(await f.db.replenishmentGap.count({ where: { orderItem: { supplierOrderId: f.order.id }, status: 'PENDING' } }), 0);
  await f.act('submit-receipt-exception', { receiptId: receipt.id, reason: '不接受，请继续补发' });
  await f.act('respond-receipt-exception', { receiptId: receipt.id, decision: 'REPLENISH', reason: '已找到货源，重新安排' });
  const gaps = await f.db.replenishmentGap.findMany({ where: { orderItem: { supplierOrderId: f.order.id } } });
  assert.equal(gaps.length, 2); assert.ok(gaps.every(gap => gap.remainingQuantity.toString() === '2'));
  assert.equal(await f.db.receiptExceptionReply.count({ where: { receiptId: receipt.id } }), 3);
  await assert.rejects(f.act('confirm-receipt'), /未解决的收货异常/);
}));

test('unflagged short receipts cannot bypass mandatory remark and evidence', () => fixture('CREDIT', async f => {
  const batch = await f.ship([0, 1]); const before = await f.current();
  const input = { expectedOrderVersion: before.version, expectedReceiptRevision: 0, items: batch.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: '9' })) };
  await assert.rejects(f.receiving.createReceipt(batch.id, input), /异常收货备注/);
  await assert.rejects(f.receiving.createReceipt(batch.id, { ...input, note: '少收' }), /上传收货凭证/);
  assert.equal(await f.db.receipt.count({ where: { shipmentId: batch.id } }), 0);
  assert.equal((await f.current()).version, before.version);
}));

test('supplier cannot use permanent quantity reduction to bypass bilateral completion', () => fixture('COMPANY_TERM', async f => {
  const input = { completeDelivery: true, freight: '0', items: f.order.items.map(item => ({ orderItemId: item.id, shipQuantity: '8', permanentlyReduceQuantity: '2' })) };
  await assert.rejects(f.shipping.shipmentPreview(f.order.id, (await f.current()).version, input), /不能直接核减订单数量/);
  await assert.rejects(f.shipping.createShipment(f.order.id, (await f.current()).version, input), /不能直接核减订单数量/);
  assert.equal(await f.db.shipment.count({ where: { supplierOrderId: f.order.id } }), 0);
  assert.equal((await f.current()).salesGoodsAmount.toFixed(2), '200.00');
}));
