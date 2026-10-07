import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../packages/domain/src/password.js';
import { CommandsService } from '../../apps/api/src/commands/commands.service.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';

function createClient(): InstanceType<typeof PrismaClient> {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

async function createTestApp(): Promise<{ app: INestApplication; baseUrl: string }> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${address.port}/api/v1` };
}

test('auth HTTP endpoints login, read current user and logout', async () => {
  const prisma = createClient();
  const username = `it_auth_http_${Date.now()}`;
  const { app, baseUrl } = await createTestApp();

  try {
    await prisma.user.create({
      data: {
        username,
        displayName: 'Integration Auth HTTP',
        passwordHash: await hashPassword('correct-password'),
      },
    });

    const missingToken = await fetch(`${baseUrl}/me`, {
      headers: { 'x-trace-id': 'trace-http-missing-token' },
    });
    assert.equal(missingToken.status, 401);
    assert.deepEqual(await missingToken.json(), {
      code: 'MISSING_AUTH_TOKEN',
      message: 'Bearer token is required',
      traceId: 'trace-http-missing-token',
    });

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-trace-id': 'trace-http-login',
      },
      body: JSON.stringify({
        username,
        password: 'correct-password',
        client: 'web',
      }),
    });
    assert.equal(login.status, 201);

    const loginBody = (await login.json()) as {
      data: { accessToken: string; user: { username: string }; expiresAt: string };
      traceId: string;
    };
    assert.equal(loginBody.traceId, 'trace-http-login');
    assert.equal(loginBody.data.user.username, username);
    assert.ok(loginBody.data.accessToken);
    assert.ok(loginBody.data.expiresAt);

    const me = await fetch(`${baseUrl}/me`, {
      headers: {
        authorization: `Bearer ${loginBody.data.accessToken}`,
        'x-trace-id': 'trace-http-me',
      },
    });
    assert.equal(me.status, 200);
    const meBody = (await me.json()) as { data: { user: { username: string }; session: { client: string } }; traceId: string };
    assert.equal(meBody.traceId, 'trace-http-me');
    assert.equal(meBody.data.user.username, username);
    assert.equal(meBody.data.session.client, 'web');

    const commandHeaders = { authorization: `Bearer ${loginBody.data.accessToken}` };
    assert.equal((await fetch(`${baseUrl}/commands`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/commands/stale`, { headers: commandHeaders })).status, 403);
    assert.equal((await fetch(`${baseUrl}/commands?limit=101`, { headers: commandHeaders })).status, 400);
    const owner = await prisma.user.findUniqueOrThrow({ where: { username } });
    const command = await prisma.commandRecord.create({ data: { actorUserId: owner.id, action: 'price.process',
      idempotencyKey: 'private-key', requestHash: '0'.repeat(64), traceId: 'command-http-trace',
      expiresAt: new Date('2000-01-01'), errorBody: { code: 'COMMAND_OUTCOME_UNKNOWN', message: 'private-error' } } });
    const diagnostics = await fetch(`${baseUrl}/commands?actorUserId=11111111-1111-4111-8111-111111111111`, { headers: commandHeaders });
    assert.equal(diagnostics.status, 200);
    const summaries = (await diagnostics.json()) as { data: Array<{ id: string; stale: boolean; errorCode: string }> };
    assert.equal(summaries.data.length, 1); assert.equal(summaries.data[0]!.id, command.id);
    assert.equal(summaries.data[0]!.stale, true); assert.equal(summaries.data[0]!.errorCode, 'COMMAND_OUTCOME_UNKNOWN');
    assert.ok(!JSON.stringify(summaries).includes('private-'));

    const reviewOptions = { method: 'POST', headers: { ...commandHeaders, 'content-type': 'application/json', 'idempotency-key': 'http-review-key' },
      body: JSON.stringify({ expectedStatus: 'PROCESSING', reason: 'HTTP review leaves unknown outcome unchanged' }) };
    assert.equal((await fetch(`${baseUrl}/commands/${command.id}/reviews`, reviewOptions)).status, 403);
    assert.equal((await fetch(`${baseUrl}/commands/${command.id}/close-rolled-back-price`, reviewOptions)).status, 403);
    assert.equal((await fetch(`${baseUrl}/commands/${command.id}/close-uncommitted-price`, reviewOptions)).status, 403);
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    await prisma.userRole.create({ data: { userId: owner.id, roleId: adminRole.id } });
    assert.equal((await fetch(`${baseUrl}/commands/stale`, { headers: commandHeaders })).status, 200);
    const reviewed = await fetch(`${baseUrl}/commands/${command.id}/reviews`, reviewOptions);
    assert.equal(reviewed.status, 201);
    const reviewBody = await reviewed.json() as { data: { resolution: string } };
    assert.equal(reviewBody.data.resolution, 'REVIEW_RECORDED_NO_STATE_CHANGE');
    const repeatedReview = await fetch(`${baseUrl}/commands/${command.id}/reviews`, reviewOptions);
    assert.equal(repeatedReview.status, 201); assert.deepEqual((await repeatedReview.json() as { data: unknown }).data, reviewBody.data);
    assert.equal(await prisma.auditLog.count({ where: { actorUserId: owner.id, action: 'command.review' } }), 1);
    assert.equal((await prisma.commandRecord.findUniqueOrThrow({ where: { id: command.id } })).status, 'PROCESSING');

    const commands = app.get(CommandsService);
    const rollback = await commands.begin({ actorUserId: owner.id, action: 'price.process', idempotencyKey: 'http-rollback',
      requestBody: { id: owner.id }, traceId: 'http-rollback-proof', resourceType: 'PriceChangeRun', resourceId: owner.id });
    await assert.rejects(commands.performAtomic(rollback, async tx => {
      await tx.user.update({ where: { id: owner.id }, data: { displayName: 'Must not commit' } });
      throw new Error('Actual callback rollback');
    }));
    const closeOptions = { ...reviewOptions, headers: { ...reviewOptions.headers, 'idempotency-key': 'http-close-rollback' } };
    const closed = await fetch(`${baseUrl}/commands/${rollback.command.id}/close-rolled-back-price`, closeOptions);
    assert.equal(closed.status, 201);
    const closedBody = (await closed.json() as { data: { status: string } }).data; assert.equal(closedBody.status, 'FAILED');
    const closedReplay = await fetch(`${baseUrl}/commands/${rollback.command.id}/close-rolled-back-price`, closeOptions);
    assert.equal(closedReplay.status, 201); assert.deepEqual((await closedReplay.json() as { data: unknown }).data, closedBody);
    assert.equal(await prisma.auditLog.count({ where: { actorUserId: owner.id, action: 'command.close-rolled-back-price' } }), 1);
    const unprovenOptions = { ...closeOptions, headers: { ...closeOptions.headers, 'idempotency-key': 'http-close-unproven' } };
    assert.equal((await fetch(`${baseUrl}/commands/${command.id}/close-rolled-back-price`, unprovenOptions)).status, 409);
    const uncommitted = await commands.begin({ actorUserId: owner.id, action: 'price.process', idempotencyKey: 'http-uncommitted',
      requestBody: { id: owner.id }, traceId: 'http-contract', resourceType: 'PriceChangeRun', resourceId: owner.id, atomicPriceExecution: true });
    const contractOptions = { ...closeOptions, headers: { ...closeOptions.headers, 'idempotency-key': 'http-contract-close' } };
    const contractClosed = await fetch(`${baseUrl}/commands/${uncommitted.command.id}/close-uncommitted-price`, contractOptions);
    assert.equal(contractClosed.status, 201);
    const contractBody = (await contractClosed.json() as { data: { resolution: string } }).data;
    assert.equal(contractBody.resolution, 'UNCOMMITTED_ATOMIC_PRICE_COMMAND_CLOSED');
    const contractReplay = await fetch(`${baseUrl}/commands/${uncommitted.command.id}/close-uncommitted-price`, contractOptions);
    assert.equal(contractReplay.status, 201); assert.deepEqual((await contractReplay.json() as { data: unknown }).data, contractBody);
    assert.equal(await prisma.auditLog.count({ where: { actorUserId: owner.id, action: 'command.close-uncommitted-price' } }), 1);
    assert.equal((await fetch(`${baseUrl}/commands/${command.id}/close-uncommitted-price`, unprovenOptions)).status, 409);

    const logout = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${loginBody.data.accessToken}`,
        'x-trace-id': 'trace-http-logout',
      },
    });
    assert.equal(logout.status, 201);
    assert.deepEqual(await logout.json(), {
      data: { revoked: true },
      traceId: 'trace-http-logout',
    });

    const afterLogout = await fetch(`${baseUrl}/me`, {
      headers: {
        authorization: `Bearer ${loginBody.data.accessToken}`,
        'x-trace-id': 'trace-http-after-logout',
      },
    });
    assert.equal(afterLogout.status, 401);
  } finally {
    await app.close();
    await prisma.auditLog.deleteMany({ where: { actor: { username } } });
    await prisma.commandRecord.deleteMany({ where: { actor: { username } } });
    await prisma.userSession.deleteMany({ where: { user: { username } } });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  }
});
