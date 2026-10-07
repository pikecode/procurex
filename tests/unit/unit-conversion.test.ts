import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { lineAmount } from '../../packages/domain/src/money.js';
import { purchaseUnitPrice, salesQuantityFromInput, validatePurchaseUnitConversion } from '../../packages/domain/src/unit-conversion.js';

const pack = { salesUnitId: 'bag', purchaseUnitId: 'pack', salesUnitsPerPurchaseUnit: '12' };

test('purchase quantity and unit price preserve the sales-unit financial amount', () => {
  const quantity = salesQuantityFromInput('2.5', 'pack', 'bag', pack);
  assert.equal(quantity.toString(), '30');
  assert.equal(purchaseUnitPrice('1.234567', pack).toString(), '14.814804');
  assert.equal(lineAmount(quantity, '1.234567').toFixed(2), lineAmount('2.5', purchaseUnitPrice('1.234567', pack)).toFixed(2));
  assert.equal(salesQuantityFromInput('2.5', 'bag', 'bag', pack).toString(), '2.5');
});

test('conversion rejects unrepresentable quantities instead of silently rounding', () => {
  const fractional = { ...pack, salesUnitsPerPurchaseUnit: '0.00000001' };
  assert.throws(() => salesQuantityFromInput('1', 'pack', 'bag', fractional), /stored exactly/);
  assert.equal(salesQuantityFromInput('100', 'pack', 'bag', fractional).toString(), '0.000001');
  assert.throws(() => salesQuantityFromInput('99999999999999', 'pack', 'bag', pack), /stored exactly/);
  assert.throws(() => salesQuantityFromInput('0.0000001', 'bag', 'bag'), /decimal places/);
});

test('unknown units and invalid conversion settings are rejected', () => {
  assert.throws(() => salesQuantityFromInput('1', 'box', 'bag', pack), /not configured/);
  assert.throws(() => salesQuantityFromInput('1', 'pack', 'bag'), /not configured/);
  assert.throws(() => salesQuantityFromInput('1', 'pack', 'other', pack), /not configured/);
  assert.throws(() => validatePurchaseUnitConversion({ ...pack, purchaseUnitId: 'bag' }), /distinct/);
  for (const ratio of ['0', '-1', 'NaN', 'Infinity', '0.000000001', '1000000000000']) {
    assert.throws(() => validatePurchaseUnitConversion({ ...pack, salesUnitsPerPurchaseUnit: ratio }));
  }
  for (const quantity of ['0', '-1', 'NaN', 'Infinity', '100000000000000']) {
    assert.throws(() => salesQuantityFromInput(quantity, 'bag', 'bag'));
  }
});

test('converted prices remain exact until line amount rounding, including zero prices', () => {
  const fractional = { ...pack, salesUnitsPerPurchaseUnit: '1.00000001' };
  assert.equal(purchaseUnitPrice('0.000001', fractional).toString(), '0.00000100000001');
  assert.equal(purchaseUnitPrice('0', pack).toString(), '0');
  for (const price of ['-1', 'NaN', 'Infinity', '0.0000001', '100000000000000']) {
    assert.throws(() => purchaseUnitPrice(price, pack));
  }
});

test('conversion precision is independent of global Decimal configuration', () => {
  const precision = Decimal.precision;
  try {
    Decimal.set({ precision: 10 });
    const conversion = { ...pack, salesUnitsPerPurchaseUnit: '999999999999.12345678' };
    assert.equal(purchaseUnitPrice('99999999999999.123456', conversion).toFixed(14), '99999999999911469134000000.76832870023168');
  } finally {
    Decimal.set({ precision });
  }
});
