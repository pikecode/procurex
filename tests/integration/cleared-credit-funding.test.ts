import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { PricingService } from '../../apps/api/src/pricing/pricing.service.js';
import { StoresService } from '../../apps/api/src/stores/stores.service.js';
import { SupplierOrdersService } from '../../apps/api/src/supplier-orders/supplier-orders.service.js';
import { ShipmentsService } from '../../apps/api/src/shipments/shipments.service.js';
import { DiscrepanciesService } from '../../apps/api/src/discrepancies/discrepancies.service.js';
import { DifferenceDisposalsService } from '../../apps/api/src/difference-disposals/difference-disposals.service.js';
import { AdjustmentsService } from '../../apps/api/src/adjustments/adjustments.service.js';
import { lockFundingRequest, synchronizeRequestFunding } from '../../apps/api/src/purchase-requests/request-funding.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const adjustmentRequired = (error: any) => error.getResponse?.().code === 'CLEARED_CREDIT_ADJUSTMENT_REQUIRED';

for (const [index, checkpoint] of (['PRICE_RUN', 'FINAL_RECEIPT', 'SHORTAGE', 'SHORTAGE_WITH_OPEN_CREDIT', 'SHORTAGE_OFFSET', 'CANCELLATION',
  'PRICE_DECREASE', 'PRICE_DECREASE_MIXED', 'PRICE_DECREASE_FROZEN', 'FINAL_RECEIPT_DECREASE', 'PRICE_DECREASE_OFFSET', 'PRICE_DECREASE_PARTIAL'] as const).entries()) {
  test(`actual cleared credit is retained through ${checkpoint}, without a second full booking`, async () => {
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    const code = `CCF${index}${Date.now()}`;
    const database = { client: db } as never;
    const pricing = new PricingService(database), stores = new StoresService(database);
    const shipping = new SupplierOrdersService(database), receiving = new ShipmentsService(database);
    try {
      const category = await db.category.create({ data: { code, name: code } });
      const unit = await db.unit.create({ data: { code, name: 'piece' } });
      const product = await db.product.create({ data: { sku: code, name: code, categoryId: category.id, baseUnitId: unit.id } });
      const supplier = await db.supplier.create({ data: { code, name: code, deliveryMode: 'SELF', defaultSettlementMode: 'CREDIT', defaultSettlementCycle: 'MONTHLY' } });
      const store = await db.store.create({ data: { code, name: code } });
      const template = await db.orderTemplate.create({ data: { code, name: code, items: { create: { productId: product.id, initialSalesPrice: '12', suppliers: { create: { supplierId: supplier.id } } } } } });
      await db.storeAccount.create({ data: { storeId: store.id, balance: '200', creditLimit: '1000' } });
      await pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '12', supplyPrice: '9', effectiveAt: new Date('2000-01-01'), reason: 'Isolated shared price' });
      const request = await db.purchaseRequest.create({ data: { requestNo: code, storeId: store.id, templateId: template.id, status: 'CONFIRMED',
        submittedAt: new Date('2026-09-20'), salesGoodsAmount: '120', supplyGoodsAmount: '90',
        items: { create: { productId: product.id, supplierId: supplier.id, quantity: '10', salesUnitPrice: '12', supplyUnitPrice: '9', salesLineAmount: '120', supplyLineAmount: '90', settlementModeSnapshot: 'CREDIT', settlementCycleSnapshot: 'MONTHLY' } } } });
      const order = await db.supplierOrder.create({ data: { supplierOrderNo: code, requestId: request.id, storeId: store.id, supplierId: supplier.id,
        settlementMode: 'CREDIT', settlementCycleSnapshot: 'MONTHLY', status: 'PUSHED', salesGoodsAmount: '120', supplyGoodsAmount: '90',
        items: { create: { productId: product.id, quantity: '10', salesUnitPrice: '12', supplyUnitPrice: '9', salesLineAmount: '120', supplyLineAmount: '90' } } }, include: { items: true } });
      await db.$transaction(async tx => { await lockFundingRequest(tx, store.id, request.id); await synchronizeRequestFunding(tx, request.id, { initial: true, sourceId: request.id }); });
      const allocation = await db.fundingAllocation.findFirstOrThrow({ where: { requestId: request.id, active: true } });
      const clear = async () => {
        const current = await db.fundingAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
        return stores.createClearing(store.id, { businessDate: new Date(), items: [{ fundingAllocationId: current.id, expectedVersion: current.version, expectedAmount: current.creditOutstanding.toFixed(2) }] });
      };
      const initialClearing = await clear();
      assert.equal(initialClearing.amount, '120.00');
      const initiallyPaid = await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } });
      assert.deepEqual([initiallyPaid.paidAmount.toFixed(2), initiallyPaid.paymentStatus], ['120.00', 'PAID']);
      const historicalItems = await db.clearingItem.findMany({ where: { clearingId: initialClearing.id } });
      assert.deepEqual([(await db.fundingAllocation.findUniqueOrThrow({ where: { id: allocation.id } })).active,
        (await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } })).creditUsed.toFixed(2)], [false, '0.00']);
      const change = (salesPrice: string) => pricing.publishPrice({ templateId: template.id, productId: product.id, supplierId: supplier.id,
        salesPrice, supplyPrice: '9', effectiveAt: new Date('2026-09-10'), reason: 'Actual cleared-credit template price' });
      if (checkpoint === 'CANCELLATION') {
        await shipping.reject(order.id, order.version, 'Isolated paid credit refusal');
        assert.equal((await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'PARTIAL_PUSHED');
        assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).status, 'REJECTED');
        assert.equal((await db.adjustmentDocument.findFirstOrThrow({ where: { sourceRejectedOrderId: order.id } })).amount.toFixed(2), '-120.00');
        assert.equal((await db.fundingAllocation.findUniqueOrThrow({ where: { id: allocation.id } })).netPaid.toFixed(2), '120.00');
        assert.equal((await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).paidAmount.toFixed(2), '0.00');
      } else if (checkpoint.startsWith('PRICE_DECREASE') || checkpoint === 'FINAL_RECEIPT_DECREASE') {
        if (checkpoint === 'PRICE_DECREASE_MIXED') {
          const increase = await change('13');
          await pricing.processRun(increase.runId!);
        }
        let shipment;
        if (checkpoint === 'PRICE_DECREASE_FROZEN' || checkpoint === 'FINAL_RECEIPT_DECREASE') {
          const current = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
          shipment = await shipping.createShipment(order.id, current.version, { freight: '0', items: [{ orderItemId: order.items[0]!.id, shipQuantity: '10', permanentlyReduceQuantity: '0' }] });
          const shipped = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
          await db.settlementItemSnapshot.create({ data: { supplierOrderId: order.id, kind: 'SUPPLIER_PAYABLE',
            settlementItemId: Buffer.from(JSON.stringify({ kind: 'SUPPLIER_PAYABLE', supplierOrderId: order.id })).toString('base64url'),
            goodsAmount: '90', freightAmount: '0', totalAmount: '90', sourceVersion: shipped.version } });
        }
        const snapshots = await db.settlementItemSnapshot.findMany({ where: { supplierOrderId: order.id } });
        const decrease = await change('11');
        if (checkpoint === 'FINAL_RECEIPT_DECREASE') {
          const current = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
          await receiving.createReceipt(shipment!.id, { expectedOrderVersion: current.version, expectedReceiptRevision: 0,
            items: shipment!.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: '10' })) });
        }
        await pricing.processRun(decrease.runId!);
        const priceSource = await db.priceChangeAdjustment.findFirstOrThrow({ where: { runId: decrease.runId!, supplierOrderId: order.id } });
        const firstCredit = await db.adjustmentDocument.findFirstOrThrow({ where: { sourcePriceChangeId: priceSource.id, side: 'STORE' } });
        assert.equal(firstCredit.amount.toFixed(2), '-10.00');
        const funded = await db.fundingAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
        assert.deepEqual([funded.targetAmount.toFixed(2), funded.netPaid.toFixed(2), funded.creditOutstanding.toFixed(2), funded.active], ['110.00', '120.00', '0.00', false]);
        assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } })).creditUsed.toFixed(2), '0.00');
        assert.equal(await db.priceChangeAdjustment.count({ where: { runId: decrease.runId!, supplierOrderId: order.id } }), 1);
        let creditIds = [firstCredit.id];
        let blockedReincreaseId: string | undefined;
        if (checkpoint !== 'FINAL_RECEIPT_DECREASE') {
          const further = await change('10');
          await pricing.processRun(further.runId!);
          const source = await db.priceChangeAdjustment.findFirstOrThrow({ where: { runId: further.runId!, supplierOrderId: order.id } });
          const secondCredit = await db.adjustmentDocument.findFirstOrThrow({ where: { sourcePriceChangeId: source.id, side: 'STORE' } });
          assert.equal(secondCredit.amount.toFixed(2), '-10.00');
          creditIds.push(secondCredit.id);
          await assert.rejects(pricing.processRun(further.runId!));
          const reincrease = await change('12');
          blockedReincreaseId = reincrease.runId!;
          await assert.rejects(pricing.processRun(reincrease.runId!), (error: any) => error.getResponse?.().code === 'CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED');
          assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).salesGoodsAmount.toFixed(2), '100.00');
          assert.equal(await db.priceChangeAdjustment.count({ where: { runId: reincrease.runId! } }), 0);
        } else assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).status, 'COMPLETED');
        const totalCredit = creditIds.length === 1 ? '10.00' : '20.00';
        const adjustmentService = new AdjustmentsService(database);
        const pendingRows = (await adjustmentService.list({ storeId: store.id, supplierId: supplier.id, processingStatus: 'PENDING_DISPOSAL' }))
          .filter(row => row.direction === 'STORE_RECEIVABLE_DECREASE');
        assert.deepEqual(pendingRows.map(row => row.disposalCreditItemId).sort(), [...creditIds].sort());
        for (const row of pendingRows) {
          assert.equal(row.pendingReturnOrOffsetAmount, '10.00');
          const detail = await adjustmentService.get(row.id, { type: 'STORE', storeId: store.id });
          assert.equal(detail.disposalCreditItemId, row.disposalCreditItemId);
          assert.equal(detail.lines[0]!.quantity, '10');
        }
        let targetDebitItemIds: string[] | undefined;
        if (checkpoint === 'PRICE_DECREASE_OFFSET') {
          const targetRequest = await db.purchaseRequest.create({ data: { requestNo: `${code}TARGET`, storeId: store.id, templateId: template.id, status: 'CONFIRMED', submittedAt: new Date() } });
          targetDebitItemIds = [];
          for (let targetIndex = 0; targetIndex < creditIds.length; targetIndex++) {
            const target = await db.supplierOrder.create({ data: { supplierOrderNo: `${code}TARGET${targetIndex}`, requestId: targetRequest.id, storeId: store.id, supplierId: supplier.id,
              settlementMode: 'COMPANY_TERM', settlementCycleSnapshot: 'MONTHLY', status: 'COMPLETED', firstShippedAt: new Date(), salesGoodsAmount: '120', supplyGoodsAmount: '90' } });
            targetDebitItemIds.push(Buffer.from(JSON.stringify({ kind: 'STORE_RECEIVABLE', supplierOrderId: target.id })).toString('base64url'));
          }
        }
        const disposals = new DifferenceDisposalsService(database);
        const selectedCredits = checkpoint === 'PRICE_DECREASE_PARTIAL' ? creditIds.slice(0, 1) : creditIds;
        const disposal = await disposals.create({ method: targetDebitItemIds ? 'OFFSET' : 'OFFLINE_RETURN', creditItemIds: selectedCredits, targetDebitItemIds,
          amount: selectedCredits.length === 1 ? '10.00' : totalCredit, businessDate: new Date() });
        if (blockedReincreaseId) await assert.rejects(pricing.processRun(blockedReincreaseId), (error: any) => error.getResponse?.().code === 'CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED');
        await disposals.confirm(disposal.id, { expectedVersion: disposal.version }, { type: 'STORE', storeId: store.id });
        const afterReturn = await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } });
        assert.deepEqual([afterReturn.paidAmount.toFixed(2), afterReturn.paymentStatus], [selectedCredits.length === 1 ? '110.00' : '100.00', 'PAID']);
        if (checkpoint === 'PRICE_DECREASE_PARTIAL') {
          await assert.rejects(pricing.processRun(blockedReincreaseId!), (error: any) => error.getResponse?.().code === 'CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED');
          assert.equal((await adjustmentService.list({ storeId: store.id, processingStatus: 'PENDING_DISPOSAL' }))
            .filter(row => row.direction === 'STORE_RECEIVABLE_DECREASE')[0]!.pendingReturnOrOffsetAmount, '10.00');
          const remaining = await disposals.create({ method: 'OFFLINE_RETURN', creditItemIds: [creditIds[1]!], amount: '10.00', businessDate: new Date() });
          const confirmations = await Promise.allSettled([
            disposals.confirm(remaining.id, { expectedVersion: remaining.version }, { type: 'STORE', storeId: store.id }),
            disposals.confirm(remaining.id, { expectedVersion: remaining.version }, { type: 'STORE', storeId: store.id }),
          ]);
          assert.equal(confirmations.filter(result => result.status === 'fulfilled').length, 1);
          assert.equal(confirmations.filter(result => result.status === 'rejected').length, 1);
          assert.equal((await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).paidAmount.toFixed(2), '100.00');
        }
        const adjustmentRows = await new AdjustmentsService(database).list({ storeId: store.id, supplierId: supplier.id });
        assert.equal(adjustmentRows.filter(row => row.direction === 'STORE_RECEIVABLE_DECREASE').length, creditIds.length);
        assert.ok(adjustmentRows.filter(row => row.direction === 'STORE_RECEIVABLE_DECREASE').every(row => row.pendingReturnOrOffsetAmount === '0.00'));
        await assert.rejects(disposals.create({ method: 'OFFLINE_RETURN', creditItemIds: creditIds, amount: totalCredit, businessDate: new Date() }));
        await db.$transaction(async tx => { await lockFundingRequest(tx, store.id, request.id); await synchronizeRequestFunding(tx, request.id); });
        if (blockedReincreaseId) {
          await db.storeAccount.update({ where: { storeId: store.id }, data: { creditLimit: '10' } });
          await assert.rejects(pricing.processRun(blockedReincreaseId), (error: any) => error.getResponse?.().code === 'CREDIT_LIMIT_EXCEEDED');
          assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).salesGoodsAmount.toFixed(2), '100.00');
          assert.equal(await db.priceChangeAdjustment.count({ where: { runId: blockedReincreaseId } }), 0);
          await db.storeAccount.update({ where: { storeId: store.id }, data: { creditLimit: '1000' } });
          await pricing.processRun(blockedReincreaseId);
          await assert.rejects(pricing.processRun(blockedReincreaseId));
          const reopened = await db.fundingAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
          assert.deepEqual([reopened.netPaid.toFixed(2), reopened.creditOutstanding.toFixed(2), reopened.active], ['120.00', '20.00', true]);
          assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } })).creditUsed.toFixed(2), '20.00');
          assert.equal((await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).paidAmount.toFixed(2), '100.00');
          const collected = await clear();
          assert.equal(collected.amount, '20.00');
          const fullyPaid = await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } });
          assert.deepEqual([fullyPaid.paidAmount.toFixed(2), fullyPaid.paymentStatus], ['120.00', 'PAID']);
          assert.equal((await db.fundingAllocation.findUniqueOrThrow({ where: { id: allocation.id } })).netPaid.toFixed(2), '140.00');
          const anotherDecrease = await change('11');
          await pricing.processRun(anotherDecrease.runId!);
          const source = await db.priceChangeAdjustment.findFirstOrThrow({ where: { runId: anotherDecrease.runId! } });
          assert.equal((await db.adjustmentDocument.findFirstOrThrow({ where: { sourcePriceChangeId: source.id, side: 'STORE' } })).amount.toFixed(2), '-10.00');
          assert.equal((await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).paidAmount.toFixed(2), '120.00');
        }
        assert.deepEqual(await db.settlementItemSnapshot.findMany({ where: { supplierOrderId: order.id } }), snapshots);
      } else if (checkpoint.startsWith('SHORTAGE')) {
        if (checkpoint === 'SHORTAGE_WITH_OPEN_CREDIT') {
          const increase = await change('13');
          await pricing.processRun(increase.runId!);
        }
        const beforeShipment = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
        const shipment = await shipping.createShipment(order.id, beforeShipment.version, { freight: '0', items: [{ orderItemId: order.items[0]!.id, shipQuantity: '10', permanentlyReduceQuantity: '0' }] });
        const shipped = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
        await receiving.createReceipt(shipment.id, { expectedOrderVersion: shipped.version, expectedReceiptRevision: 0, items: shipment.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: '8' })) });
        const discrepancy = await db.discrepancy.findFirstOrThrow({ where: { orderItemId: order.items[0]!.id } });
        const resolving = new DiscrepanciesService(database);
        await resolving.resolve(discrepancy.id, { expectedVersion: discrepancy.version, action: 'ACCEPT' });
        const expectedGoods = checkpoint === 'SHORTAGE_WITH_OPEN_CREDIT' ? '104.00' : '96.00';
        const expectedCredit = checkpoint === 'SHORTAGE_WITH_OPEN_CREDIT' ? '16.00' : '24.00';
        assert.equal((await db.discrepancy.findUniqueOrThrow({ where: { id: discrepancy.id } })).status, 'RESOLVED');
        const completed = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
        assert.deepEqual([completed.status, completed.salesGoodsAmount.toFixed(2)], ['COMPLETED', expectedGoods]);
        const creditDocument = await db.adjustmentDocument.findFirstOrThrow({ where: { supplierOrderId: order.id, side: 'STORE' } });
        assert.equal(creditDocument.amount.toFixed(2), `-${expectedCredit}`);
        const updatedAllocation = await db.fundingAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
        assert.deepEqual([updatedAllocation.netPaid.toFixed(2), updatedAllocation.targetAmount.toFixed(2), updatedAllocation.creditOutstanding.toFixed(2), updatedAllocation.active], ['120.00', expectedGoods, '0.00', false]);
        assert.equal((await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).paymentStatus, 'PAID');
        await db.$transaction(async tx => { await lockFundingRequest(tx, store.id, request.id); await synchronizeRequestFunding(tx, request.id); });
        const adjustments = new AdjustmentsService(database);
        const rows = await adjustments.list({ storeId: store.id, supplierId: supplier.id });
        assert.equal(rows.find(row => row.disposalCreditItemId === creditDocument.id)?.pendingReturnOrOffsetAmount, expectedCredit);
        const disposals = new DifferenceDisposalsService(database);
        let targetDebitItemIds: string[] | undefined;
        if (checkpoint === 'SHORTAGE_OFFSET') {
          const targetRequest = await db.purchaseRequest.create({ data: { requestNo: `${code}TARGET`, storeId: store.id, templateId: template.id, status: 'CONFIRMED', submittedAt: new Date() } });
          const targetOrder = await db.supplierOrder.create({ data: { supplierOrderNo: `${code}TARGET`, requestId: targetRequest.id, storeId: store.id, supplierId: supplier.id,
            settlementMode: 'COMPANY_TERM', settlementCycleSnapshot: 'MONTHLY', status: 'COMPLETED', firstShippedAt: new Date(), salesGoodsAmount: '120', supplyGoodsAmount: '90' } });
          targetDebitItemIds = [Buffer.from(JSON.stringify({ kind: 'STORE_RECEIVABLE', supplierOrderId: targetOrder.id })).toString('base64url')];
        }
        const disposal = await disposals.create({ method: targetDebitItemIds ? 'OFFSET' : 'OFFLINE_RETURN', creditItemIds: [creditDocument.id], targetDebitItemIds,
          amount: expectedCredit, businessDate: new Date(), reason: 'Isolated cleared-credit shortage adjustment' });
        assert.deepEqual([disposal.direction, disposal.amount, disposal.status], ['COMPANY_TO_STORE', expectedCredit, 'PENDING']);
        await assert.rejects(disposals.confirm(disposal.id, { expectedVersion: disposal.version }, { type: 'STORE', storeId: '00000000-0000-4000-8000-000000000000' }));
        await disposals.confirm(disposal.id, { expectedVersion: disposal.version }, { type: 'STORE', storeId: store.id });
        assert.equal((await adjustments.list({ storeId: store.id, supplierId: supplier.id })).find(row => row.disposalCreditItemId === creditDocument.id)?.pendingReturnOrOffsetAmount, '0.00');
        await assert.rejects(disposals.create({ method: 'OFFLINE_RETURN', creditItemIds: [creditDocument.id], amount: expectedCredit, businessDate: new Date() }));
        await assert.rejects(resolving.resolve(discrepancy.id, { expectedVersion: discrepancy.version, action: 'ACCEPT' }));
        assert.equal(await db.adjustmentDocument.count({ where: { sourceDiscrepancyId: discrepancy.id, side: 'STORE' } }), 1);
        assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } })).creditUsed.toFixed(2), '0.00');
      } else {
        let shipment;
        if (checkpoint === 'FINAL_RECEIPT') {
          shipment = await shipping.createShipment(order.id, order.version, { freight: '0', items: [{ orderItemId: order.items[0]!.id, shipQuantity: '10', permanentlyReduceQuantity: '0' }] });
          const shipped = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
          await db.settlementItemSnapshot.create({ data: { supplierOrderId: order.id, kind: 'SUPPLIER_PAYABLE',
            settlementItemId: Buffer.from(JSON.stringify({ kind: 'SUPPLIER_PAYABLE', supplierOrderId: order.id })).toString('base64url'),
            goodsAmount: '90', freightAmount: '0', totalAmount: '90', sourceVersion: shipped.version } });
        }
        const increase = await change('13');
        if (shipment) {
          const shipped = await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
          await receiving.createReceipt(shipment.id, { expectedOrderVersion: shipped.version, expectedReceiptRevision: 0, items: shipment.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: '10' })) });
          await pricing.processRun(increase.runId!);
        } else await pricing.processRun(increase.runId!);
        const funded = await db.fundingAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
        assert.deepEqual([funded.targetAmount.toFixed(2), funded.netPaid.toFixed(2), funded.creditOutstanding.toFixed(2), funded.active], ['130.00', '120.00', '10.00', true]);
        assert.equal(await db.fundingAllocation.count({ where: { requestId: request.id } }), 1);
        assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } })).creditUsed.toFixed(2), '10.00');
        assert.equal((await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).paidAmount.toFixed(2), '120.00');
        assert.equal((await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } })).paymentStatus, 'UNPAID');
        await assert.rejects(pricing.processRun(increase.runId!), (error: any) => error.getResponse?.().code === 'PRICE_CHANGE_RUN_ALREADY_PROCESSED');
        const current = await db.fundingAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
        const clearingInput = { businessDate: new Date(), items: [{ fundingAllocationId: current.id,
          expectedVersion: current.version, expectedAmount: current.creditOutstanding.toFixed(2) }] };
        const attempts = await Promise.allSettled([
          stores.createClearing(store.id, clearingInput), stores.createClearing(store.id, clearingInput),
        ]);
        const successes = attempts.filter(result => result.status === 'fulfilled');
        assert.equal(successes.length, 1);
        assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
        assert.equal(successes[0]!.value.amount, '10.00');
        const fullyPaid = await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } });
        assert.deepEqual([fullyPaid.paidAmount.toFixed(2), fullyPaid.paymentStatus], ['130.00', 'PAID']);
        await assert.rejects(clear(), (error: any) => error.getResponse?.().code === 'FUNDING_ALLOCATION_INACTIVE');
        assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } })).creditUsed.toFixed(2), '0.00');
        assert.equal(await db.clearingDocument.count({ where: { storeId: store.id } }), 2);
      }
      assert.deepEqual(await db.clearingItem.findMany({ where: { clearingId: initialClearing.id } }), historicalItems);
      assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } })).balance.toFixed(2), '200.00');
      assert.equal(await db.accountLedger.count({ where: { account: { storeId: store.id }, sourceType: 'ADJUSTMENT' } }), 0);
    } finally {
      const storeWhere = { store: { code } };
      await db.priceChangeRun.deleteMany({ where: { versions: { some: { priceVersion: { scope: { supplier: { code } } } } } } });
      await db.clearingDocument.deleteMany({ where: storeWhere });
      const storeIds = (await db.store.findMany({ where: { code }, select: { id: true } })).map(row => row.id);
      await db.differenceDisposal.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.adjustmentDocument.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.settlementItemSnapshot.deleteMany({ where: { supplierOrder: storeWhere } });
      await db.fundingAllocation.deleteMany({ where: { store: storeWhere } });
      await db.accountLedger.deleteMany({ where: { account: storeWhere } });
      await db.discrepancy.deleteMany({ where: { orderItem: { supplierOrder: storeWhere } } });
      await db.receipt.deleteMany({ where: { shipment: { supplierOrder: storeWhere } } });
      await db.shipment.deleteMany({ where: { supplierOrder: storeWhere } });
      await db.supplierOrder.deleteMany({ where: storeWhere });
      await db.purchaseRequest.deleteMany({ where: storeWhere });
      await db.priceScope.deleteMany({ where: { supplier: { code } } });
      await db.orderTemplate.deleteMany({ where: { code } });
      await db.product.deleteMany({ where: { sku: code } }); await db.supplier.deleteMany({ where: { code } });
      await db.storeAccount.deleteMany({ where: storeWhere }); await db.store.deleteMany({ where: { code } });
      await db.category.deleteMany({ where: { code } }); await db.unit.deleteMany({ where: { code } }); await db.$disconnect();
    }
  });
}
