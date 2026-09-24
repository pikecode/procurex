import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectStatementsService } from '../../apps/api/src/direct-statements/direct-statements.service.js';

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
            supplier: { defaultSettlementMode: 'SUPPLIER_TERM', defaultSettlementCycle: 'MONTHLY' },
            shipments: [{ freight: '5.00' }],
          }];
        },
      },
    },
  } as any);

  const [statement] = await service.list({ storeId: 'store-1' });
  assert.equal(query.where.supplier.defaultSettlementMode, 'SUPPLIER_TERM');
  assert.equal(statement?.type, 'DIRECT');
  assert.equal(statement?.goodsAmount, '120.00');
  assert.equal(statement?.freightAmount, '5.00');
  assert.equal(statement?.totalAmount, '125.00');
  assert.equal(statement?.lineCount, 1);
});
