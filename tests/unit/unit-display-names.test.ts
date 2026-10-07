import assert from 'node:assert/strict';
import test from 'node:test';
import { displaySalesUnitName, readUnitDisplayNames, transactionUnitView } from '../../apps/api/src/catalog/transaction-units.js';
import { ShipmentsService } from '../../apps/api/src/shipments/shipments.service.js';

const snapshot = { salesUnitId: 'original-sales-unit', salesUnitName: 'Original bottle', purchaseUnitId: 'original-purchase-unit', purchaseUnitName: 'Original pack', salesUnitsPerPurchaseUnit: '12', inputUnitId: 'original-purchase-unit', inputQuantity: '2', productVersion: 1 };

test('display names resolve original transaction unit IDs without changing snapshots or prices', async () => {
  let reads = 0;
  const names = await readUnitDisplayNames({ unit: { findMany: async (query: { where: { id: { in: string[] } } }) => {
    reads++;
    assert.deepEqual(query.where.id.in, ['original-sales-unit', 'original-purchase-unit']);
    return [{ id: 'original-sales-unit', name: 'Renamed bottle' }];
  } } } as never, [snapshot, snapshot, null]);
  assert.equal(reads, 1);
  const view = transactionUnitView(snapshot, '2', '1', names);
  assert.equal(view.unitName, 'Renamed bottle');
  assert.deepEqual(view.unitSnapshot, snapshot);
  assert.equal(view.purchaseSalesUnitPrice, '24');
  assert.equal(view.purchaseSupplyUnitPrice, '12');
  assert.equal(view.unitSnapshot?.salesUnitName, 'Original bottle');
});

test('deleted units fall back to original names and legacy unknown units stay unknown', async () => {
  assert.equal(displaySalesUnitName(snapshot, new Map()), 'Original bottle');
  assert.equal(displaySalesUnitName(null, new Map()), null);
  assert.deepEqual(await readUnitDisplayNames({ unit: { findMany: () => { throw new Error('No lookup for unknown units'); } } } as never, [null]), new Map());
});

test('receipt details use the original unit identity instead of the current product unit', async () => {
  const service = new ShipmentsService({ client: {
    shipment: { findUnique: async () => ({ id: 'shipment', shipmentNo: 'S1', supplierOrderId: 'order', kind: 'NORMAL', shippedAt: new Date(), trackingNo: null,
      supplierOrder: { supplierOrderNo: 'O1', version: 1 }, receipts: [],
      items: [{ id: 'item', orderItemId: 'line', quantity: { toString: () => '24' }, salesPriceSnapshot: { toString: () => '2' }, supplyPriceSnapshot: { toString: () => '1' }, receiptItems: [],
        orderItem: { productId: 'product', unitSnapshot: snapshot, product: { name: 'Water', baseUnitId: 'new-sales-unit' } } }] }) },
    unit: { findMany: async () => [{ id: 'original-sales-unit', name: 'Renamed bottle' }] },
  } } as never);
  const view = await service.get('shipment');
  assert.equal(view.items[0]?.unitName, 'Renamed bottle');
  assert.equal(view.items[0]?.shippedQuantity, '24');
  assert.equal(snapshot.salesUnitName, 'Original bottle');
});
