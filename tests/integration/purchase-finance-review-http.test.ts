import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../../packages/domain/src/password.js';

test('procurement confirmation gates funding and atomically generates orders without finance review', async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const prefix = `FRA${Date.now()}`;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  const call = async (path: string, token: string, body?: object, key = randomUUID(), method = body ? 'POST' : 'GET') => {
    const response = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    return { status: response.status, body: result, data: result.data };
  };
  try {
    const store = await db.store.create({ data: { code: prefix, name: '财务审核测试门店' } });
    const otherStore = await db.store.create({ data: { code: `${prefix}B`, name: '范围外门店' } });
    const account = await db.storeAccount.create({ data: { storeId: store.id, balance: 0, creditLimit: 0 } });
    const tokens: Record<string, string> = {};
    for (const code of ['ADMIN', 'PURCHASER', 'HQ_FINANCE', 'REGION_FINANCE', 'STORE', 'SUPPLIER']) {
      const role = await db.role.upsert({ where: { code }, update: {}, create: { code, name: code } });
      const user = await db.user.create({ data: { username: `${prefix}${code}`, displayName: code, passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } } } });
      if (code === 'REGION_FINANCE') await db.userScope.create({ data: { userId: user.id, scopeType: 'MULTI_STORE', stores: { create: { storeId: otherStore.id } } } });
      if (code === 'STORE') await db.userScope.create({ data: { userId: user.id, scopeType: 'STORE', storeId: store.id } });
      const login = await call('/auth/login', '', { username: user.username, password: 'correct-password', client: 'web' });
      assert.equal(login.status, 201, JSON.stringify(login.body)); tokens[code] = login.data.accessToken;
    }
    const unit = await db.unit.create({ data: { code: prefix, name: `${prefix}件` } });
    const category = await db.category.create({ data: { code: prefix, name: `${prefix}分类` } });
    const template = await db.orderTemplate.create({ data: { code: prefix, name: prefix } });
    await db.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } });
    const products: { productId: string; supplierId: string; quantity: string }[] = [];
    for (const [index, mode] of (['STORED_VALUE', 'CREDIT', 'SUPPLIER_TERM', 'COMPANY_TERM'] as const).entries()) {
      const supplier = await db.supplier.create({ data: { code: `${prefix}${index}`, name: `审核供应商${index}`, deliveryMode: 'SELF', defaultSettlementMode: mode, defaultSettlementCycle: 'WEEKLY' } });
      const product = await db.product.create({ data: { sku: `${prefix}${index}`, name: `审核商品${index}`, baseUnitId: unit.id, categoryId: category.id, suppliers: { create: { supplierId: supplier.id, supplyEnabled: true } } } });
      await db.templateItem.create({ data: { templateId: template.id, productId: product.id, suppliers: { create: { supplierId: supplier.id, priority: 1 } } } });
      const scope = await db.priceScope.create({ data: { productId: product.id, supplierId: supplier.id } });
      await db.priceVersion.create({ data: { scopeId: scope.id, salesPrice: (index + 1) * 10, supplyPrice: (index + 1) * 8, effectiveAt: new Date('2026-01-01') } });
      products.push({ productId: product.id, supplierId: supplier.id, quantity: '1' });
    }
    const create = await call('/purchase-requests', tokens.STORE!, { storeId: store.id, items: products.map(({ productId, quantity }) => ({ productId, quantity })) });
    assert.equal(create.status, 201); assert.equal(create.data.status, 'PENDING_FUNDS');
    const id = create.data.id;
    const detail = async () => (await call(`/purchase-requests/${id}`, tokens.ADMIN!)).data;
    const body = (version: number) => ({ expectedVersion: version });
    const edited = await call(`/purchase-requests/${id}/store-items`, tokens.STORE!, { expectedVersion: create.data.version,
      items: products.map(({ productId }) => ({ productId, quantity: '2' })) }, randomUUID(), 'PATCH');
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.data.salesGoodsAmount, '200.00');
    const restored = await call(`/purchase-requests/${id}/store-items`, tokens.STORE!, { expectedVersion: edited.data.version,
      items: products.map(({ productId, quantity }) => ({ productId, quantity })) }, randomUUID(), 'PATCH');
    assert.equal(restored.status, 200);
    let current = await detail();
    const preview = await call(`/purchase-requests/${id}/confirmation-preview`, tokens.PURCHASER!);
    assert.equal(preview.status, 200);
    assert.equal(preview.data.funding.stored.shortfall, '10.00');
    assert.equal(preview.data.funding.credit.shortfall, '20.00');
    assert.equal(preview.data.funding.canConfirm, false);
    const adjustmentPreview = await call(`/purchase-requests/${id}/items-preview`, tokens.PURCHASER!, { expectedVersion: current.version, reason: '资金调整预览', items: products });
    assert.equal(adjustmentPreview.status, 201);
    assert.equal(adjustmentPreview.data.settlementGroups.length, 4);
    assert.equal(adjustmentPreview.data.settlementGroups.find((group: { mode: string }) => group.mode === 'CREDIT').amount, '20.00');
    assert.equal((await detail()).version, current.version);
    const blocked = await call(`/purchase-requests/${id}/confirm`, tokens.PURCHASER!, body(current.version));
    assert.equal(blocked.status, 409);
    assert.equal(await db.supplierOrder.count({ where: { requestId: id } }), 0);
    assert.equal((await detail()).version, current.version);
    assert.equal((await detail()).procurementConfirmedAt, null);
    const adjusted = await call(`/purchase-requests/${id}/confirm-adjusted`, tokens.PURCHASER!, { expectedVersion: current.version, reason: '移除最后一项商品', items: products.slice(0, 3) });
    assert.equal(adjusted.status, 409);
    assert.ok(['PURCHASE_REQUEST_FUNDING_SHORTFALL', 'CREDIT_LIMIT_EXCEEDED'].includes(adjusted.body.code), JSON.stringify(adjusted.body));
    assert.equal((await detail()).salesGoodsAmount, '100.00');
    for (const role of ['HQ_FINANCE', 'REGION_FINANCE', 'STORE', 'SUPPLIER']) {
      assert.equal((await call(`/purchase-requests/${id}/confirm`, tokens[role]!, body(current.version))).status, 403);
    }
    assert.equal((await call(`/purchase-requests/${id}/finance-approve`, tokens.HQ_FINANCE!, body(current.version))).status, 409);
    await db.storeAccount.update({ where: { id: account.id }, data: { balance: 100 } });
    const creditBlocked = await call(`/purchase-requests/${id}/confirm`, tokens.PURCHASER!, body(current.version));
    assert.equal(creditBlocked.status, 409);
    assert.equal(await db.supplierOrder.count({ where: { requestId: id } }), 0);
    assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { id: account.id } })).reservedBalance.toFixed(2), '0.00');
    await db.storeAccount.update({ where: { id: account.id }, data: { creditLimit: 100 } });
    const ready = await call(`/purchase-requests/${id}/confirmation-preview`, tokens.PURCHASER!);
    assert.equal(ready.data.funding.canConfirm, true);
    const key = randomUUID();
    const approved = await call(`/purchase-requests/${id}/confirm`, tokens.PURCHASER!, body(current.version), key);
    assert.equal(approved.status, 201, JSON.stringify(approved.body));
    assert.equal(approved.data.status, 'CONFIRMED'); assert.equal(approved.data.supplierOrderIds.length, 4);
    const replay = await call(`/purchase-requests/${id}/confirm`, tokens.PURCHASER!, body(current.version), key);
    assert.deepEqual(replay.data, approved.data);
    assert.equal((await call(`/purchase-requests/${id}/confirm`, tokens.ADMIN!, body(current.version))).status, 409);
    current = await detail(); assert.ok(current.procurementConfirmedAt); assert.equal(current.financeReviewedAt, null);
    assert.equal((await call(`/purchase-requests/${id}/store-items`, tokens.STORE!, { expectedVersion: current.version, items: products }, randomUUID(), 'PATCH')).status, 409);
    const after = await db.storeAccount.findUniqueOrThrow({ where: { id: account.id } });
    assert.equal(after.balance.toFixed(2), '100.00');
    assert.equal(after.reservedBalance.toFixed(2), '10.00'); assert.equal(after.creditUsed.toFixed(2), '20.00');
    assert.equal(await db.auditLog.count({ where: { entityId: id, action: 'purchase-request.confirm' } }), 1);
    const funded = await call('/purchase-requests', tokens.STORE!, { storeId: store.id, items: products.slice(0, 2).map(({ productId, quantity }) => ({ productId, quantity })) });
    assert.equal(funded.status, 201);
    const ownPreview = await call(`/purchase-requests/${funded.data.id}/confirmation-preview`, tokens.PURCHASER!);
    assert.equal(ownPreview.data.funding.stored.available, '90.00');
    assert.equal(ownPreview.data.funding.credit.available, '80.00');
    const concurrent = await Promise.all(['ADMIN', 'PURCHASER'].map(role => call(`/purchase-requests/${funded.data.id}/confirm`, tokens[role]!, body(funded.data.version))));
    assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 409]);
    assert.equal(await db.supplierOrder.count({ where: { requestId: funded.data.id } }), 2);
    const held = await db.storeAccount.findUniqueOrThrow({ where: { id: account.id } });
    assert.equal(held.reservedBalance.toFixed(2), '20.00'); assert.equal(held.creditUsed.toFixed(2), '40.00');
    await db.storeAccount.update({ where: { id: account.id }, data: { balance: held.reservedBalance, creditLimit: held.creditUsed } });
    const term = await call('/purchase-requests', tokens.STORE!, { storeId: store.id, items: products.slice(2).map(({ productId, quantity }) => ({ productId, quantity })) });
    // Compatibility: an old pending-finance request is picked up by procurement, not finance.
    await db.purchaseRequest.update({ where: { id: term.data.id }, data: { status: 'PENDING_FINANCE' } });
    const termResult = await call(`/purchase-requests/${term.data.id}/confirm`, tokens.PURCHASER!, body(term.data.version));
    assert.equal(termResult.status, 201, JSON.stringify(termResult.body));
    assert.equal(termResult.data.supplierOrderIds.length, 2);
  } finally {
    await app.close();
    const stores = { code: { startsWith: prefix } };
    await db.commandRecord.deleteMany({ where: { actor: { username: { startsWith: prefix } } } });
    await db.fundingAllocation.deleteMany({ where: { store: { store: stores } } });
    await db.accountLedger.deleteMany({ where: { account: { store: stores } } });
    await db.orderItem.deleteMany({ where: { supplierOrder: { store: stores } } });
    await db.supplierOrder.deleteMany({ where: { store: stores } });
    await db.purchaseRequest.deleteMany({ where: { store: stores } });
    await db.priceVersion.deleteMany({ where: { scope: { supplier: { code: { startsWith: prefix } } } } });
    await db.priceScope.deleteMany({ where: { supplier: { code: { startsWith: prefix } } } });
    await db.storeTemplateBinding.deleteMany({ where: { store: stores } });
    await db.templateItemSupplier.deleteMany({ where: { templateItem: { template: { code: prefix } } } });
    await db.templateItem.deleteMany({ where: { template: { code: prefix } } });
    await db.orderTemplate.deleteMany({ where: { code: prefix } });
    await db.supplierProduct.deleteMany({ where: { product: { sku: { startsWith: prefix } } } });
    await db.product.deleteMany({ where: { sku: { startsWith: prefix } } });
    await db.supplier.deleteMany({ where: { code: { startsWith: prefix } } });
    await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await db.storeAccount.deleteMany({ where: { store: stores } });
    await db.store.deleteMany({ where: stores });
    await db.category.deleteMany({ where: { code: prefix } });
    await db.unit.deleteMany({ where: { code: prefix } });
    await db.$disconnect();
  }
});
