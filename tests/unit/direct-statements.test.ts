import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectStatementsService } from '../../apps/api/src/direct-statements/direct-statements.service.js';
import { SupplierStatementsService } from '../../apps/api/src/supplier-statements/supplier-statements.service.js';

test('direct statements group completed supplier-term orders and include freight', async () => {
  let query: any;
  const service = new DirectStatementsService({
    client: {
      supplierOrder: {
        findMany: async (value: any) => {
          query = value;
          return [{
            id: 'order-1', supplierOrderNo: 'SO-1', storeId: 'store-1', supplierId: 'supplier-1', version: 3,
            salesGoodsAmount: '120.00', firstShippedAt: new Date('2026-09-10T00:00:00.000Z'),
            settlementMode: 'SUPPLIER_TERM', settlementCycleSnapshot: 'MONTHLY',
            shipments: [{ freight: '5.00' }],
          }];
        },
      },
    },
  } as any);

  const [statement] = await service.list({ storeId: 'store-1' });
  assert.equal(query.where.settlementMode, 'SUPPLIER_TERM');
  assert.equal(statement?.type, 'DIRECT');
  assert.equal(statement?.goodsAmount, '120.00');
  assert.equal(statement?.freightAmount, '5.00');
  assert.equal(statement?.totalAmount, '125.00');
  assert.equal(statement?.lineCount, 1);
});

test('supplier statements use the order cycle snapshot after supplier settings change', async () => {
  const service = new SupplierStatementsService({
    client: {
      supplierOrder: {
        findMany: async () => [{
          id: 'order-1', supplierOrderNo: 'SO-1', storeId: 'store-1', supplierId: 'supplier-1', version: 1,
          supplyGoodsAmount: '80.00', firstShippedAt: new Date('2026-09-10T00:00:00.000Z'),
          settlementCycleSnapshot: 'MONTHLY',
          supplier: { defaultSettlementCycle: 'WEEKLY' }, shipments: [], priceChangeRuns: [],
        }],
      },
    },
  } as any);

  const [statement] = await service.list({ supplierId: 'supplier-1' });
  assert.equal(statement?.cycle, 'MONTHLY');
});

test('statement status becomes settled only after confirmed allocations cover the amount', async () => {
  const settlementItemId = Buffer.from(JSON.stringify({ kind: 'DIRECT', supplierOrderId: 'order-1' })).toString('base64url');
  const service = new DirectStatementsService({
    client: {
      supplierOrder: { findMany: async () => [{
        id: 'order-1', supplierOrderNo: 'SO-1', storeId: 'store-1', supplierId: 'supplier-1', version: 1,
        salesGoodsAmount: '120.00', firstShippedAt: new Date('2026-09-10T00:00:00.000Z'), settlementMode: 'SUPPLIER_TERM', settlementCycleSnapshot: 'MONTHLY', shipments: [],
      }] },
      paymentAllocation: { findMany: async () => [{ settlementItemId, state: 'CONFIRMED', amount: '120.00' }] },
    },
  } as any);
  const [statement] = await service.list({ settlementStatus: 'SETTLED' });
  assert.equal(statement?.settlementStatus, 'SETTLED');
  assert.equal((await service.get(statement!.id)).settlementStatus, 'SETTLED');
});

test('direct statements expose persisted adjustment amounts in their actual period', async () => {
  const service = new DirectStatementsService({
    client: {
      supplierOrder: { findMany: async () => [] },
      adjustmentDocument: { findMany: async () => [{
        storeId: 'store-1', supplierId: 'supplier-1', side: 'STORE', amount: '20.00', settlementPeriodKey: 'MONTHLY:2026-09-01:2026-10-01',
      }] },
    },
  } as any);
  const [statement] = await service.list({ storeId: 'store-1', supplierId: 'supplier-1' });
  assert.equal(statement?.periodStart, '2026-09-01');
  assert.equal(statement?.adjustmentAmount, '20.00');
  assert.equal(statement?.totalAmount, '0.00');
});

test('direct statement payment totals include positive adjustment settlement items', async () => {
  const adjustmentSettlementItemId = Buffer.from(JSON.stringify({ kind: 'ADJUSTMENT', supplierOrderId: 'order-1', adjustmentDocumentId: 'adjustment-1', adjustmentSide: 'STORE' })).toString('base64url');
  const service = new DirectStatementsService({
    client: {
      supplierOrder: { findMany: async () => [] },
      adjustmentDocument: { findMany: async () => [{ id: 'adjustment-1', supplierOrderId: 'order-1', storeId: 'store-1', supplierId: 'supplier-1', side: 'STORE', amount: '20.00', settlementPeriodKey: 'MONTHLY:2026-09-01:2026-10-01' }] },
      paymentAllocation: { findMany: async () => [{ settlementItemId: adjustmentSettlementItemId, state: 'CONFIRMED', amount: '20.00' }] },
    },
  } as any);
  const [statement] = await service.list({ storeId: 'store-1', supplierId: 'supplier-1' });
  assert.equal(statement?.confirmedPaidAmount, '20.00');
  assert.equal(statement?.payableAmount, '0.00');
  assert.equal(statement?.settlementStatus, 'SETTLED');
});
