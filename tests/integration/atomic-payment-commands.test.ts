import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, HttpException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { PaymentRecordsController } from '../../apps/api/src/payment-records/payment-records.controller.js';
import { PaymentRecordsService } from '../../apps/api/src/payment-records/payment-records.service.js';
import { CommandsService } from '../../apps/api/src/commands/commands.service.js';
import { AuditService } from '../../apps/api/src/audit/audit.service.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const channels = [
  { direction: 'STORE_TO_COMPANY', mode: 'COMPANY_TERM', kind: 'STORE_RECEIVABLE', amount: '120.00' },
  { direction: 'COMPANY_TO_SUPPLIER', mode: 'CREDIT', kind: 'SUPPLIER_PAYABLE', amount: '90.00' },
  { direction: 'STORE_TO_SUPPLIER', mode: 'SUPPLIER_TERM', kind: 'DIRECT', amount: '120.00' },
] as const;

async function withFixture(channel: typeof channels[number], run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>) {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const code = `APC${Date.now()}${channel.kind[0]}`;
  try { await run(await createFixture(db, code, channel)); }
  finally {
    await db.auditLog.deleteMany({ where: { actor: { username: code } } });
    await db.commandRecord.deleteMany({ where: { actor: { username: code } } });
    await db.fileObject.deleteMany({ where: { owner: { username: code } } });
    const supplierIds = (await db.supplier.findMany({ where: { code }, select: { id: true } })).map(row => row.id);
    const storeIds = (await db.store.findMany({ where: { code }, select: { id: true } })).map(row => row.id);
    await db.paymentRecord.deleteMany({ where: { OR: [{ supplierId: { in: supplierIds } }, { storeId: { in: storeIds } }] } });
    await db.settlementItemSnapshot.deleteMany({ where: { supplierOrder: { supplier: { code } } } });
    await db.supplierOrder.deleteMany({ where: { supplier: { code } } });
    await db.purchaseRequest.deleteMany({ where: { store: { code } } });
    await db.orderTemplate.deleteMany({ where: { code } });
    await db.supplier.deleteMany({ where: { code } });
    await db.store.deleteMany({ where: { code } });
    await db.user.deleteMany({ where: { username: code } });
    await db.$disconnect();
  }
}

async function createFixture(db: PrismaClient, code: string, channel: typeof channels[number]) {
  const user = await db.user.create({ data: { username: code, displayName: code } });
  const store = await db.store.create({ data: { code, name: code } });
  const supplier = await db.supplier.create({ data: { code, name: code, deliveryMode: 'SELF', defaultSettlementMode: channel.mode, defaultSettlementCycle: 'MONTHLY' } });
  const template = await db.orderTemplate.create({ data: { code, name: code } });
  const request = await db.purchaseRequest.create({ data: { requestNo: code, storeId: store.id, templateId: template.id, status: 'CONFIRMED', submittedAt: new Date() } });
  const order = await db.supplierOrder.create({ data: { supplierOrderNo: code, requestId: request.id, storeId: store.id, supplierId: supplier.id, status: 'COMPLETED',
    firstShippedAt: new Date(), settlementMode: channel.mode, salesGoodsAmount: '120', supplyGoodsAmount: channel.mode === 'SUPPLIER_TERM' ? '120' : '90' } });
  // READY metadata is an isolated uploaded-proof baseline, not an OSS/device upload test.
  const file = await db.fileObject.create({ data: { filename: 'proof.png', mimeType: 'image/png', sizeBytes: 20n, objectKey: code, uploadTokenHash: 'isolated-token', purpose: 'PAYMENT', status: 'READY', ownerId: user.id } });
  const database = { client: db } as never;
  const service = new PaymentRecordsService(database), commands = new CommandsService(database), audit = new AuditService(database);
  const controller = new PaymentRecordsController(service, commands, audit);
  const itemId = Buffer.from(JSON.stringify({ kind: channel.kind, supplierOrderId: order.id })).toString('base64url');
  const input = { direction: channel.direction, businessDate: new Date('2026-10-04'), evidenceFileIds: [file.id], items: [{ settlementItemId: itemId, expectedVersion: order.version, expectedAmount: channel.amount }] };
  const createScope = channel.direction === 'COMPANY_TO_SUPPLIER' ? { userId: user.id } : { type: 'STORE_FINANCE', storeId: store.id, userId: user.id };
  return { db, code, user, store, supplier, request, order, file, service, commands, audit, controller, itemId, input, createScope };
}

