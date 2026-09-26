import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { AdjustmentsService } from '../../apps/api/src/adjustments/adjustments.service.js';

test('price changes appear as adjustments only for settlement sides frozen before the change', async () => {
  const createdAt = new Date('2026-09-20T00:00:00Z');
  const order = {
    id: 'order-1', storeId: 'store-1', supplierId: 'supplier-1', supplierOrderNo: 'SO-1',
    settlementMode: 'COMPANY_TERM', settlementCycleSnapshot: 'MONTHLY', firstShippedAt: createdAt, version: 2,
    request: { submittedAt: createdAt },
  };
  const service = new AdjustmentsService({
    client: {
      discrepancyReturn: { findMany: async () => [] },
      priceChangeAdjustment: { findMany: async () => [{
        id: 'change-1', orderItemId: 'line-1', createdAt: new Date('2026-09-21T00:00:00Z'),
        salesDelta: new Decimal(20), supplyDelta: new Decimal(10),
        orderItem: { id: 'line-1', productId: 'product-1', quantity: 2, salesUnitPrice: 12, supplyUnitPrice: 9,
          product: { name: 'Item' }, supplierOrder: order },
      }] },
      settlementItemSnapshot: { findMany: async ({ where }: any) => {
        const ids = where.settlementItemId.in as string[];
        return [{ settlementItemId: ids[0], createdAt: new Date('2026-09-19T00:00:00Z') }];
      } },
    },
  } as any);

  const adjustments = await service.list({ storeId: order.storeId, supplierId: order.supplierId });
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0]?.direction, 'STORE_RECEIVABLE_INCREASE');
  assert.equal(adjustments[0]?.adjustmentAmount, '20.00');
});
