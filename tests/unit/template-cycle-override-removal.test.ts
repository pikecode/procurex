import assert from 'node:assert/strict';
import test from 'node:test';
import { droppedCycleOverrides } from '../../apps/admin/src/lib/templateCycleOverrides.js';

test('dropping a supplier from every enabled item marks its store cycles for removal', () => {
  const overrides = [
    { storeId: 'store-1', supplierId: 'supplier-a', settlementCycle: 'MONTHLY' },
    { storeId: 'store-2', supplierId: 'supplier-a', settlementCycle: 'WEEKLY' },
    { storeId: 'store-1', supplierId: 'supplier-b', settlementCycle: 'IMMEDIATE' },
  ];
  const items = [{ productId: 'p1', sortOrder: 0, isEnabled: true, minOrderQty: null, orderMultiple: null, suppliers: [{ supplierId: 'supplier-b', priority: 0 }] }];
  assert.deepEqual(droppedCycleOverrides(overrides, items).map(row => row.storeId), ['store-1', 'store-2']);
  assert.deepEqual(droppedCycleOverrides(overrides, items).map(row => row.settlementCycle), ['MONTHLY', 'WEEKLY']);
});

test('a supplier kept on any enabled item keeps its cycles', () => {
  const overrides = [{ storeId: 'store-1', supplierId: 'supplier-a', settlementCycle: 'MONTHLY' }];
  const items = [
    { productId: 'p1', sortOrder: 0, isEnabled: true, minOrderQty: null, orderMultiple: null, suppliers: [{ supplierId: 'supplier-a', priority: 0 }] },
    { productId: 'p2', sortOrder: 1, isEnabled: false, minOrderQty: null, orderMultiple: null, suppliers: [{ supplierId: 'supplier-c', priority: 0 }] },
  ];
  assert.deepEqual(droppedCycleOverrides(overrides, items), []);
});

test('a disabled item does not protect its supplier cycles', () => {
  const overrides = [{ storeId: 'store-1', supplierId: 'supplier-c', settlementCycle: 'HALF_MONTHLY' }];
  const items = [{ productId: 'p2', sortOrder: 0, isEnabled: false, minOrderQty: null, orderMultiple: null, suppliers: [{ supplierId: 'supplier-c', priority: 0 }] }];
  assert.equal(droppedCycleOverrides(overrides, items).length, 1);
});

test('no overrides means nothing to confirm', () => {
  assert.deepEqual(droppedCycleOverrides([], [{ isEnabled: true, suppliers: [{ supplierId: 'supplier-a' }] }]), []);
});