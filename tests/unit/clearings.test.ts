import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { ClearingsService } from '../../apps/api/src/clearings/clearings.service.js';

test('A06 prevents a store scope from reading another store clearing', async () => {
  const clearing = {
    id: 'clearing-1', clearingNo: 'CL-1', storeId: 'store-1', amount: new Decimal('20.00'),
    businessDate: new Date('2026-09-27T00:00:00Z'), remark: null,
    createdAt: new Date('2026-09-27T00:00:00Z'), items: [],
  };
  const service = new ClearingsService({
    client: {
      clearingDocument: { findUnique: async () => clearing },
      storeAccount: { findUnique: async () => null },
    },
  } as any);

  await assert.rejects(
    () => service.get(clearing.id, { type: 'STORE', storeId: 'store-2' }),
    (error: any) => error?.getResponse?.()?.code === 'CLEARING_NOT_FOUND',
  );
  assert.equal((await service.get(clearing.id, { type: 'STORE', storeId: clearing.storeId })).id, clearing.id);
  assert.equal((await service.get(clearing.id, { type: 'STORE_FINANCE', storeId: clearing.storeId })).id, clearing.id);
});
