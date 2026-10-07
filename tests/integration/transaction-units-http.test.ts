import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../packages/domain/src/password.js';
import { PurchaseRequestsService } from '../../apps/api/src/purchase-requests/purchase-requests.service.js';
import { PurchaseRequestPreviewService } from '../../apps/api/src/purchase-requests/purchase-request-preview.service.js';

test('purchase-unit configuration converts real requests and preserves snapshots through rename, disable, split and reallocation', async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
  const prefix = `ITUNIT${Date.now()}`;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  try {
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    const tokenFor = async (code: string) => {
      const role = await db.role.upsert({ where: { code }, update: {}, create: { code, name: code } });
      const username = `${prefix}${code}`;
      await db.user.create({ data: { username, displayName: code, passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } } } });
      const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-password', client: 'WEB' }) });
      assert.equal(response.status, 201); return (await response.json() as any).data.accessToken as string;
    };
    const admin = await tokenFor('ADMIN'), finance = await tokenFor('HQ_FINANCE');
    const call = async (path: string, method = 'GET', body?: object, token = admin, key = randomUUID()) => {
      const response = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: await response.json() as any };
    };
    const category = await db.category.create({ data: { code: prefix, name: 'Water' } });
    const bottle = await db.unit.create({ data: { code: `${prefix}B`, name: 'Bottle' } });
    const pack = await db.unit.create({ data: { code: `${prefix}P`, name: 'Pack' } });
    const store = await db.store.create({ data: { code: prefix, name: 'Unit test store' } });
    const template = await db.orderTemplate.create({ data: { code: prefix, name: prefix, tag: 'Units' } });
    const suppliers = await Promise.all(['A', 'B'].map(suffix => db.supplier.create({ data: { code: `${prefix}${suffix}`, name: suffix, deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY' } })));
    const product = await db.product.create({ data: { sku: prefix, name: 'Water', categoryId: category.id, baseUnitId: bottle.id, minOrderQty: '2', orderMultiple: '2' } });
    await db.templateItem.create({ data: { templateId: template.id, productId: product.id, suppliers: { create: suppliers.map((supplier, index) => ({ supplierId: supplier.id, priority: index + 1 })) } } });
    await db.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } });
    for (const supplier of suppliers) {
      await db.supplierProduct.create({ data: { supplierId: supplier.id, productId: product.id } });
      const scope = await db.priceScope.create({ data: { productId: product.id, supplierId: supplier.id } });
      await db.priceVersion.create({ data: { scopeId: scope.id, salesPrice: '1.234567', supplyPrice: '1', effectiveAt: new Date('2026-01-01') } });
    }
    const endpoint = `/products/${product.id}/purchase-unit`;
    const configure = (version: number, ratio = '12') => call(endpoint, 'PATCH', { expectedVersion: version, conversion: { purchaseUnitId: pack.id, salesUnitsPerPurchaseUnit: ratio } });
    assert.equal((await call(endpoint, 'PATCH', { expectedVersion: product.updatedAt.getTime(), conversion: null }, finance)).status, 403);
    assert.equal((await call(endpoint, 'PATCH', { expectedVersion: product.updatedAt.getTime() })).status, 400);
    assert.equal((await call(endpoint, 'PATCH', { expectedVersion: product.updatedAt.getTime(), conversion: { purchaseUnitId: bottle.id, salesUnitsPerPurchaseUnit: '12' } })).status, 409);
    assert.equal((await configure(product.updatedAt.getTime(), '0')).status, 409);
    assert.equal((await configure(product.updatedAt.getTime(), '0.000000001')).status, 400);
    let configured = await configure(product.updatedAt.getTime()); assert.equal(configured.status, 200);
    assert.equal((await configure(product.updatedAt.getTime())).status, 409);
    assert.equal(await db.productUnitConversion.count({ where: { productId: product.id } }), 1);
    const input = { storeId: store.id, items: [{ productId: product.id, unitId: pack.id, quantity: '2.5', expectedProductVersion: configured.body.data.version }] };
    const preview = await call('/purchase-requests/preview', 'POST', input); assert.equal(preview.status, 201);
    assert.equal(preview.body.data.items[0].quantity, '30'); assert.equal(preview.body.data.items[0].purchaseSalesUnitPrice, '14.814804');
    assert.equal(preview.body.data.totals.salesGoodsAmount, '37.04'); assert.equal(preview.body.data.totals.supplyGoodsAmount, '30.00');
    assert.equal((await call('/purchase-requests/preview', 'POST', { ...input, items: [{ productId: product.id, unitId: randomUUID(), quantity: '1' }] })).status, 409);
    assert.equal((await call('/purchase-requests/preview', 'POST', { ...input, items: [{ productId: product.id, quantity: '3' }] })).status, 409);
    const creationKey = randomUUID();
    const created = await call('/purchase-requests', 'POST', input, admin, creationKey); assert.equal(created.status, 201);
    const requestId = created.body.data.id;
    const snapshot = created.body.data.items[0].unitSnapshot;
    assert.equal(snapshot.inputQuantity, '2.5'); assert.equal(snapshot.salesUnitName, 'Bottle'); assert.equal(snapshot.purchaseUnitName, 'Pack');
    configured = await configure(configured.body.data.version, '24'); assert.equal(configured.status, 200);
    const replay = await call('/purchase-requests', 'POST', input, admin, creationKey);
    assert.equal(replay.status, 201); assert.equal(replay.body.data.id, requestId); assert.equal(replay.body.data.items[0].quantity, '30');
    const staleKey = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      const stale = await call('/purchase-requests', 'POST', input, admin, staleKey);
      assert.equal(stale.status, 409); assert.equal(stale.body.code, 'VERSION_CONFLICT');
    }
    assert.equal((await db.commandRecord.findFirstOrThrow({ where: { idempotencyKey: staleKey } })).status, 'FAILED');
    assert.equal(await db.purchaseRequest.count({ where: { storeId: store.id } }), 1);
    assert.equal((await call('/purchase-requests/preview', 'POST', input)).status, 409);
    assert.equal((await call('/purchase-requests/preview', 'POST', { ...input, items: [{ productId: product.id, unitId: pack.id, quantity: '2.5' }] })).body.data.items[0].quantity, '60');
    const beforeRename = await db.priceVersion.count({ where: { scope: { productId: product.id } } });
    assert.equal((await call(`/units/${bottle.id}`, 'PATCH', { expectedVersion: bottle.version, name: 'Bottle renamed' })).status, 200);
    assert.equal((await call(`/units/${pack.id}`, 'PATCH', { expectedVersion: pack.version, name: 'Pack renamed' })).status, 200);
    const request = (await call(`/purchase-requests/${requestId}`)).body.data;
    assert.deepEqual(request.items[0].unitSnapshot, snapshot); assert.equal(request.salesGoodsAmount, '37.04'); assert.equal(request.items[0].unitName, 'Bottle renamed'); assert.equal(request.items[0].purchaseUnitName, 'Pack renamed');
    const confirmed = await call(`/purchase-requests/${requestId}/confirm`, 'POST', { expectedVersion: request.version }); assert.equal(confirmed.status, 201);
    let orders = await db.supplierOrder.findMany({ where: { requestId }, include: { items: true } });
    assert.equal(orders.length, 1); assert.deepEqual(orders[0]!.items[0]!.unitSnapshot, snapshot);
    const orderDetail = (await call(`/supplier-orders/${orders[0]!.id}`)).body.data;
    assert.equal(orderDetail.items[0].unitName, 'Bottle renamed'); assert.equal(orderDetail.items[0].purchaseSupplyUnitPrice, '12');
    const rejected = await call(`/supplier-orders/${orders[0]!.id}/reject`, 'POST', { expectedVersion: orderDetail.version, reason: 'Alternate supply' }); assert.equal(rejected.status, 201);
    const reloaded = (await call(`/purchase-requests/${requestId}`)).body.data;
    const reallocated = await call(`/purchase-requests/${requestId}/reallocate`, 'POST', { expectedVersion: reloaded.version, rejectedOrderId: orders[0]!.id, assignments: [{ requestItemId: reloaded.items[0].id, supplierId: suppliers[1]!.id }], reason: 'Alternate supply' });
    assert.equal(reallocated.status, 201);
    orders = await db.supplierOrder.findMany({ where: { requestId }, include: { items: true } });
    assert.equal(orders.length, 2); for (const order of orders) assert.deepEqual(order.items[0]!.unitSnapshot, snapshot);
    const current = (await call('/products')).body.data.find((row: any) => row.id === product.id);
    assert.equal((await call(endpoint, 'PATCH', { expectedVersion: current.version, conversion: null })).status, 200);
    assert.equal((await call(`/supplier-orders/${orders[1]!.id}`)).body.data.items[0].purchaseSalesUnitPrice, '14.814804');
    assert.equal((await call('/purchase-requests/preview', 'POST', { ...input, items: [{ productId: product.id, unitId: pack.id, quantity: '1' }] })).status, 409);
    const basePreview = await call('/purchase-requests/preview', 'POST', { storeId: store.id, items: [{ productId: product.id, quantity: '2' }] });
    assert.equal(basePreview.status, 201); assert.equal(basePreview.body.data.items[0].unitSnapshot.salesUnitName, 'Bottle renamed');
    assert.equal(basePreview.body.data.items[0].unitSnapshot.purchaseUnitId, null);
    assert.equal(await db.priceVersion.count({ where: { scope: { productId: product.id } } }), beforeRename);
    assert.equal(await db.accountLedger.count({ where: { account: { store: { code: prefix } } } }), 0);

    // A real preview predating a metadata change must not create a request.
    const previewService = app.get(PurchaseRequestPreviewService);
    const original = previewService.preview.bind(previewService);
    const stalePreview = await original({ storeId: store.id, items: [{ productId: product.id, quantity: '2' }] });
    await db.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.catalog-registry'))`; await tx.unit.update({ where: { id: bottle.id }, data: { name: 'Concurrent name' } }); });
    previewService.preview = async () => stalePreview;
    const requestCount = await db.purchaseRequest.count({ where: { storeId: store.id } });
    try { await assert.rejects(app.get(PurchaseRequestsService).create({ storeId: store.id, items: [{ productId: product.id, quantity: '2' }] }), /preview the request again/); }
    finally { previewService.preview = original; }
    assert.equal(await db.purchaseRequest.count({ where: { storeId: store.id } }), requestCount);
  } finally {
    await app.close();
    await db.commandRecord.deleteMany({ where: { actor: { username: { startsWith: prefix } } } });
    await db.supplierOrder.deleteMany({ where: { store: { code: prefix } } }); await db.purchaseRequest.deleteMany({ where: { store: { code: prefix } } });
    const productIds = (await db.product.findMany({ where: { sku: prefix }, select: { id: true } })).map(product => product.id);
    await db.priceVersion.deleteMany({ where: { scope: { productId: { in: productIds } } } }); await db.priceScope.deleteMany({ where: { productId: { in: productIds } } });
    await db.storeTemplateBinding.deleteMany({ where: { template: { code: prefix } } });
    await db.templateItemSupplier.deleteMany({ where: { templateItem: { template: { code: prefix } } } }); await db.templateItem.deleteMany({ where: { template: { code: prefix } } });
    await db.supplierProduct.deleteMany({ where: { product: { sku: prefix } } }); await db.product.deleteMany({ where: { sku: prefix } });
    await db.orderTemplate.deleteMany({ where: { code: prefix } }); await db.storeAccount.deleteMany({ where: { store: { code: prefix } } }); await db.store.deleteMany({ where: { code: prefix } }); await db.supplier.deleteMany({ where: { code: { startsWith: prefix } } });
    await db.category.deleteMany({ where: { code: prefix } }); await db.unit.deleteMany({ where: { code: { startsWith: prefix } } }); await db.user.deleteMany({ where: { username: { startsWith: prefix } } }); await db.$disconnect();
  }
});
