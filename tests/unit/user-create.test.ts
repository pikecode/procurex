import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { UsersController } from '../../apps/api/src/users/users.controller.js';

const controller = new UsersController({ createUser() { throw new Error('Invalid input reached persistence'); } } as never);
const valid = { username: 'valid_user', password: 'ValidPassword123!', displayName: '用户', role: 'STORE', storeId: '3897e8ab-d990-4547-a23e-22f89cc74c8b' };
test('user creation rejects malformed credentials, unknown roles and incompatible bindings', () => {
  for (const patch of [{ username: '' }, { username: 'a'.repeat(81) }, { password: 'short' }, { password: 'x'.repeat(129) }, { displayName: ' ' }, { role: 'UNKNOWN' }, { storeId: undefined }, { storeId: 'invalid' }, { supplierId: valid.storeId }, { role: 'HQ_FINANCE' }, { role: 'SUPPLIER' }]) {
    assert.throws(() => controller.createUser({ ...valid, ...patch }, {} as never), BadRequestException);
  }
});
