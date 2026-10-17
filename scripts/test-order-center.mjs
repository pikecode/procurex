import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function center(request, apiOverrides = {}, wxOverrides = {}) {
  let definition, user = { id: 'store-user' };
  const view = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/store-view.js', 'utf8'), { module: view });
  vm.runInNewContext(readFileSync('apps/miniprogram/components/order-center/index.js', 'utf8'), {
    Component: value => { definition = value; },
    wx: wxOverrides,
    require: path => path.includes('store-view') ? view.exports : { request, currentUser: () => user, imagePath: async () => '/image.png', ...apiOverrides }
  });
  const instance = { ...definition.methods, data: { ...definition.data, active: true, mode: 'store', canReceive: true }, events: [],
    setData(value) { for (const [key, item] of Object.entries(value)) { if (key === 'selected.items') this.data.selected.items = item; else this.data[key] = item; } },
    triggerEvent(name, value) { this.events.push({ name, value }); }, switchUser() { user = { id: 'another-user' }; } };
  return { instance, definition };
}
const tap = id => ({ currentTarget: { dataset: { id } } });
const row = (n, extra = {}) => ({ id: `order${n}`, supplierOrderNo: `SO${n}`, requestNo: 'PR1', requestId: 'r1', supplierName: '供应商1', storeName: '门店1', status: 'PUSHED', fulfillmentStatus: 'PENDING', ...extra });

test('store status picker expands and selects a visible tab without changing filters on collapse', async () => {
  const { instance } = center(async () => [row(1, { status: 'CANCELED' }), row(2)]);
  await instance.load(); instance.toggleStatusExpanded();
  assert.equal(instance.data.statusExpanded, true);
  instance.chooseFilter({ currentTarget: { dataset: { filter: 'closed' } } });
  assert.equal(instance.data.statusExpanded, false);
  assert.equal(instance.data.statusScrollTarget, 'store-status-closed');
  assert.deepEqual(Array.from(instance.data.visible, item => item.id), ['order1']);
  instance.toggleStatusExpanded(); instance.toggleStatusExpanded();
  assert.equal(instance.data.filter, 'closed');
  instance.switchUser(); await instance.load();
  assert.equal(instance.data.statusScrollTarget, 'store-status-all');
  assert.equal(instance.data.statusExpanded, false);
});

test('order detail displays quantity and non-quantity receipt exceptions without flagging normal notes', async () => {
  const detail = { ...row(1), items: [], shipments: [
    { id: 'normal', receiptNote: '正常签收', currentReceiptRevision: 1 },
    { id: 'short', receiptHasException: true, receiptNote: '少收1件', receiptExceptionStatus: null, receiptDifferences: [{ productName: '商品1', shippedQuantity: '3', receivedQuantity: '2', missingQuantity: '1' }] },
    { id: 'quality', receiptExceptionStatus: 'SUBMITTED', receiptNote: '包装破损', receiptEvidenceFiles: [{ id: 'proof' }] },
  ] };
  const { instance } = center(async path => path === '/supplier-orders' ? [detail] : detail);
  await instance.load(); await instance.open(tap('order1'));
  assert.deepEqual(Array.from(instance.data.selected.receiptExceptions, item => item.id), ['short', 'quality']);
  assert.equal(instance.data.selected.receiptExceptions[0].receiptExceptionLabel, '数量差异已登记');
  assert.equal(instance.data.selected.receiptExceptions[1].receiptExceptionLabel, '待供应商处理');
  assert.equal(instance.data.selected.receiptExceptions[1].receiptEvidenceFiles[0].id, 'proof');
  assert.equal(instance.data.detailTab, 'exceptions');
  instance.chooseDetailTab({ currentTarget: { dataset: { tab: 'shipments' } } });
  assert.equal(instance.data.detailTab, 'shipments');
  instance.chooseDetailTab({ currentTarget: { dataset: { tab: 'invalid' } } });
  assert.equal(instance.data.detailTab, 'shipments');
  instance.toggleOrderInfo(); assert.equal(instance.data.orderInfoOpen, true);
  instance.showReceiptExceptions(tap('quality')); assert.equal(instance.data.detailTab, 'exceptions');
});

