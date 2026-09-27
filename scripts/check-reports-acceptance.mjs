import 'reflect-metadata';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';

const result = {
  generatedAt: new Date().toISOString(),
  title: 'M5 Reports Acceptance',
  summary: 'R01-R04 reporting and CSV export',
  steps: [],
};

function record(title, data) {
  result.steps.push({ title, data });
}

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

function authHeaders(token, extra = {}) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra };
}

async function pollExport(baseUrl, token, jobId) {
  for (let i = 0; i < 30; i += 1) {
    const status = await request(`${baseUrl}/exports/${jobId}`, { headers: authHeaders(token) });
    if (status.status === 'READY' || status.status === 'FAILED') return status;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Export job did not become ready: ${jobId}`);
}

async function run() {
  const { app, baseUrl } = await createAcceptanceApp();
  try {
    const adminToken = await login(baseUrl, 'pxrpt_admin');
    const storeToken = await login(baseUrl, 'pxrpt_store');
    const supplierToken = await login(baseUrl, 'pxrpt_supplier');
    const storeMe = await request(`${baseUrl}/me`, { headers: authHeaders(storeToken) });
    const storeId = storeMe.user.scope.storeId;

    const range = 'from=2026-09-01&to=2026-09-30';
    const orderAmounts = await request(`${baseUrl}/reports/order-amounts?${range}`, { headers: authHeaders(storeToken) });
    assert.equal(orderAmounts.months[0]?.totalAmount, '164.00');
    assert.equal(orderAmounts.months[0]?.orderCount, 2);
    record('1. R01 order amounts include completed goods and freight', {
      orderCount: orderAmounts.months[0].orderCount,
      totalAmount: orderAmounts.months[0].totalAmount,
    });

    const quantities = await request(`${baseUrl}/reports/product-quantities?${range}`, { headers: authHeaders(storeToken) });
    const rice = quantities.products.find((product) => product.productName === 'PX Reports Rice');
    assert.equal(rice?.quantity, '14.000000');
    record('2. R02 product quantities aggregate final received quantity', {
      productName: rice.productName,
      quantity: rice.quantity,
    });

    const longRange = await fetch(`${baseUrl}/reports/product-quantities?from=2026-01-01&to=2026-05-01`, { headers: authHeaders(adminToken) });
    assert.equal(longRange.status, 400);
    record('3. R02 rejects ranges beyond three months', { status: longRange.status });

    const profit = await request(`${baseUrl}/reports/profit?${range}&storeId=${storeId}`, { headers: authHeaders(adminToken) });
    assert.deepEqual([profit.totals.salesGoodsAmount, profit.totals.supplyGoodsAmount, profit.totals.profit, profit.totals.freightAmount], ['156.00', '114.00', '42.00', '8.00']);
    assert.equal(profit.rows.length, 2);
    record('4. R03 profit excludes direct supplier-term orders and keeps freight separate', profit.totals);

    const storeCrossScope = await fetch(`${baseUrl}/reports/order-amounts?${range}&storeId=00000000-0000-4000-8000-000000000001`, { headers: authHeaders(storeToken) });
    assert.equal(storeCrossScope.status, 400);
    record('5. Report reads enforce bound store scope', {
      scopedTotalAmount: orderAmounts.months[0].totalAmount,
      crossScopeStatus: storeCrossScope.status,
    });

    const supplierProfit = await fetch(`${baseUrl}/reports/profit?${range}`, { headers: authHeaders(supplierToken) });
    assert.equal(supplierProfit.status, 403);
    record('6. Supplier role cannot read profit report', { status: supplierProfit.status });

    const exportJob = await request(`${baseUrl}/exports`, {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ reportType: 'profit', filters: { from: '2026-09-01', to: '2026-09-30', storeId } }),
    });
    const ready = await pollExport(baseUrl, adminToken, exportJob.jobId);
    assert.equal(ready.status, 'READY');
    const download = await fetch(`${baseUrl}/exports/${exportJob.jobId}/download`, { headers: authHeaders(adminToken) });
    assert.equal(download.status, 200);
    const csv = await download.text();
    assert.match(csv, /supplierOrderId/);
    assert.match(csv, /PX Reports Rice/);
    const exportJobs = await request(`${baseUrl}/exports`, { headers: authHeaders(adminToken) });
    assert.equal(exportJobs[0]?.jobId, exportJob.jobId);
    assert.equal(exportJobs[0]?.status, 'READY');
    record('7. R04 export job reaches READY and downloads CSV', {
      jobId: exportJob.jobId,
      status: ready.status,
      csvBytes: csv.length,
      listedJobs: exportJobs.length,
    });

    const reconciliationIssues = await request(`${baseUrl}/reconciliation-issues`, { headers: authHeaders(adminToken) });
    const pxIssues = reconciliationIssues.filter((issue) => issue.storeCode === 'PXRPT-STORE');
    assert.deepEqual(pxIssues.map((issue) => issue.type).sort(), ['STORE_BALANCE_LEDGER_MISMATCH', 'STORE_CREDIT_USED_MISMATCH']);
    record('8. R05 reconciliation lists account mismatches without auto-fixing', {
      issueCount: pxIssues.length,
      types: pxIssues.map((issue) => issue.type).sort().join(','),
    });

    await writeFile(
      resolve(process.cwd(), 'apps/web/reports-acceptance-run.json'),
      `${JSON.stringify({ ...result, generatedAt: new Date().toISOString(), status: 'PASSED' }, null, 2)}\n`,
    );
    console.log('Reports acceptance check passed.');
    console.log('  R01 scoped total amount: 164.00 across 2 completed store orders');
    console.log('  R02 PX Reports Rice quantity: 14.000000');
    console.log('  R03 profit: 42.00 with freight 8.00 separate');
    console.log(`  R04 export job: ${exportJob.jobId} READY, CSV bytes ${csv.length}`);
  } finally {
    await app.close();
  }
}

await run();
