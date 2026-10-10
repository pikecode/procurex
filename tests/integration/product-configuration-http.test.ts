import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../packages/domain/src/password.js';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';

test('product form configuration saves atomically and invalidates opposite-side association edits', async () => {
  const prefix = `PC${Date.now()}`; const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
  const app = await NestFactory.create(AppModule, { logger: false }); app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor()); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  let actor: { id: string } | undefined;
  try {
    const role = await db.role.findUniqueOrThrow({ where: { code: 'ADMIN' } }); const password = randomUUID();
    actor = await db.user.create({ data: { username: prefix, displayName: prefix, passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } } } });
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: prefix, password, client: 'WEB' }) });
    assert.equal(login.status, 201); const token = (await login.json()).data.accessToken;
    const call = async (path: string, method: string, body?: unknown) => { const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
    const category = await db.category.create({ data: { code: prefix, name: prefix } });
    const sales = await db.unit.create({ data: { code: `${prefix}S`, name: `${prefix}袋` } }); const purchase = await db.unit.create({ data: { code: `${prefix}P`, name: `${prefix}包` } });
    const suppliers = await Promise.all([0, 1].map(index => db.supplier.create({ data: { code: `${prefix}${index}`, name: `${prefix}${index}`, deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY' } })));
    const draft = {
      name: `${prefix}商品`, categoryId: category.id, baseUnitId: sales.id, defaultSalesPrice: '12',
      supplierIds: suppliers.map(row => row.id),
      supplierPurchasePrices: suppliers.map((row, index) => ({ supplierId: row.id, supplyPrice: String(8 + index), expectedVersionId: null })),
      purchaseUnitConversion: { purchaseUnitId: purchase.id, salesUnitsPerPurchaseUnit: '10' },
    };
    for (const field of ['minOrderQty', 'orderMultiple']) for (const value of ['1.5', '0', '-1', '100000000000000']) {
      assert.equal((await call('/products', 'POST', { ...draft, [field]: value })).status, 400);
    }
    const created = await call('/products', 'POST', draft); assert.equal(created.status, 201); let product = created.body.data;
    assert.equal(product.minOrderQty, '1'); assert.equal(product.orderMultiple, '1');
    for (const field of ['minOrderQty', 'orderMultiple']) {
      assert.equal((await call(`/products/${product.id}`, 'PATCH', { expectedVersion: product.version, [field]: '2.5' })).status, 400);
    }
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).minOrderQty.toString(), '1');
    const template = (await call('/templates', 'POST', { code: `${prefix}TPL`, name: `${prefix}规则`, tag: '规则校验' })).body.data;
    assert.ok(template?.id);
    for (const field of ['minOrderQty', 'orderMultiple']) {
      const response = await call(`/templates/${template.id}/items`, 'PUT', { expectedVersion: template.version, items: [{ productId: product.id, suppliers: [{ supplierId: suppliers[0]!.id }], [field]: '1.5' }] });
      assert.equal(response.status, 400);
    }
    const templateItems = await call(`/templates/${template.id}/items`, 'PUT', { expectedVersion: template.version, items: [{ productId: product.id, salesPrice: '12', suppliers: [{ supplierId: suppliers[0]!.id }], minOrderQty: '2', orderMultiple: '3' }] });
    assert.equal(templateItems.status, 200);
    assert.deepEqual([...product.supplierIds].sort(), suppliers.map(row => row.id).sort()); assert.equal(product.purchaseUnitConversion.salesUnitsPerPurchaseUnit, '10');
    const oldSupplier = (await call(`/suppliers/${suppliers[0]!.id}/products`, 'GET')).body.data;
    const invalid = await call(`/products/${product.id}`, 'PATCH', { expectedVersion: product.version, name: `${prefix}不应保存`, supplierIds: [randomUUID()], purchaseUnitConversion: null }); assert.equal(invalid.status, 409);
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).name, draft.name); assert.ok(await db.productUnitConversion.findUnique({ where: { productId: product.id } }));
    for (const config of [{ supplierIds: 'bad' }, { supplierIds: [123] }, { purchaseUnitConversion: [] }, { purchaseUnitConversion: { purchaseUnitId: purchase.id, salesUnitsPerPurchaseUnit: '0' } }]) assert.ok([400, 409].includes((await call(`/products/${product.id}`, 'PATCH', { expectedVersion: product.version, ...config })).status));
    const update = await call(`/products/${product.id}`, 'PATCH', { expectedVersion: product.version, supplierIds: [suppliers[1]!.id], purchaseUnitConversion: null }); assert.equal(update.status, 200); product = update.body.data; assert.equal(product.purchaseUnitConversion, null);
    assert.equal((await call(`/suppliers/${suppliers[0]!.id}/products`, 'PUT', { expectedVersion: oldSupplier.version, productIds: [product.id] })).status, 409);
    const latestSupplier = (await call(`/suppliers/${suppliers[1]!.id}/products`, 'GET')).body.data;
    assert.equal((await call(`/suppliers/${suppliers[1]!.id}/products`, 'PUT', { expectedVersion: latestSupplier.version, productIds: [] })).status, 200);
    assert.equal((await call(`/products/${product.id}`, 'PATCH', { expectedVersion: product.version, name: '旧版本覆盖' })).status, 409);
    const failedCreate = await call('/products', 'POST', { ...draft, name: `${prefix}回滚`, supplierIds: [randomUUID()] }); assert.equal(failedCreate.status, 409); assert.equal(await db.product.count({ where: { name: `${prefix}回滚` } }), 0);
  } finally {
    await db.templateItem.deleteMany({ where: { template: { code: `${prefix}TPL` } } }); await db.orderTemplate.deleteMany({ where: { code: `${prefix}TPL` } });
    await db.priceScope.deleteMany({ where: { supplier: { code: { startsWith: prefix } } } });
    await db.supplierProduct.deleteMany({ where: { product: { name: { startsWith: prefix } } } }); await db.productUnitConversion.deleteMany({ where: { product: { name: { startsWith: prefix } } } }); await db.product.deleteMany({ where: { name: { startsWith: prefix } } });
    await db.supplier.deleteMany({ where: { code: { startsWith: prefix } } }); await db.category.deleteMany({ where: { code: prefix } }); await db.unit.deleteMany({ where: { code: { startsWith: prefix } } });
    if (actor) { await db.auditLog.deleteMany({ where: { actorUserId: actor.id } }); await db.user.delete({ where: { id: actor.id } }); }
    await app.close(); await db.$disconnect();
  }
});
