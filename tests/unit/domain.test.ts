import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateStoredValueFunding } from '../../packages/domain/src/funding.js';
import { canonicalJson, requestHash } from '../../packages/domain/src/idempotency.js';
import { lineAmount, spreadProfit } from '../../packages/domain/src/money.js';
import { settlementPeriod } from '../../packages/domain/src/settlement-period.js';

test('line amount rounds per line and profit excludes freight', () => {
  assert.equal(lineAmount('10', '12').toFixed(2), '120.00');
  assert.equal(lineAmount('10', '9').toFixed(2), '90.00');
  assert.equal(spreadProfit('125', '95').toFixed(2), '30.00');
});

test('stored value funding is all-or-nothing for a submission group', () => {
  const enough = evaluateStoredValueFunding('500', '125');
  assert.equal(enough.canConfirm, true);
  assert.equal(enough.paidAmount.toFixed(2), '125.00');
  assert.equal(enough.shortfallAmount.toFixed(2), '0.00');

  const insufficient = evaluateStoredValueFunding('100', '500');
  assert.equal(insufficient.canConfirm, false);
  assert.equal(insufficient.paidAmount.toFixed(2), '0.00');
  assert.equal(insufficient.shortfallAmount.toFixed(2), '400.00');
});

test('settlement periods use natural cycles in Asia Shanghai', () => {
  assert.deepEqual(settlementPeriod('WEEKLY', new Date('2026-09-24T03:00:00.000Z')), {
    cycle: 'WEEKLY',
    startDate: '2026-09-21',
    endDate: '2026-09-27',
  });

  assert.deepEqual(settlementPeriod('HALF_MONTHLY', new Date('2026-09-15T16:00:00.000Z')), {
    cycle: 'HALF_MONTHLY',
    startDate: '2026-09-16',
    endDate: '2026-09-30',
  });

  assert.deepEqual(settlementPeriod('MONTHLY', new Date('2026-02-10T10:00:00.000Z')), {
    cycle: 'MONTHLY',
    startDate: '2026-02-01',
    endDate: '2026-02-28',
  });
});

test('idempotency request hash is stable for reordered object keys', () => {
  const left = {
    storeId: 'store-a',
    items: [
      { productId: 'p-1', quantity: '10.000000' },
      { quantity: '2.500000', productId: 'p-2' },
    ],
    remark: undefined,
  };
  const right = {
    items: [
      { quantity: '10.000000', productId: 'p-1' },
      { productId: 'p-2', quantity: '2.500000' },
    ],
    storeId: 'store-a',
  };

  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(requestHash(left), requestHash(right));
  assert.match(requestHash(left), /^[a-f0-9]{64}$/);
});
