import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { PricingService } from '../../apps/api/src/pricing/pricing.service.js';
import { StoresService } from '../../apps/api/src/stores/stores.service.js';
import { SupplierOrdersService } from '../../apps/api/src/supplier-orders/supplier-orders.service.js';
import { PurchaseRequestsService } from '../../apps/api/src/purchase-requests/purchase-requests.service.js';
import { AdjustmentsService } from '../../apps/api/src/adjustments/adjustments.service.js';
import { DifferenceDisposalsService } from '../../apps/api/src/difference-disposals/difference-disposals.service.js';
import { lockFundingRequest, synchronizeRequestFunding } from '../../apps/api/src/purchase-requests/request-funding.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
for (const scenario of ['CANCEL', 'REASSIGN', 'SAME', 'TERM', 'MIXED', 'AFTER_RETURN', 'OFFSET', 'PENDING_PRICE_CREDIT'] as const) {
  test(`paid-credit refusal preserves history through ${scenario}`, async () => {
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    const code = `RJF${Date.now()}${scenario.slice(0, 2)}`;
    const database = { client: db } as never;
    const pricing = new PricingService(database), stores = new StoresService(database), shipping = new SupplierOrdersService(database);
    const requests = new PurchaseRequestsService(database, {} as never, pricing);
    const adjustments = new AdjustmentsService(database), disposals = new DifferenceDisposalsService(database);
    try {
      const category = await db.category.create({ data: { code, name: code } });
      const unit = await db.unit.create({ data: { code, name: 'piece' } });
      const product = await db.product.create({ data: { sku: code, name: code, categoryId: category.id, baseUnitId: unit.id } });
      const supplier = await db.supplier.create({ data: { code, name: code, deliveryMode: 'SELF', defaultSettlementMode: 'CREDIT', defaultSettlementCycle: 'MONTHLY' } });
      const store = await db.store.create({ data: { code, name: code } });
      const template = await db.orderTemplate.create({ data: { code, name: code, items: { create: { productId: product.id, initialSalesPrice: '12', suppliers: { create: { supplierId: supplier.id } } } } } });
      await db.storeAccount.create({ data: { storeId: store.id, balance: '500', creditLimit: '1000' } });
      await pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '12', supplyPrice: '9', effectiveAt: new Date('2000-01-01'), reason: 'Isolated refusal baseline' });
      const request = await db.purchaseRequest.create({ data: { requestNo: code, storeId: store.id, templateId: template.id, status: 'CONFIRMED', submittedAt: new Date('2026-09-20'),
        salesGoodsAmount: '120', supplyGoodsAmount: '90', items: { create: { productId: product.id, supplierId: supplier.id, quantity: '10', salesUnitPrice: '12', supplyUnitPrice: '9', salesLineAmount: '120', supplyLineAmount: '90', settlementModeSnapshot: 'CREDIT', settlementCycleSnapshot: 'MONTHLY' } } } });
      const order = await db.supplierOrder.create({ data: { supplierOrderNo: code, requestId: request.id, storeId: store.id, supplierId: supplier.id, settlementMode: 'CREDIT', settlementCycleSnapshot: 'MONTHLY',
        status: 'PUSHED', salesGoodsAmount: '120', supplyGoodsAmount: '90', items: { create: { productId: product.id, quantity: '10', salesUnitPrice: '12', supplyUnitPrice: '9', salesLineAmount: '120', supplyLineAmount: '90' } } } });
      await db.$transaction(async tx => { await lockFundingRequest(tx, store.id, request.id); await synchronizeRequestFunding(tx, request.id, { initial: true }); });
      const originalFunding = await db.fundingAllocation.findFirstOrThrow({ where: { requestId: request.id } });
      await stores.createClearing(store.id, { businessDate: new Date(), items: [{ fundingAllocationId: originalFunding.id, expectedVersion: originalFunding.version, expectedAmount: '120.00' }] });
      const originalClearings = await db.clearingItem.findMany({ where: { fundingAllocationId: originalFunding.id } });
      let priorPriceCreditId: string | undefined;
      if (scenario === 'MIXED' || scenario === 'AFTER_RETURN' || scenario === 'PENDING_PRICE_CREDIT') {
        const change = await pricing.publishPrice({ templateId: template.id, productId: product.id, supplierId: supplier.id, salesPrice: scenario === 'MIXED' ? '13' : '11', supplyPrice: '9', effectiveAt: new Date('2026-09-10'), reason: 'Refusal funding variation' });
        await pricing.processRun(change.runId!);
        if (scenario !== 'MIXED') {
          priorPriceCreditId = (await db.adjustmentDocument.findFirstOrThrow({ where: { supplierOrderId: order.id, side: 'STORE' } })).id;
          if (scenario === 'AFTER_RETURN') {
            const returned = await disposals.create({ method: 'OFFLINE_RETURN', creditItemIds: [priorPriceCreditId], amount: '10.00', businessDate: new Date() });
            await disposals.confirm(returned.id, { expectedVersion: returned.version }, { type: 'STORE', storeId: store.id });
          }
        }
      }
      const before = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
      await assert.rejects(shipping.reject(order.id, before.version, 'Foreign supplier', { type: 'SUPPLIER', supplierId: '00000000-0000-4000-8000-000000000000' }));
      await shipping.reject(order.id, before.version, 'Actual isolated refusal', { type: 'SUPPLIER', supplierId: supplier.id });
      const rejected = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
      assert.deepEqual([rejected.status, rejected.salesGoodsAmount.toFixed(2)], ['REJECTED', before.salesGoodsAmount.toFixed(2)]);
      await shipping.reject(order.id, rejected.version, 'Repeated refusal');
      const credit = await db.adjustmentDocument.findFirstOrThrow({ where: { sourceRejectedOrderId: order.id } });
      const returnAmount = scenario === 'AFTER_RETURN' || scenario === 'PENDING_PRICE_CREDIT' ? '110.00' : '120.00';
      assert.equal(credit.amount.toFixed(2), `-${returnAmount}`);
      const retired = await db.fundingAllocation.findUniqueOrThrow({ where: { id: originalFunding.id } });
      assert.deepEqual([retired.netPaid.toFixed(2), retired.creditOutstanding.toFixed(2), retired.targetAmount.toFixed(2), retired.active], ['120.00', '0.00', '0.00', false]);
      assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } })).creditUsed.toFixed(2), '0.00');
      const view = (await adjustments.list({ storeId: store.id })).find(row => row.disposalCreditItemId === credit.id)!;
      assert.equal(view.type, 'ORDER_REJECTION');
      assert.equal((await adjustments.get(view.id, { type: 'STORE', storeId: store.id })).sourceRejectedOrderId, order.id);
      await assert.rejects(adjustments.get(view.id, { type: 'STORE', storeId: '00000000-0000-4000-8000-000000000000' }));
      const currentRequest = await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } });
      const requestItem = await db.requestItem.findFirstOrThrow({ where: { requestId: request.id } });
      let replacementFundingId: string | undefined;
      if (scenario === 'CANCEL' || scenario === 'MIXED' || scenario === 'AFTER_RETURN') {
        await requests.reallocate(request.id, currentRequest.version, order.id, [{ requestItemId: requestItem.id, cancel: true }]);
        assert.equal((await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'CANCELED');
        assert.equal(await db.requestItem.count({ where: { requestId: request.id } }), 0);
      } else {
        const target = scenario === 'SAME' ? supplier : await db.supplier.create({ data: { code: `${code}N`, name: `${code}N`, deliveryMode: 'SELF',
          defaultSettlementMode: scenario === 'TERM' ? 'COMPANY_TERM' : 'CREDIT', defaultSettlementCycle: 'MONTHLY' } });
        if (target.id !== supplier.id) {
          const templateItem = await db.templateItem.findFirstOrThrow({ where: { templateId: template.id } });
          await db.templateItemSupplier.create({ data: { templateItemId: templateItem.id, supplierId: target.id } });
          await pricing.publishPrice({ productId: product.id, supplierId: target.id, salesPrice: '12', supplyPrice: '9', effectiveAt: new Date('2000-01-01'), reason: 'Replacement supplier quote' });
        }
        const assignment = [{ requestItemId: requestItem.id, supplierId: target.id }];
        if (scenario !== 'TERM') {
          await db.storeAccount.update({ where: { storeId: store.id }, data: { creditLimit: '10' } });
          await assert.rejects(requests.reallocate(request.id, currentRequest.version, order.id, assignment));
          assert.equal(await db.supplierOrder.count({ where: { requestId: request.id } }), 1);
          await db.storeAccount.update({ where: { storeId: store.id }, data: { creditLimit: '1000' } });
        }
        await requests.reallocate(request.id, currentRequest.version, order.id, assignment);
        const replacement = await db.supplierOrder.findFirstOrThrow({ where: { requestId: request.id, status: 'PUSHED' } });
        assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } })).creditUsed.toFixed(2), scenario === 'TERM' ? '0.00' : '120.00');
        if (scenario !== 'TERM') {
          const funding = await db.fundingAllocation.findFirstOrThrow({ where: { supplierOrderId: replacement.id } });
          assert.notEqual(funding.id, originalFunding.id);
          assert.equal(funding.netPaid.toFixed(2), '0.00');
          replacementFundingId = funding.id;
        }
      }
      assert.equal((await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).paidAmount.toFixed(2), '0.00');
      let targetDebitItemIds: string[] | undefined;
      if (scenario === 'OFFSET') {
        const targetRequest = await db.purchaseRequest.create({ data: { requestNo: `${code}OFFSET`, storeId: store.id, templateId: template.id, status: 'CONFIRMED', submittedAt: new Date() } });
        const target = await db.supplierOrder.create({ data: { supplierOrderNo: `${code}OFFSET`, requestId: targetRequest.id, storeId: store.id, supplierId: supplier.id,
          settlementMode: 'COMPANY_TERM', settlementCycleSnapshot: 'MONTHLY', status: 'COMPLETED', firstShippedAt: new Date(), salesGoodsAmount: '200', supplyGoodsAmount: '90' } });
        targetDebitItemIds = [Buffer.from(JSON.stringify({ kind: 'STORE_RECEIVABLE', supplierOrderId: target.id })).toString('base64url')];
      }
      const disposal = await disposals.create({ method: targetDebitItemIds ? 'OFFSET' : 'OFFLINE_RETURN', creditItemIds: [credit.id], targetDebitItemIds, amount: returnAmount, businessDate: new Date() });
      await disposals.confirm(disposal.id, { expectedVersion: disposal.version }, { type: 'STORE', storeId: store.id });
      if (scenario === 'PENDING_PRICE_CREDIT') {
        const prior = await disposals.create({ method: 'OFFLINE_RETURN', creditItemIds: [priorPriceCreditId!], amount: '10.00', businessDate: new Date() });
        await disposals.confirm(prior.id, { expectedVersion: prior.version }, { type: 'STORE', storeId: store.id });
      }
      await assert.rejects(disposals.create({ method: 'OFFLINE_RETURN', creditItemIds: [credit.id], amount: returnAmount, businessDate: new Date() }));
      if (replacementFundingId) {
        const replacement = await db.fundingAllocation.findUniqueOrThrow({ where: { id: replacementFundingId } });
        await stores.createClearing(store.id, { businessDate: new Date(), items: [{ fundingAllocationId: replacement.id, expectedVersion: replacement.version, expectedAmount: '120.00' }] });
        assert.equal((await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).paidAmount.toFixed(2), '120.00');
      }
      await db.$transaction(async tx => { await lockFundingRequest(tx, store.id, request.id); await synchronizeRequestFunding(tx, request.id); });
      assert.equal(await db.adjustmentDocument.count({ where: { sourceRejectedOrderId: order.id } }), 1);
      assert.equal((await db.fundingAllocation.findUniqueOrThrow({ where: { id: originalFunding.id } })).supplierOrderId, order.id);
      assert.deepEqual(await db.clearingItem.findMany({ where: { fundingAllocationId: originalFunding.id } }), originalClearings);
      assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } })).balance.toFixed(2), '500.00');
      assert.equal(await db.accountLedger.count({ where: { account: { storeId: store.id }, sourceType: 'ADJUSTMENT' } }), 0);
    } finally {
      const storeWhere = { store: { code } };
      const storeIds = (await db.store.findMany({ where: { code }, select: { id: true } })).map(row => row.id);
      await db.differenceDisposal.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.adjustmentDocument.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.priceChangeRun.deleteMany({ where: { versions: { some: { priceVersion: { scope: { supplier: { code: { startsWith: code } } } } } } } });
      await db.clearingDocument.deleteMany({ where: storeWhere });
      await db.fundingAllocation.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.accountLedger.deleteMany({ where: { account: { storeId: { in: storeIds } } } });
      await db.supplierOrder.deleteMany({ where: storeWhere }); await db.purchaseRequest.deleteMany({ where: storeWhere });
      await db.priceScope.deleteMany({ where: { supplier: { code: { startsWith: code } } } });
      await db.orderTemplate.deleteMany({ where: { code } }); await db.product.deleteMany({ where: { sku: code } });
      await db.supplier.deleteMany({ where: { code: { startsWith: code } } });
      await db.storeAccount.deleteMany({ where: { storeId: { in: storeIds } } }); await db.store.deleteMany({ where: { code } });
      await db.category.deleteMany({ where: { code } }); await db.unit.deleteMany({ where: { code } }); await db.$disconnect();
    }
  });
}
