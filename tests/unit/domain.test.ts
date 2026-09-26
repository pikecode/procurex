import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateStoredValueFunding } from '../../packages/domain/src/funding.js';
import { canonicalJson, requestHash } from '../../packages/domain/src/idempotency.js';
import { lineAmount, spreadProfit } from '../../packages/domain/src/money.js';
import { hashPassword, verifyPassword } from '../../packages/domain/src/password.js';
import { settlementPeriod } from '../../packages/domain/src/settlement-period.js';
import {
  validateDecimalString,
  validateExpectedVersion,
  validateIdempotencyKey,
  validateUuid,
} from '../../packages/domain/src/validation.js';

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

test('settlement periods keep half-month, week, year-end, and leap-day boundaries unique', () => {
  assert.equal(settlementPeriod('HALF_MONTHLY', new Date('2026-09-15T15:59:59.999Z')).startDate, '2026-09-01');
  assert.equal(settlementPeriod('HALF_MONTHLY', new Date('2026-09-15T16:00:00.000Z')).startDate, '2026-09-16');
  assert.equal(settlementPeriod('WEEKLY', new Date('2026-09-20T15:59:59.999Z')).startDate, '2026-09-14');
  assert.equal(settlementPeriod('WEEKLY', new Date('2026-09-20T16:00:00.000Z')).startDate, '2026-09-21');
  assert.equal(settlementPeriod('MONTHLY', new Date('2026-12-31T15:59:59.999Z')).endDate, '2026-12-31');
  assert.equal(settlementPeriod('MONTHLY', new Date('2027-01-01T00:00:00.000Z')).startDate, '2027-01-01');
  assert.equal(settlementPeriod('MONTHLY', new Date('2024-02-29T00:00:00.000Z')).endDate, '2024-02-29');
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

test('contract validation covers uuid, version, idempotency key and decimal strings', () => {
  assert.deepEqual(validateUuid('storeId', '11111111-1111-4111-8111-111111111111'), []);
  assert.equal(validateUuid('storeId', 'store-a')[0]?.code, 'INVALID_UUID');

  assert.deepEqual(validateExpectedVersion('expectedVersion', 1), []);
  assert.equal(validateExpectedVersion('expectedVersion', 0)[0]?.code, 'INVALID_EXPECTED_VERSION');

  assert.deepEqual(validateIdempotencyKey('create-order-1'), []);
  assert.equal(validateIdempotencyKey('')[0]?.code, 'MISSING_IDEMPOTENCY_KEY');
  assert.equal(validateIdempotencyKey('x'.repeat(129))[0]?.code, 'IDEMPOTENCY_KEY_TOO_LONG');

  assert.deepEqual(validateDecimalString('amount', '12.34', 2), []);
  assert.equal(validateDecimalString('amount', '12.345', 2)[0]?.code, 'DECIMAL_SCALE_EXCEEDED');
  assert.equal(validateDecimalString('amount', 12.34, 2)[0]?.code, 'INVALID_DECIMAL_STRING');
  assert.equal(validateDecimalString('amount', '1e3', 2)[0]?.code, 'INVALID_DECIMAL_STRING');
});

test('password hashing verifies matching password only', async () => {
  const storedHash = await hashPassword('correct-password');

  assert.match(storedHash, /^scrypt\$/);
  assert.equal(await verifyPassword('correct-password', storedHash), true);
  assert.equal(await verifyPassword('wrong-password', storedHash), false);
  assert.equal(await verifyPassword('correct-password', null), false);
});
