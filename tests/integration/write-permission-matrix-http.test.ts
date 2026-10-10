import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer, NestFactory, Reflector } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { AppModule } from '../../apps/api/src/app.module.js';
import { AuthGuard } from '../../apps/api/src/auth/auth.guard.js';
import { BusinessScopeGuard } from '../../apps/api/src/auth/business-scope.guard.js';
import { RolesGuard } from '../../apps/api/src/auth/roles.guard.js';
import { REQUIRED_ROLES_METADATA } from '../../apps/api/src/auth/roles.decorator.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../../packages/domain/src/password.js';

const roles = ['ADMIN', 'PURCHASER', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER'];
const purchaser = ['ADMIN', 'PURCHASER'];
const finance = ['ADMIN', 'HQ_FINANCE'];
const business = ['STORE', 'STORE_FINANCE', 'SUPPLIER'];
const contracts: Array<{ method: string; path: string; roles: string[] }> = [];
const add = (allowed: string[], entries: string[]) => {
  for (const entry of entries) {
    const [method, path] = entry.split(' ');
    contracts.push({ method: method!, path: path!, roles: allowed });
  }
};
add(purchaser, [
  'POST /categories', 'PATCH /categories/:id', 'DELETE /categories/:id',
  'POST /units', 'PATCH /units/:id', 'DELETE /units/:id',
  'POST /brands', 'PATCH /brands/:id', 'DELETE /brands/:id',
  'POST /products', 'PATCH /products/:id', 'PATCH /products/:id/purchase-unit',
  'POST /suppliers', 'PATCH /suppliers/:id', 'POST /suppliers/:id/archive', 'PUT /suppliers/:id/products',
  'POST /templates', 'PATCH /templates/:id', 'POST /templates/:id/copy', 'POST /templates/:id/archive',
  'PUT /templates/:id/stores', 'PUT /templates/:id/items',
  'PUT /templates/:id/supplier-settings', 'PUT /templates/:id/supplier-settings/:supplierId', 'DELETE /templates/:id/supplier-settings/:supplierId',
  'POST /price-changes', 'POST /prices/quote', 'POST /prices/impact-preview', 'POST /jobs/:id/process',
  'PATCH /purchase-requests/:id/items', 'POST /purchase-requests/:id/items-preview',
  'POST /purchase-requests/:id/reassign-preview', 'POST /purchase-requests/:id/assign',
  'POST /purchase-requests/:id/reallocate', 'POST /purchase-requests/:id/confirm', 'POST /purchase-requests/:id/reject',
  'POST /supplier-orders/:id/reconcile-funding',
  'POST /freight-confirmations/:id/confirm', 'POST /freight-confirmations/:id/reject',
]);
add(['ADMIN'], ['POST /stores', 'PATCH /stores/:id', 'POST /users', 'PATCH /users/:id', 'POST /users/:id/password', 'POST /users/:id/revoke-sessions',
  'POST /store-groups', 'PATCH /store-groups/:id', 'DELETE /store-groups/:id',
  'POST /commands/:id/reviews', 'POST /commands/:id/close-rolled-back-price', 'POST /commands/:id/close-uncommitted-price']);
add(finance, ['POST /collection-accounts', 'PATCH /collection-accounts/:id', 'POST /stores/:id/recharges', 'PATCH /stores/:id/credit-limit',
  'POST /stores/:id/clearings/preview', 'POST /stores/:id/clearings', 'POST /difference-disposals']);
add(['ADMIN', 'PURCHASER', 'STORE'], ['POST /purchase-requests', 'POST /purchase-requests/preview']);
add(['ADMIN', 'SUPPLIER'], ['POST /supplier-orders/:id/shipment-preview', 'POST /supplier-orders/:id/shipments',
  'POST /supplier-orders/:id/freight-confirmations', 'POST /supplier-orders/:id/reject', 'POST /discrepancies/:id/resolve']);
add(['ADMIN', 'STORE'], ['POST /shipments/:id/receipts']);
add([...finance, 'STORE', 'STORE_FINANCE'], ['POST /payment-records', 'POST /payment-records/preview', 'POST /payment-records/:id/cancel']);
add([...finance, 'SUPPLIER'], ['POST /payment-records/:id/confirm', 'POST /payment-records/:id/reject']);
add([...finance, ...business], ['POST /difference-disposals/:id/confirm']);
add(roles.filter(role => role !== 'SUPPLIER'), ['POST /files/upload-sessions', 'POST /files/:id/content', 'POST /files/:id/complete']);
add(roles, ['POST /exports', 'POST /exports/:id/retry']);

for (const roleCode of roles) test(`write permission HTTP ${roleCode}: complete route inventory and denied writes have no side effects`, async t => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
  const prefix = `WPM${Date.now()}${roleCode}`;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  try {
    const reflector = new Reflector();
    const inventory = new Map<string, string[]>();
    for (const module of app.get(ModulesContainer).values()) for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype;
      if (!controller) continue;
      const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
      if (['notifications'].includes(prefix)) continue;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = controller.prototype[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined || ![RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE].includes(method)) continue;
        const path = '/' + [prefix, Reflect.getMetadata(PATH_METADATA, handler) as string].filter(value => value && value !== '/').join('/');
        if (path === '/auth/login' || path === '/auth/logout' || path === '/auth/password') continue;
        const allowed = reflector.getAllAndOverride<string[]>(REQUIRED_ROLES_METADATA, [handler, controller]);
        assert.ok(allowed?.length, `${path} requires an explicit role contract`);
        const guards = [...(Reflect.getMetadata(GUARDS_METADATA, controller) ?? []), ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [])];
        assert.ok(guards.includes(AuthGuard) && guards.includes(RolesGuard), `${path} requires authentication and role guards`);
        if (allowed.some(role => business.includes(role))) assert.ok(guards.includes(BusinessScopeGuard), `${path} requires a business scope guard`);
        inventory.set(`${RequestMethod[method]} ${path}`, allowed);
      }
    }
    assert.deepEqual([...inventory.keys()].sort(), contracts.map(route => `${route.method} ${route.path}`).sort());
    for (const route of contracts) assert.deepEqual([...inventory.get(`${route.method} ${route.path}`)!].sort(), [...route.roles].sort(), route.path);

    const store = await db.store.create({ data: { code: prefix, name: prefix } });
    const supplier = await db.supplier.create({ data: { code: prefix, name: prefix, deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY' } });
    const role = await db.role.upsert({ where: { code: roleCode }, update: {}, create: { code: roleCode, name: roleCode } });
    const actor = await db.user.create({ data: { username: prefix, displayName: prefix, passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } } } });
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: prefix, password: 'correct-password', client: 'WEB' }) });
    assert.equal(login.status, 201);
    const token = (await login.json() as any).data.accessToken as string;
    const send = (route: typeof contracts[number], authenticated: boolean) => fetch(base + route.path.replace(/:[A-Za-z]+/g, randomUUID()), {
      method: route.method, headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: `Bearer ${token}` } : {}), 'idempotency-key': `${prefix}-${randomUUID()}` },
      body: JSON.stringify({ actorUserId: actor.id, roles: ['ADMIN'], activeScope: { roles: ['ADMIN'] }, scope: { type: 'COMPANY' }, storeId: store.id, supplierId: supplier.id }),
    });
    const snapshot = async () => JSON.stringify({
      store: await db.store.findUnique({ where: { id: store.id } }), supplier: await db.supplier.findUnique({ where: { id: supplier.id } }),
      commands: await db.commandRecord.count({ where: { actorUserId: actor.id } }), audit: await db.auditLog.count({ where: { actorUserId: actor.id } }),
      files: await db.fileObject.count({ where: { ownerId: actor.id } }), exports: await db.exportJob.count({ where: { requestedById: actor.id } }),
    });
    const before = await snapshot();
    let denied = 0;
    if (roleCode === 'ADMIN') for (const route of contracts) {
      const response = await send(route, false); assert.equal(response.status, 401, `${route.method} ${route.path}`);
      denied++;
    }
    for (const state of business.includes(roleCode) ? ['missing', 'wrong', 'valid'] : ['valid']) {
      if (state === 'wrong') await db.userScope.create({ data: { userId: actor.id, scopeType: 'COMPANY' } });
      if (state === 'valid' && business.includes(roleCode)) await db.userScope.update({ where: { userId: actor.id }, data: {
        scopeType: roleCode === 'SUPPLIER' ? 'SUPPLIER' : 'STORE', storeId: roleCode === 'SUPPLIER' ? null : store.id, supplierId: roleCode === 'SUPPLIER' ? supplier.id : null,
      } });
      for (const route of contracts) {
        if (route.roles.includes(roleCode) && state === 'valid') continue;
        const response = await send(route, true);
        assert.equal(response.status, 403, `${roleCode} ${state} ${route.method} ${route.path}: ${await response.clone().text()}`);
        denied++;
      }
      assert.equal(await snapshot(), before, `${roleCode} ${state}: denied writes cannot mutate documents, commands, audit, files or exports`);
    }
    t.diagnostic(`${contracts.length} business write/preview routes; ${denied} actual denied HTTP requests for ${roleCode}`);
  } finally {
    await app.close();
    await db.user.deleteMany({ where: { username: prefix } });
    await db.store.deleteMany({ where: { code: prefix } }); await db.supplier.deleteMany({ where: { code: prefix } });
    await db.$disconnect();
  }
});
