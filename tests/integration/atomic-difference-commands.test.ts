import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, HttpException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { DifferenceDisposalsController } from '../../apps/api/src/difference-disposals/difference-disposals.controller.js';
import { DifferenceDisposalsService } from '../../apps/api/src/difference-disposals/difference-disposals.service.js';
import { CommandsService } from '../../apps/api/src/commands/commands.service.js';
import { AuditService } from '../../apps/api/src/audit/audit.service.js';
import { PricingService } from '../../apps/api/src/pricing/pricing.service.js';
import { StoresService } from '../../apps/api/src/stores/stores.service.js';
import { PaymentRecordsService } from '../../apps/api/src/payment-records/payment-records.service.js';
import { lockFundingRequest, synchronizeRequestFunding } from '../../apps/api/src/purchase-requests/request-funding.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
type Source = 'STORE_CREDIT' | 'SUPPLIER_OVERPAYMENT';
const encode = (kind: string, supplierOrderId: string) => Buffer.from(JSON.stringify({ kind, supplierOrderId })).toString('base64url');

async function withFixture(source: Source, run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const code = `ADC${Date.now()}${source[0]}`;
  try { await run(await fixture(db, code, source)); }
  finally {
    const stores = (await db.store.findMany({ where: { code }, select: { id: true } })).map(row => row.id);
    const suppliers = (await db.supplier.findMany({ where: { code }, select: { id: true } })).map(row => row.id);
    const own = { storeId: { in: stores } };
    await db.auditLog.deleteMany({ where: { actor: { username: code } } });
    await db.commandRecord.deleteMany({ where: { actor: { username: code } } });
    await db.differenceDisposal.deleteMany({ where: own });
    await db.adjustmentDocument.deleteMany({ where: own });
    await db.fileObject.deleteMany({ where: { owner: { username: code } } });
    await db.paymentRecord.deleteMany({ where: { OR: [own, { supplierId: { in: suppliers } }] } });
    await db.priceChangeRun.deleteMany({ where: { versions: { some: { priceVersion: { scope: { supplier: { code } } } } } } });
    await db.settlementItemSnapshot.deleteMany({ where: { supplierOrder: { store: { code } } } });
    await db.clearingDocument.deleteMany({ where: own });
    await db.fundingAllocation.deleteMany({ where: own });
    await db.accountLedger.deleteMany({ where: { account: own } });
    await db.supplierOrder.deleteMany({ where: own });
    await db.purchaseRequest.deleteMany({ where: own });
    await db.priceScope.deleteMany({ where: { supplier: { code } } });
    await db.orderTemplate.deleteMany({ where: { code } });
    await db.product.deleteMany({ where: { sku: code } });
    await db.supplier.deleteMany({ where: { code } });
    await db.storeAccount.deleteMany({ where: own });
    await db.store.deleteMany({ where: { code } });
    await db.category.deleteMany({ where: { code } });
    await db.unit.deleteMany({ where: { code } });
    await db.user.deleteMany({ where: { username: code } });
    await db.$disconnect();
  }
}