for (const channel of channels) {
  for (const operation of ['create', 'confirm', 'reject', 'cancel'] as const) {
    for (const failure of ['none', 'completion', 'audit', 'connection'] as const) {
      test(`atomic ${channel.direction} ${operation}: ${failure}`, () => withFixture(channel, async f => {
        const { db, controller, commands, audit } = f;
        let payment: Awaited<ReturnType<PaymentRecordsService['create']>> | undefined;
        if (operation !== 'create') payment = await f.service.create(f.input, f.createScope);
        if (operation === 'confirm') {
          await db.supplierOrder.update({ where: { id: f.order.id }, data: { salesGoodsAmount: '100', supplyGoodsAmount: '80', version: { increment: 1 } } });
        }
        const beforeFile = await db.fileObject.findUniqueOrThrow({ where: { id: f.file.id } });
        const beforePayment = payment ? await db.paymentRecord.findUniqueOrThrow({ where: { id: payment.id }, include: { allocations: true } }) : null;
        const supplierReview = ['confirm', 'reject'].includes(operation) && channel.direction !== 'STORE_TO_COMPANY';
        const scope = supplierReview ? { type: 'SUPPLIER', supplierId: f.supplier.id }
          : operation === 'confirm' || operation === 'reject' || channel.direction === 'COMPANY_TO_SUPPLIER'
            ? undefined : { type: 'STORE_FINANCE', storeId: f.store.id };
        const auth = { user: { id: f.user.id, roles: [supplierReview ? 'SUPPLIER' : scope ? 'STORE_FINANCE' : 'HQ_FINANCE'], scope } } as never;
        const request = { headers: { 'idempotency-key': `${f.code}-${operation}` }, auth } as never;
        const run = () => operation === 'create'
          ? controller.create(request, auth, { ...f.input, businessDate: '2026-10-04' })
          : operation === 'confirm'
            ? controller.confirm(request, auth, payment!.id, { expectedVersion: payment!.version })
            : controller[operation](request, auth, payment!.id, { expectedVersion: payment!.version, reason: 'Isolated proof correction' });
        if (failure === 'completion') {
          const succeed = commands.succeed.bind(commands);
          commands.succeed = async (...args) => { await succeed(...args); throw new Error('Injected completion failure'); };
        } else if (failure === 'audit' || failure === 'connection') {
          const record = audit.record.bind(audit);
          audit.record = async (...args) => {
            await record(...args);
            if (failure === 'audit') throw new Error('Injected audit failure');
            await args[1]!.$queryRaw`SELECT pg_terminate_backend(pg_backend_pid())`;
          };
        }
        if (failure === 'none') {
          const result = await run();
          assert.deepEqual(await run(), result);
          const state = operation === 'create' ? 'PENDING' : operation === 'confirm' ? 'CONFIRMED' : operation === 'reject' ? 'REJECTED' : 'CANCELLED';
          assert.equal(result.status, state);
          const allocation = await db.paymentAllocation.findFirstOrThrow({ where: { paymentId: result.id } });
          assert.equal(allocation.state, operation === 'create' ? 'RESERVED' : operation === 'confirm' ? 'CONFIRMED' : 'RELEASED');
          assert.equal((await db.fileObject.findUniqueOrThrow({ where: { id: f.file.id } })).paymentId, result.id);
          assert.equal(await db.paymentRecord.count({ where: { allocations: { some: { supplierOrderId: f.order.id } } } }), 1);
          assert.equal(await db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
          const command = await db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } });
          assert.equal(command.status, 'SUCCEEDED');
          assert.deepEqual(command.responseBody, result);
          assert.equal(await db.settlementItemSnapshot.count({ where: { supplierOrderId: f.order.id } }), operation === 'confirm' ? 1 : 0);
          assert.equal(await db.overpayment.count({ where: { supplierId: f.supplier.id } }), operation === 'confirm' ? 1 : 0);
          if (operation === 'confirm') {
            assert.equal((await db.overpayment.findFirstOrThrow({ where: { paymentId: result.id } })).amount.toFixed(2), channel.direction === 'COMPANY_TO_SUPPLIER' ? '10.00' : '20.00');
          }
        } else {
          await assert.rejects(run());
          await assert.rejects(run(), ConflictException);
          assert.deepEqual(await db.fileObject.findUniqueOrThrow({ where: { id: f.file.id } }), beforeFile);
          assert.equal(await db.paymentRecord.count({ where: { allocations: { some: { supplierOrderId: f.order.id } } } }), payment ? 1 : 0);
          if (payment) assert.deepEqual(await db.paymentRecord.findUniqueOrThrow({ where: { id: payment.id }, include: { allocations: true } }), beforePayment);
          assert.equal(await db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
          assert.equal(await db.settlementItemSnapshot.count({ where: { supplierOrderId: f.order.id } }), 0);
          assert.equal(await db.overpayment.count({ where: { supplierId: f.supplier.id } }), 0);
          const command = await db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } });
          assert.equal(command.status, 'PROCESSING');
          assert.equal(command.responseBody, null);
        }
      }));
    }
  }
}

