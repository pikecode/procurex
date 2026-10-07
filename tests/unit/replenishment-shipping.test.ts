import assert from 'node:assert/strict';
import test from 'node:test';
import { SupplierOrdersService } from '../../apps/api/src/supplier-orders/supplier-orders.service.js';
import { remainingNormalShipmentQuantity } from '../../apps/api/src/supplier-orders/fulfillment-status.js';

test('historical replenishment shipments do not consume normal remaining quantities', () => {
  assert.equal(remainingNormalShipmentQuantity({ quantity: '6', shippedQuantity: '4', shipmentItems: [
    { permanentlyReduced: '1', gapAllocations: [] }, { permanentlyReduced: '0', gapAllocations: [{ quantity: '1' }] },
  ] }).toString(), '2');
  assert.equal(remainingNormalShipmentQuantity({ quantity: '0.5', shippedQuantity: '0.3', shipmentItems: [
    { permanentlyReduced: '0.1', gapAllocations: [{ quantity: '0.05' }] },
  ] }).toString(), '0.15');
});

test('gap-only and mixed shipment previews consume only non-gap quantities', async () => {
  const service = new SupplierOrdersService({ client: {
    supplierOrder: { findUnique: async () => ({ id: 'order', version: 2, status: 'PARTIAL_SHIPPED', items: [
      { id: 'item', productId: 'product', quantity: '6', shippedQuantity: '3', receivedQuantity: '2', salesUnitPrice: '4', supplyUnitPrice: '3', shipmentItems: [{ permanentlyReduced: '1' }] },
    ] }) }, replenishmentGap: { findMany: async () => [{ id: 'gap', orderItemId: 'item', status: 'PENDING', remainingQuantity: '1' }] },
  } } as never);
  const input = { freight: '0', items: [{ orderItemId: 'item', shipQuantity: '1', permanentlyReduceQuantity: '0', gapAllocations: [{ gapId: 'gap', quantity: '1' }] }] };
  assert.equal((await service.shipmentPreview('order', 2, input)).totals.remainingQuantity, '2');
  assert.equal((await service.shipmentPreview('order', 2, { ...input, items: [{ ...input.items[0]!, shipQuantity: '3' }] })).totals.remainingQuantity, '0');
});

function service() {
  return new SupplierOrdersService({ client: {
    supplierOrder: { findUnique: async () => ({ id: 'order', version: 2, status: 'SHIPPED', items: [
      { id: 'item', productId: 'product', quantity: '3', shippedQuantity: '3', receivedQuantity: '2', salesUnitPrice: '4', supplyUnitPrice: '3' },
    ] }) },
    replenishmentGap: { findMany: async () => [{ id: 'gap', orderItemId: 'item', status: 'PENDING', remainingQuantity: '1' }] },
  } } as never);
}

test('fully shipped order allows only gap-allocated replacement quantities', async () => {
  const input = { freight: '0', items: [{ orderItemId: 'item', shipQuantity: '1', permanentlyReduceQuantity: '0', gapAllocations: [{ gapId: 'gap', quantity: '1' }] }] };
  const preview = await service().shipmentPreview('order', 2, input);
  const item = input.items[0]!;
  assert.equal(preview.totals.shipQuantity, '1');
  assert.equal(preview.totals.remainingQuantity, '0');
  await assert.rejects(service().shipmentPreview('order', 2, { ...input, items: [{ ...item, gapAllocations: [] }] }));
  await assert.rejects(service().shipmentPreview('order', 2, { ...input, items: [{ ...item, shipQuantity: '2' }] }));
  await assert.rejects(service().shipmentPreview('order', 2, { ...input, items: [{ ...item, gapAllocations: [{ gapId: 'gap', quantity: '0.5' }, { gapId: 'gap', quantity: '0.5' }] }] }));
});