async function fixture(db: PrismaClient, code: string, source: Source) {
  const database = { client: db } as never;
  const user = await db.user.create({ data: { username: code, displayName: code } });
  const category = await db.category.create({ data: { code, name: code } });
  const unit = await db.unit.create({ data: { code, name: 'piece' } });
  const product = await db.product.create({ data: { sku: code, name: code, categoryId: category.id, baseUnitId: unit.id } });
  const supplier = await db.supplier.create({ data: { code, name: code, deliveryMode: 'SELF', defaultSettlementMode: 'CREDIT', defaultSettlementCycle: 'MONTHLY' } });
  const store = await db.store.create({ data: { code, name: code } });
  const template = await db.orderTemplate.create({ data: { code, name: code, items: { create: { productId: product.id, initialSalesPrice: '12', suppliers: { create: { supplierId: supplier.id } } } } } });
  await db.storeAccount.create({ data: { storeId: store.id, balance: '500', creditLimit: '1000' } });
  const pricing = new PricingService(database), accounts = new StoresService(database), payments = new PaymentRecordsService(database);
  await pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '12', supplyPrice: '9', effectiveAt: new Date('2000-01-01'), reason: 'Isolated disposal baseline' });
  const request = await db.purchaseRequest.create({ data: { requestNo: code, storeId: store.id, templateId: template.id, status: 'CONFIRMED', submittedAt: new Date('2026-09-20'),
    salesGoodsAmount: '120', supplyGoodsAmount: '90', items: { create: { productId: product.id, supplierId: supplier.id, quantity: '10', salesUnitPrice: '12', supplyUnitPrice: '9', salesLineAmount: '120', supplyLineAmount: '90', settlementModeSnapshot: 'CREDIT', settlementCycleSnapshot: 'MONTHLY' } } } });
  const order = await db.supplierOrder.create({ data: { supplierOrderNo: code, requestId: request.id, storeId: store.id, supplierId: supplier.id, settlementMode: 'CREDIT', settlementCycleSnapshot: 'MONTHLY',
    status: source === 'STORE_CREDIT' ? 'PUSHED' : 'COMPLETED', firstShippedAt: source === 'STORE_CREDIT' ? null : new Date(), salesGoodsAmount: '120', supplyGoodsAmount: '90',
    items: { create: { productId: product.id, quantity: '10', salesUnitPrice: '12', supplyUnitPrice: '9', salesLineAmount: '120', supplyLineAmount: '90' } } } });
  let creditId: string;
  if (source === 'STORE_CREDIT') {
    await db.$transaction(async tx => { await lockFundingRequest(tx, store.id, request.id); await synchronizeRequestFunding(tx, request.id, { initial: true }); });
    const funding = await db.fundingAllocation.findFirstOrThrow({ where: { requestId: request.id } });
    await accounts.createClearing(store.id, { businessDate: new Date(), items: [{ fundingAllocationId: funding.id, expectedVersion: funding.version, expectedAmount: '120.00' }] });
    const price = await pricing.publishPrice({ templateId: template.id, productId: product.id, supplierId: supplier.id, salesPrice: '11', supplyPrice: '9', effectiveAt: new Date('2026-09-10'), reason: 'Actual excess paid credit' });
    await pricing.processRun(price.runId!);
    creditId = (await db.adjustmentDocument.findFirstOrThrow({ where: { supplierOrderId: order.id, side: 'STORE' } })).id;
  } else {
    // Uploaded-proof metadata and completed order are isolated historical baselines.
    const file = await db.fileObject.create({ data: { filename: 'proof.png', mimeType: 'image/png', sizeBytes: 20n, objectKey: code, uploadTokenHash: 'isolated', purpose: 'PAYMENT', status: 'READY', ownerId: user.id } });
    const payment = await payments.create({ direction: 'COMPANY_TO_SUPPLIER', businessDate: new Date(), evidenceFileIds: [file.id], items: [{ settlementItemId: encode('SUPPLIER_PAYABLE', order.id), expectedAmount: '90.00', expectedVersion: order.version }] }, { userId: user.id });
    await db.supplierOrder.update({ where: { id: order.id }, data: { supplyGoodsAmount: '80', version: { increment: 1 } } });
    await payments.confirm(payment.id, payment.version, { type: 'SUPPLIER', supplierId: supplier.id });
    creditId = (await db.overpayment.findFirstOrThrow({ where: { paymentId: payment.id } })).id;
  }
  const targetRequest = await db.purchaseRequest.create({ data: { requestNo: `${code}TARGET`, storeId: store.id, templateId: template.id, status: 'CONFIRMED', submittedAt: new Date() } });
  const target = await db.supplierOrder.create({ data: { supplierOrderNo: `${code}TARGET`, requestId: targetRequest.id, storeId: store.id, supplierId: supplier.id,
    status: 'COMPLETED', firstShippedAt: new Date(), settlementMode: source === 'STORE_CREDIT' ? 'COMPANY_TERM' : 'CREDIT', salesGoodsAmount: '200', supplyGoodsAmount: '200' } });
  const targetId = encode(source === 'STORE_CREDIT' ? 'STORE_RECEIVABLE' : 'SUPPLIER_PAYABLE', target.id);
  const service = new DifferenceDisposalsService(database), commands = new CommandsService(database), audit = new AuditService(database);
  const controller = new DifferenceDisposalsController(service, commands, audit);
  const scope = source === 'STORE_CREDIT' ? { type: 'STORE_FINANCE', storeId: store.id } : { type: 'SUPPLIER', supplierId: supplier.id };
  return { db, code, source, user, store, supplier, product, template, request, order, target, targetId, creditId, pricing, payments, service, commands, audit, controller, scope };
}