test('order details prioritize pending receipts and keep completed orders on products', async () => {
  const detail = { ...row(1), items: [], pendingReceiptCount: 1, shipments: [{ id: 'batch' }] };
  const { instance } = center(async path => path === '/supplier-orders' ? [detail] : detail);
  await instance.load(); await instance.open(tap('order1'));
  assert.equal(instance.data.detailTab, 'shipments');
  detail.status = 'COMPLETED'; detail.pendingReceiptCount = 0;
  detail.shipments[0] = { id: 'batch', receiptHasException: true, receiptExceptionStatus: 'RESOLVED' };
  await instance.open(tap('order1'));
  assert.equal(instance.data.detailTab, 'products');
});

test('registered receipt exception blocks completion and submits a separate supplier task', async () => {
  let state = 'REGISTERED'; const commands = [];
  const detail = () => ({ ...row(1), version: 7, deliveryState: 'FINISHED', pendingReceiptCount: 0, openReceiptExceptionCount: 1,
    items: [{ id: 'product', quantity: '10', receivedQuantity: '10' }],
    shipments: [{ id: 'batch', receiptId: 'receipt', receiptExceptionStatus: state, receiptNote: '包装破损', currentReceiptRevision: 1 }] });
  const { instance } = center(async path => path === '/supplier-orders' ? [detail()] : detail(), {
    roleCommand: async (...args) => { commands.push(args); state = 'SUBMITTED'; }, roleCommandState: () => ({ pending: null }),
  }, { showModal: options => options.success({ confirm: true, content: '请安排核查并处理' }) });
  await instance.load(); await instance.open(tap('order1'));
  assert.equal(instance.data.selected.stage, 'exception');
  assert.equal(instance.data.selected.canFinalize, false);
  await instance.finalize(tap('order1')); assert.equal(commands.length, 0);
  await instance.receiptExceptionAction({ currentTarget: { dataset: { receiptId: 'receipt', action: 'submit-receipt-exception' } } });
  assert.equal(commands[0][1], '/supplier-orders/order1/submit-receipt-exception');
  assert.equal(commands[0][2].data.receiptId, 'receipt');
  assert.equal(instance.data.selected.shipments[0].receiptExceptionStatus, 'SUBMITTED');
  await instance.receiptExceptionAction({ currentTarget: { dataset: { receiptId: 'receipt', action: 'confirm-receipt-exception' } } });
  assert.equal(commands.length, 1);
  instance.data.canReceive = false;
  await instance.receiptExceptionAction({ currentTarget: { dataset: { receiptId: 'receipt', action: 'submit-receipt-exception' } } });
  assert.equal(commands.length, 1);
});

test('store waits for all batches and uses explicit final confirmation with a durable command', async () => {
  const calls = []; let received = false, agreed = false;
  const detail = () => ({ ...row(1), version: 4, deliveryState: 'FINISHED', shortageAgreementRequired: !agreed, items: [{ id: 'i', quantity: '10', receivedQuantity: '8' }], shipments: [{ id: 'batch', currentReceiptRevision: received ? 1 : 0 }] });
  const { instance } = center(async path => path === '/supplier-orders' ? [detail()] : detail(), {
    roleCommand: async (...args) => calls.push(args), roleCommandState: () => ({ pending: null }),
  }, { showModal: options => options.success({ confirm: true }) });
  await instance.load(); await instance.open(tap('order1'));
  assert.equal(instance.data.selected.canFinalize, false);
  assert.equal(instance.data.objectionOpen, false);
  await instance.finalize(tap('order1')); assert.equal(calls.length, 0);
  received = true; await instance.open(tap('order1'));
  assert.equal(instance.data.objectionItems[0].objectionQuantity, '2');
  assert.equal(instance.data.objectionOpen, true);
  await instance.finalize(tap('order1')); assert.equal(calls.length, 0);
  agreed = true; await instance.open(tap('order1'));
  await instance.finalize(tap('order1'));
  assert.equal(calls[0][0], 'store'); assert.equal(calls[0][1], '/supplier-orders/order1/confirm-receipt');
  assert.equal(calls[0][2].data.expectedVersion, 4);
});

