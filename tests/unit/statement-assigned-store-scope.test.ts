import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectStatementsService } from '../../apps/api/src/direct-statements/direct-statements.service.js';
import { SupplierStoreStatementsService } from '../../apps/api/src/supplier-store-statements/supplier-store-statements.service.js';

for (const Service of [DirectStatementsService, SupplierStoreStatementsService]) {
  test(`${Service.name} filters orders and adjustments and denies foreign detail`, async () => {
    const queries: Array<{ where: { storeId: unknown } }> = [];
    const service = new Service({ client: {
      supplierOrder: { findMany: async (query: typeof queries[number]) => { queries.push(query); return []; } },
      adjustmentDocument: { findMany: async (query: typeof queries[number]) => { queries.push(query); return []; } },
    } } as never);
    await service.list({ storeIds: ['store-a', 'store-b'] });
    assert.ok(queries.length >= 2);
    for (const query of queries) assert.deepEqual(query.where.storeId, { in: ['store-a', 'store-b'] });
    const id = Buffer.from(JSON.stringify({ storeId: '11111111-1111-4111-8111-111111111111', supplierId: '22222222-2222-4222-8222-222222222222', cycle: 'MONTHLY', periodStart: '2026-09-01', periodEndExclusive: '2026-10-01' })).toString('base64url');
    await assert.rejects(service.get(id, { type: 'MULTI_STORE', storeIds: ['33333333-3333-4333-8333-333333333333'] }), { status: 403 });
    await assert.rejects(service.list({ storeIds: ['store-a'], storeId: 'store-c' }), { status: 403 });
  });
}
