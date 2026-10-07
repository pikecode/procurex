import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { PaymentRecordsService } from '../../apps/api/src/payment-records/payment-records.service.js';

for (const legacy of [false, true]) for (const extraState of ['MISSING', 'RESERVED', 'CONFIRMED']) {
  test(`company positive adjustment uses frozen base plus extra once; ${legacy ? 'legacy' : 'statement'} collection ${extraState}`, async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const baseId = encode({ kind: 'STORE_RECEIVABLE', supplierOrderId: 'order' });
    const storeId = encode(legacy ? { kind: 'ADJUSTMENT', adjustmentDocumentId: 'store-extra', supplierOrderId: 'order', adjustmentSide: 'STORE' }
      : { kind: 'ADJUSTMENT', supplierOrderId: 'order', adjustmentDocumentId: 'store-extra', adjustmentSide: 'STORE' });
    const supplierId = encode({ kind: 'ADJUSTMENT', adjustmentDocumentId: 'supplier-extra', supplierOrderId: 'order', adjustmentSide: 'SUPPLIER' });
    const documents = [
      { id: 'store-extra', supplierOrderId: 'order', side: 'STORE', amount: new Decimal('3.50'), sourceRevision: 8 },
      { id: 'supplier-extra', supplierOrderId: 'order', side: 'SUPPLIER', amount: new Decimal('3.50'), sourceRevision: 8 },
    ];
    const snapshots = [{ settlementItemId: baseId, totalAmount: new Decimal(25), goodsAmount: new Decimal(25), freightAmount: new Decimal(0), sourceVersion: 3 }];
    const client = {
      supplierOrder: { findMany: async () => [{ id: 'order', storeId: 'store', supplierId: 'supplier', supplierOrderNo: 'SO', status: 'COMPLETED',
        firstShippedAt: new Date(), settlementMode: 'COMPANY_TERM', salesGoodsAmount: '25', supplyGoodsAmount: '20', version: 8,
        request: { shortfallAmount: '0' }, shipments: [{ freight: '3.50' }] }] },
      settlementItemSnapshot: { findMany: async (query: { where: { settlementItemId: { in: string[] } } }) => snapshots.filter(row => query.where.settlementItemId.in.includes(row.settlementItemId)) },
      adjustmentDocument: { findMany: async (query: { where: { side?: string; id?: { in: string[] } } }) => documents.filter(row => query.where.side ? row.side === query.where.side : query.where.id!.in.includes(row.id)) },
      paymentAllocation: { findMany: async () => [
        { settlementItemId: baseId, state: 'CONFIRMED', amount: new Decimal(25) },
        ...(extraState === 'MISSING' ? [] : [{ settlementItemId: storeId, state: extraState, amount: new Decimal('3.50') }]),
      ] },
      differenceDisposalItem: { findMany: async () => [] },
    };
    const service = new PaymentRecordsService({ client } as never);
    if (extraState === 'CONFIRMED') {
      const quote = await service.preview([supplierId]);
      assert.equal(quote.totalPayableAmount, '3.50'); assert.deepEqual(quote.blockedItems, []);
    } else {
      await assert.rejects(service.preview([supplierId]), (error: any) => error.getResponse().details.blockedItems[0].code === 'STORE_RECEIVABLE_UNSETTLED');
    }
  });
}