test('store objection requires reason and selected items, finances cannot submit', async () => {
  const calls = [];
  const { instance } = center(async () => [], { roleCommand: async (...args) => calls.push(args) }, { showModal: options => options.success({ confirm: true }) });
  instance.data.selected = { ...row(1), version: 2, canFinalize: false, canRaiseObjection: true };
  instance.data.objectionItems = [{ id: 'i', checked: true, objectionQuantity: '2' }];
  const event = { currentTarget: { dataset: { action: 'raise-objection' } } };
  await instance.finalize(event); assert.equal(calls.length, 0); assert.match(instance.data.deliveryError, /原因/);
  instance.data.objectionReason = '缺少2件';
  instance.data.canReceive = false; await instance.finalize(event); assert.equal(calls.length, 0);
  instance.data.canReceive = true; await instance.finalize(event); assert.equal(calls.length, 1);
  assert.equal(calls[0][1], '/supplier-orders/order1/raise-objection');
  assert.equal(calls[0][2].data.items[0].quantity, '2');
});

test('store cannot resolve a replenishment case before receiving it or bypass supplier reply', async () => {
  let commands = 0;
  const { instance } = center(async () => [], { roleCommand: async () => { commands++; } }, { showModal: options => options.success({ confirm: true, content: '核对处理结果' }) });
  instance.open = async () => {}; instance.load = async () => {};
  const batch = { receiptId: 'receipt', receiptExceptionStatus: 'SUBMITTED', receiptExceptionDecision: '', canConfirmReceiptException: false };
  instance.data.selected = { id: 'o', version: 1, shipments: [batch] };
  const event = { currentTarget: { dataset: { receiptId: 'receipt', action: 'confirm-receipt-exception' } } };
  await instance.receiptExceptionAction(event); assert.equal(commands, 0);
  batch.receiptExceptionStatus = 'RESPONDED'; batch.receiptExceptionDecision = 'REPLENISH';
  await instance.receiptExceptionAction(event); assert.equal(commands, 0);
  const submitting = { currentTarget: { dataset: { receiptId: 'receipt', action: 'submit-receipt-exception' } } };
  await instance.receiptExceptionAction(submitting); assert.equal(commands, 0);
  batch.canConfirmReceiptException = true;
  await instance.receiptExceptionAction(event); assert.equal(commands, 1);
});

test('store must explicitly accept supplier refusal or may continue the whole-order objection', async () => {
  let prompt, writes = 0;
  const detail = { ...row(1), deliveryState: 'DECLINED', pendingReceiptCount: 0, openReceiptExceptionCount: 0,
    shortageAgreementRequired: false, unagreedShortageItems: [],
    items: [{ id: 'i', quantity: '10', receivedQuantity: '8' }], shipments: [{ id: 'b', currentReceiptRevision: 1 }] };
  const { instance } = center(async () => detail, { roleCommand: async () => { writes++; } }, {
    showModal: options => { prompt = options.content; options.success({ confirm: false }); }
  });
  await instance.open(tap('order1'));
  assert.equal(instance.data.selected.canFinalize, true);
  assert.equal(instance.data.selected.canRaiseObjection, true);
  assert.equal(instance.data.objectionOpen, false);
  assert.equal(instance.data.objectionItems[0].objectionQuantity, '2');
  await instance.finalize(tap('order1'));
  assert.match(prompt, /确认即接受剩余数量不再补发/); assert.equal(writes, 0);
});

test('formal pagination counts orders, does not group same-source or same-supplier orders', async () => {
  const { instance } = center(async () => Array.from({ length: 12 }, (_, n) => row(n)));
  await instance.load(); assert.equal(instance.data.visible.length, 10); assert.equal(instance.data.total, 12);
  instance.more(); assert.equal(instance.data.visible.length, 12); assert.equal(instance.data.more, false);
  instance.onSearch({ detail: { value: 'PR1' } }); assert.equal(instance.data.total, 12);
  instance.onSearch({ detail: { value: 'SO11' } }); assert.equal(instance.data.total, 1);
});

test('inactive order observers emit a detail-close event only when a detail was actually open', () => {
  const { instance, definition } = center(async () => []);
  const observe = definition.observers['active, revision'];
  observe.call(instance, false);
  assert.equal(instance.events.length, 0);
  instance.data.selectedId = 'order1';
  observe.call(instance, false);
  observe.call(instance, false);
  assert.equal(instance.events.length, 1);
  assert.equal(instance.events[0].name, 'detailchange');
  assert.equal(instance.events[0].value.open, false);
});

