import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { SupplierOrdersService } from '../../apps/api/src/supplier-orders/supplier-orders.service.js';
import { ShipmentsService } from '../../apps/api/src/shipments/shipments.service.js';
import { AdjustmentsService } from '../../apps/api/src/adjustments/adjustments.service.js';
import { DifferenceDisposalsService } from '../../apps/api/src/difference-disposals/difference-disposals.service.js';
import { lockFundingRequest, synchronizeRequestFunding } from '../../apps/api/src/purchase-requests/request-funding.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';

for (const mode of ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM'] as const) {
  test(`${mode} frozen reduction preserves bills, separates freight and rolls back failed funding`, async () => {
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    const code = `FR${mode[0]}${Date.now()}`;
    try {
      const store = await db.store.create({ data: { code, name: code } });
      const supplier = await db.supplier.create({ data: { code, name: code, deliveryMode: 'SELF', defaultSettlementMode: mode, defaultSettlementCycle: 'MONTHLY' } });
      const category = await db.category.create({ data: { code, name: code } });
      const unit = await db.unit.create({ data: { code, name: 'piece' } });
      const product = await db.product.create({ data: { sku: code, name: code, categoryId: category.id, baseUnitId: unit.id } });
      const template = await db.orderTemplate.create({ data: { code, name: code } });
      const supplyPrice = mode === 'SUPPLIER_TERM' ? '12' : '9';
      const supplyGoods = mode === 'SUPPLIER_TERM' ? '120' : '90';
      const scope = await db.priceScope.create({ data: { productId: product.id, supplierId: supplier.id } });
      await db.priceVersion.create({ data: { scopeId: scope.id, salesPrice: '12', supplyPrice, effectiveAt: new Date('2026-09-01') } });
      await db.storeAccount.create({ data: { storeId: store.id, balance: mode === 'STORED_VALUE' ? '120' : '150', creditLimit: '120' } });
      const request = await db.purchaseRequest.create({ data: {
        requestNo: code, storeId: store.id, templateId: template.id, status: 'CONFIRMED', submittedAt: new Date('2026-09-20'), salesGoodsAmount: '120', supplyGoodsAmount: supplyGoods,
        items: { create: { productId: product.id, supplierId: supplier.id, quantity: '10', salesUnitPrice: '12', supplyUnitPrice: supplyPrice, salesLineAmount: '120', supplyLineAmount: supplyGoods } },
      } });
      const order = await db.supplierOrder.create({ data: {
        supplierOrderNo: code, requestId: request.id, storeId: store.id, supplierId: supplier.id, settlementMode: mode, settlementCycleSnapshot: 'MONTHLY', status: 'PUSHED', salesGoodsAmount: '120', supplyGoodsAmount: supplyGoods,
        items: { create: { productId: product.id, quantity: '10', salesUnitPrice: '12', supplyUnitPrice: supplyPrice, salesLineAmount: '120', supplyLineAmount: supplyGoods } },
      }, include: { items: true } });
      await db.$transaction(async tx => { await lockFundingRequest(tx, store.id, request.id); await synchronizeRequestFunding(tx, request.id, { initial: true, sourceId: request.id }); });
      const shipping = new SupplierOrdersService({ client: db } as never);
      const receiving = new ShipmentsService({ client: db } as never);
      const first = await shipping.createShipment(order.id, order.version, { freight: '0', items: [{ orderItemId: order.items[0]!.id, shipQuantity: '4', permanentlyReduceQuantity: '0' }] });
      const afterFirstShip = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
      await receiving.createReceipt(first.id, { expectedOrderVersion: afterFirstShip.version, expectedReceiptRevision: 0, items: first.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: '4' })) });
      const beforeReduction = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
      // Explicit historical partial-freeze fixture; normal payment cannot freeze an incomplete order.
      const kinds = mode === 'SUPPLIER_TERM' ? ['DIRECT'] : mode === 'CREDIT' ? ['SUPPLIER_PAYABLE'] : ['STORE_RECEIVABLE', 'SUPPLIER_PAYABLE'];
      for (const kind of kinds) await db.settlementItemSnapshot.create({ data: {
        settlementItemId: Buffer.from(JSON.stringify({ kind, supplierOrderId: order.id })).toString('base64url'), supplierOrderId: order.id, kind,
        goodsAmount: kind === 'SUPPLIER_PAYABLE' ? supplyGoods : '120', freightAmount: '0', totalAmount: kind === 'SUPPLIER_PAYABLE' ? supplyGoods : '120', sourceVersion: beforeReduction.version,
      } });
      const snapshotsBefore = await db.settlementItemSnapshot.findMany({ where: { supplierOrderId: order.id }, orderBy: { kind: 'asc' } });
      const fee = await db.freightConfirmation.create({ data: { supplierOrderId: order.id, amount: '35', reason: 'Frozen reduction freight fixture', status: 'CONFIRMED', confirmedAt: new Date() } });
      const input = { freight: '35', freightConfirmationId: fee.id, items: [{ orderItemId: order.items[0]!.id, shipQuantity: '4', permanentlyReduceQuantity: '2' }] };
      if (mode === 'STORED_VALUE' || mode === 'CREDIT') {
        await assert.rejects(shipping.createShipment(order.id, beforeReduction.version, input),
          (error: any) => error.getResponse().code === (mode === 'STORED_VALUE' ? 'PURCHASE_REQUEST_FUNDING_SHORTFALL' : 'CREDIT_LIMIT_EXCEEDED'));
        assert.equal(await db.shipment.count({ where: { supplierOrderId: order.id } }), 1);
        assert.equal(await db.adjustmentDocument.count({ where: { supplierOrderId: order.id } }), 0);
        assert.equal((await db.freightConfirmation.findUniqueOrThrow({ where: { id: fee.id } })).status, 'CONFIRMED');
        assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).salesGoodsAmount.toFixed(2), '120.00');
        assert.equal(await db.accountLedger.count({ where: { requestId: request.id, sourceType: 'ADJUSTMENT' } }), 0);
        await db.storeAccount.update({ where: { storeId: store.id }, data: mode === 'STORED_VALUE' ? { balance: '30' } : { creditLimit: '132' } });
      }
      const results = await Promise.allSettled([shipping.createShipment(order.id, beforeReduction.version, input), shipping.createShipment(order.id, beforeReduction.version, input)]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.getResponse().code, 'VERSION_CONFLICT');
      const shipment = (results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof shipping.createShipment>>>).value;
      const freightDocuments = await db.adjustmentDocument.findMany({ where: { sourceShipmentId: shipment.id, shipmentAdjustmentKind: 'FREIGHT' } });
      assert.equal(freightDocuments.length, kinds.length === 1 && mode === 'CREDIT' ? 1 : 2);
      assert.ok(freightDocuments.every(row => row.amount.toFixed(2) === '35.00'));
      const documents = await db.adjustmentDocument.findMany({ where: { sourceShipmentId: shipment.id, shipmentAdjustmentKind: 'REDUCTION' }, orderBy: { side: 'asc' }, include: { items: true } });
      assert.deepEqual(documents.map(row => [row.side, row.amount.toFixed(2)]), mode === 'CREDIT' ? [['SUPPLIER', '-18.00']] : [['STORE', '-24.00'], ['SUPPLIER', mode === 'SUPPLIER_TERM' ? '-24.00' : '-18.00']]);
      assert.ok(documents.every(row => row.items[0]!.quantitySnapshot!.toString() === '2'));
      assert.deepEqual(await db.settlementItemSnapshot.findMany({ where: { supplierOrderId: order.id }, orderBy: { kind: 'asc' } }), snapshotsBefore);
      const account = await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
      if (mode === 'STORED_VALUE' || mode === 'CREDIT') {
        const funding = await db.fundingAllocation.findFirstOrThrow({ where: { supplierOrderId: order.id, active: true } });
        assert.equal(funding.targetAmount.toFixed(2), '131.00');
        assert.equal(mode === 'STORED_VALUE' ? funding.netPaid.toFixed(2) : funding.creditOutstanding.toFixed(2), '131.00');
      } else assert.equal(await db.fundingAllocation.count({ where: { requestId: request.id, active: true } }), 0);
      assert.equal(account.balance.toFixed(2), mode === 'STORED_VALUE' ? '19.00' : '150.00');
      if (mode === 'CREDIT') assert.equal(account.creditUsed.toFixed(2), '131.00');
      const ledger = await db.accountLedger.findMany({ where: { sourceId: shipment.id }, orderBy: { createdAt: 'asc' } });
      assert.deepEqual(ledger.map(row => [row.direction, row.amount.toFixed(2)]), mode === 'STORED_VALUE' ? [['CREDIT', '24.00'], ['DEBIT', '35.00']] : []);
      const adjusted = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
      assert.equal(adjusted.salesGoodsAmount.toFixed(2), '96.00');
      assert.equal(adjusted.firstShippedAt!.toISOString(), beforeReduction.firstShippedAt!.toISOString());
      await receiving.createReceipt(shipment.id, { expectedOrderVersion: adjusted.version, expectedReceiptRevision: 0, items: shipment.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: '4' })) });
      assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).status, 'COMPLETED');
      const adjustments = new AdjustmentsService({ client: db } as never);
      const views = (await adjustments.list({ storeId: store.id })).filter(row => row.sourceShipmentId === shipment.id);
      assert.equal(views.length, documents.length + freightDocuments.length);
      assert.equal(views.filter(row => row.type === 'PERMANENT_REDUCTION').length, documents.length);
      assert.ok(views.filter(row => row.type === 'FREIGHT_CHANGE').every(row => row.freightAdjustmentAmount === '35.00' && row.goodsAdjustmentAmount === '0.00'));
      const freightView = views.find(row => row.type === 'FREIGHT_CHANGE')!;
      assert.equal((await adjustments.get(freightView.id)).freightAdjustmentAmount, '35.00');
      for (const snapshot of snapshotsBefore) {
        const side = snapshot.kind === 'SUPPLIER_PAYABLE' ? 'SUPPLIER' : 'STORE';
        const delta = [...documents, ...freightDocuments].filter(row => row.side === side).reduce((sum, row) => sum + Number(row.amount), 0);
        assert.equal(Number(snapshot.totalAmount) + delta, snapshot.kind === 'SUPPLIER_PAYABLE' ? 107 : 131);
      }
      const supplierView = views.find(row => row.direction === 'SUPPLIER_PAYABLE_DECREASE')!;
      const detail = await adjustments.get(supplierView.id);
      assert.deepEqual([detail.lines[0]!.quantity, detail.lines[0]!.unitSupplyPrice], ['2', mode === 'SUPPLIER_TERM' ? '12.00' : '9.00']);
      const disposals = new DifferenceDisposalsService({ client: db } as never);
      if (mode === 'STORED_VALUE') {
        assert.equal(views.find(row => row.direction === 'STORE_RECEIVABLE_DECREASE')!.processingStatus, 'DISPOSED');
        await assert.rejects(disposals.create({ method: 'OFFLINE_RETURN', creditItemIds: [documents[0]!.id], amount: '24', businessDate: new Date() }),
          (error: any) => error.getResponse().code === 'DIFFERENCE_CREDIT_ALREADY_DISPOSED');
      }
      const supplierDocument = documents.find(row => row.side === 'SUPPLIER')!;
      const disposal = await disposals.create({ method: 'OFFLINE_RETURN', creditItemIds: [supplierDocument.id], amount: supplierDocument.amount.abs().toFixed(2), businessDate: new Date() });
      assert.equal((await disposals.confirm(disposal.id, { expectedVersion: disposal.version })).status, 'CONFIRMED');
    } finally {
      const stores = await db.store.findMany({ where: { code }, select: { id: true } });
      const storeIds = stores.map(row => row.id);
      const orders = await db.supplierOrder.findMany({ where: { storeId: { in: storeIds } }, select: { id: true } });
      const ids = orders.map(row => row.id);
      await db.differenceDisposal.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.adjustmentDocument.deleteMany({ where: { supplierOrderId: { in: ids } } });
      await db.settlementItemSnapshot.deleteMany({ where: { supplierOrderId: { in: ids } } });
      await db.fundingAllocation.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.accountLedger.deleteMany({ where: { account: { storeId: { in: storeIds } } } });
      await db.receiptItem.deleteMany({ where: { receipt: { shipment: { supplierOrderId: { in: ids } } } } });
      await db.receipt.deleteMany({ where: { shipment: { supplierOrderId: { in: ids } } } });
      await db.shipmentItem.deleteMany({ where: { shipment: { supplierOrderId: { in: ids } } } });
      await db.shipment.deleteMany({ where: { supplierOrderId: { in: ids } } });
      await db.freightConfirmation.deleteMany({ where: { supplierOrderId: { in: ids } } });
      await db.orderItem.deleteMany({ where: { supplierOrderId: { in: ids } } });
      await db.supplierOrder.deleteMany({ where: { id: { in: ids } } });
      await db.purchaseRequest.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.priceVersion.deleteMany({ where: { scope: { supplier: { code } } } });
      await db.priceScope.deleteMany({ where: { supplier: { code } } });
      await db.storeAccount.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.orderTemplate.deleteMany({ where: { code } });
      await db.product.deleteMany({ where: { sku: code } });
      await db.supplier.deleteMany({ where: { code } });
      await db.store.deleteMany({ where: { code } });
      await db.category.deleteMany({ where: { code } });
      await db.unit.deleteMany({ where: { code } });
      await db.$disconnect();
    }
  });
}
