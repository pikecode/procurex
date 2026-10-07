import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { AppModule } from '../../apps/api/src/app.module.js';
import { PricingService } from '../../apps/api/src/pricing/pricing.service.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../../packages/domain/src/password.js';

for (const mode of ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM'] as const) for (const priceScope of ['SHARED', 'TEMPLATE'] as const) {
  test(`AC-09 HTTP ${mode} ${priceScope}: Shanghai midnight changes new requests, not existing approvals`, async t => {
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
    const prefix = `MID${Date.now()}${mode[0]}${priceScope[0]}`;
    const app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    try {
      const category = await db.category.create({ data: { code: prefix, name: prefix } });
      const unit = await db.unit.create({ data: { code: prefix, name: 'piece' } });
      const product = await db.product.create({ data: { sku: prefix, name: prefix, categoryId: category.id, baseUnitId: unit.id } });
      const supplier = await db.supplier.create({ data: { code: prefix, name: prefix, deliveryMode: 'SELF', defaultSettlementMode: mode, defaultSettlementCycle: 'MONTHLY' } });
      await db.supplierProduct.create({ data: { productId: product.id, supplierId: supplier.id } });
      const store = await db.store.create({ data: { code: prefix, name: prefix } });
      await db.storeAccount.create({ data: { storeId: store.id, balance: '1000', creditLimit: '1000' } });
      const template = await db.orderTemplate.create({ data: { code: prefix, name: prefix, bindings: { create: { storeId: store.id } },
        items: { create: { productId: product.id, suppliers: { create: { supplierId: supplier.id } } } } } });
      const oldSales = mode === 'SUPPLIER_TERM' ? '9' : '12', newSales = mode === 'SUPPLIER_TERM' ? '10' : '13';
      const pricing = app.get(PricingService);
      await pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: oldSales, supplyPrice: '9', effectiveAt: new Date('2000-01-01'), reason: prefix });
      const midnight = new Date('2026-10-06T00:00:00.000+08:00').getTime();
      if (mode === 'SUPPLIER_TERM' || priceScope === 'SHARED') await pricing.publishPrice({ productId: product.id, supplierId: supplier.id,
        salesPrice: newSales, supplyPrice: mode === 'SUPPLIER_TERM' ? '10' : '9', effectiveAt: new Date(midnight), reason: prefix });
      if (priceScope === 'TEMPLATE') await pricing.publishPrice({ templateId: template.id, productId: product.id, supplierId: supplier.id,
        salesPrice: newSales, supplyPrice: mode === 'SUPPLIER_TERM' ? '10' : '9', effectiveAt: new Date(midnight), reason: prefix });
      const role = await db.role.upsert({ where: { code: 'ADMIN' }, update: {}, create: { code: 'ADMIN', name: 'ADMIN' } });
      await db.user.create({ data: { username: prefix, displayName: prefix, passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } } } });
      await app.listen(0, '127.0.0.1');
      const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
      t.mock.timers.enable({ apis: ['Date'], now: midnight - 1 });
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: prefix, password: 'correct-password', client: 'WEB' }) });
      assert.equal(login.status, 201); const token = (await login.json() as any).data.accessToken;
      const call = async (path: string, body?: object, key = `${prefix}-${Date.now()}-${path}`) => {
        const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key }, body: body ? JSON.stringify(body) : undefined });
        return { status: response.status, body: await response.json() as any };
      };
      const input = { storeId: store.id, items: [{ productId: product.id, quantity: '1' }] };
      const preview = async () => { const response = await call('/purchase-requests/preview', input); assert.equal(response.status, 201); return response.body.data; };
      const approved = (quote: any) => ({ ...input, expectedTemplateId: quote.templateId, items: [{ ...input.items[0], expectedPriceVersionId: quote.items[0].priceVersionId, expectedSupplyPriceVersionId: quote.items[0].supplyPriceVersionId }] });
      const before = await preview(); assert.equal(before.totals.salesGoodsAmount, `${oldSales}.00`);
      const originalBody = approved(before), originalKey = `${prefix}-before`;
      const original = await call('/purchase-requests', originalBody, originalKey); assert.equal(original.status, 201);
      const confirmed = await call(`/purchase-requests/${original.body.data.id}/confirm`, { expectedVersion: original.body.data.version }); assert.equal(confirmed.status, 201);
      t.mock.timers.setTime(midnight);
      const count = await db.purchaseRequest.count({ where: { storeId: store.id } });
      const accountBefore = await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
      const stale = await call('/purchase-requests', originalBody, `${prefix}-stale`);
      assert.equal(stale.status, 409); assert.equal(stale.body.code, 'VERSION_CONFLICT');
      assert.equal(await db.purchaseRequest.count({ where: { storeId: store.id } }), count);
      assert.deepEqual(await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } }), accountBefore);
      for (const at of [midnight, midnight + 1]) {
        t.mock.timers.setTime(at);
        const quote = await preview(); assert.equal(quote.totals.salesGoodsAmount, `${newSales}.00`);
        const created = await call('/purchase-requests', approved(quote)); assert.equal(created.status, 201);
        assert.equal(created.body.data.totals.salesGoodsAmount, `${newSales}.00`);
      }
      const replay = await call('/purchase-requests', originalBody, originalKey); assert.equal(replay.status, 201);
      assert.deepEqual(replay.body.data, original.body.data);
      const oldOrder = await db.supplierOrder.findFirstOrThrow({ where: { requestId: original.body.data.id } });
      assert.equal(oldOrder.salesGoodsAmount.toFixed(2), `${oldSales}.00`);
      assert.equal(oldOrder.supplyGoodsAmount.toFixed(2), '9.00');
      assert.equal(await db.purchaseRequest.count({ where: { storeId: store.id } }), 3);
      t.diagnostic('Application Date mocked at Shanghai 23:59:59.999, 00:00:00.000 and 00:00:00.001; no OS clock or database dates changed.');
    } finally {
      t.mock.timers.reset(); await app.close();
      await db.auditLog.deleteMany({ where: { actor: { username: prefix } } }); await db.commandRecord.deleteMany({ where: { actor: { username: prefix } } });
      const stores = { store: { code: prefix } };
      await db.fundingAllocation.deleteMany({ where: { store: stores } }); await db.accountLedger.deleteMany({ where: { account: stores } });
      await db.supplierOrder.deleteMany({ where: stores }); await db.purchaseRequest.deleteMany({ where: stores });
      await db.storeTemplateBinding.deleteMany({ where: { template: { code: prefix } } }); await db.orderTemplate.deleteMany({ where: { code: prefix } });
      await db.priceScope.deleteMany({ where: { supplier: { code: prefix } } }); await db.supplierProduct.deleteMany({ where: { supplier: { code: prefix } } });
      await db.product.deleteMany({ where: { sku: prefix } }); await db.supplier.deleteMany({ where: { code: prefix } });
      await db.storeAccount.deleteMany({ where: stores }); await db.store.deleteMany({ where: { code: prefix } });
      await db.category.deleteMany({ where: { code: prefix } }); await db.unit.deleteMany({ where: { code: prefix } });
      await db.user.deleteMany({ where: { username: prefix } }); await db.$disconnect();
    }
  });
}