test('store order tabs retain exception labels alongside receipt tasks and classify legacy partial shipments', async () => {
  const { instance } = center(async () => [
    row(1, { deliveryState: 'FINISHED', pendingReceiptCount: 1, openReceiptExceptionCount: 1, pendingSupplierReceiptExceptionCount: 1 }),
    row(2, { deliveryState: 'FINISHED', pendingReceiptCount: 0, openReceiptExceptionCount: 1, pendingSupplierReceiptExceptionCount: 0 }),
    row(3, { deliveryState: 'REPLENISHING', pendingReceiptCount: 0 }),
    row(4, { deliveryState: 'DECLINED', pendingReceiptCount: 0 }),
    row(5, { status: 'PARTIAL_SHIPPED', pendingReceiptCount: 0 }),
    row(6, { status: 'PARTIAL_SHIPPED', pendingReceiptCount: 1 }),
    row(7, { status: 'COMPLETED', openReceiptExceptionCount: 1, pendingSupplierReceiptExceptionCount: 1 }),
    row(8, { status: 'CANCELED', pendingReceiptCount: 1 })
  ]);
  await instance.load();
  const byId = Object.fromEntries(instance.data.orders.map(item => [item.id, item]));
  assert.equal(byId.order1.stage, 'receiving'); assert.equal(byId.order1.exceptionLabel, '待供应商处理');
  assert.equal(byId.order2.stage, 'exception'); assert.equal(byId.order2.displayStatus, '待门店确认异常');
  assert.equal(byId.order3.displayStatus, '待供应商补发');
  assert.equal(byId.order4.displayStatus, '补发被拒 · 待门店确认');
  assert.equal(byId.order5.stage, 'shipping'); assert.equal(byId.order6.stage, 'receiving');
  assert.equal(byId.order7.stage, 'completed'); assert.equal(byId.order7.exceptionLabel, '');
  assert.equal(byId.order8.stage, 'closed');
  assert.equal(instance.data.tabs.find(tab => tab.value === 'confirm').label, '待整单确认');
  assert.equal(instance.data.tabs.slice(1).reduce((sum, tab) => sum + tab.count, 0), 8);
});

test('store order tabs match live batch progress and list labels rather than mixing receipt and completion', async () => {
  const rows = [
    row(1, { deliveryState: 'FINISHED', status: 'SHIPPED', pendingReceiptCount: 1 }),
    row(2, { deliveryState: 'FINISHED', status: 'SHIPPED', pendingReceiptCount: 0 }),
    row(3, { deliveryState: 'DISPUTED', status: 'SHIPPED', pendingReceiptCount: 0 }),
    row(4, { deliveryState: 'IN_PROGRESS', status: 'PARTIAL_SHIPPED', pendingReceiptCount: 0 }),
    row(5), row(6, { status: 'SHIPPED', fulfillmentStatus: 'COMPLETED' }),
    row(7, { status: 'REJECTED' }), row(8, { status: 'PARTIAL_SHIPPED', receiptExceptionCount: 1, pendingReceiptCount: 0 }),
  ];
  const { instance } = center(async () => rows);
  await instance.load();
  for (const [filter, expected] of Object.entries({ receiving: ['order1'], confirm: ['order2'], exception: ['order3', 'order8'], shipping: ['order4'], pending: ['order5'], completed: ['order6'], closed: ['order7'] })) {
    instance.chooseFilter({ currentTarget: { dataset: { filter } } });
    assert.deepEqual(Array.from(instance.data.visible, item => item.id), expected);
    assert.equal(instance.data.tabs.find(tab => tab.value === filter).count, expected.length);
  }
  assert.equal(instance.data.orders.find(item => item.id === 'order6').displayStatus, '已完成');
  assert.equal(instance.data.orders.find(item => item.id === 'order2').displayStatus, '待整单确认');
  instance.onSearch({ detail: { value: 'SO2' } });
  assert.equal(instance.data.tabs.find(tab => tab.value === 'all').count, 1);
  assert.equal(instance.data.tabs.find(tab => tab.value === 'confirm').count, 1);
});

