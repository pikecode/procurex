import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../../packages/backend/generated/prisma/client.js';
import { lockFundingRequest, synchronizeRequestFunding } from '../../apps/api/src/purchase-requests/request-funding.js';
import { ShipmentsService } from '../../apps/api/src/shipments/shipments.service.js';
import { adjustAcceptedShortage } from '../../apps/api/src/discrepancies/shortage-financials.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const rollback = new Error('Rollback reservation fixture');

async function fixture(tx: Prisma.TransactionClient, legacy = false) {
  const code = `RS-${randomUUID()}`;
  const category = await tx.category.create({ data: { code, name: '储值测试分类' } });
  const unit = await tx.unit.create({ data: { code, name: '件' } });
  const store = await tx.store.create({ data: { code, name: '储值测试门店' } });
  const supplier = await tx.supplier.create({ data: { code, name: '储值测试供应商', deliveryMode: 'SELF', defaultSettlementMode: 'STORED_VALUE', defaultSettlementCycle: 'MONTHLY' } });
  const product = await tx.product.create({ data: { sku: code, name: '储值测试商品', categoryId: category.id, baseUnitId: unit.id } });
  const template = await tx.orderTemplate.create({ data: { code, name: '储值测试模板' } });
  await tx.storeAccount.create({ data: { storeId: store.id, balance: '100' } });
  const request = await tx.purchaseRequest.create({ data: {
    requestNo: code, storeId: store.id, templateId: template.id, storedValueOnReceipt: !legacy, salesGoodsAmount: '60',
    items: { create: { productId: product.id, supplierId: supplier.id, quantity: '6', salesUnitPrice: '10', supplyUnitPrice: '8', salesLineAmount: '60', supplyLineAmount: '48' } },
  } });
  const sync = async (id = request.id, requireFull = false) => {
    await lockFundingRequest(tx, store.id, id);
    return synchronizeRequestFunding(tx, id, { requireFull });
  };
  const account = () => tx.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
  return { code, store, supplier, product, template, request, sync, account };
}

for (const scenario of ['reserve-release', 'receipt-revision', 'shortage', 'legacy'] as const) {
  test(`stored value reservation: ${scenario}`, async () => {
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    try {
      await assert.rejects(db.$transaction(async tx => {
        const f = await fixture(tx, scenario === 'legacy');
        const initial = await f.sync();
        assert.equal(initial.canConfirm, true);
        assert.equal(initial.storedPaid.toFixed(2), scenario === 'legacy' ? '60.00' : '0.00');
        assert.equal(initial.storedReserved.toFixed(2), scenario === 'legacy' ? '0.00' : '60.00');
        assert.equal(initial.available.toFixed(2), '40.00');
        const cashCount = () => tx.accountLedger.count({ where: { account: { storeId: f.store.id } } });
        if (scenario === 'legacy') {
          await f.sync();
          assert.equal((await f.account()).balance.toFixed(2), '40.00');
          assert.equal(await cashCount(), 1);
        } else if (scenario === 'reserve-release') {
          const other = await tx.purchaseRequest.create({ data: {
            requestNo: `${f.code}-2`, storeId: f.store.id, templateId: f.template.id, storedValueOnReceipt: true, salesGoodsAmount: '60',
            items: { create: { productId: f.product.id, supplierId: f.supplier.id, quantity: '6', salesUnitPrice: '10', supplyUnitPrice: '8', salesLineAmount: '60', supplyLineAmount: '48' } },
          } });
          const second = await f.sync(other.id);
          assert.equal(second.canConfirm, false);
          assert.equal(second.shortfallAmount.toFixed(2), '20.00');
          assert.equal(second.storedReserved.toFixed(2), '0.00');
          await tx.requestItem.updateMany({ where: { requestId: f.request.id }, data: { quantity: '4', salesLineAmount: '40' } });
          await tx.purchaseRequest.update({ where: { id: f.request.id }, data: { salesGoodsAmount: '40' } });
          await f.sync();
          assert.equal((await f.account()).reservedBalance.toFixed(2), '40.00');
          await f.sync(other.id, true);
          assert.equal((await f.account()).reservedBalance.toFixed(2), '100.00');
          await tx.purchaseRequest.update({ where: { id: other.id }, data: { status: 'CANCELED' } });
          await f.sync(other.id);
          assert.equal((await f.account()).reservedBalance.toFixed(2), '40.00');
          assert.equal((await f.account()).balance.toFixed(2), '100.00');
          assert.equal(await cashCount(), 0);
        } else {
          const order = await tx.supplierOrder.create({ data: {
            supplierOrderNo: f.code, requestId: f.request.id, storeId: f.store.id, supplierId: f.supplier.id,
            settlementMode: 'STORED_VALUE', settlementCycleSnapshot: 'MONTHLY', status: 'SHIPPED', salesGoodsAmount: '60',
            items: { create: { productId: f.product.id, quantity: '6', shippedQuantity: '6', salesUnitPrice: '10', supplyUnitPrice: '8', salesLineAmount: '60', supplyLineAmount: '48' } },
          }, include: { items: true } });
          const shipment = await tx.shipment.create({ data: {
            shipmentNo: f.code, supplierOrderId: order.id, sequence: 1, kind: 'INITIAL',
            items: { create: { orderItemId: order.items[0]!.id, quantity: '6', salesPriceSnapshot: '10', supplyPriceSnapshot: '8', salesLineAmount: '60', supplyLineAmount: '48' } },
          }, include: { items: true } });
          await f.sync();
          const service = new ShipmentsService({ client: tx } as never);
          const receipt = async (quantity: string, revision: number) => service.createReceipt(shipment.id, {
            expectedOrderVersion: (await tx.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).version,
            expectedReceiptRevision: revision, items: [{ shipmentItemId: shipment.items[0]!.id, receivedQuantity: quantity }],
          }, undefined, undefined, tx);
          if (scenario === 'receipt-revision') {
            await receipt('6', 0);
            assert.deepEqual([(await f.account()).balance.toFixed(2), (await f.account()).reservedBalance.toFixed(2)], ['40.00', '0.00']);
            await f.sync();
            assert.equal(await cashCount(), 1);
            await receipt('4', 1);
            assert.deepEqual([(await f.account()).balance.toFixed(2), (await f.account()).reservedBalance.toFixed(2)], ['100.00', '60.00']);
            await receipt('6', 2);
            assert.equal((await f.account()).balance.toFixed(2), '40.00');
            assert.equal(await cashCount(), 3);
          } else {
            await receipt('4', 0);
            assert.equal((await f.account()).balance.toFixed(2), '100.00');
            const discrepancy = await tx.discrepancy.findFirstOrThrow({ where: { orderItemId: order.items[0]!.id } });
            await tx.discrepancy.update({ where: { id: discrepancy.id }, data: { status: 'RESOLVED' } });
            await tx.discrepancyAction.create({ data: { discrepancyId: discrepancy.id, action: 'ACCEPT' } });
            await adjustAcceptedShortage(tx, discrepancy.id, order.items[0]!.id);
            assert.equal((await f.account()).reservedBalance.toFixed(2), '40.00');
            await tx.supplierOrder.update({ where: { id: order.id }, data: { fulfillmentStatus: 'COMPLETED' } });
            await f.sync(undefined, true);
            assert.deepEqual([(await f.account()).balance.toFixed(2), (await f.account()).reservedBalance.toFixed(2)], ['60.00', '0.00']);
            assert.equal(await cashCount(), 1);
          }
        }
        throw rollback;
      }, { timeout: 20000 }), error => error === rollback);
    } finally { await db.$disconnect(); }
  });
}
