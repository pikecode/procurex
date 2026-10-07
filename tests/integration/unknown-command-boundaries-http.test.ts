import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { AppModule } from '../../apps/api/src/app.module.js';
import { CommandsService } from '../../apps/api/src/commands/commands.service.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../../packages/domain/src/password.js';

const actions = [
  'store.recharge.create', 'store.credit-limit.update', 'store.clearing.create',
  'purchase-request.create', 'purchase-request.items.replace', 'purchase-request.assign', 'purchase-request.reallocate', 'purchase-request.confirm', 'purchase-request.reject',
  'supplier-order.shipment.create', 'supplier-order.freight-confirmation.create', 'supplier-order.reject', 'supplier-order.funding.reconcile',
  'shipment.receipt.create', 'freight-confirmation.confirm', 'freight-confirmation.reject', 'discrepancy.resolve',
  'payment-record.create', 'payment-record.confirm', 'payment-record.reject', 'payment-record.cancel', 'difference-disposal.create', 'difference-disposal.confirm', 'price.publish',
];
const cases = [
  ...actions.map(action => ({ name: action, action, atomicPriceExecution: false, resourceType: 'HistoricalResource', resourceId: randomUUID() as string | null })),
  { name: 'legacy unmarked price', action: 'price.process', atomicPriceExecution: false, resourceType: 'PriceChangeRun', resourceId: randomUUID() },
  { name: 'unbound atomic price', action: 'price.process', atomicPriceExecution: true, resourceType: 'PriceChangeRun', resourceId: null },
  { name: 'wrong resource atomic price', action: 'price.process', atomicPriceExecution: true, resourceType: 'HistoricalResource', resourceId: randomUUID() },
];

for (const entry of cases) test(`unknown command HTTP ${entry.name}: expiry and review never authorize execution or price-only closure`, async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
  const prefix = `UCB${Date.now()}${randomUUID().slice(0, 8)}`;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  try {
    const adminRole = await db.role.upsert({ where: { code: 'ADMIN' }, update: {}, create: { code: 'ADMIN', name: 'ADMIN' } });
    const actor = await db.user.create({ data: { username: prefix, displayName: prefix, passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: adminRole.id } } } });
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: prefix, password: 'correct-password', client: 'WEB' }) });
    assert.equal(login.status, 201);
    const token = (await login.json() as any).data.accessToken;
    const call = (path: string, body?: object, key?: string) => fetch(base + path, { method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const commands = app.get(CommandsService);
    const original = await commands.begin({ actorUserId: actor.id, action: entry.action, idempotencyKey: `${prefix}-original`, requestBody: { privateNote: 'never-in-diagnostics' },
      traceId: prefix, atomicPriceExecution: entry.atomicPriceExecution, resourceType: entry.resourceType, resourceId: entry.resourceId ?? undefined,
      expiresAt: new Date(Date.now() - 60000) });
    await db.commandRecord.update({ where: { id: original.command.id }, data: { errorBody: { code: 'COMMAND_OUTCOME_UNKNOWN', privateAccount: 'never-in-diagnostics' } } });
    const before = JSON.stringify(await db.commandRecord.findUniqueOrThrow({ where: { id: original.command.id } }));
    const diagnostics = await call('/commands/stale'); assert.equal(diagnostics.status, 200);
    const text = await diagnostics.text(); assert.doesNotMatch(text, /never-in-diagnostics|requestHash|idempotencyKey|responseBody/);
    const summary = (JSON.parse(text) as any).data.find((row: any) => row.id === original.command.id);
    assert.equal(summary.recovery, 'RECONCILIATION_REQUIRED'); assert.equal(summary.stale, true);
    for (const endpoint of ['close-rolled-back-price', 'close-uncommitted-price']) {
      const response = await call(`/commands/${original.command.id}/${endpoint}`, { reason: 'operator checked; no proof of outcome' }, `${prefix}-${endpoint}`);
      assert.equal(response.status, 409);
      const error = await response.json() as any;
      assert.equal(error.code, endpoint === 'close-rolled-back-price' ? 'COMMAND_ROLLBACK_NOT_PROVEN' : 'COMMAND_ATOMIC_CONTRACT_REQUIRED');
      assert.equal(JSON.stringify(await db.commandRecord.findUniqueOrThrow({ where: { id: original.command.id } })), before);
    }
    const reviewBody = { expectedStatus: 'PROCESSING', reason: 'preserve original request and reconcile; do not retry or compensate' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await call(`/commands/${original.command.id}/reviews`, reviewBody, `${prefix}-review`);
      assert.equal(response.status, 201);
      assert.equal((await response.json() as any).data.resolution, 'REVIEW_RECORDED_NO_STATE_CHANGE');
    }
    assert.equal(await db.auditLog.count({ where: { actorUserId: actor.id, action: 'command.review' } }), 1);
    assert.equal(await db.auditLog.count({ where: { actorUserId: actor.id, action: { in: ['command.close-rolled-back-price', 'command.close-uncommitted-price'] } } }), 0);
    const retry = await commands.begin({ actorUserId: actor.id, action: entry.action, idempotencyKey: `${prefix}-original`, requestBody: { privateNote: 'never-in-diagnostics' }, traceId: prefix });
    let executions = 0;
    await assert.rejects(commands.performAtomic(retry, async () => { executions++; }), { status: 409 });
    assert.equal(executions, 0);
    assert.equal(JSON.stringify(await db.commandRecord.findUniqueOrThrow({ where: { id: original.command.id } })), before);
    assert.equal(await db.commandRecord.count({ where: { actorUserId: actor.id, action: entry.action } }), 1);
  } finally {
    await app.close();
    await db.auditLog.deleteMany({ where: { actor: { username: prefix } } });
    await db.commandRecord.deleteMany({ where: { actor: { username: prefix } } });
    await db.user.deleteMany({ where: { username: prefix } });
    await db.$disconnect();
  }
});
