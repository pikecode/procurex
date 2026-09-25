import assert from 'node:assert/strict';
import test from 'node:test';
import { ReportsService } from '../../apps/api/src/reports/reports.service.js';
import { BadRequestException } from '@nestjs/common';
import { ReportsController } from '../../apps/api/src/reports/reports.controller.js';

test('reports use final received quantities, split freight, and exclude direct orders from profit', async () => {
  const queries: any[] = [];
  const orders = [{
    id: 'order-1', storeId: 'store-1', supplierId: 'supplier-1', status: 'COMPLETED', settlementMode: 'COMPANY_TERM',
    completedAt: new Date('2026-09-10T12:00:00.000Z'), firstShippedAt: new Date('2026-09-09T12:00:00.000Z'),
    salesGoodsAmount: '96.00', supplyGoodsAmount: '72.00',
    shipments: [{ freight: '5.00' }],
    items: [{ productId: 'product-1', receivedQuantity: '8', salesUnitPrice: '12', supplyUnitPrice: '9', product: { name: 'Rice', baseUnit: { name: 'kg' } } }],
  }];
  const service = new ReportsService({ client: { supplierOrder: { findMany: async (query: any) => { queries.push(query); return orders; } } } } as any);

  const amounts = await service.orderAmounts({ from: '2026-09-01', to: '2026-09-30' });
  assert.equal(amounts.dateBasis, 'completedAt');
  assert.deepEqual(amounts.months[0], { month: '2026-09', orderCount: 1, goodsAmount: '96.00', freightAmount: '5.00', totalAmount: '101.00' });

  const quantities = await service.productQuantities({ from: '2026-09-01', to: '2026-09-30' });
  assert.equal(quantities.products[0]?.quantity, '8.000000');

  const profit = await service.profit({ from: '2026-09-01', to: '2026-09-30' });
  assert.equal(profit.totals.salesGoodsAmount, '96.00');
  assert.equal(profit.totals.supplyGoodsAmount, '72.00');
  assert.equal(profit.totals.profit, '24.00');
  assert.equal(profit.totals.freightAmount, '5.00');
  assert.equal(queries[2]?.where.settlementMode.not, 'SUPPLIER_TERM');
  assert.equal(queries[2]?.where.firstShippedAt.gte.toISOString(), '2026-08-31T16:00:00.000Z');
});

test('report filters reject impossible dates and product quantity ranges beyond three months', () => {
  const controller = new ReportsController({} as any);
  const request = { auth: { user: { roles: ['PURCHASER'] } } } as any;
  assert.throws(() => controller.orderAmounts({ from: '2026-02-31', to: '2026-03-01' }, request), BadRequestException);
  assert.throws(() => controller.productQuantities({ from: '2026-01-01', to: '2026-05-01' }, request), BadRequestException);
});

test('export status and downloads recheck current report role and saved scope', async () => {
  const row = { id: 'job', requestedById: 'user', reportType: 'profit', permissionScope: { type: 'COMPANY' }, expiresAt: new Date(Date.now() + 60000), status: 'READY', csvContent: 'private' };
  const service = new ReportsService({ client: { exportJob: { findFirst: async () => row } } } as any);
  assert.equal(await service.exportStatus('job', 'user', ['STORE'], { type: 'STORE', storeId: 'store' }), null);
  assert.equal(await service.exportContent('job', 'user', ['PURCHASER'], { type: 'STORE', storeId: 'store' }), null);
  assert.equal(await service.exportContent('job', 'user', ['PURCHASER'], { type: 'COMPANY' }), 'private');
});
