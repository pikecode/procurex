import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { DeliveryMode, FulfillmentStatus, PurchaseRequestStatus, SettlementMode, SupplierOrderStatus } from '../../packages/backend/generated/prisma/enums.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { PricingService } from '../../apps/api/src/pricing/pricing.service.js';
import { PaymentRecordsService } from '../../apps/api/src/payment-records/payment-records.service.js';
import { SupplierStatementsService } from '../../apps/api/src/supplier-statements/supplier-statements.service.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';

function createClient(): InstanceType<typeof PrismaClient> {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

function createService(prisma: InstanceType<typeof PrismaClient>): PricingService {
  return new PricingService({ client: prisma } as never);
}

test('pricing service returns latest version effective at business time', async () => {
  const prisma = createClient();
  const service = createService(prisma);
  const runId = Date.now();
  const categoryCode = `PRICECAT${runId}`;
  const unitCode = `PRICEUNIT${runId}`;
  const sku = `PRICESKU${runId}`;
  const supplierCode = `PRICESUP${runId}`;

  try {
    const [category, unit, supplier] = await Promise.all([
      prisma.category.create({ data: { code: categoryCode, name: 'Price Category' } }),
      prisma.unit.create({ data: { code: unitCode, name: 'piece' } }),
      prisma.supplier.create({
        data: {
          code: supplierCode,
          name: 'Price Supplier',
          deliveryMode: DeliveryMode.SELF,
          defaultSettlementMode: SettlementMode.COMPANY_TERM,
          defaultSettlementCycle: 'MONTHLY',
        },
      }),
    ]);
    const product = await prisma.product.create({
      data: {
        sku,
        name: 'Price Product',
        categoryId: category.id,
        baseUnitId: unit.id,
      },
    });

    await service.publishPrice({
      productId: product.id,
      supplierId: supplier.id,
      salesPrice: '10.000000',
      supplyPrice: '8.000000',
      effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      reason: 'Initial price',
    });
    const store = await prisma.store.create({ data: { code: `PRICESTORE${runId}`, name: 'Price Store' } });
    const template = await prisma.orderTemplate.create({ data: { code: `PRICETPL${runId}`, name: 'Price Template' } });
    const request = await prisma.purchaseRequest.create({
      data: {
        requestNo: `PRICEREQ${runId}`,
        storeId: store.id,
        templateId: template.id,
        status: PurchaseRequestStatus.CONFIRMED,
        submittedAt: new Date('2026-09-05T00:00:00.000Z'),
        salesGoodsAmount: '100.00',
        supplyGoodsAmount: '80.00',
      },
    });
    const order = await prisma.supplierOrder.create({
      data: {
        supplierOrderNo: `PRICESO${runId}`,
        requestId: request.id,
        storeId: store.id,
        supplierId: supplier.id,
        settlementMode: SettlementMode.COMPANY_TERM,
        status: SupplierOrderStatus.PUSHED,
        fulfillmentStatus: FulfillmentStatus.PARTIAL_SHIPPED,
        firstShippedAt: new Date('2026-09-15T00:00:00.000Z'),
        salesGoodsAmount: '100.00',
        supplyGoodsAmount: '80.00',
        items: {
          create: {
            productId: product.id,
            quantity: '10',
            salesUnitPrice: '10',
            supplyUnitPrice: '8',
            salesLineAmount: '100.00',
            supplyLineAmount: '80.00',
          },
        },
      },
      include: { items: true },
    });
    const staleOrder = await prisma.supplierOrder.create({
      data: {
        supplierOrderNo: `PRICESTALE${runId}`,
        requestId: request.id,
        storeId: store.id,
        supplierId: supplier.id,
        status: SupplierOrderStatus.PUSHED,
        fulfillmentStatus: FulfillmentStatus.PENDING,
        firstShippedAt: new Date('2026-09-15T00:00:00.000Z'),
        salesGoodsAmount: '10.00',
        supplyGoodsAmount: '8.00',
        items: { create: { productId: product.id, quantity: '1', salesUnitPrice: '10', supplyUnitPrice: '8', salesLineAmount: '10.00', supplyLineAmount: '8.00' } },
      },
    });
    const latest = await service.publishPrice({
      productId: product.id,
      supplierId: supplier.id,
      salesPrice: '12.000000',
      supplyPrice: '9.000000',
      effectiveAt: new Date('2026-09-10T00:00:00.000Z'),
      reason: 'Price increase',
    });
    await prisma.supplierOrder.update({ where: { id: staleOrder.id }, data: { status: SupplierOrderStatus.COMPLETED } });
    const processed = await service.processRun(latest.runId!);
    assert.equal(processed.status, 'FAILED');
    assert.equal(processed.orders.find((item) => item.supplierOrderId === order.id)?.status, 'SUCCEEDED');
    assert.equal(processed.orders.find((item) => item.supplierOrderId === order.id)?.supplierOrderId, order.id);
    assert.equal(processed.orders.find((item) => item.supplierOrderId === staleOrder.id)?.status, 'FAILED');
    const succeededOrder = processed.orders.find((item) => item.supplierOrderId === order.id);
    assert.equal(succeededOrder?.adjustment?.previousSalesPrice, '10');
    assert.equal(succeededOrder?.adjustment?.newSalesPrice, '12');
    const updatedOrder = await prisma.supplierOrder.findUnique({ where: { id: order.id }, include: { items: true } });
    assert.equal(updatedOrder?.items[0]?.salesLineAmount.toString(), '120');
    assert.equal(updatedOrder?.items[0]?.supplyLineAmount.toString(), '90');
    assert.equal((await prisma.priceChangeAdjustment.count({ where: { runId: latest.runId } })), 1);
    await prisma.supplierOrder.update({ where: { id: order.id }, data: { status: SupplierOrderStatus.COMPLETED } });
    const repricedRequest = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(repricedRequest.shortfallAmount.toFixed(2), '120.00');
    assert.equal(repricedRequest.paymentStatus, 'UNPAID');
    const storeSettlementItemId = Buffer.from(JSON.stringify({ kind: 'STORE_RECEIVABLE', supplierOrderId: order.id })).toString('base64url');
    await assert.rejects(
      new PaymentRecordsService({ client: prisma } as never).preview([storeSettlementItemId]),
      (error: unknown) => error instanceof NotFoundException && JSON.stringify(error.getResponse()).includes('UNRESOLVED_FUNDING_SHORTFALL'),
    );
    await prisma.purchaseRequest.update({ where: { id: request.id }, data: { shortfallAmount: '0.00' } });
    const supplierSettlementItemId = Buffer.from(JSON.stringify({ kind: 'SUPPLIER_PAYABLE', supplierOrderId: order.id })).toString('base64url');
    await assert.rejects(
      new PaymentRecordsService({ client: prisma } as never).preview([supplierSettlementItemId]),
      (error: unknown) => error instanceof NotFoundException && JSON.stringify(error.getResponse()).includes('STORE_RECEIVABLE_UNSETTLED'),
    );
    const statement = (await new SupplierStatementsService({ client: prisma } as never).list({ supplierId: supplier.id }))[0];
    assert.ok(statement);
    const statementDetail = await new SupplierStatementsService({ client: prisma } as never).get(statement.id);
    const statementLine = statementDetail.lines.find((line) => line.supplierOrderId === order.id);
    assert.equal(statementLine?.goodsAmount, '90.00');
    assert.equal(statementLine?.priceAdjustments[0]?.supplyDelta, '10.00');
    const adjustments = await service.listAdjustments(latest.runId!);
    assert.equal(adjustments.length, 1);
    assert.equal(adjustments[0]?.salesDelta, '20');
    assert.equal(adjustments[0]?.supplyDelta, '10');
    const sameTimeRevision = await service.publishPrice({
      productId: product.id,
      supplierId: supplier.id,
      salesPrice: '13.000000',
      supplyPrice: '10.000000',
      effectiveAt: new Date('2026-09-10T00:00:00.000Z'),
      reason: 'Correction',
    });
    assert.equal(latest.revision, 2);
    assert.equal(sameTimeRevision.revision, 3);

    const beforeChange = await service.getEffectivePrice(product.id, supplier.id, new Date('2026-09-05T00:00:00.000Z'));
    assert.equal(beforeChange.salesPrice, '10');
    assert.equal(beforeChange.supplyPrice, '8');

    const afterChange = await service.getEffectivePrice(product.id, supplier.id, new Date('2026-09-10T00:00:00.000Z'));
    assert.equal(afterChange.versionId, sameTimeRevision.versionId);
    assert.equal(afterChange.salesPrice, '13');
    assert.equal(afterChange.supplyPrice, '10');
    assert.equal(afterChange.revision, 3);

    await assert.rejects(
      service.getEffectivePrice(product.id, supplier.id, new Date('2026-08-31T00:00:00.000Z')),
      (error: unknown) => error instanceof NotFoundException && error.getStatus() === 404,
    );
  } finally {
    await prisma.priceVersion.deleteMany({ where: { scope: { supplier: { code: supplierCode } } } });
    await prisma.priceChangeAdjustment.deleteMany({ where: { supplierOrderId: { in: (await prisma.supplierOrder.findMany({ where: { supplier: { code: supplierCode } }, select: { id: true } })).map((item) => item.id) } } });
    await prisma.priceChangeRunOrder.deleteMany({ where: { supplierOrder: { supplier: { code: supplierCode } } } });
    await prisma.supplierOrder.deleteMany({ where: { supplier: { code: supplierCode } } });
    await prisma.purchaseRequest.deleteMany({ where: { requestNo: `PRICEREQ${runId}` } });
    await prisma.orderTemplate.deleteMany({ where: { code: `PRICETPL${runId}` } });
    await prisma.store.deleteMany({ where: { code: `PRICESTORE${runId}` } });
    await prisma.priceScope.deleteMany({ where: { supplier: { code: supplierCode } } });
    await prisma.product.deleteMany({ where: { sku } });
    await prisma.supplier.deleteMany({ where: { code: supplierCode } });
    await prisma.category.deleteMany({ where: { code: categoryCode } });
    await prisma.unit.deleteMany({ where: { code: unitCode } });
    await prisma.$disconnect();
  }
});

test('an older price run cannot overwrite a newer effective price when processed later', async () => {
  const prisma = createClient();
  const service = createService(prisma);
  const suffix = Date.now();
  const categoryCode = `ORDER${suffix}`;
  const unitCode = `ORDER${suffix}`;
  const sku = `ORDER${suffix}`;
  const supplierCode = `ORDER${suffix}`;
  const storeCode = `ORDER${suffix}`;
  const templateCode = `ORDER${suffix}`;
  const requestNo = `ORDER${suffix}`;

  try {
    const [category, unit, supplier, store, template] = await Promise.all([
      prisma.category.create({ data: { code: categoryCode, name: 'Order price category' } }),
      prisma.unit.create({ data: { code: unitCode, name: 'piece' } }),
      prisma.supplier.create({ data: { code: supplierCode, name: 'Order price supplier', deliveryMode: DeliveryMode.SELF, defaultSettlementMode: SettlementMode.COMPANY_TERM, defaultSettlementCycle: 'MONTHLY' } }),
      prisma.store.create({ data: { code: storeCode, name: 'Order price store' } }),
      prisma.orderTemplate.create({ data: { code: templateCode, name: 'Order price template' } }),
    ]);
    const product = await prisma.product.create({ data: { sku, name: 'Order price product', categoryId: category.id, baseUnitId: unit.id } });
    await service.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '10', supplyPrice: '8', effectiveAt: new Date('2026-09-01T00:00:00Z'), reason: 'Initial' });
    const request = await prisma.purchaseRequest.create({ data: { requestNo, storeId: store.id, templateId: template.id, status: PurchaseRequestStatus.CONFIRMED, submittedAt: new Date('2026-09-05T00:00:00Z'), salesGoodsAmount: '100', supplyGoodsAmount: '80' } });
    const order = await prisma.supplierOrder.create({
      data: {
        supplierOrderNo: `ORDER${suffix}`, requestId: request.id, storeId: store.id, supplierId: supplier.id,
        settlementMode: SettlementMode.COMPANY_TERM, status: SupplierOrderStatus.PUSHED,
        fulfillmentStatus: FulfillmentStatus.PARTIAL_SHIPPED, firstShippedAt: new Date('2026-09-15T00:00:00Z'),
        salesGoodsAmount: '100', supplyGoodsAmount: '80',
        items: { create: { productId: product.id, quantity: '10', salesUnitPrice: '10', supplyUnitPrice: '8', salesLineAmount: '100', supplyLineAmount: '80' } },
      },
    });
    const older = await service.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '12', supplyPrice: '9', effectiveAt: new Date('2026-09-10T00:00:00Z'), reason: 'Older effective price' });
    const newer = await service.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '13', supplyPrice: '10', effectiveAt: new Date('2026-09-12T00:00:00Z'), reason: 'Newer effective price' });

    await service.processRun(newer.runId!);
    const staleRun = await service.processRun(older.runId!);
    const updated = await prisma.supplierOrder.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    assert.equal(updated.items[0]?.salesUnitPrice.toString(), '13');
    assert.equal(updated.items[0]?.supplyUnitPrice.toString(), '10');
    const obsoleteEntry = staleRun.orders.find(({ supplierOrderId }) => supplierOrderId === order.id);
    assert.equal(obsoleteEntry?.status, 'SUCCEEDED');
    assert.equal(obsoleteEntry?.salesDelta, '0');
    assert.equal(obsoleteEntry?.supplyDelta, '0');
    assert.equal(await prisma.priceChangeAdjustment.count({ where: { runId: older.runId } }), 0);
  } finally {
    await prisma.priceVersion.deleteMany({ where: { scope: { supplier: { code: supplierCode } } } });
    const orderIds = (await prisma.supplierOrder.findMany({ where: { supplier: { code: supplierCode } }, select: { id: true } })).map(({ id }) => id);
    await prisma.priceChangeAdjustment.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
    await prisma.priceChangeRunOrder.deleteMany({ where: { supplierOrder: { supplier: { code: supplierCode } } } });
    await prisma.supplierOrder.deleteMany({ where: { supplier: { code: supplierCode } } });
    await prisma.purchaseRequest.deleteMany({ where: { requestNo } });
    await prisma.orderTemplate.deleteMany({ where: { code: templateCode } });
    await prisma.store.deleteMany({ where: { code: storeCode } });
    await prisma.priceScope.deleteMany({ where: { supplier: { code: supplierCode } } });
    await prisma.product.deleteMany({ where: { sku } });
    await prisma.supplier.deleteMany({ where: { code: supplierCode } });
    await prisma.category.deleteMany({ where: { code: categoryCode } });
    await prisma.unit.deleteMany({ where: { code: unitCode } });
    await prisma.$disconnect();
  }
});
