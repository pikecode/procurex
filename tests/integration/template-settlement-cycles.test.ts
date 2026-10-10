import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { TemplatesService } from '../../apps/api/src/templates/templates.service.js';
import { resolveSettlementTerms } from '../../apps/api/src/purchase-requests/request-funding.js';

test('template cycles isolate stores, inherit defaults and reject unrelated bindings atomically', async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
  const code = `CYCLE${randomUUID().replaceAll('-', '')}`;
  try {
    const stores = await Promise.all([1, 2].map(n => db.store.create({ data: { code: `${code}${n}`, name: `${code}${n}` } })));
    const supplier = await db.supplier.create({ data: { code, name: code, deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY' } });
    const category = await db.category.create({ data: { code, name: code } });
    const unit = await db.unit.create({ data: { code, name: code } });
    const product = await db.product.create({ data: { name: code, categoryId: category.id, baseUnitId: unit.id } });
    const template = await db.orderTemplate.create({ data: { code, name: code,
      bindings: { create: stores.map(store => ({ storeId: store.id })) },
      items: { create: { productId: product.id, suppliers: { create: { supplierId: supplier.id } } } },
    } });
    const service = new TemplatesService({ client: db } as never);
    let version = new Date(template.updatedAt).getTime();
    const row = { storeId: stores[0]!.id, supplierId: supplier.id, settlementCycle: 'WEEKLY' };
    const saved = await service.replaceSettlementCycles(template.id, version, [row]);
    version = saved.version;
    assert.equal((await resolveSettlementTerms(db, template.id, [supplier.id], stores[0]!.id)).get(supplier.id)!.cycle, 'WEEKLY');
    assert.equal((await resolveSettlementTerms(db, template.id, [supplier.id], stores[1]!.id)).get(supplier.id)!.cycle, 'MONTHLY');
    for (const rows of [[row, row], [{ ...row, storeId: randomUUID() }], [{ ...row, supplierId: randomUUID() }], [{ ...row, settlementCycle: 'invalid' }]]) {
      await assert.rejects(service.replaceSettlementCycles(template.id, version, rows));
      assert.equal(await db.templateStoreSupplierCycle.count({ where: { templateId: template.id } }), 1);
    }
    await assert.rejects(service.replaceSettlementCycles(template.id, version - 1, []));
    const reset = await service.replaceSettlementCycles(template.id, version, []);
    assert.equal((await resolveSettlementTerms(db, template.id, [supplier.id], stores[0]!.id)).get(supplier.id)!.cycle, 'MONTHLY');
    const restored = await service.replaceSettlementCycles(template.id, reset.version, [row]);
    const rebound = await service.replaceTemplateStores(template.id, restored.version, [stores[1]!.id]);
    assert.equal(await db.templateStoreSupplierCycle.count({ where: { templateId: template.id } }), 0);
    await db.supplier.update({ where: { id: supplier.id }, data: { defaultSettlementMode: 'CREDIT' } });
    await assert.rejects(service.replaceSettlementCycles(template.id, rebound.version, [{ ...row, storeId: stores[1]!.id }]));
    assert.deepEqual((await resolveSettlementTerms(db, template.id, [supplier.id], stores[0]!.id)).get(supplier.id), { mode: 'CREDIT', cycle: 'IMMEDIATE' });
  } finally {
    await db.orderTemplate.deleteMany({ where: { code } }).catch(async () => {
      await db.storeTemplateBinding.deleteMany({ where: { template: { code } } });
      await db.orderTemplate.deleteMany({ where: { code } });
    });
    await db.product.deleteMany({ where: { name: code } });
    await db.supplier.deleteMany({ where: { code } });
    await db.store.deleteMany({ where: { code: { startsWith: code } } });
    await db.category.deleteMany({ where: { code } });
    await db.unit.deleteMany({ where: { code } });
    await db.$disconnect();
  }
});
