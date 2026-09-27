import 'reflect-metadata';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
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

async function login(baseUrl) {
  const data = await request(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'pxacc_admin', password: 'correct-password', client: 'web' }),
  });
  return data.accessToken;
}

function authHeaders(token, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function seedIds() {
  const [store, company, stored, credit, direct] = await Promise.all([
    prisma.store.findUnique({ where: { code: 'PXACC-STORE' } }),
    prisma.supplier.findUnique({ where: { code: 'PXACC-SUP-COMPANY' } }),
    prisma.supplier.findUnique({ where: { code: 'PXACC-SUP-STORED' } }),
    prisma.supplier.findUnique({ where: { code: 'PXACC-SUP-CREDIT' } }),
    prisma.supplier.findUnique({ where: { code: 'PXACC-SUP-DIRECT' } }),
  ]);
  for (const [name, value] of Object.entries({ store, company, stored, credit, direct })) {
    assert.ok(value, `Missing PXACC seed record: ${name}`);
  }
  return { store, company, stored, credit, direct };
}

async function run() {
  const ids = await seedIds();
  const { app, baseUrl } = await createAcceptanceApp();
  try {
    const token = await login(baseUrl);

    const storedSupplier = await request(`${baseUrl}/supplier-statements?supplierId=${ids.stored.id}`, {
      headers: authHeaders(token),
    });
    const storedSupplierStore = await request(
      `${baseUrl}/supplier-store-statements?supplierId=${ids.stored.id}&storeId=${ids.store.id}`,
      { headers: authHeaders(token) },
    );
    assert.equal(storedSupplier.length, 1);
    assert.equal(storedSupplierStore.length, 1);
    assert.deepEqual(
      [storedSupplier[0].totalAmount, storedSupplier[0].pendingPaymentAmount, storedSupplier[0].payableAmount],
      ['69.00', '69.00', '0.00'],
    );
    assert.deepEqual(
      [storedSupplierStore[0].totalAmount, storedSupplierStore[0].pendingPaymentAmount, storedSupplierStore[0].payableAmount],
      ['69.00', '69.00', '0.00'],
    );

    const creditStore = await request(`${baseUrl}/store-statements?storeId=${ids.store.id}&supplierId=${ids.credit.id}`, {
      headers: authHeaders(token),
    });
    assert.equal(creditStore.length, 1);
    assert.deepEqual([creditStore[0].cycle, creditStore[0].periodStart, creditStore[0].totalAmount], ['HALF_MONTHLY', '2026-09-16', '215.00']);

    const directStatements = await request(`${baseUrl}/direct-statements?storeId=${ids.store.id}&supplierId=${ids.direct.id}`, {
      headers: authHeaders(token),
    });
    assert.equal(directStatements.length, 1);
    const directDetail = await request(`${baseUrl}/direct-statements/${encodeURIComponent(directStatements[0].id)}`, {
      headers: authHeaders(token),
    });
    const directPreview = await request(`${baseUrl}/payment-records/preview`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ settlementItemIds: [directDetail.lines[0].settlementItemId] }),
    });
    assert.deepEqual(
      [directPreview.direction, directPreview.channel, directPreview.totalPayableAmount],
      ['STORE_TO_SUPPLIER', 'DIRECT', '162.50'],
    );

    const companySupplier = await request(`${baseUrl}/supplier-statements?supplierId=${ids.company.id}`, {
      headers: authHeaders(token),
    });
    assert.equal(companySupplier.length, 1);
    const companyDetail = await request(`${baseUrl}/supplier-statements/${encodeURIComponent(companySupplier[0].id)}`, {
      headers: authHeaders(token),
    });
    const blockedPreview = await fetch(`${baseUrl}/payment-records/preview`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ settlementItemIds: [companyDetail.lines[0].settlementItemId] }),
    });
    assert.equal(blockedPreview.status, 404);

    const payments = await request(`${baseUrl}/payment-records?supplierId=${ids.stored.id}&direction=COMPANY_TO_SUPPLIER`, {
      headers: authHeaders(token),
    });
    assert.ok(payments.some((payment) => payment.paymentNo === 'PXACC-PAY-SHARED' && payment.status === 'PENDING' && payment.amount === '69.00'));

    console.log('Billing acceptance check passed.');
    console.log('  Stored-value shared pending amount: 69.00');
    console.log('  Credit period: HALF_MONTHLY 2026-09-16');
    console.log('  Direct preview: STORE_TO_SUPPLIER / DIRECT / 162.50');
    console.log('  Company-term supplier payment remains blocked before store receivable settlement.');
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

await run();
