import assert from 'node:assert/strict';
import test from 'node:test';
import { SupplierStatementsService } from '../../apps/api/src/supplier-statements/supplier-statements.service.js';
import { SupplierStoreStatementsService } from '../../apps/api/src/supplier-store-statements/supplier-store-statements.service.js';

for (const Service of [SupplierStatementsService, SupplierStoreStatementsService]) {
  test(`${Service.name} excludes direct base orders and adjustment-only direct periods`, async () => {
    const orders = ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM'].map(mode => ({
      id: mode, supplierOrderNo: mode, storeId: 'store', supplierId: 'supplier', settlementMode: mode,
      settlementCycleSnapshot: 'MONTHLY', firstShippedAt: new Date('2026-09-20'),
      supplyGoodsAmount: '100', version: 1, shipments: [{ freight: '5' }], priceChangeRuns: [],
    }));
    const queries: Array<{ select?: unknown; where: { settlementMode?: unknown } }> = [];
    const service = new Service({ client: {
      supplierOrder: { findMany: async (query: typeof queries[number]) => { queries.push(query); return orders; } },
      adjustmentDocument: { findMany: async () => orders.map(order => ({
        id: `adjustment-${order.id}`, supplierOrderId: order.id, storeId: 'store', supplierId: 'supplier',
        amount: '20', settlementPeriodKey: 'MONTHLY:2026-10-01:2026-11-01',
      })) },
    } } as never);
    const statements = await service.list({ supplierId: 'supplier' });
    assert.deepEqual(queries[0]!.where.settlementMode, { not: 'SUPPLIER_TERM' });
    assert.equal(statements.length, 2);
    assert.equal(statements.find(statement => statement.lineCount > 0)!.payableAmount, '315.00');
    const adjustment = statements.find(statement => statement.lineCount === 0)!;
    assert.equal(adjustment.adjustmentAmount, '60.00');
    assert.equal(adjustment.adjustmentSettlementItemIds.length, 3);
  });
}