for (const source of ['STORE_CREDIT', 'SUPPLIER_OVERPAYMENT'] as const) {
  for (const method of ['OFFLINE_RETURN', 'OFFSET'] as const) {
    for (const operation of ['create', 'confirm'] as const) {
      for (const failure of ['none', 'completion', 'audit', 'connection'] as const) {
        test(`atomic difference ${source} ${method} ${operation}: ${failure}`, () => withFixture(source, async f => {
          const input = { method, creditItemIds: [f.creditId], targetDebitItemIds: method === 'OFFSET' ? [f.targetId] : undefined, amount: '10.00', businessDate: new Date('2026-10-04') };
          const disposal = operation === 'confirm' ? await f.service.create(input) : undefined;
          const beforeRequest = await f.db.purchaseRequest.findUniqueOrThrow({ where: { id: f.request.id } });
          const beforeAccount = await f.db.storeAccount.findUniqueOrThrow({ where: { storeId: f.store.id } });
          const clearings = await f.db.clearingItem.findMany({ where: { fundingAllocation: { requestId: f.request.id } } });
          const beforeDisposal = disposal ? await f.db.differenceDisposal.findUniqueOrThrow({ where: { id: disposal.id }, include: { items: true } }) : undefined;
          const auth = { user: { id: f.user.id, roles: [operation === 'create' ? 'HQ_FINANCE' : source === 'STORE_CREDIT' ? 'STORE_FINANCE' : 'SUPPLIER'], scope: operation === 'confirm' ? f.scope : undefined } } as never;
          const request = { headers: { 'idempotency-key': `${f.code}-${operation}` }, auth } as never;
          const run = () => operation === 'create' ? f.controller.create(request, auth, { ...input, businessDate: '2026-10-04' })
            : f.controller.confirm(request, auth, disposal!.id, { expectedVersion: disposal!.version });
          if (failure === 'completion') {
            const succeed = f.commands.succeed.bind(f.commands);
            f.commands.succeed = async (...args) => { await succeed(...args); throw new Error('Injected completion failure'); };
          } else if (failure === 'audit' || failure === 'connection') {
            const record = f.audit.record.bind(f.audit);
            f.audit.record = async (...args) => {
              await record(...args);
              if (failure === 'audit') throw new Error('Injected audit failure');
              await args[1]!.$queryRaw`SELECT pg_terminate_backend(pg_backend_pid())`;
            };
          }
          if (failure === 'none') {
            const result = await run();
            assert.deepEqual(await run(), result);
            assert.equal(result.status, operation === 'confirm' ? 'CONFIRMED' : 'PENDING');
            assert.equal(await f.db.differenceDisposal.count({ where: { storeId: f.store.id } }), 1);
            assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
            const command = await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } });
            assert.equal(command.status, 'SUCCEEDED');
            assert.deepEqual(command.responseBody, result);
            assert.equal((await f.db.purchaseRequest.findUniqueOrThrow({ where: { id: f.request.id } })).paidAmount.toFixed(2), source === 'STORE_CREDIT' ? operation === 'confirm' ? '110.00' : '120.00' : beforeRequest.paidAmount.toFixed(2));
            await assert.rejects(f.service.create(input), ConflictException);
          } else {
            await assert.rejects(run());
            await assert.rejects(run(), ConflictException);
            assert.deepEqual(await f.db.purchaseRequest.findUniqueOrThrow({ where: { id: f.request.id } }), beforeRequest);
            assert.equal(await f.db.differenceDisposal.count({ where: { storeId: f.store.id } }), disposal ? 1 : 0);
            if (disposal) assert.deepEqual(await f.db.differenceDisposal.findUniqueOrThrow({ where: { id: disposal.id }, include: { items: true } }), beforeDisposal);
            assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
            const command = await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } });
            assert.equal(command.status, 'PROCESSING');
            assert.equal(command.responseBody, null);
          }
          assert.deepEqual(await f.db.storeAccount.findUniqueOrThrow({ where: { storeId: f.store.id } }), beforeAccount);
          assert.deepEqual(await f.db.clearingItem.findMany({ where: { fundingAllocation: { requestId: f.request.id } } }), clearings);
          const payable = await f.payments.preview([f.targetId]);
          assert.equal(payable.items[0]!.payableAmount, method === 'OFFSET' && (failure === 'none' || operation === 'confirm') ? '190.00' : '200.00');
        }));
      }
    }
  }
}

