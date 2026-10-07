import assert from 'node:assert/strict';
import test from 'node:test';
import { ReportsService } from '../../apps/api/src/reports/reports.service.js';
import { BadRequestException } from '@nestjs/common';
import { ReportsController } from '../../apps/api/src/reports/reports.controller.js';
import { AdjustmentsController } from '../../apps/api/src/adjustments/adjustments.controller.js';
import { ForbiddenException } from '@nestjs/common';

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
  assert.equal(queries[0].where.completedAt.not, null);

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

test('supplier order reports use supply amounts and preserve freight rather than revealing sales', async () => {
  const service = new ReportsService({ client: { supplierOrder: { findMany: async () => [{ id: 'order', storeId: 'store', supplierId: 'supplier',
    completedAt: new Date('2026-09-10'), shipments: [{ freight: '5' }], items: [{ receivedQuantity: '10', salesUnitPrice: '12', supplyUnitPrice: '9' }] }] } } } as any);
  const result = await service.orderAmounts({ amountBasis: 'SUPPLY' });
  assert.equal(result.amountBasis, 'SUPPLY'); assert.equal(result.orders[0]!.goodsAmount, '90.00'); assert.equal(result.orders[0]!.totalAmount, '95.00');
  assert.equal(result.months[0]!.totalAmount, '95.00'); assert.doesNotMatch(result.metric, /sales/);
});

