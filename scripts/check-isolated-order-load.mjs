import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { DatabaseService } from '../dist/apps/api/src/database/database.service.js';
import { PricingService } from '../dist/apps/api/src/pricing/pricing.service.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { assertLoadIsolation } from './sustained-load.mjs';
import { runOrderLoadGenerator } from './run-order-load-generator.mjs';
import { observeLoadDatabase } from './order-load-diagnostics.mjs';

assertLoadIsolation(process.env);
const app = await NestFactory.create(AppModule, { logger: false });
let diagnostics;
const db = app.get(DatabaseService).client;
const report = { status: 'RUNNING', generatedAt: new Date().toISOString(), profiles: [],
  environment: { node: process.version, platform: process.platform, architecture: process.arch,
    diagnosticsEnabled: process.env.LOAD_DIAGNOSTICS === '1',
    generator: 'Separate Node child process; loopback network and same host, not a production capacity benchmark' },
  scope: 'Real scoped stored-value purchase-request creation only; no procurement confirmation, shipment, production hardware or full financial workflow claim',
  dataset: { stores: 20, products: 1, suppliers: 1, initialBalancePerStore: '1000000',
    openingBalance: 'Direct synthetic fixture, not actual recharge or customer opening data' } };
try {
  assert.equal(await db.store.count(), 0);
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor()); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const category = await db.category.create({ data: { code: 'LOAD', name: 'Load' } });
  const unit = await db.unit.create({ data: { code: 'LOAD', name: 'piece' } });
  const product = await db.product.create({ data: { sku: 'LOAD', name: 'Load item', categoryId: category.id, baseUnitId: unit.id, defaultSalesPrice: '10' } });
  const supplier = await db.supplier.create({ data: { code: 'LOAD', name: 'Load supplier', deliveryMode: 'SELF', defaultSettlementMode: 'STORED_VALUE', defaultSettlementCycle: 'MONTHLY' } });
  await db.supplierProduct.create({ data: { supplierId: supplier.id, productId: product.id } });
  const template = await db.orderTemplate.create({ data: { code: 'LOAD', name: 'Load template', items: { create: {
    productId: product.id, initialSalesPrice: '10', suppliers: { create: { supplierId: supplier.id } } } } } });
  await app.get(PricingService).publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '10', supplyPrice: '8',
    effectiveAt: new Date('2000-01-01'), reason: 'Isolated load price' });
  const role = await db.role.upsert({ where: { code: 'STORE' }, update: {}, create: { code: 'STORE', name: 'Store' } });
  const password = randomUUID(), passwordHash = await hashPassword(password);
  async function request(path, token, body, key) {
    const response = await fetch(base + path, { method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) });
    const result = await response.json();
    if (response.status !== 201) throw Object.assign(new Error('Load request failed'), { code: result.code || result.error?.code || `HTTP_${response.status}` });
    return result.data;
  }
  const stores = [];
  for (let index = 0; index < report.dataset.stores; index++) {
    const store = await db.store.create({ data: { code: `LOAD-${index}`, name: `Load store ${index}`,
      bindings: { create: { templateId: template.id } }, accounts: { create: { balance: '1000000' } } } });
    const user = await db.user.create({ data: { username: `load_${index}`, displayName: 'Load user', passwordHash,
      roles: { create: { roleId: role.id } }, scopes: { create: { scopeType: 'STORE', storeId: store.id } } } });
    const token = (await request('/auth/login', null, { username: user.username, password, client: 'LOAD_CHECK' })).accessToken;
    stores.push({ id: store.id, token, succeeded: 0 });
  }
  const successful = [];
  const bodyFor = store => ({ storeId: store.id, items: [{ productId: product.id, quantity: '1' }] });
  const checked = value => {
    assert.equal(value.status, 'PENDING_PROCUREMENT');
    assert.equal(value.funding.stored.paid, '10.00');
  };
  const warmKey = `load-preflight-${randomUUID()}`;
  const warmBody = bodyFor(stores[0]);
  const warm = await request('/purchase-requests', stores[0].token, warmBody, warmKey); checked(warm);
  successful.push({ id: warm.id, key: warmKey, body: warmBody, store: stores[0] }); stores[0].succeeded++;
  report.preflight = 'PASSED: real creation response and stored-value funding contract checked before arrival profiles';
  const apiDelay = monitorEventLoopDelay({ resolution: 20 }); apiDelay.enable();
  if (process.env.LOAD_DIAGNOSTICS === '1') diagnostics = observeLoadDatabase(app.get(DatabaseService));
  let generated;
  try {
    generated = await runOrderLoadGenerator({ base, productId: product.id, stores: stores.map(({ id, token }) => ({ id, token })) }, profile => {
      if (diagnostics) profile.databaseDiagnostics = diagnostics.snapshot();
      report.profiles.push(profile);
      console.log(`Order load: ${profile.offeredQps} offered QPS; ${profile.succeeded} succeeded, ${profile.errors} errors, ${profile.dropped} dropped`);
    });
    report.environment.apiPid = process.pid; report.environment.generatorPid = generated.pid;
    assert.notEqual(generated.pid, process.pid);
    report.environment.apiEventLoop = { p95Ms: apiDelay.percentile(95) / 1e6, maxMs: apiDelay.max / 1e6 };
  } finally { apiDelay.disable(); }
  for (const item of generated.successful) {
    const store = stores.find(store => store.id === item.storeId); assert.ok(store);
    successful.push({ ...item, store }); store.succeeded++;
  }
  assert.equal(await db.purchaseRequest.count(), successful.length);
  assert.equal(new Set(successful.map(item => item.id)).size, successful.length);
  assert.equal(await db.commandRecord.count({ where: { status: 'SUCCEEDED', action: 'purchase-request.create' } }), successful.length);
  assert.equal(await db.commandRecord.count({ where: { status: 'PROCESSING' } }), 0);
  assert.equal(await db.requestItem.count(), successful.length);
  assert.equal(await db.accountLedger.count(), successful.length);
  for (const store of stores) {
    const account = await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
    assert.equal(account.balance.toString(), String(1000000 - store.succeeded * 10));
    const ledger = await db.accountLedger.aggregate({ where: { accountId: account.id, direction: 'DEBIT' }, _sum: { amount: true } });
    assert.equal(ledger._sum.amount?.toString() || '0', String(store.succeeded * 10));
  }
  const replay = successful[0]; assert.ok(replay);
  const before = await db.accountLedger.count();
  assert.equal((await request('/purchase-requests', replay.store.token, replay.body, replay.key)).id, replay.id);
  assert.equal(await db.accountLedger.count(), before);
  assert.equal(await db.purchaseRequest.count(), successful.length);
  report.consistency = { status: 'PASSED', requests: successful.length, uniqueIds: successful.length,
    requestItems: successful.length, ledgerRows: successful.length, reconciledStores: stores.length, exactReplay: 'PASSED' };
  report.capacityTarget = { offeredQps: 200, sustainedMs: 30000, achieved: report.profiles.at(-1).targetMet,
    limitation: '30-second local capacity probe on 20 stores, not long soak, real network or production sizing' };
  report.status = report.capacityTarget.achieved ? 'PASSED' : 'CAPACITY_NOT_MET';
} catch (error) { report.status = 'FAILED'; report.failure = error.message; process.exitCode = 1; }
finally {
  if (diagnostics) await diagnostics.close();
  await app.close(); await db.$disconnect();
  await writeFile(join(process.env.LOAD_ROOT, 'load.json'), JSON.stringify(report, null, 2));
}
