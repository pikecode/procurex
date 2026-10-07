import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { createFrozenPriceDocuments } from '../../apps/api/src/pricing/frozen-price-adjustments.js';
import { applyEffectiveOrderPrices } from '../../apps/api/src/pricing/price-checkpoint.js';

for (const mode of ['COMPANY_TERM', 'STORED_VALUE', 'CREDIT', 'SUPPLIER_TERM']) {
  test(`${mode} records only frozen price sides with immutable quantity/price evidence`, async () => {
    const documents: any[] = [];
    const tx = {
      settlementItemSnapshot: { findMany: async () => [{ kind: mode === 'SUPPLIER_TERM' ? 'DIRECT' : 'SUPPLIER_PAYABLE' }] },
      adjustmentDocument: { create: async ({ data }: any) => { documents.push(data); } },
    };
    await createFrozenPriceDocuments(tx as never, {
      order: { id: 'order', storeId: 'store', supplierId: 'supplier', settlementMode: mode, settlementCycleSnapshot: 'MONTHLY', version: 3 } as never,
      baseline: new Date('2026-08-31T10:00:00Z'), adjustmentId: 'price-change', itemId: 'item', quantity: new Decimal(8),
      salesDelta: new Decimal(-16), supplyDelta: new Decimal(-8), salesPrice: new Decimal(10), supplyPrice: new Decimal(10),
    });
    assert.equal(documents.length, mode === 'SUPPLIER_TERM' ? 2 : 1);
    assert.equal(documents.at(-1).side, 'SUPPLIER');
    for (const document of documents) {
      assert.equal(document.sourcePriceChangeId, 'price-change');
      assert.equal(document.originalPeriodKey, 'MONTHLY:2026-08-01:2026-09-01');
      assert.equal(document.sourceRevision, 4);
      assert.equal(document.items.create.quantitySnapshot.toFixed(0), '8');
      assert.equal(document.items.create.unitPriceSnapshot.toFixed(2), '10.00');
    }
  });
}

for (const status of [null, 'SUCCEEDED']) {
  test(`frozen checkpoint rejects ${status ?? 'missing'} price-run source without writing prices`, async () => {
    const tx = {
      supplierOrder: { findUniqueOrThrow: async () => ({ id: 'order', supplierId: 'supplier', request: { templateId: 'template' }, settlementMode: 'STORED_VALUE', items: [{ productId: 'product', salesUnitPrice: '12', supplyUnitPrice: '9' }] }) },
      settlementItemSnapshot: { count: async () => 1 },
      priceVersion: { findFirst: async () => ({ id: 'version', salesPrice: '10', supplyPrice: '8' }) },
      priceChangeRunVersion: { findFirst: async () => status ? { run: { orders: [{ status, adjustment: null }] } } : null },
    };
    await assert.rejects(applyEffectiveOrderPrices(tx as never, 'order', new Date()),
      (error: any) => error.getResponse().code === 'FROZEN_PRICE_CHECKPOINT_RECONCILIATION_REQUIRED');
  });
}

test('a CREDIT frozen receivable alone does not create a refundable store price credit', async () => {
  const documents: any[] = [];
  const tx = {
    settlementItemSnapshot: { findMany: async () => [{ kind: 'STORE_RECEIVABLE' }, { kind: 'SUPPLIER_PAYABLE' }] },
    adjustmentDocument: { create: async ({ data }: any) => { documents.push(data); } },
  };
  await createFrozenPriceDocuments(tx as never, {
    order: { id: 'order', storeId: 'store', supplierId: 'supplier', settlementMode: 'CREDIT', settlementCycleSnapshot: 'MONTHLY', version: 3 } as never,
    baseline: new Date('2026-08-31'), adjustmentId: 'price-change', itemId: 'item', quantity: new Decimal(10),
    salesDelta: new Decimal(-20), supplyDelta: new Decimal(-10), salesPrice: new Decimal(10), supplyPrice: new Decimal(8),
  });
  assert.deepEqual(documents.map(document => document.side), ['SUPPLIER']);
});
