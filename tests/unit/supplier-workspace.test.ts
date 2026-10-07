import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { BusinessScopeGuard } from '../../apps/api/src/auth/business-scope.guard.js';
import { supplierPriceView } from '../../apps/api/src/supplier-orders/supplier-price-privacy.interceptor.js';

const context = (roles: string[], scope?: Record<string, string>) => ({
  switchToHttp: () => ({ getRequest: () => ({ auth: { user: { roles, scope } } }) }),
}) as unknown as ExecutionContext;

test('business scopes reject missing or mismatched supplier/store bindings', () => {
  const guard = new BusinessScopeGuard();
  for (const [roles, scope] of [
    [['SUPPLIER'], undefined], [['SUPPLIER'], { type: 'SUPPLIER' }],
    [['SUPPLIER'], { type: 'STORE', supplierId: 'supplier-a' }],
    [['STORE'], undefined], [['STORE_FINANCE'], { type: 'STORE_FINANCE' }],
  ] as [string[], Record<string, string> | undefined][]) {
    assert.throws(() => guard.canActivate(context(roles, scope)), /Business account scope/);
  }
  assert.equal(guard.canActivate(context(['SUPPLIER'], { type: 'SUPPLIER', supplierId: 'supplier-a' })), true);
  assert.equal(guard.canActivate(context(['STORE_FINANCE'], { type: 'STORE', storeId: 'store-a' })), true);
  for (const role of ['ADMIN', 'PURCHASER', 'HQ_FINANCE']) assert.equal(guard.canActivate(context([role])), true);
});

test('supplier projection strips nested company prices without mutating source or dates', () => {
  const createdAt = new Date('2026-10-04T00:00:00Z');
  const source = { salesGoodsAmount: '100', supplyGoodsAmount: '60', createdAt,
    items: [{ salesUnitPrice: '10', salesLineAmount: '100', supplyUnitPrice: '6',
      snapshot: { purchaseSalesUnitPrice: '10', salesPriceVersionId: 'secret', supplyPriceVersionId: 'cost-a' } }] };
  assert.deepEqual(supplierPriceView(source), { supplyGoodsAmount: '60', createdAt,
    items: [{ supplyUnitPrice: '6', snapshot: { supplyPriceVersionId: 'cost-a' } }] });
  assert.equal(source.salesGoodsAmount, '100');
  assert.equal((supplierPriceView(source) as { createdAt: Date }).createdAt, createdAt);
});
