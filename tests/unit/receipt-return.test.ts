import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { resolveSupplierOrderFulfillmentStatus, effectiveOrderItemQuantity } from '../../apps/api/src/supplier-orders/fulfillment-status.js';
import { isReceiptItemLocked } from '../../apps/api/src/shipments/shipments.service.js';
import { pendingReceiptKind } from '../../apps/api/src/shipments/receipt-progress.js';

test('pending receipt batches depend on live receipts, returned decisions and order locks', () => {
  const order = { status: 'SHIPPED', fulfillmentStatus: 'SHIPPED', deliveryState: 'FINISHED', deliveryReview: null as unknown };
  const batch = { shippedAt: new Date('2026-10-17T00:00:00Z'), receipts: [] as Array<{ items: Array<{ discrepancy: { status: string; returnRecord?: unknown } | null }> }> };
  assert.equal(pendingReceiptKind(order, batch), 'PENDING');
  batch.receipts = [{ items: [{ discrepancy: null }] }];
  assert.equal(pendingReceiptKind(order, batch), null);
  batch.receipts = [{ items: [{ discrepancy: { status: 'OPEN' } }] }];
  assert.equal(pendingReceiptKind(order, batch), null);
  batch.receipts[0]!.items[0]!.discrepancy = { status: 'RESOLVED', returnRecord: { id: 'return' } };
  assert.equal(pendingReceiptKind(order, batch), 'RETURNED');
  for (const deliveryState of ['DISPUTED', 'DECLINED', 'COMPLETED']) assert.equal(pendingReceiptKind({ ...order, deliveryState }, batch), null);
  assert.equal(pendingReceiptKind({ ...order, deliveryReview: { requestedAt: '2026-10-17T01:00:00Z' } }, batch), null);
  assert.equal(pendingReceiptKind({ ...order, status: 'COMPLETED' }, { ...batch, receipts: [] }), null);
});

test('explicit delivery lifecycle cannot complete from a single full receipt', () => {
  const item = { quantity: new Decimal(10), shippedQuantity: new Decimal(10), receivedQuantity: new Decimal(10), shipmentItems: [], discrepancies: [] };
  assert.equal(resolveSupplierOrderFulfillmentStatus([item], 'IN_PROGRESS'), 'PARTIAL_SHIPPED');
  for (const state of ['FINISHED', 'DISPUTED', 'DECLINED']) assert.equal(resolveSupplierOrderFulfillmentStatus([item], state), 'SHIPPED');
  assert.equal(resolveSupplierOrderFulfillmentStatus([item], 'REPLENISHING'), 'PARTIAL_SHIPPED');
  assert.equal(resolveSupplierOrderFulfillmentStatus([item], 'COMPLETED'), 'COMPLETED');
  assert.equal(effectiveOrderItemQuantity({ ...item, closedQuantity: '2' }).toString(), '8');
});

test('returned receipt blocks completion and cannot reduce the accepted fulfillment target', () => {
  const item = { quantity: new Decimal(3), shippedQuantity: new Decimal(3), receivedQuantity: new Decimal(2), shipmentItems: [],
    discrepancies: [{ missingQuantity: new Decimal(1), status: 'RESOLVED' as const, returnRecord: { id: 'return' } }] };
  assert.equal(resolveSupplierOrderFulfillmentStatus([item]), 'PARTIAL_SHIPPED');
  assert.equal(resolveSupplierOrderFulfillmentStatus([{ ...item, discrepancies: [{ ...item.discrepancies[0]!, returnRecord: undefined }] }]), 'COMPLETED');
  assert.equal(resolveSupplierOrderFulfillmentStatus([{ ...item, receivedQuantity: new Decimal(3), discrepancies: [{ ...item.discrepancies[0]!, status: 'SUPERSEDED' }] }]), 'COMPLETED');
});

test('receipt revisions unlock returned/open items but keep accepted and replenishment rows fixed', () => {
  assert.equal(isReceiptItemLocked([{ discrepancy: { status: 'RESOLVED', returnRecord: { id: 'return' } } }]), false);
  assert.equal(isReceiptItemLocked([{ discrepancy: { status: 'OPEN' } }]), false);
  assert.equal(isReceiptItemLocked([]), false);
  assert.equal(isReceiptItemLocked([{ discrepancy: null }]), true);
  assert.equal(isReceiptItemLocked([{ discrepancy: { status: 'SUPERSEDED', returnRecord: {} } }, { discrepancy: null }]), true);
  assert.equal(isReceiptItemLocked([{ discrepancy: { status: 'RESOLVED' } }]), true);
  assert.equal(isReceiptItemLocked([{ discrepancy: { status: 'REPLENISH_PENDING' } }]), true);
  assert.equal(isReceiptItemLocked([{ discrepancy: { status: 'SUPERSEDED', returnRecord: {} } }]), false);
});