test('concurrent distinct payments cannot steal the same proof or reserve both settlements', () => withFixture(channels[0], async f => {
  const other = await f.db.supplierOrder.create({ data: { supplierOrderNo: `${f.code}OTHER`, requestId: f.request.id, storeId: f.store.id, supplierId: f.supplier.id,
    status: 'COMPLETED', firstShippedAt: new Date(), settlementMode: 'COMPANY_TERM', salesGoodsAmount: '120', supplyGoodsAmount: '90' } });
  const otherId = Buffer.from(JSON.stringify({ kind: 'STORE_RECEIVABLE', supplierOrderId: other.id })).toString('base64url');
  const auth = { user: { id: f.user.id, roles: ['STORE_FINANCE'], scope: f.createScope } } as never;
  const results = await Promise.allSettled([f.itemId, otherId].map((id, index) => f.controller.create({ headers: { 'idempotency-key': `${f.code}-${index}` }, auth } as never, auth,
    { ...f.input, businessDate: '2026-10-04', items: [{ ...f.input.items[0]!, settlementItemId: id }] })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof ConflictException);
  assert.equal((rejected.reason.getResponse() as { code: string }).code, 'PAYMENT_EVIDENCE_INVALID');
  const payment = await f.db.paymentRecord.findFirstOrThrow({ where: { storeId: f.store.id } });
  assert.equal(await f.db.paymentRecord.count({ where: { storeId: f.store.id } }), 1);
  assert.equal((await f.db.fileObject.findUniqueOrThrow({ where: { id: f.file.id } })).paymentId, payment.id);
  assert.equal(await f.db.paymentAllocation.count({ where: { supplierOrder: { supplierId: f.supplier.id } } }), 1);
  assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
  assert.deepEqual((await f.db.commandRecord.findMany({ where: { actorUserId: f.user.id } })).map(row => row.status).sort(), ['FAILED', 'SUCCEEDED']);
}));

for (const channel of channels) {
  test(`${channel.direction}: invalid proof and foreign review fail atomically without releasing reservations`, () => withFixture(channel, async f => {
    const createAuth = { user: { id: f.user.id, roles: ['HQ_FINANCE'] } } as never;
    const createRequest = { headers: { 'idempotency-key': `${f.code}-invalid` }, auth: createAuth } as never;
    await f.db.fileObject.update({ where: { id: f.file.id }, data: { status: 'UPLOADING' } });
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(f.controller.create(createRequest, createAuth, { ...f.input, businessDate: '2026-10-04' }), (error: unknown) => {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), 409);
        assert.equal((error.getResponse() as { code: string }).code, 'PAYMENT_EVIDENCE_INVALID');
        return true;
      });
    }
    assert.equal(await f.db.paymentAllocation.count({ where: { supplierOrderId: f.order.id } }), 0);
    assert.equal((await f.db.fileObject.findUniqueOrThrow({ where: { id: f.file.id } })).paymentId, null);
    await f.db.fileObject.update({ where: { id: f.file.id }, data: { status: 'READY' } });
    const payment = await f.service.create(f.input, f.createScope);
    const before = await f.db.paymentRecord.findUniqueOrThrow({ where: { id: payment.id }, include: { allocations: true } });
    const foreign = '00000000-0000-4000-8000-000000000000';
    for (const operation of ['confirm', 'reject', 'cancel'] as const) {
      const scope = operation === 'cancel' ? { type: 'STORE_FINANCE', storeId: foreign } : { type: 'SUPPLIER', supplierId: foreign };
      const auth = { user: { id: f.user.id, roles: [operation === 'cancel' ? 'STORE_FINANCE' : 'SUPPLIER'], scope } } as never;
      const request = { headers: { 'idempotency-key': `${f.code}-foreign-${operation}` }, auth } as never;
      const run = () => operation === 'confirm' ? f.controller.confirm(request, auth, payment.id, { expectedVersion: payment.version })
        : f.controller[operation](request, auth, payment.id, { expectedVersion: payment.version, reason: 'Foreign action must fail' });
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(run(), (error: unknown) => {
          assert.equal((error as { getStatus(): number }).getStatus(), 404);
          return true;
        });
      }
    }
    assert.deepEqual(await f.db.paymentRecord.findUniqueOrThrow({ where: { id: payment.id }, include: { allocations: true } }), before);
    assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
    assert.equal(await f.db.commandRecord.count({ where: { actorUserId: f.user.id, status: 'FAILED' } }), 4);
    assert.equal(await f.db.settlementItemSnapshot.count({ where: { supplierOrderId: f.order.id } }), 0);
  }));
}
