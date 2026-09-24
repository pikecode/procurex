import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { DeliveryMode, SettlementMode } from '../../packages/backend/generated/prisma/enums.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { PricingService } from '../../apps/api/src/pricing/pricing.service.js';

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
    const latest = await service.publishPrice({
      productId: product.id,
      supplierId: supplier.id,
      salesPrice: '12.000000',
      supplyPrice: '9.000000',
      effectiveAt: new Date('2026-09-10T00:00:00.000Z'),
      reason: 'Price increase',
    });
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
    await prisma.priceScope.deleteMany({ where: { supplier: { code: supplierCode } } });
    await prisma.product.deleteMany({ where: { sku } });
    await prisma.supplier.deleteMany({ where: { code: supplierCode } });
    await prisma.category.deleteMany({ where: { code: categoryCode } });
    await prisma.unit.deleteMany({ where: { code: unitCode } });
    await prisma.$disconnect();
  }
});