test('concurrent return and offset cannot dispose one credit twice', () => withFixture('STORE_CREDIT', async f => {
  const auth = { user: { id: f.user.id, roles: ['HQ_FINANCE'] } } as never;
  const results = await Promise.allSettled((['OFFLINE_RETURN', 'OFFSET'] as const).map((method, index) => f.controller.create(
    { headers: { 'idempotency-key': `${f.code}-${index}` }, auth } as never, auth,
    { method, creditItemIds: [f.creditId], targetDebitItemIds: method === 'OFFSET' ? [f.targetId] : undefined, amount: '10.00', businessDate: '2026-10-04' })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(failed.reason instanceof ConflictException);
  assert.equal((failed.reason.getResponse() as { code: string }).code, 'DIFFERENCE_CREDIT_ALREADY_DISPOSED');
  assert.equal(await f.db.differenceDisposal.count({ where: { storeId: f.store.id } }), 1);
  assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
  assert.deepEqual((await f.db.commandRecord.findMany({ where: { actorUserId: f.user.id } })).map(row => row.status).sort(), ['FAILED', 'SUCCEEDED']);
}));

test('concurrent distinct credits cannot over-reserve the same offset target', () => withFixture('STORE_CREDIT', async f => {
  const price = await f.pricing.publishPrice({ templateId: f.template.id, productId: f.product.id, supplierId: f.supplier.id, salesPrice: '10', supplyPrice: '9', effectiveAt: new Date('2026-09-10'), reason: 'Second actual excess credit' });
  await f.pricing.processRun(price.runId!);
  const second = await f.db.adjustmentDocument.findFirstOrThrow({ where: { supplierOrderId: f.order.id, side: 'STORE', id: { not: f.creditId } } });
  await f.db.supplierOrder.update({ where: { id: f.target.id }, data: { salesGoodsAmount: '15', supplyGoodsAmount: '15', version: { increment: 1 } } });
  const auth = { user: { id: f.user.id, roles: ['HQ_FINANCE'] } } as never;
  const results = await Promise.allSettled([f.creditId, second.id].map((id, index) => f.controller.create(
    { headers: { 'idempotency-key': `${f.code}-${index}` }, auth } as never, auth,
    { method: 'OFFSET', creditItemIds: [id], targetDebitItemIds: [f.targetId], amount: '10.00', businessDate: '2026-10-04' })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(failed.reason instanceof ConflictException);
  assert.equal((failed.reason.getResponse() as { code: string }).code, 'TARGET_DEBIT_AMOUNT_INSUFFICIENT');
  assert.equal((await f.payments.preview([f.targetId])).items[0]!.payableAmount, '5.00');
  assert.equal(await f.db.differenceDisposal.count({ where: { storeId: f.store.id } }), 1);
  assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
}));

for (const source of ['STORE_CREDIT', 'SUPPLIER_OVERPAYMENT'] as const) {
  test(`${source}: foreign and wrong-direction confirmation errors replay without changing payment summary`, () => withFixture(source, async f => {
    const disposal = await f.service.create({ method: 'OFFLINE_RETURN', creditItemIds: [f.creditId], amount: '10.00', businessDate: new Date() });
    const before = await f.db.purchaseRequest.findUniqueOrThrow({ where: { id: f.request.id } });
    const foreign = '00000000-0000-4000-8000-000000000000';
    const scopes = source === 'STORE_CREDIT' ? [{ type: 'STORE_FINANCE', storeId: foreign }, { type: 'SUPPLIER', supplierId: f.supplier.id }]
      : [{ type: 'SUPPLIER', supplierId: foreign }, { type: 'STORE_FINANCE', storeId: f.store.id }];
    for (const [index, scope] of scopes.entries()) {
      const auth = { user: { id: f.user.id, roles: [scope.type], scope } } as never;
      const request = { headers: { 'idempotency-key': `${f.code}-${index}` }, auth } as never;
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(f.controller.confirm(request, auth, disposal.id, { expectedVersion: disposal.version }), (error: unknown) => {
          assert.ok(error instanceof HttpException);
          assert.equal(error.getStatus(), 404);
          assert.equal((error.getResponse() as { code: string }).code, 'DIFFERENCE_DISPOSAL_NOT_FOUND');
          return true;
        });
      }
    }
    assert.deepEqual(await f.db.purchaseRequest.findUniqueOrThrow({ where: { id: f.request.id } }), before);
    assert.equal((await f.db.differenceDisposal.findUniqueOrThrow({ where: { id: disposal.id } })).status, 'PENDING');
    assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
    assert.equal(await f.db.commandRecord.count({ where: { actorUserId: f.user.id, status: 'FAILED' } }), 2);
  }));
}
