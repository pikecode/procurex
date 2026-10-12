import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscrepanciesService } from '../../apps/api/src/discrepancies/discrepancies.service.js';

for (const scope of [undefined, { type: 'STORE', storeId: 'store' }, { type: 'SUPPLIER', supplierId: 'supplier' }]) {
  test(`discrepancy todos exclude fulfilled gaps and retain ${scope?.type ?? 'company'} scope`, async () => {
    let query: { where: Record<string, unknown> } | undefined;
    const service = new DiscrepanciesService({ client: { discrepancy: { findMany: async (input: typeof query) => { query = input; return []; } } } } as never);
    assert.deepEqual(await service.list(scope), []);
    assert.deepEqual(query?.where.OR, [
      { status: 'OPEN' },
      { status: 'REPLENISH_PENDING', replenishmentGap: { remainingQuantity: { gt: 0 } } },
    ]);
    assert.deepEqual(query?.where.orderItem, scope ? { supplierOrder: scope.type === 'STORE' ? { storeId: 'store' } : { supplierId: 'supplier' } } : undefined);
  });
}
