import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function center(request) {
  let definition, user = { id: 'store-user' };
  const view = { exports: {} };
  vm.runInNewContext(readFileSync('apps/miniprogram/utils/store-view.js', 'utf8'), { module: view });
  vm.runInNewContext(readFileSync('apps/miniprogram/components/order-center/index.js', 'utf8'), {
    Component: value => { definition = value; },
    wx: {},
    require: path => path.includes('store-view') ? view.exports : { request, currentUser: () => user, imagePath: async () => '/image.png' }
  });
  const instance = { ...definition.methods, data: { ...definition.data, active: true, mode: 'store', canReceive: true }, events: [],
    setData(value) { for (const [key, item] of Object.entries(value)) { if (key === 'selected.items') this.data.selected.items = item; else this.data[key] = item; } },
    triggerEvent(name, value) { this.events.push({ name, value }); }, switchUser() { user = { id: 'another-user' }; } };
  return { instance, definition };
}
const tap = id => ({ currentTarget: { dataset: { id } } });
const row = (n, extra = {}) => ({ id: `order${n}`, supplierOrderNo: `SO${n}`, requestNo: 'PR1', requestId: 'r1', supplierName: '供应商1', storeName: '门店1', status: 'PUSHED', fulfillmentStatus: 'PENDING', ...extra });

test('formal pagination counts orders, does not group same-source or same-supplier orders', async () => {
  const { instance } = center(async () => Array.from({ length: 12 }, (_, n) => row(n)));
  await instance.load(); assert.equal(instance.data.visible.length, 10); assert.equal(instance.data.total, 12);
  instance.more(); assert.equal(instance.data.visible.length, 12); assert.equal(instance.data.more, false);
  instance.onSearch({ detail: { value: 'PR1' } }); assert.equal(instance.data.total, 12);
  instance.onSearch({ detail: { value: 'SO11' } }); assert.equal(instance.data.total, 1);
});
test('order detail uses own item list and emits exact source and shipment ids', async () => {
  const { instance } = center(async () => ({ ...row(1), items: [{ id: 'line1', productName: '商品1' }], shipments: [{ id: 'shipment1' }] }));
  await instance.open(tap('order1')); assert.equal(instance.data.selected.items.length, 1);
  instance.source(); instance.receipt(tap('shipment1'));
  assert.equal(instance.events[0].value.id, 'r1'); assert.equal(instance.events[1].value.id, 'shipment1');
  instance.data.canReceive = false; instance.receipt(tap('shipment1')); assert.equal(instance.events.length, 2);
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
