import assert from 'node:assert/strict';
import test from 'node:test';
import { recordCreditMovement } from '../../apps/api/src/stores/credit-movements.js';

for (const [before, after, clearing, kind] of [['0', '300', false, 'BOOKING'], ['300', '200', false, 'RELEASE'], ['300', '0', true, 'CLEARING'], ['300', '300', false, null]] as const) {
  test(`credit occurrence ${kind ?? 'unchanged'}: only positive booking adds to cumulative`, async () => {
    const movements: any[] = [], totals: any[] = [];
    const tx = { creditMovement: { create: async (value: unknown) => movements.push(value) }, storeAccount: { update: async (value: unknown) => totals.push(value) } };
    await recordCreditMovement(tx as never, { accountId: 'account', fundingAllocationId: 'allocation', before, after, clearing, sourceType: clearing ? 'CLEARING' : 'PURCHASE_REQUEST', sourceId: 'source' });
    assert.equal(movements.length, kind ? 1 : 0); assert.equal(totals.length, kind === 'BOOKING' ? 1 : 0);
    if (kind) { assert.equal(movements[0].data.kind, kind); assert.equal(movements[0].data.outstandingAfter, `${after}.00`); }
    if (kind === 'BOOKING') assert.deepEqual(totals[0].data, { creditCumulative: { increment: '300.00' } });
  });
}
