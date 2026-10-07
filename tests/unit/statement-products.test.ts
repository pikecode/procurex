import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { NotFoundException } from '@nestjs/common';
import { enrichStatementLines } from '../../apps/api/src/supplier-statements/statement-order-details.js';
import { SupplierStatementsService } from '../../apps/api/src/supplier-statements/supplier-statements.service.js';
import { SupplierStoreStatementsService } from '../../apps/api/src/supplier-store-statements/supplier-store-statements.service.js';

test('statement product details use effective quantities and preserve frozen header differences', async () => {
  let ids: string[] = [];
  const [line] = await enrichStatementLines({ supplierOrder: { findMany: async (query: { where: { id: { in: string[] } } }) => {
    ids = query.where.id.in;
    return [{ id: 'order', store: { name: 'Hotel' }, items: [{ id: 'item', productId: 'product',
      product: { sku: 'SKU', name: 'Water', specification: '500 mL', baseUnit: { name: 'bottle' } },
      unitSnapshot: null, salesUnitPrice: new Decimal(12), quantity: new Decimal(10), receivedQuantity: new Decimal(7), supplyUnitPrice: new Decimal(9), supplyLineAmount: new Decimal(63),
      shipmentItems: [{ permanentlyReduced: new Decimal(1) }], discrepancies: [
        { status: 'RESOLVED', missingQuantity: new Decimal(2), returnRecord: null },
        { status: 'RESOLVED', missingQuantity: new Decimal(1), returnRecord: { id: 'return' } },
      ] }] }];
  } } } as never, [{ supplierOrderId: 'order', goodsAmount: '80.00', amountBasis: 'FROZEN' }]);
  assert.deepEqual(ids, ['order']); assert.equal(line!.storeName, 'Hotel');
  assert.equal(line!.products[0]!.orderedQuantity, '10.000000');
  assert.equal(line!.products[0]!.effectiveQuantity, '7.000000');
  assert.equal(line!.products[0]!.supplyUnitPrice, '9.000000');
  assert.equal(line!.products[0]!.unitBasis, 'LEGACY_UNKNOWN');
  assert.equal(line!.productGoodsAmount, '63.00'); assert.equal(line!.goodsReconciliationAmount, '17.00');
  assert.equal(line!.goodsAmount, '80.00'); assert.equal(line!.productAmountBasis, 'CURRENT_ORDER');
  assert.ok(!('salesUnitPrice' in line!.products[0]!));
});

test('empty statement lines do not query orders', async () => {
  const result = await enrichStatementLines({ supplierOrder: { findMany: () => { throw new Error('Should not query'); } } } as never, []);
  assert.deepEqual(result, []);
});

test('statement unit rename uses transaction identity without changing frozen totals', async () => {
  const unitSnapshot = { salesUnitId: 'old-unit-id', salesUnitName: 'bottle', purchaseUnitId: null };
  const [line] = await enrichStatementLines({
    supplierOrder: { findMany: async () => [{ id: 'order', store: { name: 'Hotel' }, items: [{ id: 'item', productId: 'product', unitSnapshot,
      product: { sku: 'SKU', name: 'Water', specification: null, baseUnit: { name: 'different-current-unit' } },
      quantity: new Decimal(10), receivedQuantity: new Decimal(7), supplyUnitPrice: new Decimal(9), supplyLineAmount: new Decimal(63), shipmentItems: [], discrepancies: [],
    }] }] },
    unit: { findMany: async () => [{ id: 'old-unit-id', name: 'bottle renamed' }] },
  } as never, [{ supplierOrderId: 'order', goodsAmount: '80.00' }]);
  assert.equal(line!.products[0]!.unitName, 'bottle renamed');
  assert.equal(line!.goodsAmount, '80.00');
  assert.equal(line!.products[0]!.supplyLineAmount, '63.00');
  assert.equal(line!.goodsReconciliationAmount, '17.00');
  assert.equal(unitSnapshot.salesUnitName, 'bottle');
});

test('supplier statement services reject malformed identities and foreign or empty scopes before querying', async () => {
  const supplierId = '11111111-1111-4111-8111-111111111111', storeId = '22222222-2222-4222-8222-222222222222';
  const client = { supplierOrder: { findMany: () => { throw new Error('Unauthorized query'); } } };
  for (const Service of [SupplierStatementsService, SupplierStoreStatementsService]) {
    const service = new Service({ client } as never);
    const encode = (supplierId: string) => Buffer.from(JSON.stringify({ supplierId, storeId, cycle: 'MONTHLY', periodStart: '2026-10-01', periodEndExclusive: '2026-11-01' })).toString('base64url');
    for (const scope of [{ type: 'SUPPLIER' }, { type: 'SUPPLIER', supplierId: storeId }]) {
      await assert.rejects(service.get(encode(supplierId), scope), (error: unknown) => error instanceof NotFoundException);
    }
    await assert.rejects(service.get(encode('not-a-uuid')), (error: unknown) => error instanceof NotFoundException);
    await assert.rejects(service.get('invalid-json'), (error: unknown) => error instanceof NotFoundException);
  }
});

test('adjustment-only store statements retain names, source identities and parent linkage', async () => {
  const supplierId = '11111111-1111-4111-8111-111111111111', storeId = '22222222-2222-4222-8222-222222222222';
  const service = new SupplierStoreStatementsService({ client: {
    supplierOrder: { findMany: async (query: { select?: unknown }) => query.select ? [{ id: 'order', settlementMode: 'COMPANY_TERM' }] : [] },
    store: { findMany: async () => [{ id: storeId, name: 'Adjustment hotel' }] },
    adjustmentDocument: { findMany: async () => [{ id: 'document', supplierOrderId: 'order', storeId, supplierId,
      sourcePriceChangeId: 'change', amount: new Decimal(20), settlementPeriodKey: 'MONTHLY:2026-10-01:2026-11-01' }] },
  } } as never);
  const [summary] = await service.list({ supplierId });
  assert.equal(summary!.storeName, 'Adjustment hotel'); assert.equal(summary!.goodsAmount, '0.00');
  assert.equal(summary!.adjustmentAmount, '20.00'); assert.equal(summary!.payableAmount, '20.00');
  assert.equal(summary!.lineCount, 0); assert.equal(summary!.adjustmentItems[0]!.supplierOrderId, 'order');
  assert.equal(JSON.parse(Buffer.from(summary!.adjustmentItems[0]!.adjustmentId!, 'base64url').toString()).kind, 'PRICE_DOCUMENT');
  const parent = JSON.parse(Buffer.from(summary!.parentStatementId, 'base64url').toString());
  assert.equal(parent.supplierId, supplierId); assert.ok(!('storeId' in parent));
  assert.equal((await service.get(summary!.id)).lines.length, 0);
});
