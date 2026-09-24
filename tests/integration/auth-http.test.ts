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
    await prisma.userSession.deleteMany({ where: { user: { username } } });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  }
});
