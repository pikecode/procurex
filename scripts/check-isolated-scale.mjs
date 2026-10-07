import 'reflect-metadata';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';

const url = new URL(process.env.DATABASE_URL);
const root = process.env.RESTORE_DRILL_ROOT;
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/drill_restore');
assert.notEqual(url.port, '55438');
assert.match(root, /^\/private\/tmp\/procurex-restore-[0-9a-f-]{36}$/);
assert.equal(process.env.PRIVATE_FILE_DIR, join(root, 'restored-files'));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
const count = 100000;
let app;
try {
  const source = await prisma.supplierOrder.findUniqueOrThrow({ where: { supplierOrderNo: 'PXRPT-SO-COMPANY-A' } });
  const seedStarted = performance.now();
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`CREATE TEMP TABLE scale_ids ON COMMIT DROP AS SELECT n, gen_random_uuid() AS request_id, gen_random_uuid() AS order_id FROM generate_series(1, ${count}::integer) AS n`;
    await tx.$executeRaw`INSERT INTO "PurchaseRequest" SELECT (jsonb_populate_record(NULL::"PurchaseRequest", to_jsonb(r) || jsonb_build_object('id', s.request_id, 'requestNo', 'PXSCALE-REQ-' || s.n))).* FROM "PurchaseRequest" r CROSS JOIN scale_ids s WHERE r.id = ${source.requestId}::uuid`;
    await tx.$executeRaw`INSERT INTO "SupplierOrder" SELECT (jsonb_populate_record(NULL::"SupplierOrder", to_jsonb(o) || jsonb_build_object('id', s.order_id, 'requestId', s.request_id, 'supplierOrderNo', 'PXSCALE-SO-' || s.n, 'completedAt', '2026-10-01T04:00:00Z', 'firstShippedAt', '2026-10-01T04:00:00Z'))).* FROM "SupplierOrder" o CROSS JOIN scale_ids s WHERE o.id = ${source.id}::uuid`;
    await tx.$executeRaw`INSERT INTO "OrderItem" SELECT (jsonb_populate_record(NULL::"OrderItem", to_jsonb(i) || jsonb_build_object('id', gen_random_uuid(), 'supplierOrderId', s.order_id))).* FROM "OrderItem" i CROSS JOIN scale_ids s WHERE i."supplierOrderId" = ${source.id}::uuid`;
  }, { timeout: 120000 });
  assert.equal(await prisma.supplierOrder.count({ where: { supplierOrderNo: { startsWith: 'PXSCALE-' } } }), count);
  const seedMs = performance.now() - seedStarted;
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  let token;
  const request = async (path, body) => {
    const response = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120000) });
    assert.equal(response.status, body ? (path === '/exports' ? 202 : 201) : 200, path);
    return (await response.json()).data;
  };
  token = (await request('/auth/login', { username: 'pxrpt_admin', password: 'correct-password', client: 'SCALE_CHECK' })).accessToken;
  const filters = { from: '2026-10-01', to: '2026-10-01', storeId: source.storeId };
  const reportStarted = performance.now();
  const report = await request(`/reports/profit?${new URLSearchParams(filters)}`);
  assert.equal(report.rows.length, count);
  assert.equal(report.totals.salesGoodsAmount, '9600000.00');
  assert.equal(report.totals.supplyGoodsAmount, '7200000.00');
  assert.equal(report.totals.profit, '2400000.00');
  const reportMs = performance.now() - reportStarted;
  const exportStarted = performance.now();
  const job = await request('/exports', { reportType: 'profit', filters });
  let ready;
  while (performance.now() - exportStarted < 120000) {
    ready = await request(`/exports/${job.jobId}`);
    if (ready.status === 'READY' || ready.status === 'FAILED') break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(ready?.status, 'READY');
  const download = await fetch(`${base}/exports/${job.jobId}/download`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000) });
  assert.equal(download.status, 200);
  const csv = await download.text();
  // This fixed fixture has no embedded quotes or newlines in exported fields.
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, count + 1);
  const ids = new Set();
  for (const line of lines.slice(1)) {
    const fields = line.split(',').map(value => value.replace(/^"|"$/g, ''));
    assert.equal(fields.length, 10);
    assert.equal(fields[1], source.storeId);
    assert.equal(fields[7], '96.00');
    assert.equal(fields[8], '72.00');
    assert.equal(fields[9], '24.00');
    ids.add(fields[0]);
  }
  assert.equal(ids.size, count);
  const exportMs = performance.now() - exportStarted;
  const evidence = { status: 'PASSED', generatedAt: new Date().toISOString(),
    dataset: { purchaseRequests: count, supplierOrders: count, orderItems: count, purpose: 'Synthetic completed report fixtures; not financial workflow or production load evidence' },
    measurements: { seedMs, reportMs, exportMs }, csv: { rows: count, bytes: Buffer.byteLength(csv), sha256: createHash('sha256').update(csv).digest('hex'), uniqueOrderIds: ids.size },
    performanceTargets: { reportTargetMs: 3000, exportTargetMs: 10000, reportStatus: reportMs <= 3000 ? 'PASS' : 'WARN', exportStatus: exportMs <= 10000 ? 'PASS' : 'WARN', note: 'Single observation, not p95 acceptance; PASSED means dataset/total/CSV integrity only.' },
    totals: report.totals, limitation: 'Single large profit report/export; no sustained QPS claim, no large order-amount export or production hardware acceptance.' };
  await writeFile(join(root, 'scale.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  if (app) await app.close();
  await prisma.$disconnect();
}
