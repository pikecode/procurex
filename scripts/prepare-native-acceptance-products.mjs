import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';

export async function prepareNativeAcceptanceProducts(seed) {
  const connectionString = process.env.DATABASE_URL || 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname), 'Native fixtures require a local database');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    return await prisma.$transaction(async tx => {
      const original = await tx.product.findUniqueOrThrow({ where: { id: seed.productId } });
      assert.equal(original.sku, 'PXFLOW-SKU');
      const binding = await tx.storeTemplateBinding.findFirstOrThrow({ where: { storeId: seed.storeId }, include: { template: true } });
      assert.equal(binding.template.code, 'PXFLOW-TPL');
      const ids = [original.id];
      for (const number of [2, 3]) {
        const product = await tx.product.upsert({ where: { sku: `PXFLOW-NATIVE-${number}` }, update: {},
          create: { sku: `PXFLOW-NATIVE-${number}`, name: `小程序验收商品${number}`, categoryId: original.categoryId, baseUnitId: original.baseUnitId } });
        ids.push(product.id);
        const item = await tx.templateItem.upsert({ where: { templateId_productId: { templateId: binding.templateId, productId: product.id } },
          update: {}, create: { templateId: binding.templateId, productId: product.id, sortOrder: number } });
        for (const [index, supplierId] of [seed.supplierId, seed.secondarySupplierId].entries()) {
          await tx.templateItemSupplier.upsert({ where: { templateItemId_supplierId: { templateItemId: item.id, supplierId } },
            update: {}, create: { templateItemId: item.id, supplierId, priority: index + 1 } });
          await tx.supplierProduct.upsert({ where: { supplierId_productId: { supplierId, productId: product.id } },
            update: {}, create: { supplierId, productId: product.id } });
          const scope = await tx.priceScope.upsert({ where: { productId_supplierId_templateKey: { productId: product.id, supplierId, templateKey: '' } }, update: {}, create: { productId: product.id, supplierId } });
          await tx.priceVersion.upsert({ where: { scopeId_revision: { scopeId: scope.id, revision: 1 } }, update: {},
            create: { scopeId: scope.id, revision: 1, salesPrice: '12', supplyPrice: index ? '9.50' : '9', effectiveAt: new Date('2026-09-01T00:00:00Z'), reason: 'Local native acceptance fixture' } });
        }
      }
      return ids;
    });
  } finally {
    await prisma.$disconnect();
  }
}
