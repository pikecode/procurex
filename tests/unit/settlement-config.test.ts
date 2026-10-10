import assert from 'node:assert/strict';
import test from 'node:test';
import { supplierSettlementCycle } from '../../apps/api/src/suppliers/settlement-config.js';
import { resolveSettlementTerms } from '../../apps/api/src/purchase-requests/request-funding.js';

test('only term modes require a valid settlement cycle', () => {
  for (const mode of ['STORED_VALUE', 'CREDIT']) assert.equal(supplierSettlementCycle(mode), 'IMMEDIATE');
  for (const mode of ['COMPANY_TERM', 'SUPPLIER_TERM']) {
    assert.throws(() => supplierSettlementCycle(mode));
    assert.throws(() => supplierSettlementCycle(mode, 'invalid'));
    assert.equal(supplierSettlementCycle(mode, 'HALF_MONTHLY'), 'HALF_MONTHLY');
  }
});

test('store-specific period overrides only cycle and preserves supplier mode', async () => {
  let query: any;
  const client = { supplier: { findMany: async () => [{ id: 's', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY' }] },
    templateStoreSupplierCycle: { findMany: async (args: any) => { query = args; return [{ supplierId: 's', settlementCycle: 'WEEKLY' }]; } } } as never;
  assert.deepEqual((await resolveSettlementTerms(client, 't', ['s'], 'store')).get('s'), { mode: 'COMPANY_TERM', cycle: 'WEEKLY' });
  assert.equal(query.where.storeId, 'store');
  assert.equal(query.where.templateId, 't');
  assert.deepEqual(query.where.template.bindings.some, { storeId: 'store', expiredAt: null });
  assert.deepEqual((await resolveSettlementTerms(client, 't', ['s'])).get('s'), { mode: 'COMPANY_TERM', cycle: 'MONTHLY' });
});