test('old supplier sales exports remain unavailable even when saved and current scopes match', async () => {
  const scope = { type: 'SUPPLIER', supplierId: 'supplier' };
  const row = { reportType: 'order-amounts', permissionScope: scope, filters: {}, status: 'READY', csvContent: 'sales-private', expiresAt: new Date(Date.now() + 60000) };
  const service = new ReportsService({ client: { exportJob: { findFirst: async () => row } } } as any);
  assert.equal(await service.exportContent('job', 'user', ['SUPPLIER'], scope), null);
  assert.equal(await service.exportStatus('job', 'user', ['SUPPLIER'], scope), null);
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

test('export list only returns current user jobs in the current saved scope', async () => {
  const rows = [
    { id: 'visible', reportType: 'order-amounts', permissionScope: { type: 'STORE', storeId: 'store-1' }, expiresAt: new Date(Date.now() + 60000), status: 'READY', createdAt: new Date('2026-09-27T00:00:00.000Z'), errorMessage: null },
    { id: 'hidden-scope', reportType: 'order-amounts', permissionScope: { type: 'STORE', storeId: 'store-2' }, expiresAt: new Date(Date.now() + 60000), status: 'READY', createdAt: new Date('2026-09-27T00:00:00.000Z'), errorMessage: null },
    { id: 'hidden-profit', reportType: 'profit', permissionScope: { type: 'STORE', storeId: 'store-1' }, expiresAt: new Date(Date.now() + 60000), status: 'READY', createdAt: new Date('2026-09-27T00:00:00.000Z'), errorMessage: null },
  ];
  const service = new ReportsService({ client: { exportJob: { findMany: async () => rows } } } as any);
  const jobs = await service.listExports('user', ['STORE'], { type: 'STORE', storeId: 'store-1' });
  assert.deepEqual(jobs.map((job) => job.jobId), ['visible']);
});

test('export worker claims queued jobs once', async () => {
  const updates: any[] = [];
  const service = new ReportsService({ client: { exportJob: {
    findMany: async () => [{ id: 'job', status: 'QUEUED', reportType: 'order-amounts', filters: {}, expiresAt: new Date(Date.now() + 60000), createdAt: new Date() }],
    updateMany: async (query: any) => { updates.push(query); return { count: 1 }; },
    update: async () => ({}),
  } } } as any);
  await (service as any).processQueuedExports();
  assert.equal(updates[0].where.status, 'QUEUED');
});

test('export worker retries stale processing jobs', async () => {
  const updates: any[] = [];
  const service = new ReportsService({ client: { exportJob: {
    findMany: async (query: any) => {
      assert.equal(query.where.OR[1].status, 'PROCESSING');
      assert.ok(query.where.OR[1].createdAt.lte instanceof Date);
      return [{ id: 'stale-job', status: 'PROCESSING', reportType: 'order-amounts', filters: {}, expiresAt: new Date(Date.now() + 60000), createdAt: new Date(Date.now() - 11 * 60 * 1000) }];
    },
    updateMany: async (query: any) => { updates.push(query); return { count: 1 }; },
    update: async () => ({}),
  } } } as any);
  await (service as any).processQueuedExports();
  assert.equal(updates[0].where.status, 'PROCESSING');
  assert.ok(updates[0].where.createdAt.lte instanceof Date);
  assert.equal(updates[0].data.errorMessage, null);
});

test('export expiration closes processing jobs', async () => {
  let updateQuery: any;
  const service = new ReportsService({ client: { exportJob: {
    updateMany: async (query: any) => { updateQuery = query; return { count: 1 }; },
  } } } as any);
  await (service as any).expireExports();
  assert.ok(updateQuery.where.status.in.includes('PROCESSING'));
  assert.equal(updateQuery.data.status, 'FAILED');
  assert.equal(updateQuery.data.csvContent, null);
});

test('export health reports stale processing jobs and recent failures', async () => {
  const now = Date.now();
  const service = new ReportsService({ client: { exportJob: {
    findMany: async (query: any) => {
      assert.equal(query.take, 200);
      assert.equal(query.where.OR[1].status, 'FAILED');
      return [
        { id: 'stale', status: 'PROCESSING', reportType: 'profit', createdAt: new Date(now - 11 * 60 * 1000), expiresAt: new Date(now + 60000), errorMessage: 'interrupted' },
        { id: 'ready', status: 'READY', reportType: 'order-amounts', createdAt: new Date(now - 1000), expiresAt: new Date(now + 60000), errorMessage: null },
        { id: 'failed', status: 'FAILED', reportType: 'product-quantities', createdAt: new Date(now - 2000), expiresAt: new Date(now + 60000), errorMessage: 'boom' },
      ];
    },
  } } } as any);
  const health = await service.exportHealth();
  assert.equal(health.leaseMinutes, 10);
  assert.equal(health.byStatus.find((row) => row.status === 'PROCESSING')?.count, 1);
  assert.deepEqual(health.staleProcessing.map((job) => job.jobId), ['stale']);
  assert.deepEqual(health.recentFailures.map((job) => job.jobId), ['failed']);
});

test('failed exports can be retried in the saved scope only', async () => {
  const updates: any[] = [];
  const row = { id: 'failed', requestedById: 'user', reportType: 'order-amounts', permissionScope: { type: 'STORE', storeId: 'store-1' }, expiresAt: new Date(Date.now() + 60000), status: 'FAILED', createdAt: new Date('2026-09-27T00:00:00.000Z'), errorMessage: 'boom' };
  const service = new ReportsService({ client: { exportJob: {
    findFirst: async () => row,
    findMany: async () => [],
    updateMany: async (query: any) => { updates.push(query); return { count: 1 }; },
  } } } as any);
  const wrongScope = await service.retryExport('failed', 'user', ['STORE'], { type: 'STORE', storeId: 'store-2' });
  assert.equal(wrongScope, null);
  const retry = await service.retryExport('failed', 'user', ['STORE'], { type: 'STORE', storeId: 'store-1' });
  assert.equal(retry?.retryable, true);
  assert.equal((retry as any).job.status, 'QUEUED');
  assert.equal(updates[0].where.status, 'FAILED');
  assert.deepEqual(updates[0].data, { status: 'QUEUED', csvContent: null, errorMessage: null });
});

test('ready exports are not retryable', async () => {
  const service = new ReportsService({ client: { exportJob: {
    findFirst: async () => ({ id: 'ready', requestedById: 'user', reportType: 'order-amounts', permissionScope: {}, expiresAt: new Date(Date.now() + 60000), status: 'READY', createdAt: new Date(), errorMessage: null }),
  } } } as any);
  const retry = await service.retryExport('ready', 'user', ['ADMIN'], undefined);
  assert.equal(retry?.retryable, false);
  assert.equal(retry?.status, 'READY');
});

test('adjustment queries cannot cross a bound account scope', async () => {
  const controller = new AdjustmentsController({ list: async () => [] } as any);
  const request = { auth: { user: { scope: { type: 'STORE', storeId: '00000000-0000-4000-8000-000000000001' } } } } as any;
  assert.throws(() => controller.list({ storeId: '00000000-0000-4000-8000-000000000002' }, request), ForbiddenException);
});
