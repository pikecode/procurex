import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { assignedStoreIds, assertAssignedStore, storeFilter } from '../../apps/api/src/auth/store-scope.js';

test('assigned stores normalize identifiers and never expand a requested store', () => {
  const scope = { type: 'MULTI_STORE', storeIds: ['B', 'a', 'A'] };
  assert.deepEqual(assignedStoreIds(scope), ['a', 'b']);
  assert.deepEqual(storeFilter('A', assignedStoreIds(scope)), { in: ['a'] });
  assert.deepEqual(storeFilter(undefined, []), { in: [] });
  assert.throws(() => storeFilter('c', assignedStoreIds(scope)), ForbiddenException);
  assert.throws(() => assertAssignedStore(scope, 'c'), ForbiddenException);
});

test('missing and malformed assigned scope fail closed', () => {
  for (const storeIds of [undefined, [], [''], [null], 'a']) {
    assert.throws(() => assignedStoreIds({ type: 'MULTI_STORE', storeIds } as never), ForbiddenException);
  }
  assert.equal(assignedStoreIds({ type: 'COMPANY' }), undefined);
});