test('store orders keep actionable old orders first and completed recent orders first', async () => {
  const { instance } = center(async () => [
    row(1, { status: 'COMPLETED', createdAt: '2026-10-01T00:00:00Z' }),
    row(2, { status: 'SHIPPED', pendingReceiptCount: 1, createdAt: '2026-10-10T00:00:00Z' }),
    row(3, { status: 'SHIPPED', pendingReceiptCount: 1, createdAt: '2026-10-02T00:00:00Z' }),
    row(4, { status: 'COMPLETED', createdAt: '2026-10-11T00:00:00Z' }),
  ]);
  await instance.load();
  assert.deepEqual(Array.from(instance.data.visible, item => item.id), ['order3', 'order2', 'order4', 'order1']);
});
test('order detail uses own item list and emits exact source and shipment ids', async () => {
  const { instance } = center(async () => ({ ...row(1), items: [{ id: 'line1', productName: '商品1' }], shipments: [{ id: 'shipment1' }] }));
  await instance.open(tap('order1')); assert.equal(instance.data.selected.items.length, 1);
  instance.source(); instance.receipt(tap('shipment1'));
  assert.equal(instance.events.find(event => event.name === 'source').value.id, 'r1');
  const receipt = instance.events.filter(event => event.name === 'receipt');
  assert.equal(receipt[0].value.id, 'shipment1'); assert.equal(receipt[0].value.orderId, 'order1');
  instance.data.canReceive = false; instance.receipt(tap('shipment1'));
  assert.equal(instance.events.filter(event => event.name === 'receipt').length, 1);
});
test('stale list and detail reads cannot restore another identity or closed view', async () => {
  let finish;
  const { instance, definition } = center(() => new Promise(resolve => { finish = resolve; }));
  const list = instance.load(); instance.switchUser(); finish([row(1)]); await list;
  assert.equal(instance.data.orders.length, 0);
  const detail = instance.open(tap('order1')); instance.close(); finish({ ...row(1), items: [], shipments: [] }); await detail;
  assert.equal(instance.data.selected, null);
  const hidden = instance.open(tap('order1')); definition.lifetimes.detached.call(instance); finish({ ...row(1), items: [], shipments: [] }); await hidden;
  assert.equal(instance.data.selected, null);
});
test('closed and completed filters do not mix lifecycle stages and failed reads remain errors', async () => {
  let fail = false;
  const { instance } = center(async () => { if (fail) throw new Error('读取失败'); return [row(1), row(2, { status: 'SHIPPED' }), row(3, { status: 'COMPLETED' }), row(4, { status: 'REJECTED' })]; });
  await instance.load(); instance.chooseFilter({ currentTarget: { dataset: { filter: 'receiving' } } }); assert.equal(instance.data.visible[0].id, 'order2');
  instance.chooseFilter({ currentTarget: { dataset: { filter: 'closed' } } }); assert.equal(instance.data.visible[0].id, 'order4');
  fail = true; await instance.load(); assert.equal(instance.data.error, '读取失败'); assert.equal(instance.data.visible.length, 0);
});

test('date filters use Shanghai creation date, reject reversed dates and reset order pagination', async () => {
  const { instance } = center(async () => [row(1, { createdAt: '2026-10-13T17:00:00Z' }), row(2, { createdAt: '2026-10-13T12:00:00Z' })]);
  await instance.load();
  instance.chooseDate({ currentTarget: { dataset: { field: 'from' } }, detail: { value: '2026-10-14' } });
  assert.equal(instance.data.visible.length, 1); assert.equal(instance.data.visible[0].id, 'order1');
  instance.chooseDate({ currentTarget: { dataset: { field: 'to' } }, detail: { value: '2026-10-13' } });
  assert.equal(instance.data.to, ''); assert.ok(instance.data.dateError);
  instance.clearDates(); assert.equal(instance.data.total, 2);
});

test('formal rejection entry remains read-only unless purchasing-manager permission is supplied', () => {
  const { instance } = center(async () => []);
  instance.data.mode = 'purchaser'; instance.data.selected = row(1);
  instance.reallocate(); assert.equal(instance.events.length, 0);
  instance.data.canReallocate = true; instance.reallocate();
  assert.equal(instance.events[0].name, 'reallocate'); assert.equal(instance.events[0].value.supplierOrderId, 'order1');
});
