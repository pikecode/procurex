import assert from 'node:assert/strict';
import test from 'node:test';
import { PricingService } from '../../apps/api/src/pricing/pricing.service.js';

test('price impact preview limits the effective interval and excludes completed orders', async () => {
  let query: any;
  const service = new PricingService({
    client: {
      priceScope: { findUnique: async () => ({
        id: 'scope-1',
        versions: [
          { effectiveAt: new Date('2026-09-01T00:00:00Z'), revision: 2 },
          { effectiveAt: new Date('2026-10-01T00:00:00Z'), revision: 3 },
        ],
      }) },
      supplierOrder: { findMany: async (value: any) => {
        query = value;
        return [
          {
            id: 'order-1', supplierOrderNo: 'SO-1', firstShippedAt: null,
            request: { submittedAt: new Date('2026-09-15T00:00:00Z') },
            items: [{ quantity: '10', salesUnitPrice: '10', supplyUnitPrice: '8', salesLineAmount: '100', supplyLineAmount: '80' }],
          },
          {
            id: 'order-after-next-price', supplierOrderNo: 'SO-2', firstShippedAt: null,
            request: { submittedAt: new Date('2026-10-01T00:00:00Z') }, items: [],
          },
        ];
      } },
    },
  } as any);

  const preview = await service.previewImpact({
    productId: 'product-1', supplierId: 'supplier-1', salesPrice: '12', supplyPrice: '9', effectiveAt: new Date('2026-09-01T00:00:00Z'),
  });
  assert.deepEqual(query.where.status.notIn, ['COMPLETED', 'CANCELED', 'REJECTED']);
  assert.equal(preview.affectedOrderCount, 1);
  assert.equal(preview.salesDelta, '20.00');
  assert.equal(preview.supplyDelta, '10.00');
  assert.equal(preview.orders[0]?.supplierOrderId, 'order-1');
  const sameTimePreview = await service.previewImpact({
    productId: 'product-1', supplierId: 'supplier-1', salesPrice: '12', supplyPrice: '9', effectiveAt: new Date('2026-10-01T00:00:00Z'),
  });
  assert.equal(sameTimePreview.affectedOrderCount, 0);
});
