import 'reflect-metadata';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';

async function createAcceptanceApp() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  return { app, baseUrl: `http://127.0.0.1:${address.port}/api/v1` };
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${url} failed: ${response.status} ${JSON.stringify(body)}`);
  return body.data ?? body;
}

async function login(baseUrl, username) {
  const data = await request(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'correct-password', client: 'web' }),
  });
  return data.accessToken;
}

function authHeaders(token) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function run() {
  const { app, baseUrl } = await createAcceptanceApp();
  try {
    const adminToken = await login(baseUrl, 'pxrpt_admin');
    const storeToken = await login(baseUrl, 'pxrpt_store');
    const adminMessages = await request(`${baseUrl}/notifications`, { headers: authHeaders(adminToken) });
    assert.equal(adminMessages.unreadCount, 1);
    assert.equal(adminMessages.notifications[0]?.title, '对账异常待核查');
    const adminNotificationId = adminMessages.notifications[0].id;

    const storeCannotReadAdmin = await fetch(`${baseUrl}/notifications/${adminNotificationId}/read`, { method: 'POST', headers: authHeaders(storeToken) });
    assert.equal(storeCannotReadAdmin.status, 404);

    const read = await request(`${baseUrl}/notifications/${adminNotificationId}/read`, { method: 'POST', headers: authHeaders(adminToken) });
    assert.equal(read.status, 'READ');
    assert.ok(read.readAt);
    const adminAfterRead = await request(`${baseUrl}/notifications`, { headers: authHeaders(adminToken) });
    assert.equal(adminAfterRead.unreadCount, 0);

    const storeMessages = await request(`${baseUrl}/notifications`, { headers: authHeaders(storeToken) });
    assert.equal(storeMessages.unreadCount, 1);
    assert.equal(storeMessages.notifications[0]?.title, '待收货提醒');
    assert.notEqual(storeMessages.notifications[0]?.id, adminNotificationId);

    console.log('Notifications acceptance check passed.');
    console.log(`  Admin notification read: ${adminNotificationId}`);
    console.log(`  Store unread notifications: ${storeMessages.unreadCount}`);
  } finally {
    await app.close();
  }
}

await run();
