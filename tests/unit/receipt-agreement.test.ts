import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { unagreedShortages } from '../../apps/api/src/supplier-orders/receipt-agreement.js';

const item = () => ({ id: 'item', quantity: new Decimal(10), shippedQuantity: new Decimal(10), receivedQuantity: new Decimal(9), shipmentItems: [], discrepancies: [] });
const batches = (status: string, decision: string) => [{ items: [{ id: 'line', orderItemId: 'item', quantity: '10' }],
  receipts: [{ exceptionStatus: status, exceptionDecision: decision, items: [{ shipmentItemId: 'line', receivedQuantity: '9' }] }] }];

test('only supplier shortage agreement accepted by the store permits reduced completion', () => {
  for (const [status, decision] of [['SUBMITTED', ''], ['RESPONDED', 'ACCEPT_SHORTAGE'], ['RESOLVED', 'HANDLED'], ['RESOLVED', 'REPLENISH']]) {
    assert.equal(unagreedShortages([item()], batches(status!, decision!)).length, 1);
  }
  for (const decision of ['ACCEPT_SHORTAGE', 'DECLINED']) assert.equal(unagreedShortages([item()], batches('RESOLVED', decision)).length, 0);
});

test('shortage approval belongs to the receipt product and is bounded by its recorded difference', () => {
  const other = { ...item(), id: 'other', receivedQuantity: new Decimal(8) };
  assert.deepEqual(unagreedShortages([item(), other], batches('RESOLVED', 'ACCEPT_SHORTAGE')), [{ orderItemId: 'other', quantity: '2' }]);
  assert.deepEqual(unagreedShortages([{ ...item(), receivedQuantity: new Decimal(7) }], batches('RESOLVED', 'ACCEPT_SHORTAGE')), [{ orderItemId: 'item', quantity: '2' }]);
});

test('legacy whole-order refusal needs an actual supplier response before it authorizes shortage', () => {
  const review = { items: [{ orderItemId: 'item', quantity: '1' }] };
  assert.equal(unagreedShortages([item()], [], 'DECLINED', review).length, 1);
  assert.equal(unagreedShortages([item()], [], 'DECLINED', { ...review, respondedAt: '2026-10-17T00:00:00Z' }).length, 0);
  assert.equal(unagreedShortages([item()], [], 'FINISHED', { ...review, respondedAt: '2026-10-17T00:00:00Z' }).length, 1);
});
