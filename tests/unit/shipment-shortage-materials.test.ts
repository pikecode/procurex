import assert from 'node:assert/strict';
import test from 'node:test';
import { SupplierOrdersService } from '../../apps/api/src/supplier-orders/supplier-orders.service.js';

test('first shipment rejects missing shortage materials including omitted product rows', async () => {
  const service = new SupplierOrdersService({ client: { supplierOrder: { findUniqueOrThrow: async () => ({
    items: [{ id: 'one', quantity: '5', shippedQuantity: '0', replenishmentGaps: [] }, { id: 'two', quantity: '3', shippedQuantity: '0', replenishmentGaps: [] }], shipments: []
  }) } } } as never);
  service.shipmentPreview = async () => ({ items: [{ orderItemId: 'one', remainingQuantityAfter: '0', gapAllocations: [] }] }) as never;
  await assert.rejects(service.createShipment('order', 1, {
    freight: '0', items: [{ orderItemId: 'one', shipQuantity: '5', permanentlyReduceQuantity: '0' }]
  }), /填写备注并上传发货凭证/);
  for (const materials of [{ note: '库存不足' }, { evidenceFileIds: ['proof'] }, { note: '   ', evidenceFileIds: ['proof'] }]) {
    await assert.rejects(service.createShipment('order', 1, {
      freight: '0', ...materials, items: [{ orderItemId: 'one', shipQuantity: '5', permanentlyReduceQuantity: '0' }]
    }), /填写备注并上传发货凭证/);
  }
});
