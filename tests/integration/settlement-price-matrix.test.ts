import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { PricingService } from '../../apps/api/src/pricing/pricing.service.js';
import { SupplierOrdersService } from '../../apps/api/src/supplier-orders/supplier-orders.service.js';
import { ShipmentsService } from '../../apps/api/src/shipments/shipments.service.js';
import { StoreStatementsService } from '../../apps/api/src/store-statements/store-statements.service.js';
import { SupplierStatementsService } from '../../apps/api/src/supplier-statements/supplier-statements.service.js';
import { DirectStatementsService } from '../../apps/api/src/direct-statements/direct-statements.service.js';
import { lockFundingRequest, synchronizeRequestFunding } from '../../apps/api/src/purchase-requests/request-funding.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';

for (const mode of ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM'] as const) {
  for (const timing of ['PAST', 'IMMEDIATE', 'FUTURE'] as const) {
  for (const scope of mode === 'SUPPLIER_TERM' ? ['SHARED', 'TEMPLATE'] as const : ['TEMPLATE'] as const) {
    test(`${mode} ${timing} ${scope} prices preserve mode-specific funding, freight and completed bills`, async () => {
      const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
      const code = `SPM${mode[0]}${timing[0]}${scope[0]}${Date.now()}`;
      const database = { client: db } as never;
      const pricing = new PricingService(database), shipping = new SupplierOrdersService(database), receiving = new ShipmentsService(database);
      try {
        const category = await db.category.create({ data: { code, name: code } });
        const unit = await db.unit.create({ data: { code, name: 'piece' } });
        const product = await db.product.create({ data: { sku: code, name: code, categoryId: category.id, baseUnitId: unit.id } });
        const supplier = await db.supplier.create({ data: { code, name: code, deliveryMode: 'SELF', defaultSettlementMode: mode, defaultSettlementCycle: 'MONTHLY' } });
        const template = await db.orderTemplate.create({ data: { code, name: code, items: { create: { productId: product.id,
          initialSalesPrice: mode === 'SUPPLIER_TERM' ? '9' : '12', suppliers: { create: { supplierId: supplier.id } } } } } });
        const store = await db.store.create({ data: { code, name: code } });
        await db.storeAccount.create({ data: { storeId: store.id, balance: '500', creditLimit: '500' } });
        const salesPrice = mode === 'SUPPLIER_TERM' ? '9' : '12', salesGoods = mode === 'SUPPLIER_TERM' ? '90' : '120';
        await pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice, supplyPrice: '9', effectiveAt: new Date('2000-01-01'), reason: 'Isolated matrix shared price' });
        const request = await db.purchaseRequest.create({ data: { requestNo: code, storeId: store.id, templateId: template.id,
          status: 'CONFIRMED', submittedAt: new Date('2026-09-20'), salesGoodsAmount: salesGoods, supplyGoodsAmount: '90',
          items: { create: { productId: product.id, supplierId: supplier.id, quantity: '10', salesUnitPrice: salesPrice, supplyUnitPrice: '9', salesLineAmount: salesGoods, supplyLineAmount: '90' } } } });
        const order = await db.supplierOrder.create({ data: { supplierOrderNo: code, requestId: request.id, storeId: store.id, supplierId: supplier.id,
          settlementMode: mode, settlementCycleSnapshot: 'MONTHLY', status: 'PUSHED', salesGoodsAmount: salesGoods, supplyGoodsAmount: '90',
          items: { create: { productId: product.id, quantity: '10', salesUnitPrice: salesPrice, supplyUnitPrice: '9', salesLineAmount: salesGoods, supplyLineAmount: '90' } } }, include: { items: true } });
        await db.$transaction(async tx => { await lockFundingRequest(tx, store.id, request.id); await synchronizeRequestFunding(tx, request.id, { initial: true, sourceId: request.id }); });
        assert.equal((await db.requestItem.findFirstOrThrow({ where: { requestId: request.id } })).settlementModeSnapshot, mode);
        const freight = await db.freightConfirmation.create({ data: { supplierOrderId: order.id, amount: '5', reason: 'Approved matrix freight', status: 'CONFIRMED', confirmedAt: new Date() } });
        const shipment = await shipping.createShipment(order.id, order.version, { freight: '5', freightConfirmationId: freight.id,
          items: [{ orderItemId: order.items[0]!.id, shipQuantity: '10', permanentlyReduceQuantity: '0' }] });
        const before = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
        const effectiveAt = timing === 'PAST' ? new Date(before.firstShippedAt!.getTime() - 1000) : timing === 'IMMEDIATE' ? new Date() : new Date('2099-01-01');
        const price = await pricing.publishPrice({ ...(scope === 'TEMPLATE' ? { templateId: template.id } : {}), productId: product.id, supplierId: supplier.id,
          salesPrice: mode === 'SUPPLIER_TERM' ? '10' : '13', supplyPrice: '9',
          effectiveAt, reason: 'Historical, immediate or future matrix price' });
        if (mode === 'SUPPLIER_TERM' && scope === 'TEMPLATE') {
          const quote = await pricing.getEffectivePrice(product.id, supplier.id, effectiveAt, template.id);
          assert.equal(quote.templateId, template.id); assert.equal(quote.salesPrice.toString(), '10'); assert.equal(quote.supplyPrice.toString(), '9');
        }
        const run = await pricing.processRun(price.runId!);
        assert.equal(run.affectedOrderCount, timing === 'PAST' ? 1 : 0);
        const changed = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
        await receiving.createReceipt(shipment.id, { expectedOrderVersion: changed.version, expectedReceiptRevision: 0,
          items: shipment.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: '10' })) });
        const completed = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
        const expectedSales = mode === 'SUPPLIER_TERM' ? timing === 'PAST' ? '100.00' : '90.00' : timing === 'PAST' ? '130.00' : '120.00';
        const expectedSupply = '90.00';
        const expectedTotal = (Number(expectedSales) + 5).toFixed(2);
        assert.deepEqual([completed.status, completed.salesGoodsAmount.toFixed(2), completed.supplyGoodsAmount.toFixed(2)], ['COMPLETED', expectedSales, expectedSupply]);
        assert.equal(completed.firstShippedAt!.toISOString(), before.firstShippedAt!.toISOString());
        const account = await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
        const allocations = await db.fundingAllocation.findMany({ where: { requestId: request.id } });
        if (mode === 'STORED_VALUE' || mode === 'CREDIT') {
          assert.equal(allocations.length, 1); assert.equal(allocations[0]!.targetAmount.toFixed(2), expectedTotal);
          assert.equal((mode === 'STORED_VALUE' ? allocations[0]!.netPaid : allocations[0]!.creditOutstanding).toFixed(2), expectedTotal);
        } else assert.equal(allocations.length, 0);
        assert.equal(account.balance.toFixed(2), mode === 'STORED_VALUE' ? (500 - Number(expectedTotal)).toFixed(2) : '500.00');
        assert.equal(account.creditUsed.toFixed(2), mode === 'CREDIT' ? expectedTotal : '0.00');
        const ledger = await db.accountLedger.findMany({ where: { accountId: account.id } });
        assert.equal(ledger.reduce((sum, row) => sum + (row.direction === 'DEBIT' ? Number(row.amount) : -Number(row.amount)), 0), mode === 'STORED_VALUE' ? Number(expectedTotal) : 0);
        const storeBills = await new StoreStatementsService(database).list({ storeId: store.id, supplierId: supplier.id });
        const supplierBills = await new SupplierStatementsService(database).list({ supplierId: supplier.id });
        const directBills = await new DirectStatementsService(database).list({ storeId: store.id, supplierId: supplier.id });
        assert.deepEqual(storeBills.map(row => row.totalAmount), mode === 'COMPANY_TERM' ? [expectedTotal] : []);
        assert.deepEqual(supplierBills.map(row => row.totalAmount), mode === 'SUPPLIER_TERM' ? [] : [(Number(expectedSupply) + 5).toFixed(2)]);
        assert.deepEqual(directBills.map(row => row.totalAmount), mode === 'SUPPLIER_TERM' ? [expectedTotal] : []);
        const directTemplate = mode === 'SUPPLIER_TERM' && scope === 'TEMPLATE';
        await pricing.publishPrice({ ...(scope === 'TEMPLATE' ? { templateId: template.id } : {}), productId: product.id, supplierId: supplier.id,
          salesPrice: directTemplate ? '10' : mode === 'SUPPLIER_TERM' ? '11' : '20', supplyPrice: '9',
          effectiveAt: directTemplate ? effectiveAt : new Date(before.firstShippedAt!.getTime() - 1000), reason: 'Completed order must not reprice' });
        assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).salesGoodsAmount.toFixed(2), expectedSales);
        assert.equal(await db.shipment.count({ where: { supplierOrderId: order.id } }), 1);
      } finally {
        const storeWhere = { store: { code } };
        await db.priceChangeRun.deleteMany({ where: { versions: { some: { priceVersion: { scope: { supplier: { code } } } } } } });
        await db.fundingAllocation.deleteMany({ where: { store: storeWhere } });
        await db.accountLedger.deleteMany({ where: { account: storeWhere } });
        await db.receipt.deleteMany({ where: { shipment: { supplierOrder: storeWhere } } });
        await db.shipment.deleteMany({ where: { supplierOrder: storeWhere } });
        await db.freightConfirmation.deleteMany({ where: { supplierOrder: storeWhere } });
        await db.supplierOrder.deleteMany({ where: storeWhere }); await db.purchaseRequest.deleteMany({ where: storeWhere });
        await db.priceScope.deleteMany({ where: { supplier: { code } } }); await db.orderTemplate.deleteMany({ where: { code } });
        await db.product.deleteMany({ where: { sku: code } }); await db.supplier.deleteMany({ where: { code } });
        await db.storeAccount.deleteMany({ where: storeWhere }); await db.store.deleteMany({ where: { code } });
        await db.category.deleteMany({ where: { code } }); await db.unit.deleteMany({ where: { code } }); await db.$disconnect();
      }
    });
  }
}
}
