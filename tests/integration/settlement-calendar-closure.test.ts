import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { PricingService } from '../../apps/api/src/pricing/pricing.service.js';
import { SupplierOrdersService } from '../../apps/api/src/supplier-orders/supplier-orders.service.js';
import { ShipmentsService } from '../../apps/api/src/shipments/shipments.service.js';
import { StoreStatementsService } from '../../apps/api/src/store-statements/store-statements.service.js';
import { SupplierStatementsService } from '../../apps/api/src/supplier-statements/supplier-statements.service.js';
import { SupplierStoreStatementsService } from '../../apps/api/src/supplier-store-statements/supplier-store-statements.service.js';
import { DirectStatementsService } from '../../apps/api/src/direct-statements/direct-statements.service.js';
import { ReportsService } from '../../apps/api/src/reports/reports.service.js';
import { lockFundingRequest, synchronizeRequestFunding } from '../../apps/api/src/purchase-requests/request-funding.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const date = (day: number) => new Date(`2026-09-${day}T10:00:00+08:00`);
const total = (rows: Array<{ totalAmount: string }>) => rows.reduce((sum, row) => sum.plus(row.totalAmount), new Decimal(0)).toFixed(2);

for (const mode of ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM'] as const) {
  for (const historical of [false, true]) {
    test(`calendar ${mode} ${historical ? 'historical' : 'ordinary'}: first shipment fixes periods, replenishment and report totals`, async () => {
      const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
      const code = `SCC${mode[0]}${Number(historical)}${Date.now()}`;
      const database = { client: db } as never;
      const pricing = new PricingService(database), shipping = new SupplierOrdersService(database), receiving = new ShipmentsService(database);
      try {
        const category = await db.category.create({ data: { code, name: code } });
        const unit = await db.unit.create({ data: { code, name: 'piece' } });
        const product = await db.product.create({ data: { sku: code, name: code, categoryId: category.id, baseUnitId: unit.id } });
        const supplier = await db.supplier.create({ data: { code, name: code, deliveryMode: 'SELF', defaultSettlementMode: mode, defaultSettlementCycle: 'HALF_MONTHLY' } });
        const template = await db.orderTemplate.create({ data: { code, name: code, items: { create: { productId: product.id,
          initialSalesPrice: mode === 'SUPPLIER_TERM' ? '9' : '12', suppliers: { create: { supplierId: supplier.id } } } } } });
        const stores = [];
        for (const suffix of ['A', 'B']) {
          const store = await db.store.create({ data: { code: `${code}${suffix}`, name: `${code}${suffix}` } });
          await db.storeAccount.create({ data: { storeId: store.id, balance: '1000', creditLimit: '1000' } });
          stores.push(store);
        }
        await pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: mode === 'SUPPLIER_TERM' ? '9' : '12',
          supplyPrice: '9', effectiveAt: new Date('2000-01-01'), reason: 'Calendar baseline' });
        const createOrder = async (storeId: string, suffix: string, submittedDay: number) => {
          const quote = await pricing.getEffectivePrice(product.id, supplier.id, date(submittedDay), template.id);
          const sales = new Decimal(quote.salesPrice).mul(10).toFixed(2), supply = new Decimal(quote.supplyPrice).mul(10).toFixed(2);
          const request = await db.purchaseRequest.create({ data: { requestNo: `${code}${suffix}`, storeId, templateId: template.id,
            status: 'CONFIRMED', submittedAt: date(submittedDay), salesGoodsAmount: sales, supplyGoodsAmount: supply,
            items: { create: { productId: product.id, supplierId: supplier.id, quantity: '10', salesUnitPrice: quote.salesPrice,
              supplyUnitPrice: quote.supplyPrice, salesLineAmount: sales, supplyLineAmount: supply,
              settlementModeSnapshot: mode, settlementCycleSnapshot: 'HALF_MONTHLY' } } } });
          const order = await db.supplierOrder.create({ data: { supplierOrderNo: `${code}${suffix}`, requestId: request.id, storeId,
            supplierId: supplier.id, settlementMode: mode, settlementCycleSnapshot: 'HALF_MONTHLY', status: 'PUSHED',
            salesGoodsAmount: sales, supplyGoodsAmount: supply, items: { create: { productId: product.id, quantity: '10',
              salesUnitPrice: quote.salesPrice, supplyUnitPrice: quote.supplyPrice, salesLineAmount: sales, supplyLineAmount: supply } } }, include: { items: true } });
          await db.$transaction(async tx => { await lockFundingRequest(tx, storeId, request.id);
            await synchronizeRequestFunding(tx, request.id, { initial: true, sourceId: request.id }); });
          return order;
        };
        const send = async (orderId: string, itemId: string, quantity: string, freightConfirmationId?: string) => {
          const order = await db.supplierOrder.findUniqueOrThrow({ where: { id: orderId } });
          return shipping.createShipment(orderId, order.version, { freight: freightConfirmationId ? '5' : '0', freightConfirmationId,
            items: [{ orderItemId: itemId, shipQuantity: quantity, permanentlyReduceQuantity: '0' }] });
        };
        const receive = async (shipment: Awaited<ReturnType<typeof send>>, quantity: string) => {
          const order = await db.supplierOrder.findUniqueOrThrow({ where: { id: shipment.supplierOrderId } });
          return receiving.createReceipt(shipment.id, { expectedOrderVersion: order.version, expectedReceiptRevision: 0,
            items: shipment.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: quantity })) });
        };
        const upper = await createOrder(stores[0]!.id, 'UPPER', 14);
        const freight = await db.freightConfirmation.create({ data: { supplierOrderId: upper.id, amount: '5', reason: 'Once only calendar freight', status: 'CONFIRMED', confirmedAt: date(15) } });
        const first = await send(upper.id, upper.items[0]!.id, '6', freight.id);
        // Isolated historical date facts; quantity, funding and later checkpoints use real services.
        await db.supplierOrder.update({ where: { id: upper.id }, data: { firstShippedAt: date(15) } });
        await db.shipment.update({ where: { id: first.id }, data: { shippedAt: date(15) } });
        const firstReceipt = await receive(first, '6');
        await db.receipt.update({ where: { id: firstReceipt.id }, data: { submittedAt: date(16) } });
        await pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: mode === 'SUPPLIER_TERM' ? '10' : '13',
          supplyPrice: '10', effectiveAt: date(16), reason: 'Ordinary change after first shipment' });
        const later = await send(upper.id, upper.items[0]!.id, '4');
        await db.shipment.update({ where: { id: later.id }, data: { shippedAt: date(17) } });
        if (historical) {
          const change = await pricing.publishPrice({ productId: product.id, supplierId: supplier.id,
            salesPrice: mode === 'SUPPLIER_TERM' ? '11' : '14', supplyPrice: '11', effectiveAt: date(14), reason: 'Historical change published after second shipment' });
          assert.equal((await pricing.processRun(change.runId!)).affectedOrderCount, 1);
        }
        const lastReceipt = await receive(later, '4');
        await db.receipt.update({ where: { id: lastReceipt.id }, data: { submittedAt: date(18) } });
        await db.supplierOrder.update({ where: { id: upper.id }, data: { completedAt: date(18) } });
        const expectedUpperSales = mode === 'SUPPLIER_TERM' ? historical ? '110.00' : '90.00' : historical ? '140.00' : '120.00';
        const expectedUpperSupply = historical ? '110.00' : '90.00';
        const finalUpper = await db.supplierOrder.findUniqueOrThrow({ where: { id: upper.id }, include: { items: true } });
        assert.equal(finalUpper.firstShippedAt!.toISOString(), date(15).toISOString());
        assert.equal(finalUpper.items[0]!.receivedQuantity.toString(), '10');
        assert.equal(finalUpper.salesGoodsAmount.toFixed(2), expectedUpperSales);
        assert.equal(finalUpper.supplyGoodsAmount.toFixed(2), expectedUpperSupply);
        assert.equal(await db.shipment.count({ where: { supplierOrderId: upper.id } }), 2);
        for (const [index, store] of stores.entries()) {
          const lower = await createOrder(store.id, `LOWER${index}`, 15);
          const shipment = await send(lower.id, lower.items[0]!.id, '10');
          await db.supplierOrder.update({ where: { id: lower.id }, data: { firstShippedAt: date(16) } });
          await db.shipment.update({ where: { id: shipment.id }, data: { shippedAt: date(16) } });
          const receipt = await receive(shipment, '10');
          await db.receipt.update({ where: { id: receipt.id }, data: { submittedAt: date(17) } });
          await db.supplierOrder.update({ where: { id: lower.id }, data: { completedAt: date(17) } });
        }
        for (const [index, store] of stores.entries()) {
          const account = await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
          const target = new Decimal(mode === 'SUPPLIER_TERM' ? 100 : 130).plus(index === 0 ? new Decimal(expectedUpperSales).plus(5) : 0);
          assert.equal(account.balance.toFixed(2), mode === 'STORED_VALUE' ? new Decimal(1000).minus(target).toFixed(2) : '1000.00');
          assert.equal(account.creditUsed.toFixed(2), mode === 'CREDIT' ? target.toFixed(2) : '0.00');
        }
        const supplierBills = await new SupplierStatementsService(database).list({ supplierId: supplier.id });
        const supplierStoreBills = await new SupplierStoreStatementsService(database).list({ supplierId: supplier.id });
        const storeBills = await new StoreStatementsService(database).list({ supplierId: supplier.id });
        const direct = await new DirectStatementsService(database).list({ supplierId: supplier.id });
        if (mode === 'SUPPLIER_TERM') {
          assert.equal(supplierBills.length, 0); assert.equal(supplierStoreBills.length, 0); assert.equal(storeBills.length, 0);
          assert.equal(direct.length, 3); assert.equal(total(direct), new Decimal(expectedUpperSales).plus(205).toFixed(2));
          assert.equal(direct.filter(row => row.periodStart === '2026-09-01').length, 1);
          assert.equal(direct.filter(row => row.periodStart === '2026-09-16').length, 2);
        } else {
          assert.equal(supplierBills.length, 2); assert.equal(supplierStoreBills.length, 3); assert.equal(direct.length, 0);
          assert.equal(supplierBills.find(row => row.periodStart === '2026-09-01')!.totalAmount, new Decimal(expectedUpperSupply).plus(5).toFixed(2));
          assert.equal(supplierBills.find(row => row.periodStart === '2026-09-16')!.totalAmount, '200.00');
          for (const bill of supplierBills) assert.equal(total(supplierStoreBills.filter(row => row.parentStatementId === bill.id)), bill.totalAmount);
          assert.equal(storeBills.length, mode === 'COMPANY_TERM' ? 3 : 0);
        }
        const reports = new ReportsService(database);
        const amounts = await reports.orderAmounts({ supplierId: supplier.id });
        assert.equal(amounts.orders.length, 3);
        assert.equal(total(amounts.orders), new Decimal(expectedUpperSales).plus(mode === 'SUPPLIER_TERM' ? 205 : 265).toFixed(2));
        assert.equal((await reports.productQuantities({ supplierId: supplier.id })).products[0]!.quantity, '30.000000');
        const profit = await reports.profit({ supplierId: supplier.id });
        assert.equal(profit.totals.profit, mode === 'SUPPLIER_TERM' ? '0.00' : '90.00');
        assert.equal(profit.totals.freightAmount, mode === 'SUPPLIER_TERM' ? '0.00' : '5.00');
        if (mode !== 'SUPPLIER_TERM') assert.equal(profit.rows.find(row => row.supplierOrderId === upper.id)!.profit, '30.00');
        assert.equal((await reports.orderAmounts({ supplierId: supplier.id, from: '2026-09-01', to: '2026-09-15' })).orders.length, 0);
        assert.equal((await reports.orderAmounts({ supplierId: supplier.id, from: '2026-09-16', to: '2026-09-30' })).orders.length, 3);
        assert.equal((await reports.profit({ supplierId: supplier.id, from: '2026-09-01', to: '2026-09-15' })).rows.length, mode === 'SUPPLIER_TERM' ? 0 : 1);
        assert.equal(await db.supplierOrder.count({ where: { supplierId: supplier.id } }), 3);
      } finally {
        const storeIds = (await db.store.findMany({ where: { code: { in: [`${code}A`, `${code}B`] } }, select: { id: true } })).map(row => row.id);
        const own = { storeId: { in: storeIds } };
        await db.priceChangeRun.deleteMany({ where: { versions: { some: { priceVersion: { scope: { supplier: { code } } } } } } });
        await db.fundingAllocation.deleteMany({ where: own }); await db.accountLedger.deleteMany({ where: { account: own } });
        await db.receipt.deleteMany({ where: { shipment: { supplierOrder: own } } });
        await db.shipment.deleteMany({ where: { supplierOrder: own } }); await db.freightConfirmation.deleteMany({ where: { supplierOrder: own } });
        await db.supplierOrder.deleteMany({ where: own }); await db.purchaseRequest.deleteMany({ where: own });
        await db.priceScope.deleteMany({ where: { supplier: { code } } }); await db.orderTemplate.deleteMany({ where: { code } });
        await db.product.deleteMany({ where: { sku: code } }); await db.supplier.deleteMany({ where: { code } });
        await db.storeAccount.deleteMany({ where: own }); await db.store.deleteMany({ where: { id: { in: storeIds } } });
        await db.category.deleteMany({ where: { code } }); await db.unit.deleteMany({ where: { code } }); await db.$disconnect();
      }
    });
  }
}
