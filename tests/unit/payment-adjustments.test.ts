import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { PaymentRecordsService } from '../../apps/api/src/payment-records/payment-records.service.js';

function adjustmentItemId(adjustmentDocumentId: string, supplierOrderId: string, adjustmentSide: 'STORE' | 'SUPPLIER'): string {
  return Buffer.from(JSON.stringify({ kind: 'ADJUSTMENT', adjustmentDocumentId, supplierOrderId, adjustmentSide })).toString('base64url');
}

function serviceForAdjustment(amount: string) {
  const itemId = adjustmentItemId('adjustment-1', 'order-1', 'STORE');
  return {
    itemId,
    service: new PaymentRecordsService({
      client: {
        supplierOrder: { findMany: async () => [{
          id: 'order-1', supplierOrderNo: 'SO-1', storeId: 'store-1', supplierId: 'supplier-1', version: 4,
          status: 'COMPLETED', firstShippedAt: new Date('2026-09-10T00:00:00.000Z'), settlementMode: 'COMPANY_TERM',
          salesGoodsAmount: '100.00', supplyGoodsAmount: '80.00', shipments: [], request: { shortfallAmount: '0.00' },
        }] },
        settlementItemSnapshot: { findMany: async () => [] },
        adjustmentDocument: { findMany: async () => [{ id: 'adjustment-1', supplierOrderId: 'order-1', side: 'STORE', amount: new Decimal(amount), sourceRevision: 9 }] },
        paymentAllocation: { findMany: async () => [] },
        differenceDisposalItem: { findMany: async () => [] },
      },
    } as any),
  };
}

test('payment preview treats a positive adjustment as a payable store receivable', async () => {
  const { service, itemId } = serviceForAdjustment('20.00');
  const preview = await service.preview([itemId]);
  assert.equal(preview.direction, 'STORE_TO_COMPANY');
  assert.equal(preview.items[0]?.kind, 'ADJUSTMENT');
  assert.equal(preview.items[0]?.adjustmentSide, 'STORE');
  assert.equal(preview.items[0]?.sourceVersion, 9);
  assert.equal(preview.items[0]?.payableAmount, '20.00');
});

test('payment preview blocks a negative adjustment as a difference credit', async () => {
  const { service, itemId } = serviceForAdjustment('-20.00');
  await assert.rejects(
    () => service.preview([itemId]),
    (error: any) => error?.getResponse?.()?.details?.blockedItems?.[0]?.code === 'ADJUSTMENT_CREDIT_NOT_PAYABLE',
  );
});

test('company-term supplier adjustment waits for store receivable and store adjustments', async () => {
  const itemId = adjustmentItemId('adjustment-1', 'order-1', 'SUPPLIER');
  const storeAdjustmentId = adjustmentItemId('adjustment-store', 'order-1', 'STORE');
  const service = new PaymentRecordsService({
    client: {
      supplierOrder: { findMany: async () => [{
        id: 'order-1', supplierOrderNo: 'SO-1', storeId: 'store-1', supplierId: 'supplier-1', version: 4,
        status: 'COMPLETED', firstShippedAt: new Date('2026-09-10T00:00:00.000Z'), settlementMode: 'COMPANY_TERM',
        salesGoodsAmount: '100.00', supplyGoodsAmount: '80.00', shipments: [], request: { shortfallAmount: '0.00' },
      }] },
      settlementItemSnapshot: { findMany: async () => [] },
      adjustmentDocument: { findMany: async ({ where }: any) => where.side === 'STORE'
        ? [{ id: 'adjustment-store', supplierOrderId: 'order-1', side: 'STORE', amount: new Decimal('20.00'), sourceRevision: 9 }]
        : [{ id: 'adjustment-1', supplierOrderId: 'order-1', side: 'SUPPLIER', amount: new Decimal('10.00'), sourceRevision: 9 }] },
      paymentAllocation: { findMany: async () => [{ settlementItemId: storeAdjustmentId, state: 'CONFIRMED', amount: '20.00' }] },
      differenceDisposalItem: { findMany: async () => [] },
    },
  } as any);
  await assert.rejects(
    () => service.preview([itemId]),
    (error: any) => error?.getResponse?.()?.details?.blockedItems?.[0]?.code === 'STORE_RECEIVABLE_UNSETTLED',
  );
});

test('payment preview combines an ordinary item and a same-direction adjustment', async () => {
  const adjustmentId = adjustmentItemId('adjustment-1', 'order-1', 'STORE');
  const ordinaryId = Buffer.from(JSON.stringify({ kind: 'STORE_RECEIVABLE', supplierOrderId: 'order-1' })).toString('base64url');
  const service = new PaymentRecordsService({
    client: {
      supplierOrder: { findMany: async () => [{
        id: 'order-1', supplierOrderNo: 'SO-1', storeId: 'store-1', supplierId: 'supplier-1', version: 4,
        status: 'COMPLETED', firstShippedAt: new Date('2026-09-10T00:00:00.000Z'), settlementMode: 'COMPANY_TERM',
        salesGoodsAmount: '100.00', supplyGoodsAmount: '80.00', shipments: [], request: { shortfallAmount: '0.00' },
      }] },
      settlementItemSnapshot: { findMany: async () => [] },
      adjustmentDocument: { findMany: async () => [{ id: 'adjustment-1', supplierOrderId: 'order-1', side: 'STORE', amount: new Decimal('20.00'), sourceRevision: 9 }] },
      paymentAllocation: { findMany: async () => [] },
      differenceDisposalItem: { findMany: async () => [] },
    },
  } as any);
  const preview = await service.preview([ordinaryId, adjustmentId]);
  assert.equal(preview.direction, 'STORE_TO_COMPANY');
  assert.equal(preview.totalPayableAmount, '120.00');
  assert.equal(preview.items.length, 2);
});
