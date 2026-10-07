import assert from 'node:assert/strict';
import test from 'node:test';
import { requestProgress } from '../../apps/api/src/purchase-requests/request-progress.js';

test('repeat rejection exposes only the most recent order for the same supplier product', () => {
  const request = { status: 'PARTIAL_PUSHED', items: [{ productId: 'product', supplierId: 'supplier' }], supplierOrders: [
    { id: 'old', createdAt: new Date('2026-09-01T00:00:00Z'), status: 'REJECTED', supplierId: 'supplier', items: [{ productId: 'product' }] },
    { id: 'new', createdAt: new Date('2026-09-02T00:00:00Z'), status: 'REJECTED', supplierId: 'supplier', items: [{ productId: 'product' }] },
  ] };
  assert.equal(requestProgress(request).supplierCount, 1);
  assert.equal(requestProgress(request).rejectedSupplierCount, 1);
});

test('fulfilled reallocation ignores historical rejection but preserves active rejection', () => {
  const request = { status: 'CONFIRMED', items: [{ productId: 'product', supplierId: 'backup' }], supplierOrders: [
    { status: 'REJECTED', supplierId: 'original', items: [{ productId: 'product' }] },
    { status: 'COMPLETED', supplierId: 'backup', items: [{ productId: 'product' }] },
  ] };
  assert.deepEqual(requestProgress(request), { supplierCount: 1, completedSupplierCount: 1, canceledSupplierCount: 0, rejectedSupplierCount: 0, fulfillmentStage: 'completed' });
  assert.equal(requestProgress({ ...request, items: [{ productId: 'product', supplierId: 'original' }] }).fulfillmentStage, 'pending');
});

test('empty canceled reassignment is not a waiting shipment', () => {
  const request = { status: 'CONFIRMED', items: [], supplierOrders: [{ status: 'REJECTED', supplierId: 'supplier', items: [{ productId: 'product' }] }] };
  assert.equal(requestProgress(request).fulfillmentStage, 'canceled');
  assert.equal(requestProgress({ status: 'PENDING_FUNDS', items: [{ productId: 'product', supplierId: 'supplier' }], supplierOrders: [] }).fulfillmentStage, 'pending');
  assert.equal(requestProgress({ ...request, items: [{ productId: 'product', supplierId: 'supplier' }], supplierOrders: [{ ...request.supplierOrders[0]!, status: 'CANCELED' }] }).fulfillmentStage, 'canceled');
  assert.equal(requestProgress({ status: 'COMPLETED', items: [], supplierOrders: [] }).fulfillmentStage, 'completed');
});

test('retry with the same supplier does not reopen its superseded rejection', () => {
  const request = { status: 'CONFIRMED', items: [{ productId: 'product', supplierId: 'supplier' }], supplierOrders: [
    { status: 'REJECTED', supplierId: 'supplier', items: [{ productId: 'product' }] },
    { status: 'COMPLETED', supplierId: 'supplier', items: [{ productId: 'product' }] },
  ] };
  assert.equal(requestProgress(request).fulfillmentStage, 'completed');
  assert.equal(requestProgress(request).supplierCount, 1);
});
