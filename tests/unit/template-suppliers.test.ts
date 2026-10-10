import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTemplateSupplier, selectTemplateSuppliers } from '../../apps/admin/src/lib/templateSuppliers.js';

test('template multi-selection retains supplier prices and promotes one default', () => {
  const original = [{ supplierId: 'a', priority: 0, salesPrice: '12.00' }, { supplierId: 'b', priority: 10, salesPrice: '13.00' }];
  const selected = selectTemplateSuppliers(original, ['a', 'b', 'c']);
  assert.deepEqual(selected.map(row => row.priority), [0, 10, 20]);
  const promoted = defaultTemplateSupplier(selected, 'b');
  assert.equal(promoted[0]?.supplierId, 'b');
  assert.equal(promoted[0]?.salesPrice, '13.00');
  assert.equal(promoted[1]?.salesPrice, '12.00');
  assert.equal(selectTemplateSuppliers(promoted, ['a', 'c'])[0]?.supplierId, 'a');
  assert.deepEqual(original.map(row => row.priority), [0, 10]);
});
