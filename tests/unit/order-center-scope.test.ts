import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { SupplierOrdersController } from '../../apps/api/src/supplier-orders/supplier-orders.controller.js';
import { SupplierOrdersService } from '../../apps/api/src/supplier-orders/supplier-orders.service.js';
import { REQUIRED_ROLES_METADATA } from '../../apps/api/src/auth/roles.decorator.js';
import { StorePricePrivacyInterceptor, storePriceView } from '../../apps/api/src/common/store-price-privacy.interceptor.js';

const storeId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const auth = (role: string, scope = { type: 'STORE', storeId }) => ({ auth: { user: { roles: [role], scope } } }) as never;

test('formal order reads explicitly allow both store roles and retain store price privacy', () => {
  for (const name of ['list', 'get'] as const) for (const role of ['STORE', 'STORE_FINANCE']) {
    assert.ok(Reflect.getMetadata(REQUIRED_ROLES_METADATA, SupplierOrdersController.prototype[name]).includes(role));
  }
  assert.ok(Reflect.getMetadata('__interceptors__', SupplierOrdersController).includes(StorePricePrivacyInterceptor));
  for (const method of ['createShipment', 'shipmentPreview', 'reviseShipment'] as const) {
    const roles = Reflect.getMetadata(REQUIRED_ROLES_METADATA, SupplierOrdersController.prototype[method]);
    assert.equal(roles.includes('STORE'), false);
    assert.equal(roles.includes('STORE_FINANCE'), false);
  }
  assert.deepEqual(storePriceView({ requestNo: 'PR1', supplierOrderNo: 'SO1', salesGoodsAmount: '20', supplyGoodsAmount: '10', items: [{ salesUnitPrice: '20', supplyUnitPrice: '10' }] }),
    { requestNo: 'PR1', supplierOrderNo: 'SO1', salesGoodsAmount: '20', items: [{ salesUnitPrice: '20' }] });
});

test('store order list forces own store and rejects cross-store query; company reads stay broad', async () => {
  let input: unknown;
  const controller = new SupplierOrdersController({ list: async (value: unknown) => { input = value; return []; } } as never, {} as never, {} as never, {} as never);
  for (const role of ['STORE', 'STORE_FINANCE']) {
    await controller.list(auth(role), {});
    assert.equal((input as { storeId: string }).storeId, storeId);
    assert.throws(() => controller.list(auth(role), { storeId: otherId }), ForbiddenException);
  }
  await controller.list(auth('PURCHASER', { type: 'COMPANY', storeId: '' }), {});
  assert.equal((input as { storeId?: string }).storeId, undefined);
});

test('store detail passes scope and database query cannot read another store order', async () => {
  let where: unknown;
  const service = new SupplierOrdersService({ client: { supplierOrder: { findUnique: async (query: { where: unknown }) => { where = query.where; return null; } } } } as never);
  const controller = new SupplierOrdersController(service, {} as never, {} as never, {} as never);
  for (const role of ['STORE', 'STORE_FINANCE']) {
    await assert.rejects(controller.get(auth(role), otherId), /Supplier order was not found/);
    assert.equal((where as { storeId: string }).storeId, storeId);
  }
});
