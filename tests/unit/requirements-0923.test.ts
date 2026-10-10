import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpException } from '@nestjs/common';
import { resolveSettlementTerms } from '../../apps/api/src/purchase-requests/request-funding.js';
import { SupplierOrdersService } from '../../apps/api/src/supplier-orders/supplier-orders.service.js';
import { StoresController } from '../../apps/api/src/stores/stores.controller.js';

test('supplier settlement terms ignore legacy template overrides', async () => {
  const client = { supplier: { findMany: async () => [{ id: 'supplier', defaultSettlementMode: 'CREDIT', defaultSettlementCycle: 'MONTHLY' }] },
    templateSupplierSetting: { findMany: async () => { throw new Error('Legacy overrides must not be read'); } } };
  const terms = await resolveSettlementTerms(client as never, 'template', ['supplier']);
  assert.deepEqual(terms.get('supplier'), { mode: 'CREDIT', cycle: 'IMMEDIATE' });
});

test('shipment delivery defaults to supplier and rejects self-delivery tracking', async () => {
  const service = new SupplierOrdersService({ client: { supplierOrder: { findUnique: async () => ({
    id: 'order', version: 1, status: 'PUSHED', supplier: { deliveryMode: 'LOGISTICS' },
    items: [{ id: 'item', productId: 'product', quantity: '1', shippedQuantity: '0', receivedQuantity: '0', salesUnitPrice: '2', supplyUnitPrice: '1', shipmentItems: [] }],
  }) } } } as never);
  const input = { freight: '0', items: [{ orderItemId: 'item', shipQuantity: '1', permanentlyReduceQuantity: '0' }] };
  assert.equal((await service.shipmentPreview('order', 1, input)).deliveryMode, 'LOGISTICS');
  assert.equal((await service.shipmentPreview('order', 1, { ...input, deliveryMode: 'SELF' })).deliveryMode, 'SELF');
  await assert.rejects(service.shipmentPreview('order', 1, { ...input, deliveryMode: 'SELF', trackingNo: '123' }), HttpException);
});

test('recharge and clearing reject missing image evidence before commands or funds', async () => {
  const controller = new StoresController({} as never, {} as never, {} as never);
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const request = { headers: {}, auth: { user: { id, roles: ['HQ_FINANCE'] } } } as never;
  const auth = { user: { id, roles: ['HQ_FINANCE'] } } as never;
  for (const evidenceFileIds of [undefined, [], [id, id], ['invalid']]) {
    await assert.rejects(controller.createRecharge(request, auth, id, { amount: '10.00', businessDate: '2026-10-09', collectionAccountId: 'bank', evidenceFileIds }), HttpException);
    await assert.rejects(controller.createClearing(request, auth, id, { businessDate: '2026-10-09', items: [{ fundingAllocationId: id, expectedVersion: 1, expectedAmount: '10.00' }], evidenceFileIds }), HttpException);
  }
});
