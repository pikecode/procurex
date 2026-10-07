import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../../packages/backend/generated/prisma/client.js';
import { PricingService } from '../../apps/api/src/pricing/pricing.service.js';
import { AdjustmentsService } from '../../apps/api/src/adjustments/adjustments.service.js';
import { DifferenceDisposalsService } from '../../apps/api/src/difference-disposals/difference-disposals.service.js';
import { lockFundingRequest, synchronizeRequestFunding } from '../../apps/api/src/purchase-requests/request-funding.js';
import { SupplierOrdersService } from '../../apps/api/src/supplier-orders/supplier-orders.service.js';
import { ShipmentsService } from '../../apps/api/src/shipments/shipments.service.js';
import { StoreStatementsService } from '../../apps/api/src/store-statements/store-statements.service.js';
import { PaymentRecordsService } from '../../apps/api/src/payment-records/payment-records.service.js';
import { Decimal } from 'decimal.js';
import { DiscrepanciesService } from '../../apps/api/src/discrepancies/discrepancies.service.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';

function pausedPriceWorker(db: InstanceType<typeof PrismaClient>) {
  let resume!: () => void;
  let loaded!: () => void;
  const ready = new Promise<void>(resolve => { loaded = resolve; });
  const release = new Promise<void>(resolve => { resume = resolve; });
  const client = new Proxy(db, { get(target, key, receiver) {
    if (key !== '$transaction') return Reflect.get(target, key, receiver);
    return (work: (tx: Prisma.TransactionClient) => Promise<void>) => target.$transaction(async tx => {
      const wrapped = new Proxy(tx, { get(transaction, property, transactionReceiver) {
        if (property !== 'priceChangeRun') return Reflect.get(transaction, property, transactionReceiver);
        return new Proxy(transaction.priceChangeRun, { get(run, method, runReceiver) {
          if (method !== 'findUnique') return Reflect.get(run, method, runReceiver);
          return async (args: Prisma.PriceChangeRunFindUniqueArgs) => {
            const result = await run.findUnique(args);
            loaded();
            await release;
            return result;
          };
        } });
      } });
      await work(wrapped);
    }, { timeout: 15_000 });
  } });
  return { service: new PricingService({ client } as never), ready, resume };
}

