import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { AppModule } from '../../apps/api/src/app.module.js';
import { AuditService } from '../../apps/api/src/audit/audit.service.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../../packages/domain/src/password.js';

const actions = ['category.create', 'category.update', 'category.delete', 'unit.create', 'unit.update', 'unit.delete',
  'brand.create', 'brand.update', 'brand.delete', 'product.create', 'product.update', 'product.purchase-unit.set',
  'supplier.create', 'supplier.update', 'supplier.archive', 'supplier.products.replace', 'template.create', 'template.update',
  'template.copy', 'template.archive', 'template.stores.replace', 'template.items.replace',
  'template.supplier-setting.set', 'template.supplier-setting.clear', 'store.create', 'store.update', 'user.update'] as const;

for (const action of actions) for (const fault of [false, true]) {
  test(`master data HTTP ${action}: ${fault ? 'audit insertion failure rolls back and retry succeeds' : 'authenticated audit and forbidden role'}`, async () => {
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
    const code = `MDA${Date.now()}`;
    const app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    try {
      const category = await db.category.create({ data: { code, name: code } });
      const spareCategory = await db.category.create({ data: { code: `${code}S`, name: code } });
      const unit = await db.unit.create({ data: { code, name: code } });
      const spareUnit = await db.unit.create({ data: { code: `${code}S`, name: `${code}S` } });
      const brand = await db.brand.create({ data: { name: code } });
      const product = await db.product.create({ data: { sku: code, name: code, categoryId: category.id, baseUnitId: unit.id,
        ...(action === 'brand.update' ? { brandId: brand.id, brand: brand.name } : {}) } });
      const supplier = await db.supplier.create({ data: { code, name: code, deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'HALF_MONTHLY',
        contactPhone: 'private-phone', bankAccount: 'private-bank', remark: 'private-remark' } });
      await db.supplierProduct.create({ data: { supplierId: supplier.id, productId: product.id } });
      const store = await db.store.create({ data: { code, name: code } });
      const template = await db.orderTemplate.create({ data: { code, name: code,
        items: { create: { productId: product.id, suppliers: { create: { supplierId: supplier.id, priority: 1 } } } },
        settings: { create: { supplierId: supplier.id, settlementMode: 'COMPANY_TERM', settlementCycle: 'HALF_MONTHLY' } },
        bindings: { create: { storeId: store.id } } } });
      await db.priceScope.create({ data: { productId: product.id, supplierId: supplier.id, templateKey: template.id,
        versions: { create: { salesPrice: '12', supplyPrice: '9', effectiveAt: new Date('2000-01-01'), revision: 1, reason: code } } } });
      await app.listen(0, '127.0.0.1');
      const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
      const login = async (roleCode: string) => {
        const role = await db.role.upsert({ where: { code: roleCode }, update: {}, create: { code: roleCode, name: roleCode } });
        const user = await db.user.create({ data: { username: `${code}${roleCode}`, displayName: code, passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } } } });
        const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user.username, password: 'correct-password', client: 'WEB' }) });
        assert.equal(response.status, 201);
        const envelope = await response.json() as { data: { accessToken: string } };
        return { user, token: envelope.data.accessToken };
      };
      const admin = await login('ADMIN'), finance = await login('HQ_FINANCE');
      const targetUser = await db.user.create({ data: { username: `${code}TARGET`, displayName: code, passwordHash: 'unused' } });
      const version = template.updatedAt.getTime(), supplierVersion = supplier.updatedAt.getTime(), productVersion = product.updatedAt.getTime();
      const routes: Record<typeof actions[number], [string, string, object]> = {
        'store.create': ['/stores', 'POST', { code: `${code}NEW`, name: code, contactName: 'Contact', contactPhone: '123', address: 'Address', storeType: 'DIRECT' }],
        'store.update': [`/stores/${store.id}`, 'PATCH', { expectedVersion: store.updatedAt.getTime(), name: `${code}edited` }],
        'user.update': [`/users/${targetUser.id}`, 'PATCH', { expectedVersion: targetUser.updatedAt.getTime(), displayName: `${code}edited`, scope: { type: 'STORE', storeId: store.id } }],
        'category.create': ['/categories', 'POST', { code: `${code}NEW`, name: code }],
        'category.update': [`/categories/${category.id}`, 'PATCH', { expectedVersion: category.version, name: `${code}edited` }],
        'category.delete': [`/categories/${spareCategory.id}`, 'DELETE', { expectedVersion: spareCategory.version }],
        'unit.create': ['/units', 'POST', { code: `${code}NEW`, name: code }],
        'unit.update': [`/units/${unit.id}`, 'PATCH', { expectedVersion: unit.version, name: `${code}edited` }],
        'unit.delete': [`/units/${spareUnit.id}`, 'DELETE', { expectedVersion: spareUnit.version }],
        'brand.create': ['/brands', 'POST', { name: `${code}NEW` }],
        'brand.update': [`/brands/${brand.id}`, 'PATCH', { expectedVersion: brand.version, name: `${code}edited` }],
        'brand.delete': [`/brands/${brand.id}`, 'DELETE', { expectedVersion: brand.version }],
        'product.create': ['/products', 'POST', { sku: `${code}NEW`, name: code, categoryId: category.id, baseUnitId: unit.id, defaultSalesPrice: '12' }],
        'product.update': [`/products/${product.id}`, 'PATCH', { expectedVersion: productVersion, name: `${code}edited` }],
        'product.purchase-unit.set': [`/products/${product.id}/purchase-unit`, 'PATCH', { expectedVersion: productVersion, conversion: { purchaseUnitId: spareUnit.id, salesUnitsPerPurchaseUnit: '6' } }],
        'supplier.create': ['/suppliers', 'POST', { code: `${code}NEW`, name: code, contactName: 'Contact', contactPhone: '123', address: 'Address',
          bankName: 'private-bank', bankAccountName: 'private-bank', bankAccount: 'private-bank', taxpayerId: 'private-bank', invoiceTitle: 'private-bank',
          deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'HALF_MONTHLY' }],
        'supplier.update': [`/suppliers/${supplier.id}`, 'PATCH', { expectedVersion: supplierVersion, name: `${code}edited` }],
        'supplier.archive': [`/suppliers/${supplier.id}/archive`, 'POST', { expectedVersion: supplierVersion }],
        'supplier.products.replace': [`/suppliers/${supplier.id}/products`, 'PUT', { expectedVersion: supplierVersion, productIds: [] }],
        'template.create': ['/templates', 'POST', { code: `${code}NEW`, name: `${code}NEW`, tag: code }],
        'template.update': [`/templates/${template.id}`, 'PATCH', { expectedVersion: version, name: `${code}edited` }],
        'template.copy': [`/templates/${template.id}/copy`, 'POST', { expectedVersion: version, code: `${code}NEW`, name: `${code}NEW`, tag: code }],
        'template.archive': [`/templates/${template.id}/archive`, 'POST', { expectedVersion: version }],
        'template.stores.replace': [`/templates/${template.id}/stores`, 'PUT', { expectedVersion: version, storeIds: [] }],
        'template.items.replace': [`/templates/${template.id}/items`, 'PUT', { expectedVersion: version, items: [] }],
        'template.supplier-setting.set': [`/templates/${template.id}/supplier-settings/${supplier.id}`, 'PUT', { expectedVersion: version, settlementMode: 'CREDIT', settlementCycle: 'MONTHLY' }],
        'template.supplier-setting.clear': [`/templates/${template.id}/supplier-settings/${supplier.id}`, 'DELETE', { expectedVersion: version }],
      };
      const [path, method, body] = routes[action];
      const call = (token: string) => fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-trace-id': code },
        body: JSON.stringify({ ...body, actorUserId: finance.user.id, activeScope: { roles: ['HQ_FINANCE'] }, traceId: 'spoofed' }) });
      const snapshot = async () => JSON.stringify({
        stores: await db.store.findMany({ where: { code: { startsWith: code } }, orderBy: { id: 'asc' } }),
        users: await db.user.findMany({ where: { id: targetUser.id }, include: { scopes: true } }),
        categories: await db.category.findMany({ where: { code: { startsWith: code } }, orderBy: { id: 'asc' } }),
        units: await db.unit.findMany({ where: { code: { startsWith: code } }, orderBy: { id: 'asc' } }),
        brands: await db.brand.findMany({ where: { name: { startsWith: code } }, orderBy: { id: 'asc' } }),
        products: await db.product.findMany({ where: { sku: { startsWith: code } }, include: { conversion: true }, orderBy: { id: 'asc' } }),
        suppliers: await db.supplier.findMany({ where: { code: { startsWith: code } }, include: { products: true }, orderBy: { id: 'asc' } }),
        templates: await db.orderTemplate.findMany({ where: { code: { startsWith: code } }, include: { items: { include: { suppliers: true } }, settings: true, bindings: true }, orderBy: { id: 'asc' } }),
        prices: await db.priceScope.findMany({ where: { productId: product.id }, include: { versions: true }, orderBy: { id: 'asc' } }),
      });
      const before = await snapshot();
      assert.equal((await call(finance.token)).status, 403);
      assert.equal(await snapshot(), before);
      const audit = app.get(AuditService), original = audit.record.bind(audit);
      if (fault) {
        audit.record = async (input, tx) => { await original(input, tx); if (input.action === action) throw new Error('Injected audit failure'); };
        assert.equal((await call(admin.token)).status, 500);
        assert.equal(await snapshot(), before, 'business rows and associations must roll back');
        assert.equal(await db.auditLog.count({ where: { action, traceId: code } }), 0);
        audit.record = original;
      }
      const response = await call(admin.token);
      assert.equal(response.status, method === 'POST' ? 201 : 200, await response.text());
      const logs = await db.auditLog.findMany({ where: { action, traceId: code } });
      assert.equal(logs.length, 1);
      assert.equal(logs[0]!.actorUserId, admin.user.id);
      assert.deepEqual(logs[0]!.activeScope, { roles: ['ADMIN'] });
      assert.ok(logs[0]!.entityId);
      assert.equal(logs[0]!.entityType, action.startsWith('template.') ? 'OrderTemplate' : action.split('.')[0]!.replace(/^./, letter => letter.toUpperCase()));
      assert.match(JSON.stringify(logs[0]!.after), /SUCCEEDED|DELETED/);
      assert.doesNotMatch(JSON.stringify(logs), /private-phone|private-bank|private-remark|passwordHash|spoofed/);
      if ('expectedVersion' in body && !action.endsWith('.delete') && action !== 'template.copy') {
        assert.equal((await call(admin.token)).status, action === 'template.archive' ? 404 : 409);
        assert.equal(await db.auditLog.count({ where: { action, traceId: code } }), 1);
      }
      if (action === 'user.update') {
        const current = await db.user.findUniqueOrThrow({ where: { id: targetUser.id }, include: { scopes: true } });
        assert.equal(current.scopes[0]!.storeId, store.id);
        if (!fault) {
          const responses = await Promise.all(['A', 'B'].map(displayName => fetch(`${base}${path}`, {
            method, headers: { authorization: `Bearer ${admin.token}`, 'content-type': 'application/json', 'x-trace-id': `${code}RACE` },
            body: JSON.stringify({ expectedVersion: current.updatedAt.getTime(), displayName }),
          })));
          assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
          assert.equal(await db.auditLog.count({ where: { action, traceId: `${code}RACE` } }), 1);
        }
      }
    } finally {
      await app.close();
      const products = await db.product.findMany({ where: { sku: { startsWith: code } }, select: { id: true } });
      await db.priceScope.deleteMany({ where: { productId: { in: products.map(row => row.id) } } });
      await db.storeTemplateBinding.deleteMany({ where: { template: { code: { startsWith: code } } } });
      await db.orderTemplate.deleteMany({ where: { code: { startsWith: code } } });
      await db.supplierProduct.deleteMany({ where: { supplier: { code: { startsWith: code } } } });
      await db.product.deleteMany({ where: { sku: { startsWith: code } } });
      await db.supplier.deleteMany({ where: { code: { startsWith: code } } });
      await db.userScope.deleteMany({ where: { user: { username: { startsWith: code } } } });
      await db.store.deleteMany({ where: { code: { startsWith: code } } });
      await db.brand.deleteMany({ where: { name: { startsWith: code } } });
      await db.category.deleteMany({ where: { code: { startsWith: code } } });
      await db.unit.deleteMany({ where: { code: { startsWith: code } } });
      await db.user.deleteMany({ where: { username: { startsWith: code } } });
      await db.$disconnect();
    }
  });
}
