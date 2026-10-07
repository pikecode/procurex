import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { resolveSupplierOrderFulfillmentStatus } from '../../apps/api/src/supplier-orders/fulfillment-status.js';
import { isReceiptItemLocked } from '../../apps/api/src/shipments/shipments.service.js';

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
  assert.equal(isReceiptItemLocked([{ discrepancy: { status: 'RESOLVED' } }]), true);
  assert.equal(isReceiptItemLocked([{ discrepancy: { status: 'REPLENISH_PENDING' } }]), true);
  assert.equal(isReceiptItemLocked([{ discrepancy: { status: 'SUPERSEDED', returnRecord: {} } }]), false);
});
