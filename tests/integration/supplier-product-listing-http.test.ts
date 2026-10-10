import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { SuppliersService } from '../../apps/api/src/suppliers/suppliers.service.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../packages/domain/src/password.js';

test('supplier can list and unlist only its own associated products', async () => {
  const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const prefix = `ITLIST${Date.now()}`;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  try {
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    const role = await db.role.upsert({ where: { code: 'SUPPLIER' }, update: {}, create: { code: 'SUPPLIER', name: '供应商' } });
    const category = await db.category.create({ data: { code: `${prefix}C`, name: `${prefix}分类` } });
    const unit = await db.unit.create({ data: { code: `${prefix}U`, name: `${prefix}件` } });
    const product = await db.product.create({ data: { sku: `${prefix}P`, name: `${prefix}商品`, defaultSalesPrice: '12.00', categoryId: category.id, baseUnitId: unit.id } });
    const suppliers = await Promise.all(['A', 'B'].map(suffix => db.supplier.create({ data: { code: `${prefix}${suffix}`, name: `${prefix}供应商${suffix}`, deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY' } })));
    const link = await db.supplierProduct.create({ data: { supplierId: suppliers[0]!.id, productId: product.id } });
    const user = await db.user.create({ data: { username: prefix, displayName: '供应商上下架测试', passwordHash: await hashPassword('correct-password'),
      roles: { create: { roleId: role.id } }, scopes: { create: { scopeType: 'SUPPLIER', supplierId: suppliers[0]!.id } } } });
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: prefix, password: 'correct-password', client: 'WEB' }) });
    const token = (await login.json() as { data: { accessToken: string } }).data.accessToken;
    const call = (path: string, method = 'GET', body?: object) => fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

    assert.equal((await call(`/suppliers/${suppliers[1]!.id}/managed-products`)).status, 403);
    const managedResponse = await call(`/suppliers/${suppliers[0]!.id}/managed-products`);
    assert.equal(managedResponse.status, 200);
    const managed = (await managedResponse.json() as { data: { items: Array<{ id: string; supplyEnabled: boolean; version: number }> } }).data.items[0]!;
    assert.equal(managed.id, product.id); assert.equal(managed.supplyEnabled, true); assert.equal(managed.version, link.updatedAt.getTime());

    const unlistedResponse = await call(`/suppliers/${suppliers[0]!.id}/managed-products/${product.id}`, 'PATCH', { supplyEnabled: false, expectedVersion: managed.version });
    assert.equal(unlistedResponse.status, 200, await unlistedResponse.clone().text());
    const unlisted = (await unlistedResponse.json() as { data: { supplyEnabled: boolean; version: number } }).data;
    assert.equal(unlisted.supplyEnabled, false); assert.ok(unlisted.version > managed.version);
    const catalog = await call(`/suppliers/${suppliers[0]!.id}/catalog`);
    assert.deepEqual((await catalog.json() as { data: { items: unknown[] } }).data.items, []);
    const supplier = await db.supplier.findUniqueOrThrow({ where: { id: suppliers[0]!.id } });
    const saved = await app.get(SuppliersService).replaceSupplierProducts(supplier.id, supplier.updatedAt.getTime(), [product.id]);
    assert.deepEqual(saved.productIds, [product.id]);
    assert.equal((await db.supplierProduct.findUniqueOrThrow({ where: { supplierId_productId: { supplierId: supplier.id, productId: product.id } } })).supplyEnabled, false);
    assert.equal((await call(`/suppliers/${suppliers[0]!.id}/managed-products/${product.id}`, 'PATCH', { supplyEnabled: true, expectedVersion: managed.version })).status, 409);
    assert.equal((await call(`/suppliers/${suppliers[0]!.id}/managed-products/${product.id}`, 'PATCH', { supplyEnabled: true, expectedVersion: unlisted.version })).status, 200);
  } finally {
    await app.close();
    const productIds = (await db.product.findMany({ where: { sku: `${prefix}P` }, select: { id: true } })).map(item => item.id);
    await db.auditLog.deleteMany({ where: { actor: { username: prefix } } });
    await db.userSession.deleteMany({ where: { user: { username: prefix } } });
    await db.user.deleteMany({ where: { username: prefix } });
    await db.priceVersion.deleteMany({ where: { scope: { productId: { in: productIds } } } });
    await db.priceScope.deleteMany({ where: { productId: { in: productIds } } });
    await db.supplierProduct.deleteMany({ where: { supplier: { code: { startsWith: prefix } } } });
    await db.supplier.deleteMany({ where: { code: { startsWith: prefix } } });
    await db.product.deleteMany({ where: { sku: `${prefix}P` } });
    await db.category.deleteMany({ where: { code: `${prefix}C` } });
    await db.unit.deleteMany({ where: { code: `${prefix}U` } });
    await db.$disconnect();
  }
});
