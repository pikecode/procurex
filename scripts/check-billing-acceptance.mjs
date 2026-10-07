import 'reflect-metadata';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const result = {
  generatedAt: new Date().toISOString(),
  title: 'M4 Billing Acceptance',
  summary: 'W09/S05/S08 billing and W10 adjustment offset',
  steps: [],
};

function record(title, data, gates = []) {
  result.steps.push({ title, data, gates });
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
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${url} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.data ?? body;
}

async function login(baseUrl, username = 'pxacc_admin') {
  const data = await request(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'correct-password', client: 'web' }),
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

async function paymentEvidence(baseUrl, token) {
  const bytes = Buffer.from('%PDF-1.4\nPXACC payment evidence\n%%EOF\n');
  const session = await request(`${baseUrl}/files/upload-sessions`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ purpose: 'PAYMENT', filename: 'pxacc-payment.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length }),
  });
  const upload = await fetch(`${baseUrl}/files/${session.id}/content`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-upload-token': session.uploadToken },
    body: bytes,
  });
  assert.equal(upload.status, 201);
  await request(`${baseUrl}/files/${session.id}/complete`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  return session.id;
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
    const storeToken = await login(baseUrl, 'pxacc_store');
    const supplierDirectToken = await login(baseUrl, 'pxacc_supplier_direct');

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
      ['154.00', '69.00', '91.00'],
    );
    assert.deepEqual(
      [storedSupplierStore[0].totalAmount, storedSupplierStore[0].pendingPaymentAmount, storedSupplierStore[0].payableAmount],
      ['154.00', '69.00', '91.00'],
    );
    record('1. Stored-value supplier total and supplier-store share pending reservation', {
      supplierTotalAmount: storedSupplier[0].totalAmount,
      supplierStoreTotalAmount: storedSupplierStore[0].totalAmount,
      pendingPaymentAmount: storedSupplier[0].pendingPaymentAmount,
      payableAmount: storedSupplier[0].payableAmount,
    }, [
      { gateId: 'DEV-402', evidenceId: 'stored-value-payable' },
      { gateId: 'DEV-403', evidenceId: 'supplier-total-view' },
      { gateId: 'DEV-403', evidenceId: 'supplier-store-view' },
      { gateId: 'DEV-403', evidenceId: 'shared-pending-reservation' },
    ]);

    const creditStore = await request(`${baseUrl}/store-statements?storeId=${ids.store.id}&supplierId=${ids.credit.id}`, {
      headers: authHeaders(token),
    });
    assert.deepEqual(creditStore, []);
    const creditSupplier = await request(`${baseUrl}/supplier-statements?supplierId=${ids.credit.id}`, { headers: authHeaders(token) });
    assert.equal(creditSupplier.length, 1);
    assert.deepEqual([creditSupplier[0].cycle, creditSupplier[0].periodStart, creditSupplier[0].totalAmount], ['HALF_MONTHLY', '2026-09-16', '185.00']);
    record('2. Credit uses its account, while supplier payable retains the half-month period', {
      cycle: creditSupplier[0].cycle,
      periodStart: creditSupplier[0].periodStart,
      totalAmount: creditSupplier[0].totalAmount,
      storeReceivableCount: creditStore.length,
    }, [
      { gateId: 'DEV-402', evidenceId: 'credit-period' },
    ]);

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
    record('3. Direct supplier-term preview uses direct channel', {
      direction: directPreview.direction,
      channel: directPreview.channel,
      totalPayableAmount: directPreview.totalPayableAmount,
    }, [
      { gateId: 'DEV-402', evidenceId: 'direct-term-preview' },
      { gateId: 'DEV-403', evidenceId: 'direct-view' },
    ]);

    const evidenceFileId = await paymentEvidence(baseUrl, storeToken);
    const directPayment = await request(`${baseUrl}/payment-records`, {
      method: 'POST',
      headers: authHeaders(storeToken, { 'idempotency-key': 'pxacc-direct-payment' }),
      body: JSON.stringify({
        direction: 'STORE_TO_SUPPLIER',
        businessDate: '2026-09-27',
        remark: 'PXACC direct-term payment audit',
        evidenceFileIds: [evidenceFileId],
        items: [{
          settlementItemId: directDetail.lines[0].settlementItemId,
          expectedVersion: directPreview.items[0].sourceVersion,
          expectedAmount: directPreview.items[0].payableAmount,
        }],
      }),
    });
    assert.deepEqual([directPayment.direction, directPayment.status, directPayment.amount], ['STORE_TO_SUPPLIER', 'PENDING', '162.50']);
    const confirmedDirectPayment = await request(`${baseUrl}/payment-records/${directPayment.id}/confirm`, {
      method: 'POST',
      headers: authHeaders(supplierDirectToken, { 'idempotency-key': 'pxacc-direct-payment-confirm' }),
      body: JSON.stringify({ expectedVersion: directPayment.version }),
    });
    assert.deepEqual([confirmedDirectPayment.status, confirmedDirectPayment.version], ['CONFIRMED', 2]);
    const paymentAuditLogs = await request(`${baseUrl}/audit-logs`, { headers: authHeaders(token) });
    const paymentAuditActions = new Set(paymentAuditLogs.map((entry) => entry.action));
    assert.ok(paymentAuditActions.has('payment-record.create'));
    assert.ok(paymentAuditActions.has('payment-record.confirm'));
    record('4. Direct payment create and confirm audit trail', {
      paymentNo: directPayment.paymentNo,
      amount: confirmedDirectPayment.amount,
      status: confirmedDirectPayment.status,
      auditActions: Array.from(paymentAuditActions).filter((action) => action.startsWith('payment-record.')).sort(),
    }, [
      { gateId: 'DEV-404', evidenceId: 'payment-audit-create-confirm' },
    ]);

    const companySupplier = await request(`${baseUrl}/supplier-statements?supplierId=${ids.company.id}`, {
      headers: authHeaders(token),
    });
    assert.equal(companySupplier.length, 1);
    const companyStore = await request(`${baseUrl}/store-statements?storeId=${ids.store.id}&supplierId=${ids.company.id}`, { headers: authHeaders(token) });
    assert.equal(companyStore.length, 1);
    assert.equal(companyStore[0].payableAmount, '130.00');
    const companyDetail = await request(`${baseUrl}/supplier-statements/${encodeURIComponent(companySupplier[0].id)}`, {
      headers: authHeaders(token),
    });
    const blockedPreview = await fetch(`${baseUrl}/payment-records/preview`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ settlementItemIds: [companyDetail.lines[0].settlementItemId] }),
    });
    assert.equal(blockedPreview.status, 404);
    record('5. Company-term supplier payment is blocked before store receivable settlement', {
      blockedStatus: blockedPreview.status,
      supplierTotalAmount: companySupplier[0].totalAmount,
      payableAmount: companySupplier[0].payableAmount,
      storeReceivableAmount: companyStore[0].payableAmount,
    }, [
      { gateId: 'DEV-402', evidenceId: 'company-term-block' },
      { gateId: 'DEV-403', evidenceId: 'store-view' },
    ]);

    const payments = await request(`${baseUrl}/payment-records?supplierId=${ids.stored.id}&direction=COMPANY_TO_SUPPLIER`, {
      headers: authHeaders(token),
    });
    assert.ok(payments.some((payment) => payment.paymentNo === 'PXACC-PAY-SHARED' && payment.status === 'PENDING' && payment.amount === '69.00'));
    record('6. Shared supplier payable reservation is visible in payments', {
      paymentNo: 'PXACC-PAY-SHARED',
      status: 'PENDING',
      amount: '69.00',
    }, [
      { gateId: 'DEV-403', evidenceId: 'shared-payment-visible' },
    ]);

    const adjustments = await request(`${baseUrl}/adjustments?storeId=${ids.store.id}&supplierId=${ids.stored.id}`, {
      headers: authHeaders(token),
    });
    const credit = adjustments.find((adjustment) => adjustment.supplierOrderNo === 'PXACC-SO-STORED-ADJ-CREDIT' && adjustment.direction === 'SUPPLIER_PAYABLE_DECREASE');
    const target = adjustments.find((adjustment) => adjustment.supplierOrderNo === 'PXACC-SO-STORED-ADJ-TARGET' && adjustment.direction === 'SUPPLIER_PAYABLE_INCREASE');
    assert.ok(credit?.disposalCreditItemId, 'Missing negative supplier adjustment credit id');
    assert.ok(target?.offsetTargetItemId, 'Missing positive supplier adjustment target id');
    assert.deepEqual([credit.adjustmentAmount, credit.pendingReturnOrOffsetAmount, credit.processingStatus], ['-4.00', '4.00', 'PENDING_DISPOSAL']);
    assert.deepEqual([target.adjustmentAmount, target.pendingReturnOrOffsetAmount], ['10.00', '0.00']);
    record('7. W10 exposes negative credit and positive offset target', {
      creditOrderNo: credit.supplierOrderNo,
      creditAmount: credit.adjustmentAmount,
      pendingReturnOrOffsetAmount: credit.pendingReturnOrOffsetAmount,
      targetOrderNo: target.supplierOrderNo,
      targetAmount: target.adjustmentAmount,
    }, [
      { gateId: 'DEV-406', evidenceId: 'adjustment-list' },
      { gateId: 'DEV-406', evidenceId: 'adjustment-detail' },
      { gateId: 'DEV-406', evidenceId: 'offset-target' },
    ]);

    const creditDetail = await request(`${baseUrl}/adjustments/${encodeURIComponent(credit.id)}`, {
      headers: authHeaders(token),
    });
    assert.equal(creditDetail.lines[0]?.supplyAdjustmentAmount, '-4.00');
    const disposal = await request(`${baseUrl}/difference-disposals`, {
      method: 'POST',
      headers: authHeaders(token, { 'idempotency-key': 'pxacc-adjustment-offset' }),
      body: JSON.stringify({
        method: 'OFFSET',
        creditItemIds: [credit.disposalCreditItemId],
        targetDebitItemIds: [target.offsetTargetItemId],
        amount: '4.00',
        businessDate: '2026-09-27',
        reason: 'PXACC acceptance offset',
      }),
    });
    assert.deepEqual([disposal.method, disposal.direction, disposal.status, disposal.amount], ['OFFSET', 'SUPPLIER_TO_COMPANY', 'PENDING', '4.00']);
    assert.equal(disposal.items[0]?.adjustmentDocumentId, credit.disposalCreditItemId);
    assert.equal(disposal.items[0]?.targetDebitItemId, target.offsetTargetItemId);

    const confirmedDisposal = await request(`${baseUrl}/difference-disposals/${disposal.id}/confirm`, {
      method: 'POST',
      headers: authHeaders(token, { 'idempotency-key': 'pxacc-adjustment-offset-confirm' }),
      body: JSON.stringify({ expectedVersion: disposal.version }),
    });
    assert.deepEqual([confirmedDisposal.status, confirmedDisposal.version], ['CONFIRMED', 2]);
    const auditLogs = await request(`${baseUrl}/audit-logs`, { headers: authHeaders(token) });
    const auditActions = new Set(auditLogs.map((entry) => entry.action));
    assert.ok(auditActions.has('difference-disposal.create'));
    assert.ok(auditActions.has('difference-disposal.confirm'));
    record('8. W10 offset disposal is created and confirmed', {
      method: disposal.method,
      direction: disposal.direction,
      amount: disposal.amount,
      status: confirmedDisposal.status,
      version: confirmedDisposal.version,
      auditActions: Array.from(auditActions).filter((action) => action.startsWith('difference-disposal.')).sort(),
    }, [
      { gateId: 'DEV-406', evidenceId: 'offset-created' },
      { gateId: 'DEV-406', evidenceId: 'receiver-confirmed' },
      { gateId: 'DEV-406', evidenceId: 'disposed-state' },
    ]);

    console.log('Billing acceptance check passed.');
    console.log('  Stored-value shared pending amount: 69.00');
    console.log('  Credit period: HALF_MONTHLY 2026-09-16');
    console.log('  Direct preview: STORE_TO_SUPPLIER / DIRECT / 162.50');
    console.log('  Company-term supplier payment remains blocked before store receivable settlement.');
    console.log('  W10 offset disposal: -4.00 supplier adjustment offset and confirmed.');
    await writeFile(
      resolve(process.cwd(), 'apps/web/billing-acceptance-run.json'),
      `${JSON.stringify({ ...result, generatedAt: new Date().toISOString(), status: 'PASSED' }, null, 2)}\n`,
    );
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

await run();
