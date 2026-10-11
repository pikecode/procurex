import assert from 'node:assert/strict';
import test from 'node:test';
import { ShipmentsService } from '../../apps/api/src/shipments/shipments.service.js';

test('shipment detail uses assigned stores in its parent order query', async () => {
  let where: unknown;
  const service = new ShipmentsService({ client: {
    shipment: { findUnique: async (query: { where: unknown }) => { where = query.where; return null; } },
  } } as never);
  await assert.rejects(service.get('shipment', { type: 'MULTI_STORE', storeIds: ['store-a', 'store-b'] }), { status: 404 });
  assert.deepEqual(where, { id: 'shipment', supplierOrder: { storeId: { in: ['store-a', 'store-b'] } } });
  where = undefined;
  await assert.rejects(service.get('shipment', { type: 'MULTI_STORE', storeIds: [] }), { status: 403 });
  assert.equal(where, undefined);
});
