import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

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
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${url} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.data ?? body;
}

async function login(baseUrl, username) {
  const result = await request(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'correct-password', client: 'PERFORMANCE_CHECK' }),
  });
  return result.accessToken;
}

function authHeaders(token, extra = {}) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function summarize(samples, thresholdMs) {
  const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const errors = samples.filter((sample) => sample.error);
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);
  return {
    iterations: samples.length,
    errorCount: errors.length,
    errorRate: Number((errors.length / Math.max(samples.length, 1)).toFixed(4)),
    minMs: Number((durations[0] ?? 0).toFixed(2)),
    p50Ms: Number(p50.toFixed(2)),
    p95Ms: Number(p95.toFixed(2)),
    maxMs: Number((durations.at(-1) ?? 0).toFixed(2)),
    thresholdMs,
    status: errors.length === 0 && p95 <= thresholdMs ? 'PASS' : 'WARN',
    errors: errors.slice(0, 3).map((sample) => sample.error),
  };
}

async function measure(name, thresholdMs, iterations, fn) {
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    try {
      await fn(i);
      samples.push({ durationMs: performance.now() - started });
    } catch (error) {
      samples.push({ durationMs: performance.now() - started, error: error.message });
    }
  }
  return { name, ...summarize(samples, thresholdMs) };
}

async function pollExport(baseUrl, token, jobId) {
  for (let i = 0; i < 40; i += 1) {
    const status = await request(`${baseUrl}/exports/${jobId}`, { headers: authHeaders(token) });
    if (status.status === 'READY' || status.status === 'FAILED') return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Export job did not become ready: ${jobId}`);
}

async function datasetStats() {
  const [
    stores,
    suppliers,
    purchaseRequests,
    supplierOrders,
    shipments,
    receipts,
    exportJobs,
  ] = await Promise.all([
    prisma.store.count({ where: { code: { startsWith: 'PXRPT' } } }),
    prisma.supplier.count({ where: { code: { startsWith: 'PXRPT' } } }),
    prisma.purchaseRequest.count({ where: { store: { code: { startsWith: 'PXRPT' } } } }),
    prisma.supplierOrder.count({ where: { request: { store: { code: { startsWith: 'PXRPT' } } } } }),
    prisma.shipment.count({ where: { supplierOrder: { request: { store: { code: { startsWith: 'PXRPT' } } } } } }),
    prisma.receipt.count({ where: { shipment: { supplierOrder: { request: { store: { code: { startsWith: 'PXRPT' } } } } } } }),
    prisma.exportJob.count(),
  ]);
  return { seedPrefix: 'PXRPT', stores, suppliers, purchaseRequests, supplierOrders, shipments, receipts, exportJobs };
}

async function run() {
  const { app, baseUrl } = await createAcceptanceApp();
  try {
    const adminToken = await login(baseUrl, 'pxrpt_admin');
    const storeToken = await login(baseUrl, 'pxrpt_store');
    const storeMe = await request(`${baseUrl}/me`, { headers: authHeaders(storeToken) });
    const storeId = storeMe.user.scope.storeId;
    const range = 'from=2026-09-01&to=2026-09-30';

    const checks = [];
    checks.push(await measure('Store purchase-request list', 1000, 12, () =>
      request(`${baseUrl}/purchase-requests`, { headers: authHeaders(storeToken) })));
    checks.push(await measure('Store order-amount report', 3000, 10, () =>
      request(`${baseUrl}/reports/order-amounts?${range}`, { headers: authHeaders(storeToken) })));
    checks.push(await measure('Store product-quantity report', 3000, 10, () =>
      request(`${baseUrl}/reports/product-quantities?${range}`, { headers: authHeaders(storeToken) })));
    checks.push(await measure('Admin profit report', 3000, 10, () =>
      request(`${baseUrl}/reports/profit?${range}&storeId=${storeId}`, { headers: authHeaders(adminToken) })));
    checks.push(await measure('Export job acceptance', 1000, 5, () =>
      request(`${baseUrl}/exports`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ reportType: 'profit', filters: { from: '2026-09-01', to: '2026-09-30', storeId } }),
      })));
    checks.push(await measure('Export job ready time', 10000, 3, async () => {
      const job = await request(`${baseUrl}/exports`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ reportType: 'order-amounts', filters: { from: '2026-09-01', to: '2026-09-30', storeId } }),
      });
      const ready = await pollExport(baseUrl, adminToken, job.jobId);
      assert.equal(ready.status, 'READY');
    }));

    const status = checks.every((check) => check.status === 'PASS') ? 'LOCAL_READY' : 'WARN';
    const result = {
      generatedAt: new Date().toISOString(),
      title: 'M6 Local Performance Check',
      status,
      summary: status === 'LOCAL_READY'
        ? 'Local API list/report/export checks are within the current M6 thresholds.'
        : 'One or more local API performance checks exceeded thresholds or returned errors.',
      environment: {
        node: process.version,
        databaseUrl: connectionString.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@'),
        note: 'Local single-process Nest API against the configured PostgreSQL database; not production load evidence.',
      },
      dataset: await datasetStats(),
      thresholds: {
        listP95Ms: 1000,
        reportP95Ms: 3000,
        exportAcceptanceP95Ms: 1000,
        exportReadyP95Ms: 10000,
        errorRate: 0,
      },
      checks,
    };

    await mkdir('var', { recursive: true });
    await writeFile('var/m6-performance-report.json', `${JSON.stringify(result, null, 2)}\n`);

    console.log('M6 local performance check complete.');
    console.log(`  Status: ${status}`);
    for (const check of checks) {
      console.log(`  ${check.status.padEnd(4)} ${check.name}: p50 ${check.p50Ms}ms, p95 ${check.p95Ms}ms, errors ${check.errorCount}`);
    }
    console.log('  Wrote: var/m6-performance-report.json');
    if (status !== 'LOCAL_READY') process.exitCode = 1;
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

await run();
