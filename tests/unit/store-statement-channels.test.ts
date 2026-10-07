import assert from 'node:assert/strict';
import test from 'node:test';
import { StoreStatementsService } from '../../apps/api/src/store-statements/store-statements.service.js';

test('store receivables include only company terms, never account or direct orders', async () => {
  const queries: Array<{ where: { settlementMode: string } }> = [];
  let adjustmentQuery: unknown;
  const orders = ['STORED_VALUE', 'CREDIT', 'SUPPLIER_TERM', 'COMPANY_TERM'].map(mode => ({
    id: mode, supplierOrderNo: mode, storeId: 'store', supplierId: 'supplier', settlementMode: mode,
    settlementCycleSnapshot: 'MONTHLY', firstShippedAt: new Date('2026-09-20'),
    salesGoodsAmount: '100', version: 1, shipments: [{ freight: '5' }], priceChangeRuns: [],
  }));
  const service = new StoreStatementsService({ client: {
    supplierOrder: { findMany: async (query: typeof queries[number]) => { queries.push(query); return orders; } },
    adjustmentDocument: { findMany: async (query: unknown) => { adjustmentQuery = query; return []; } },
  } } as never);
  const statements = await service.list({ storeId: 'store', supplierId: 'supplier' });
  assert.ok(queries.every(query => query.where.settlementMode === 'COMPANY_TERM'));
  assert.equal(statements.length, 1);
  assert.equal(statements[0]!.lineCount, 1);
  assert.equal(statements[0]!.payableAmount, '105.00');
  assert.deepEqual(adjustmentQuery, { where: {
    storeId: 'store', supplierId: 'supplier', side: 'STORE', supplierOrderId: { in: ['COMPANY_TERM'] },
  } });
  const detail = await service.get(statements[0]!.id);
  assert.equal(detail.lines[0]!.supplierOrderId, 'COMPANY_TERM');
});

test('company-term adjustments remain visible in their actual period without a completed base line', async () => {
  const service = new StoreStatementsService({ client: {
    supplierOrder: { findMany: async (query: { select?: unknown }) => query.select ? [{ id: 'company', settlementMode: 'COMPANY_TERM' }] : [] },
    adjustmentDocument: { findMany: async () => [{ id: 'adjustment', supplierOrderId: 'company', storeId: 'store', supplierId: 'supplier', amount: '20', settlementPeriodKey: 'MONTHLY:2026-09-01:2026-10-01' }] },
  } } as never);
  const [statement] = await service.list({ storeId: 'store', supplierId: 'supplier' });
  assert.equal(statement!.lineCount, 0);
  assert.equal(statement!.adjustmentAmount, '20.00');
  assert.equal(statement!.payableAmount, '20.00');
});
