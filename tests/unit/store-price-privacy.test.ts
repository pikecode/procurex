import assert from 'node:assert/strict';
import test from 'node:test';
import { of, firstValueFrom } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { StorePricePrivacyInterceptor, storePriceView } from '../../apps/api/src/common/store-price-privacy.interceptor.js';

test('store response projection removes nested cost values but retains opaque approval versions', () => {
  const date = new Date();
  assert.deepEqual(storePriceView({ date, totals: { salesGoodsAmount: '120', supplyGoodsAmount: '90' }, items: [
    { salesUnitPrice: '12', supplyUnitPrice: '9', supplyLineAmount: '90', supplyPriceSnapshot: '9', purchaseSupplyPrice: '54',
      supplyPriceVersionId: 'opaque-version', salesLineAmount: '120', profit: '30' },
  ] }), { date, totals: { salesGoodsAmount: '120' }, items: [{ salesUnitPrice: '12', supplyPriceVersionId: 'opaque-version', salesLineAmount: '120' }] });
});

test('store privacy applies to pure store roles without restricting central mixed roles', async () => {
  const interceptor = new StorePricePrivacyInterceptor();
  for (const roles of [['STORE'], ['STORE_FINANCE'], ['ADMIN', 'STORE'], ['PURCHASER', 'STORE'], ['HQ_FINANCE', 'STORE_FINANCE']]) {
    const context = { switchToHttp: () => ({ getRequest: () => ({ auth: { user: { roles } } }) }) } as ExecutionContext;
    const value = await firstValueFrom(interceptor.intercept(context, { handle: () => of({ supplyUnitPrice: '9', salesUnitPrice: '12' }) }));
    assert.deepEqual(value, roles.length === 1 ? { salesUnitPrice: '12' } : { supplyUnitPrice: '9', salesUnitPrice: '12' });
  }
});
