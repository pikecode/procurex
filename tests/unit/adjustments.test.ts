import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { AdjustmentsService } from '../../apps/api/src/adjustments/adjustments.service.js';

const changedAt = new Date('2026-09-21T00:00:00Z');

function createService(snapshotTimes: Record<string, Date>) {
  const order = {
    id: 'order-1', storeId: 'store-1', supplierId: 'supplier-1', supplierOrderNo: 'SO-1',
    settlementMode: 'COMPANY_TERM', settlementCycleSnapshot: 'MONTHLY', firstShippedAt: new Date('2026-09-20T00:00:00Z'), version: 2,
    request: { submittedAt: new Date('2026-09-20T00:00:00Z') },
  };
  return new AdjustmentsService({
    client: {
      discrepancyReturn: { findMany: async () => [] },
      priceChangeAdjustment: { findMany: async () => [{
        id: 'change-1', orderItemId: 'line-1', createdAt: changedAt,
        salesDelta: new Decimal(20), supplyDelta: new Decimal(10),
        orderItem: { id: 'line-1', productId: 'product-1', quantity: 2, salesUnitPrice: 12, supplyUnitPrice: 9,
          product: { name: 'Item' }, supplierOrder: order },
      }] },
      settlementItemSnapshot: { findMany: async ({ where }: any) => (where.settlementItemId.in as string[]).flatMap((id) => {
        const kind = JSON.parse(Buffer.from(id, 'base64url').toString()).kind;
        return snapshotTimes[kind] ? [{ settlementItemId: id, createdAt: snapshotTimes[kind] }] : [];
      }) },
    },
  } as any);
}

test('price change before settlement snapshots is already in the settled amounts', async () => {
  const service = createService({
    STORE_RECEIVABLE: new Date('2026-09-22T00:00:00Z'),
    SUPPLIER_PAYABLE: new Date('2026-09-22T00:00:00Z'),
  });
  assert.deepEqual(await service.list({}), []);
});

test('price change after only one side settled adjusts only that frozen side', async () => {
  const service = createService({ STORE_RECEIVABLE: new Date('2026-09-19T00:00:00Z') });
  const adjustments = await service.list({});
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0]?.direction, 'STORE_RECEIVABLE_INCREASE');
  assert.equal(adjustments[0]?.adjustmentAmount, '20.00');
});

test('sequential side settlement keeps the pre-change side adjustment only', async () => {
  const service = createService({
    STORE_RECEIVABLE: new Date('2026-09-19T00:00:00Z'),
    SUPPLIER_PAYABLE: new Date('2026-09-22T00:00:00Z'),
  });
  const adjustments = await service.list({});
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0]?.direction, 'STORE_RECEIVABLE_INCREASE');
  assert.equal(adjustments[0]?.adjustmentAmount, '20.00');
});

test('B05 reads persisted adjustment documents when available', async () => {
  const service = createService({});
  (service as any).database.client.adjustmentDocument = {
    findMany: async () => [{ sourcePriceChangeId: 'change-1', side: 'SUPPLIER', amount: new Decimal(10), createdAt: changedAt }],
  };
  const adjustments = await service.list({});
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0]?.direction, 'SUPPLIER_PAYABLE_INCREASE');
  assert.equal(adjustments[0]?.adjustmentAmount, '10.00');
});

test('B05 exposes confirmed persisted adjustment disposal by side', async () => {
  const service = createService({});
  (service as any).database.client.adjustmentDocument = {
    findMany: async () => [{
      id: 'adjustment-1', sourcePriceChangeId: 'change-1', side: 'SUPPLIER', amount: new Decimal(-10), createdAt: changedAt,
      disposalItems: [{ amount: new Decimal(10), disposal: {
        id: 'disposal-1', disposalNo: 'DD-1', status: 'CONFIRMED', confirmedAt: new Date('2026-09-23T00:00:00Z'),
      } }],
    }],
  };
  const adjustments = await service.list({ processingStatus: 'DISPOSED' });
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0]?.pendingReturnOrOffsetAmount, '0.00');
  const detail = await service.get(adjustments[0]!.id);
  assert.equal(detail.disposal?.disposalId, 'disposal-1');
  assert.equal(detail.disposal?.status, 'CONFIRMED');
});
