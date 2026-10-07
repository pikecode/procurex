import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { BusinessScopeGuard } from '../../apps/api/src/auth/business-scope.guard.js';

const guard = new BusinessScopeGuard();
const context = (roles: string[], scope?: object) => ({ switchToHttp: () => ({ getRequest: () => ({ auth: { user: { roles, scope } } }) }) }) as never;

test('pure business roles require matching scope type and participant id', () => {
  for (const role of ['STORE', 'STORE_FINANCE', 'SUPPLIER']) {
    for (const scope of [undefined, { type: 'COMPANY' }, { type: role }, { type: role, storeId: role === 'SUPPLIER' ? 'store' : undefined, supplierId: role === 'SUPPLIER' ? undefined : 'supplier' }]) {
      assert.throws(() => guard.canActivate(context([role], scope)), ForbiddenException);
    }
  }
});
test('store and store finance roles share a valid store scope', () => {
  for (const type of ['STORE', 'STORE_FINANCE']) assert.equal(guard.canActivate(context(['STORE', 'STORE_FINANCE'], { type, storeId: 'store' })), true);
});
test('incompatible store and supplier role combination fails closed', () => {
  for (const scope of [{ type: 'STORE', storeId: 'store', supplierId: 'supplier' }, { type: 'SUPPLIER', storeId: 'store', supplierId: 'supplier' }]) {
    assert.throws(() => guard.canActivate(context(['STORE', 'SUPPLIER'], scope)), ForbiddenException);
  }
});
test('central mixed roles retain central scope policy', () => {
  for (const role of ['ADMIN', 'PURCHASER', 'HQ_FINANCE']) for (const scope of [undefined, { type: 'COMPANY' }, { type: 'STORE', storeId: 'store' }]) {
    assert.equal(guard.canActivate(context([role, 'STORE', 'SUPPLIER'], scope)), true);
  }
});