for (const checkpoint of ['UNFROZEN_INCREASE', 'FROZEN_INCREASE', 'FROZEN_DECREASE', 'FROZEN_ACCEPT'] as const) {
for (const mode of ['STORED_VALUE', 'CREDIT'] as const) {
  test(`repricing reconciles ${mode} funds through ${checkpoint}`, async () => {
    const frozenCheckpoint = checkpoint !== 'UNFROZEN_INCREASE';
    const decreasing = checkpoint === 'FROZEN_DECREASE';
    const acceptedCheckpoint = checkpoint === 'FROZEN_ACCEPT';
    const effectiveQuantity = acceptedCheckpoint ? 9 : 10;
    const retainedFunding = acceptedCheckpoint ? '126.00' : '140.00';
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    const code = `PF${mode === 'STORED_VALUE' ? 'S' : 'C'}${acceptedCheckpoint ? 'A' : frozenCheckpoint ? decreasing ? 'D' : 'I' : 'U'}${Date.now()}`;
    const pricing = new PricingService({ client: db } as never);
    try {
      const category = await db.category.create({ data: { code, name: code } });
      const unit = await db.unit.create({ data: { code, name: 'piece' } });
      const store = await db.store.create({ data: { code, name: code } });
      const supplier = await db.supplier.create({ data: { code, name: code, deliveryMode: 'SELF', defaultSettlementMode: mode, defaultSettlementCycle: 'MONTHLY' } });
      const product = await db.product.create({ data: { sku: code, name: code, categoryId: category.id, baseUnitId: unit.id } });
      const template = await db.orderTemplate.create({ data: { code, name: code } });
      await db.storeAccount.create({ data: { storeId: store.id, balance: '150', creditLimit: '150' } });
      await pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '12', supplyPrice: '9', effectiveAt: new Date('2026-09-01'), reason: 'Initial fixture price' });
      const request = await db.purchaseRequest.create({ data: {
        requestNo: code, storeId: store.id, templateId: template.id, status: 'CONFIRMED', submittedAt: new Date('2026-09-20'), salesGoodsAmount: '120', supplyGoodsAmount: '90',
        items: { create: { productId: product.id, supplierId: supplier.id, quantity: '10', salesUnitPrice: '12', supplyUnitPrice: '9', salesLineAmount: '120', supplyLineAmount: '90' } },
      } });
      const order = await db.supplierOrder.create({ data: {
        supplierOrderNo: code, requestId: request.id, storeId: store.id, supplierId: supplier.id, settlementMode: mode, settlementCycleSnapshot: 'MONTHLY', status: 'PUSHED', firstShippedAt: new Date('2026-09-20'), salesGoodsAmount: '120', supplyGoodsAmount: '90',
        items: { create: { productId: product.id, quantity: '10', salesUnitPrice: '12', supplyUnitPrice: '9', salesLineAmount: '120', supplyLineAmount: '90' } },
      } });
      await db.$transaction(async tx => { await lockFundingRequest(tx, store.id, request.id); await synchronizeRequestFunding(tx, request.id, { initial: true, sourceId: request.id }); });
      const change = async (price: string) => pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: price, supplyPrice: '9', effectiveAt: new Date('2026-09-10'), reason: 'Funding repricing acceptance' });
      const increase = await change('13');
      await pricing.processRun(increase.runId!);
      let account = await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
      assert.equal(mode === 'STORED_VALUE' ? account.balance.toFixed(2) : account.creditUsed.toFixed(2), mode === 'STORED_VALUE' ? '20.00' : '130.00');
      const insufficient = await change('20');
      if (mode === 'CREDIT') {
        await assert.rejects(pricing.processRun(insufficient.runId!), (error: any) => error.getResponse?.().code === 'CREDIT_LIMIT_EXCEEDED');
        assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).salesGoodsAmount.toFixed(2), '130.00');
        assert.equal((await db.priceChangeRun.findUniqueOrThrow({ where: { id: insufficient.runId! } })).status, 'PENDING');
        await db.storeAccount.update({ where: { storeId: store.id }, data: { creditLimit: '220' } });
        await pricing.processRun(insufficient.runId!);
      } else {
        await pricing.processRun(insufficient.runId!);
        const short = await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } });
        assert.deepEqual([short.paidAmount.toFixed(2), short.shortfallAmount.toFixed(2)], ['130.00', '50.00']);
        assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } })).balance.toFixed(2), '20.00');
        await db.storeAccount.update({ where: { storeId: store.id }, data: { balance: { increment: '80' } } });
        await db.$transaction(async tx => { await lockFundingRequest(tx, store.id, request.id); await synchronizeRequestFunding(tx, request.id, { requireFull: true }); });
      }
      const snapshot = await db.settlementItemSnapshot.create({ data: {
        settlementItemId: Buffer.from(JSON.stringify({ kind: mode === 'STORED_VALUE' ? 'STORE_RECEIVABLE' : 'SUPPLIER_PAYABLE', supplierOrderId: order.id })).toString('base64url'),
        supplierOrderId: order.id, kind: mode === 'STORED_VALUE' ? 'STORE_RECEIVABLE' : 'SUPPLIER_PAYABLE', goodsAmount: mode === 'STORED_VALUE' ? '200' : '90', freightAmount: '0', totalAmount: mode === 'STORED_VALUE' ? '200' : '90', sourceVersion: 1,
      } });
      const decrease = await change('10');
      await pricing.processRun(decrease.runId!);
      account = await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
      const allocation = await db.fundingAllocation.findFirstOrThrow({ where: { requestId: request.id, active: true } });
      assert.equal(allocation.targetAmount.toFixed(2), '100.00');
      assert.equal(mode === 'STORED_VALUE' ? allocation.netPaid.toFixed(2) : allocation.creditOutstanding.toFixed(2), '100.00');
      assert.equal(mode === 'STORED_VALUE' ? account.balance.toFixed(2) : account.creditUsed.toFixed(2), mode === 'STORED_VALUE' ? '130.00' : '100.00');
      assert.equal((await db.settlementItemSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).totalAmount.toFixed(2), snapshot.totalAmount.toFixed(2));
      assert.deepEqual(await new StoreStatementsService({ client: db } as never).list({ storeId: store.id, supplierId: supplier.id }), []);
      const line = await db.requestItem.findFirstOrThrow({ where: { requestId: request.id } });
      assert.equal(line.salesLineAmount.toFixed(2), '100.00');
      assert.equal(line.salesUnitPrice.toFixed(2), '10.00');
      if (mode === 'STORED_VALUE') {
        const adjustment = await db.priceChangeAdjustment.findFirstOrThrow({ where: { runId: decrease.runId } });
        assert.equal(await db.accountLedger.count({ where: { sourceId: adjustment.id, direction: 'CREDIT', amount: '100' } }), 1);
        await assert.rejects(pricing.processRun(decrease.runId!), (error: any) => error.getResponse?.().code === 'PRICE_CHANGE_RUN_ALREADY_PROCESSED');
        assert.equal(await db.accountLedger.count({ where: { sourceId: adjustment.id, direction: 'CREDIT', amount: '100' } }), 1);
        const document = await db.adjustmentDocument.findFirstOrThrow({ where: { sourcePriceChangeId: adjustment.id, side: 'STORE' } });
        const view = (await new AdjustmentsService({ client: db } as never).list({ storeId: store.id })).find(row => row.sourcePriceChangeId === adjustment.id);
        assert.equal(view?.processingStatus, 'DISPOSED');
        assert.equal(view?.pendingReturnOrOffsetAmount, '0.00');
        assert.equal(view?.disposalCreditItemId, undefined);
        await assert.rejects(new DifferenceDisposalsService({ client: db } as never).create({ method: 'OFFLINE_RETURN', creditItemIds: [document.id], amount: '100.00', businessDate: new Date('2026-09-30') }),
          (error: any) => error.getResponse?.().code === 'DIFFERENCE_CREDIT_ALREADY_DISPOSED');
      } else {
        assert.equal(await db.accountLedger.count({ where: { requestId: request.id } }), 0);
        await db.fundingAllocation.update({ where: { id: allocation.id }, data: { netPaid: '100', creditOutstanding: '0' } });
        await db.storeAccount.update({ where: { storeId: store.id }, data: { creditUsed: '0' } });
        const clearedDecrease = await change('9');
        await assert.rejects(pricing.processRun(clearedDecrease.runId!), (error: any) => error.getResponse?.().code === 'CLEARED_CREDIT_ADJUSTMENT_REQUIRED');
        assert.equal((await db.fundingAllocation.findUniqueOrThrow({ where: { id: allocation.id } })).targetAmount.toFixed(2), '100.00');
      }
      await db.supplierOrder.update({ where: { id: order.id }, data: { status: 'COMPLETED' } });
      assert.deepEqual(await new StoreStatementsService({ client: db } as never).list({ storeId: store.id, supplierId: supplier.id }), []);
      const legacyPayment = await db.paymentRecord.create({ data: {
        paymentNo: `${code}LEGACY`, direction: 'STORE_TO_COMPANY', storeId: store.id, supplierId: supplier.id, amount: '100', businessDate: new Date(),
        allocations: { create: { supplierOrderId: order.id, settlementItemId: Buffer.from(JSON.stringify({ kind: 'STORE_RECEIVABLE', supplierOrderId: order.id })).toString('base64url'), amount: '100', sourceVersion: 1 } },
      } });
      await assert.rejects(new PaymentRecordsService({ client: db } as never).confirm(legacyPayment.id, 1),
        (error: any) => error.getResponse().code === 'ACCOUNT_SETTLEMENT_NOT_PAYABLE');
      assert.equal((await db.paymentRecord.findUniqueOrThrow({ where: { id: legacyPayment.id } })).status, 'PENDING');
      assert.equal((await db.paymentAllocation.findFirstOrThrow({ where: { paymentId: legacyPayment.id } })).state, 'RESERVED');
      const checkpointRequest = await db.purchaseRequest.create({ data: {
        requestNo: `${code}CP`, storeId: store.id, templateId: template.id, status: 'CONFIRMED', submittedAt: new Date('2026-09-20'), salesGoodsAmount: '120', supplyGoodsAmount: '90',
        items: { create: { productId: product.id, supplierId: supplier.id, quantity: '10', salesUnitPrice: '12', supplyUnitPrice: '9', salesLineAmount: '120', supplyLineAmount: '90' } },
      } });
      const checkpointOrder = await db.supplierOrder.create({ data: {
        supplierOrderNo: `${code}CP`, requestId: checkpointRequest.id, storeId: store.id, supplierId: supplier.id, settlementMode: mode, settlementCycleSnapshot: 'MONTHLY', status: 'PUSHED', salesGoodsAmount: '120', supplyGoodsAmount: '90',
        items: { create: { productId: product.id, quantity: '10', salesUnitPrice: '12', supplyUnitPrice: '9', salesLineAmount: '120', supplyLineAmount: '90' } },
      }, include: { items: true } });
      await db.$transaction(async tx => { await lockFundingRequest(tx, store.id, checkpointRequest.id); await synchronizeRequestFunding(tx, checkpointRequest.id, { initial: true, sourceId: checkpointRequest.id }); });
      await pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '14', supplyPrice: '9', effectiveAt: new Date(Date.now() - 60_000), reason: 'New first-shipment price' });
      const shipping = new SupplierOrdersService({ client: db } as never);
      const shipmentInput = { freight: '0', items: [{ orderItemId: checkpointOrder.items[0]!.id, shipQuantity: '10', permanentlyReduceQuantity: '0' }] };
      if (mode === 'STORED_VALUE') {
        await assert.rejects(shipping.createShipment(checkpointOrder.id, checkpointOrder.version, shipmentInput), (error: any) => error.getResponse?.().code === 'PURCHASE_REQUEST_FUNDING_SHORTFALL');
        assert.equal(await db.shipment.count({ where: { supplierOrderId: checkpointOrder.id } }), 0);
        assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: checkpointOrder.id } })).firstShippedAt, null);
        await db.storeAccount.update({ where: { storeId: store.id }, data: { balance: { increment: '50' } } });
      }
      const shipment = await shipping.createShipment(checkpointOrder.id, checkpointOrder.version, shipmentInput);
      assert.equal((await db.shipmentItem.findFirstOrThrow({ where: { shipmentId: shipment.id } })).salesPriceSnapshot.toFixed(2), '14.00');
      const shippedOrder = await db.supplierOrder.findUniqueOrThrow({ where: { id: checkpointOrder.id } });
      assert.ok(shippedOrder.firstShippedAt);
      if (frozenCheckpoint) for (const kind of ['STORE_RECEIVABLE', 'SUPPLIER_PAYABLE'] as const) {
        await db.settlementItemSnapshot.create({ data: {
          settlementItemId: Buffer.from(JSON.stringify({ kind, supplierOrderId: checkpointOrder.id })).toString('base64url'),
          supplierOrderId: checkpointOrder.id, kind, goodsAmount: kind === 'STORE_RECEIVABLE' ? '140' : '90',
          freightAmount: '0', totalAmount: kind === 'STORE_RECEIVABLE' ? '140' : '90', sourceVersion: shippedOrder.version,
        } });
      }
      if (mode === 'STORED_VALUE') await db.storeAccount.update({ where: { storeId: store.id }, data: { balance: '10' } });
      else await db.storeAccount.update({ where: { storeId: store.id }, data: { creditLimit: '150' } });
      const receiving = new ShipmentsService({ client: db } as never);
      let shortage: { id: string; version: number } | undefined;
      if (acceptedCheckpoint) {
        await receiving.createReceipt(shipment.id, { expectedOrderVersion: shippedOrder.version, expectedReceiptRevision: 0,
          items: shipment.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: '9' })) });
        shortage = await db.discrepancy.findFirstOrThrow({ where: { orderItem: { supplierOrderId: checkpointOrder.id }, status: 'OPEN' } });
      }
      const finalPrice = await pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: decreasing ? '10' : '20', supplyPrice: frozenCheckpoint ? decreasing ? '7' : '11' : '9', effectiveAt: new Date(shippedOrder.firstShippedAt!.getTime() - 1_000), reason: 'Published before final receipt, worker not processed' });
      const receiptInput = { expectedOrderVersion: shippedOrder.version, expectedReceiptRevision: 0, items: shipment.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: '10' })) };
      if (decreasing && mode === 'CREDIT') {
        const funds = await db.fundingAllocation.findFirstOrThrow({ where: { supplierOrderId: checkpointOrder.id, active: true } });
        await db.fundingAllocation.update({ where: { id: funds.id }, data: { netPaid: '140', creditOutstanding: '0' } });
        await db.storeAccount.update({ where: { storeId: store.id }, data: { creditUsed: '0' } });
        await assert.rejects(receiving.createReceipt(shipment.id, receiptInput), (error: any) => error.getResponse().code === 'CLEARED_CREDIT_ADJUSTMENT_REQUIRED');
        assert.equal(await db.receipt.count({ where: { shipmentId: shipment.id } }), 0);
        assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: checkpointOrder.id } })).salesGoodsAmount.toFixed(2), '140.00');
        assert.equal(await db.priceChangeAdjustment.count({ where: { runId: finalPrice.runId } }), 0);
        await db.fundingAllocation.update({ where: { id: funds.id }, data: { netPaid: '0', creditOutstanding: '140' } });
        await db.storeAccount.update({ where: { storeId: store.id }, data: { creditUsed: '140' } });
      }
      // Force the worker to cache PENDING before receipt consumes the same price source.
      const worker = decreasing ? pausedPriceWorker(db) : null;
      const workerDone = worker?.service.processRun(finalPrice.runId!);
      if (worker) await worker.ready;
      const resolving = new DiscrepanciesService({ client: db } as never);
      const complete = () => shortage ? resolving.resolve(shortage.id, { expectedVersion: shortage.version, action: 'ACCEPT' }) : receiving.createReceipt(shipment.id, receiptInput);
      const receiptRace = Promise.allSettled([complete(), complete()]);
      const publishConcurrent = () => pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: decreasing ? '11' : '21', supplyPrice: frozenCheckpoint ? decreasing ? '8' : '12' : '9', effectiveAt: new Date(shippedOrder.firstShippedAt!.getTime() - 1_000), reason: 'Publication racing final receipt' });
      const concurrentPublication = worker ? receiptRace.then(() => { worker.resume(); return publishConcurrent(); }) : publishConcurrent();
      const [simultaneousReceipts, racedPrice] = await Promise.all([receiptRace, concurrentPublication]);
      await workerDone;
      assert.equal(simultaneousReceipts.filter(result => result.status === 'fulfilled').length, 1);
      const lostReceipt = simultaneousReceipts.find(result => result.status === 'rejected') as PromiseRejectedResult;
      assert.equal(lostReceipt.reason.getResponse().code, 'VERSION_CONFLICT');
      const completed = await db.supplierOrder.findUniqueOrThrow({ where: { id: checkpointOrder.id } });
      const publishedBeforeCompletion = await db.priceChangeRunOrder.count({ where: { runId: racedPrice.runId, supplierOrderId: checkpointOrder.id } });
      const finalUnitPrice = decreasing ? publishedBeforeCompletion ? 11 : 10 : publishedBeforeCompletion ? 21 : 20;
      const completedGoods = new Decimal(effectiveQuantity).times(finalUnitPrice).toFixed(2);
      assert.equal(completed.status, 'COMPLETED');
      assert.equal(completed.salesGoodsAmount.toFixed(2), completedGoods);
      assert.equal(completed.firstShippedAt?.toISOString(), shippedOrder.firstShippedAt!.toISOString());
      const completionFunds = await db.purchaseRequest.findUniqueOrThrow({ where: { id: checkpointRequest.id } });
      assert.equal(completionFunds.shortfallAmount.toFixed(2), decreasing ? '0.00' : new Decimal(completedGoods).minus(150).toFixed(2));
      if (mode === 'STORED_VALUE') assert.equal(completionFunds.paidAmount.toFixed(2), decreasing ? completedGoods : retainedFunding);
      else assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } })).creditUsed.toFixed(2), decreasing ? completedGoods : retainedFunding);
      assert.equal(await db.receipt.count({ where: { shipmentId: shipment.id } }), 1);
      if (frozenCheckpoint) {
        const chosenRunId = publishedBeforeCompletion ? racedPrice.runId! : finalPrice.runId!;
        const frozenPriceChange = await db.priceChangeAdjustment.findFirstOrThrow({ where: { runId: chosenRunId, supplierOrderId: checkpointOrder.id } });
        const documents = await db.adjustmentDocument.findMany({ where: { sourcePriceChangeId: frozenPriceChange.id }, orderBy: { side: 'asc' }, include: { items: true } });
        const expectedDocuments = [
          ...(mode === 'CREDIT' && decreasing ? [] : [['STORE', new Decimal(completedGoods).minus(retainedFunding).toFixed(2)]]),
          ['SUPPLIER', new Decimal(effectiveQuantity).times(decreasing ? publishedBeforeCompletion ? -1 : -2 : publishedBeforeCompletion ? 3 : 2).toFixed(2)],
        ];
        assert.deepEqual(documents.map(row => [row.side, row.amount.toFixed(2)]), expectedDocuments);
        assert.ok(documents.every(row => row.items[0]!.quantitySnapshot!.toFixed(0) === effectiveQuantity.toString()));
        const supplierPriceView = (await new AdjustmentsService({ client: db } as never).list({ storeId: store.id }))
          .find(row => row.sourcePriceChangeId === frozenPriceChange.id && row.direction.startsWith('SUPPLIER_'));
        const supplierPriceDetail = await new AdjustmentsService({ client: db } as never).get(supplierPriceView!.id);
        assert.equal(supplierPriceDetail.lines[0]!.quantity, effectiveQuantity.toString());
        assert.equal(supplierPriceDetail.lines[0]!.unitSupplyPrice, documents.at(-1)!.items[0]!.unitPriceSnapshot!.toFixed(2));
        if (shortage) {
          const shortageDocuments = await db.adjustmentDocument.findMany({ where: { sourceDiscrepancyId: shortage.id }, orderBy: { side: 'asc' } });
          // A synthetic frozen receivable is not proof that CREDIT was actually cleared.
          assert.deepEqual(shortageDocuments.map(row => [row.side, row.amount.toFixed(2)]), mode === 'STORED_VALUE'
            ? [['STORE', '-14.00'], ['SUPPLIER', '-9.00']] : [['SUPPLIER', '-9.00']]);
          if (mode === 'STORED_VALUE') assert.equal(await db.accountLedger.count({ where: { sourceId: shortage.id, direction: 'CREDIT', amount: '14' } }), 1);
          else {
            const creditFunding = await db.fundingAllocation.findFirstOrThrow({ where: { supplierOrderId: checkpointOrder.id } });
            assert.equal(creditFunding.netPaid.toFixed(2), '0.00');
            assert.equal(creditFunding.creditOutstanding.toFixed(2), retainedFunding);
            assert.equal(await db.accountLedger.count({ where: { sourceId: shortage.id, direction: 'CREDIT' } }), 0);
            assert.equal((await new AdjustmentsService({ client: db } as never).list({ storeId: store.id }))
              .filter(row => row.sourceDiscrepancyId === shortage.id && row.direction === 'STORE_RECEIVABLE_DECREASE').length, 0);
          }
        }
        const snapshots = await db.settlementItemSnapshot.findMany({ where: { supplierOrderId: checkpointOrder.id }, orderBy: { kind: 'asc' } });
        assert.deepEqual(snapshots.map(row => [row.kind, row.goodsAmount.toFixed(2)]), [['STORE_RECEIVABLE', '140.00'], ['SUPPLIER_PAYABLE', '90.00']]);
        if (decreasing && mode === 'STORED_VALUE') {
          const refund = new Decimal(140).minus(completedGoods);
          assert.equal(await db.accountLedger.count({ where: { sourceId: frozenPriceChange.id, direction: 'CREDIT', amount: refund.toFixed(2) } }), 1);
          assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } })).balance.toFixed(2), refund.plus(10).toFixed(2));
          const view = (await new AdjustmentsService({ client: db } as never).list({ storeId: store.id })).find(row => row.sourcePriceChangeId === frozenPriceChange.id && row.direction === 'STORE_RECEIVABLE_DECREASE');
          assert.equal(view!.processingStatus, 'DISPOSED');
          await assert.rejects(new DifferenceDisposalsService({ client: db } as never).create({ method: 'OFFLINE_RETURN', creditItemIds: [documents[0]!.id], amount: refund.toFixed(2), businessDate: new Date() }),
            (error: any) => error.getResponse().code === 'DIFFERENCE_CREDIT_ALREADY_DISPOSED');
        }
        if (!worker) await pricing.processRun(chosenRunId);
        assert.equal((await db.priceChangeRunOrder.findUniqueOrThrow({ where: { runId_supplierOrderId: { runId: chosenRunId, supplierOrderId: checkpointOrder.id } } })).status, 'SUCCEEDED');
        assert.equal(await db.priceChangeAdjustment.count({ where: { runId: chosenRunId, supplierOrderId: checkpointOrder.id } }), 1);
        assert.equal(await db.adjustmentDocument.count({ where: { sourcePriceChangeId: frozenPriceChange.id } }), expectedDocuments.length);
      }
      if (!frozenCheckpoint || publishedBeforeCompletion) await pricing.processRun(finalPrice.runId!);
      await pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '22', supplyPrice: '9', effectiveAt: new Date(shippedOrder.firstShippedAt!.getTime() - 1_000), reason: 'Published after completion must not change completed order' });
      assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: checkpointOrder.id } })).salesGoodsAmount.toFixed(2), completedGoods);
      if (mode === 'CREDIT') {
        const finalAccount = await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
        const movements = await db.creditMovement.findMany({ where: { accountId: finalAccount.id } });
        const booked = movements.filter(row => row.kind === 'BOOKING').reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
        assert.equal(finalAccount.creditCumulative!.toFixed(2), booked.toFixed(2));
        // This legacy fixture manually clears earlier allocations; check the real shortage event independently.
        if (acceptedCheckpoint) {
          const shortageIds = (await db.discrepancy.findMany({ where: { orderItem: { supplierOrderId: checkpointOrder.id } } })).map(row => row.id);
          const shortageRelease = movements.filter(row => shortageIds.includes(row.sourceId));
          assert.deepEqual(shortageRelease.map(row => [row.kind, row.amount.toFixed(2), row.outstandingAfter.toFixed(2)]), [['RELEASE', '14.00', '126.00']]);
        }
      }
    } finally {
      const orderWhere = { supplier: { code } };
      const orders = await db.supplierOrder.findMany({ where: orderWhere, select: { id: true } });
      const ids = orders.map(order => order.id);
      await db.paymentAllocation.deleteMany({ where: { supplierOrderId: { in: ids } } });
      await db.paymentRecord.deleteMany({ where: { paymentNo: `${code}LEGACY` } });
      await db.adjustmentDocumentItem.deleteMany({ where: { adjustment: { supplierOrderId: { in: ids } } } });
      await db.adjustmentDocument.deleteMany({ where: { supplierOrderId: { in: ids } } });
      await db.settlementItemSnapshot.deleteMany({ where: { supplierOrderId: { in: ids } } });
      await db.priceChangeAdjustment.deleteMany({ where: { supplierOrderId: { in: ids } } });
      await db.priceChangeRunOrder.deleteMany({ where: { supplierOrderId: { in: ids } } });
      await db.priceChangeRun.deleteMany({ where: { versions: { some: { priceVersion: { scope: { supplier: { code } } } } } } });
      await db.fundingAllocation.deleteMany({ where: { store: { store: { code } } } });
      await db.accountLedger.deleteMany({ where: { account: { store: { code } } } });
      await db.discrepancyAction.deleteMany({ where: { discrepancy: { orderItem: { supplierOrderId: { in: ids } } } } });
      await db.discrepancy.deleteMany({ where: { orderItem: { supplierOrderId: { in: ids } } } });
      await db.receiptItem.deleteMany({ where: { receipt: { shipment: { supplierOrderId: { in: ids } } } } });
      await db.receipt.deleteMany({ where: { shipment: { supplierOrderId: { in: ids } } } });
      await db.shipmentItem.deleteMany({ where: { shipment: { supplierOrderId: { in: ids } } } });
      await db.shipment.deleteMany({ where: { supplierOrderId: { in: ids } } });
      await db.orderItem.deleteMany({ where: { supplierOrderId: { in: ids } } });
      await db.supplierOrder.deleteMany({ where: orderWhere });
      await db.purchaseRequest.deleteMany({ where: { store: { code } } });
      await db.priceVersion.deleteMany({ where: { scope: { supplier: { code } } } });
      await db.priceScope.deleteMany({ where: { supplier: { code } } });
      await db.storeAccount.deleteMany({ where: { store: { code } } });
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
}
