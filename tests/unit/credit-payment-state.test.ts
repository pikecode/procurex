import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { loadFundingPaymentStates } from '../../apps/api/src/purchase-requests/request-funding.js';

for (const method of ['OFFLINE_RETURN', 'OFFSET']) {
  for (const status of ['PENDING', 'CONFIRMED']) {
    test(`${method} ${status} affects effective credit payment only after confirmation`, async () => {
      const tx = { adjustmentDocument: { findMany: async () => [{ supplierOrderId: 'order', amount: new Decimal(-20),
        disposalItems: [{ amount: new Decimal(20), disposal: { status, method } }] }] } };
      const states = await loadFundingPaymentStates(tx as never, [{ id: 'funding', method: 'CREDIT', netPaid: new Decimal(120), supplierOrderId: 'order' }] as never);
      const state = states.get('funding')!;
      assert.equal(state.effectivePaid.toFixed(2), status === 'CONFIRMED' ? '100.00' : '120.00');
      assert.equal(state.pendingCredit.toFixed(2), status === 'CONFIRMED' ? '0.00' : '20.00');
    });
  }
}

test('unassigned credit is pending rather than a completed refund', async () => {
  const tx = { adjustmentDocument: { findMany: async () => [{ supplierOrderId: 'order', amount: new Decimal(-20), disposalItems: [] }] } };
  const state = (await loadFundingPaymentStates(tx as never, [{ id: 'funding', method: 'CREDIT', netPaid: new Decimal(120), supplierOrderId: 'order' }] as never)).get('funding')!;
  assert.deepEqual([state.effectivePaid.toFixed(2), state.pendingCredit.toFixed(2)], ['120.00', '20.00']);
});

test('partial confirmation deducts only confirmed source credits and isolates other orders', async () => {
  const tx = { adjustmentDocument: { findMany: async () => [
    { supplierOrderId: 'order', amount: new Decimal(-10), disposalItems: [{ amount: new Decimal(10), disposal: { status: 'CONFIRMED' } }] },
    { supplierOrderId: 'order', amount: new Decimal(-10), disposalItems: [] },
    { supplierOrderId: 'other', amount: new Decimal(-30), disposalItems: [{ amount: new Decimal(30), disposal: { status: 'CONFIRMED' } }] },
  ] } };
  const states = await loadFundingPaymentStates(tx as never, [
    { id: 'funding', method: 'CREDIT', netPaid: new Decimal(120), supplierOrderId: 'order' },
    { id: 'other', method: 'CREDIT', netPaid: new Decimal(50), supplierOrderId: 'other' },
  ] as never);
  assert.deepEqual([states.get('funding')!.effectivePaid.toFixed(2), states.get('funding')!.pendingCredit.toFixed(2)], ['110.00', '10.00']);
  assert.equal(states.get('other')!.effectivePaid.toFixed(2), '20.00');
});

test('confirmed credit returns exceeding gross paid require reconciliation', async () => {
  const tx = { adjustmentDocument: { findMany: async () => [{ supplierOrderId: 'order', amount: new Decimal(-130),
    disposalItems: [{ amount: new Decimal(130), disposal: { status: 'CONFIRMED' } }] }] } };
  await assert.rejects(loadFundingPaymentStates(tx as never, [{ id: 'funding', method: 'CREDIT', netPaid: new Decimal(120), supplierOrderId: 'order' }] as never),
    (error: any) => error.getResponse?.().code === 'FUNDING_ALLOCATION_RECONCILIATION_REQUIRED');
});

test('stored-value funding does not deduct its already-booked cash refund twice', async () => {
  const tx = { adjustmentDocument: { findMany: async () => { throw new Error('Unexpected credit query'); } } };
  const state = (await loadFundingPaymentStates(tx as never, [{ id: 'funding', method: 'STORED_VALUE', netPaid: new Decimal(100), supplierOrderId: 'order' }] as never)).get('funding')!;
  assert.deepEqual([state.effectivePaid.toFixed(2), state.pendingCredit.toFixed(2)], ['100.00', '0.00']);
});
