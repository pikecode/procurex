import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { createReductionDocuments, createFrozenFreightDocuments } from '../../apps/api/src/supplier-orders/reduction-adjustments.js';
import { SupplierOrdersService } from '../../apps/api/src/supplier-orders/supplier-orders.service.js';

test('one shipment aggregates multiple reduced products once per frozen side', async () => {
  const documents: any[] = [];
  await createReductionDocuments({
    settlementItemSnapshot: { findMany: async () => [{ kind: 'STORE_RECEIVABLE' }, { kind: 'SUPPLIER_PAYABLE' }] },
    adjustmentDocument: { create: async ({ data }: any) => { documents.push(data); } },
  } as never, {
    order: { id: 'order', storeId: 'store', supplierId: 'supplier', settlementMode: 'COMPANY_TERM', settlementCycleSnapshot: 'MONTHLY', version: 4 } as never,
    shipmentId: 'shipment', baseline: new Date('2026-08-20'),
    lines: [1, 2].map(index => ({ itemId: `item-${index}`, quantity: new Decimal(index), salesChange: new Decimal(-12 * index), supplyChange: new Decimal(-9 * index), salesPrice: new Decimal(12), supplyPrice: new Decimal(9) })),
  });
  assert.deepEqual(documents.map(document => [document.side, document.amount.toFixed(2)]), [['STORE', '-36.00'], ['SUPPLIER', '-27.00']]);
  assert.ok(documents.every(document => document.sourceShipmentId === 'shipment' && document.items.create.length === 2));
  assert.equal(documents[0].originalPeriodKey, 'MONTHLY:2026-08-01:2026-09-01');
  assert.equal(documents[0].items.create[1].quantitySnapshot.toString(), '2');
});

test('new freight creates only frozen-side documents without a goods reduction', async () => {
  const documents: any[] = [];
  const tx = {
    settlementItemSnapshot: { findMany: async () => [{ kind: 'SUPPLIER_PAYABLE' }] },
    adjustmentDocument: { create: async ({ data }: any) => { documents.push(data); } },
  };
  const input = { order: { id: 'order', storeId: 'store', supplierId: 'supplier', settlementMode: 'CREDIT', settlementCycleSnapshot: 'MONTHLY', version: 4 } as never,
    shipmentId: 'shipment', baseline: new Date('2026-08-20'), freight: new Decimal(35) };
  await createFrozenFreightDocuments(tx as never, input);
  assert.equal(documents.length, 1);
  assert.deepEqual([documents[0].side, documents[0].shipmentAdjustmentKind, documents[0].amount.toFixed(2)], ['SUPPLIER', 'FREIGHT', '35.00']);
  await createFrozenFreightDocuments(tx as never, { ...input, freight: new Decimal(0) });
  assert.equal(documents.length, 1);
  await createFrozenFreightDocuments({ ...tx, settlementItemSnapshot: { findMany: async () => [] } } as never, input);
  assert.equal(documents.length, 1);
});

test('later shipments cannot reuse permanently reduced quantities', async () => {
  const service = new SupplierOrdersService({ client: { supplierOrder: { findUnique: async () => ({
    id: 'order', version: 3, supplier: { deliveryMode: 'SELF' }, status: 'PARTIAL_SHIPPED', items: [{ id: 'item', productId: 'product', quantity: '10', shippedQuantity: '4', receivedQuantity: '4', salesUnitPrice: '12', supplyUnitPrice: '9', shipmentItems: [{ permanentlyReduced: '2' }] }],
  }) } } } as never);
  const preview = await service.shipmentPreview('order', 3, { freight: '0', items: [{ orderItemId: 'item', shipQuantity: '3', permanentlyReduceQuantity: '1' }] });
  assert.equal(preview.items[0]!.remainingQuantityBefore, '4');
  assert.equal(preview.items[0]!.remainingQuantityAfter, '0');
  await assert.rejects(service.shipmentPreview('order', 3, { freight: '0', items: [{ orderItemId: 'item', shipQuantity: '4', permanentlyReduceQuantity: '1' }] }),
    (error: any) => error.getResponse().code === 'INVALID_SHIPMENT_QUANTITY');
});
