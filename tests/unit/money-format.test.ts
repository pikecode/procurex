import assert from 'node:assert/strict';
import test from 'node:test';
import { money } from '../../apps/admin/src/lib/money.js';

test('money display rounds exactly to two places without modifying source prices', () => {
  assert.equal(money('8'), '8.00');
  assert.equal(money('1.005'), '1.01');
  assert.equal(money('99999999999999.999'), '100000000000000.00');
  assert.equal(money('-0.001'), '0.00');
  assert.equal(money(null), '—');
});
