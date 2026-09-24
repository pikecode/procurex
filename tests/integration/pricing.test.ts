import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { DeliveryMode, FulfillmentStatus, PurchaseRequestStatus, SettlementMode, SupplierOrderStatus } from '../../packages/backend/generated/prisma/enums.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { PricingService } from '../../apps/api/src/pricing/pricing.service.js';
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
    const latest = await service.publishPrice({
      productId: product.id,
      supplierId: supplier.id,
      salesPrice: '12.000000',
      supplyPrice: '9.000000',
      effectiveAt: new Date('2026-09-10T00:00:00.000Z'),
      reason: 'Price increase',
    });
    const processed = await service.processRun(latest.runId!);
    assert.equal(processed.status, 'SUCCEEDED');
    assert.equal(processed.orders[0]?.supplierOrderId, order.id);
    assert.equal(processed.orders[0]?.adjustment?.previousSalesPrice, '10');
    assert.equal(processed.orders[0]?.adjustment?.newSalesPrice, '12');
    const updatedOrder = await prisma.supplierOrder.findUnique({ where: { id: order.id }, include: { items: true } });
    assert.equal(updatedOrder?.items[0]?.salesLineAmount.toString(), '120');
    assert.equal(updatedOrder?.items[0]?.supplyLineAmount.toString(), '90');
    assert.equal((await prisma.priceChangeAdjustment.count({ where: { runId: latest.runId } })), 1);
    await prisma.supplierOrder.update({ where: { id: order.id }, data: { status: SupplierOrderStatus.COMPLETED } });
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
