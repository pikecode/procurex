import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { StoresController } from '../../apps/api/src/stores/stores.controller.js';
import { StoresService } from '../../apps/api/src/stores/stores.service.js';
import { CommandsService } from '../../apps/api/src/commands/commands.service.js';
import { AuditService } from '../../apps/api/src/audit/audit.service.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const actions = { recharge: 'store.recharge.create', limit: 'store.credit-limit.update', clearing: 'store.clearing.create' };

for (const operation of ['recharge', 'limit', 'clearing'] as const) {
  for (const failure of ['none', 'completion', 'audit', 'connection'] as const) {
    test(`atomic ${operation}: ${failure} preserves funds, command and audit together`, async () => {
      const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
      const code = `ATC${Date.now()}${operation[0]}${failure[0]}`;
      try {
        const user = await db.user.create({ data: { username: code, displayName: code } });
        const store = await db.store.create({ data: { code, name: code } });
        const collection = await db.collectionAccount.create({ data: { name: code, bankName: '测试银行', accountName: '测试户名', accountNo: code } });
        const account = await db.storeAccount.create({ data: { storeId: store.id, balance: '50', creditLimit: '100', creditUsed: '20' } });
        const funding = await db.fundingAllocation.create({ data: { storeId: store.id, method: 'CREDIT', targetAmount: '20', creditOutstanding: '20' } });
        const database = { client: db } as never;
        const commands = new CommandsService(database), audit = new AuditService(database);
        const controller = new StoresController(new StoresService(database), commands, audit);
        const auth = { user: { id: user.id, roles: ['HQ_FINANCE'] } } as never;
        const request = { headers: { 'idempotency-key': code }, auth } as never;
        const run = () => operation === 'recharge'
          ? controller.createRecharge(request, auth, store.id, { amount: '10.00', businessDate: '2026-10-04', collectionAccountId: collection.id })
          : operation === 'limit'
            ? controller.updateCreditLimit(request, auth, store.id, { limit: '150.00', expectedVersion: account.version, reason: 'Isolated approved limit' })
            : controller.createClearing(request, auth, store.id, { businessDate: '2026-10-04', items: [{ fundingAllocationId: funding.id, expectedAmount: '20.00', expectedVersion: funding.version }] });
        if (failure === 'completion') {
          const succeed = commands.succeed.bind(commands);
          commands.succeed = async (...args) => { await succeed(...args); throw new Error('Injected failure after response saved'); };
        } else if (failure === 'audit') {
          const record = audit.record.bind(audit);
          audit.record = async (...args) => { await record(...args); throw new Error('Injected failure after audit saved'); };
        } else if (failure === 'connection') {
          const record = audit.record.bind(audit);
          audit.record = async (...args) => {
            await record(...args);
            // Terminate the real transaction after all writes, before its commit.
            await args[1]!.$queryRaw`SELECT pg_terminate_backend(pg_backend_pid())`;
          };
        }
        if (failure === 'none') {
          const result = await run();
          assert.deepEqual(await run(), result);
          assert.equal(await db.auditLog.count({ where: { actorUserId: user.id } }), 1);
          assert.equal((await db.commandRecord.findFirstOrThrow({ where: { actorUserId: user.id } })).status, 'SUCCEEDED');
          const updated = await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
          assert.equal(updated.version, account.version + 1);
          assert.equal(updated.balance.toFixed(2), operation === 'recharge' ? '60.00' : '50.00');
          assert.equal(updated.creditLimit.toFixed(2), operation === 'limit' ? '150.00' : '100.00');
          assert.equal(updated.creditUsed.toFixed(2), operation === 'clearing' ? '0.00' : '20.00');
          assert.equal(await db.accountLedger.count({ where: { accountId: account.id } }), operation === 'limit' ? 0 : 1);
        } else {
          if (failure === 'connection') await assert.rejects(run());
          else await assert.rejects(run(), /Injected failure/);
          await assert.rejects(run(), ConflictException);
          assert.deepEqual(await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } }), account);
          assert.deepEqual(await db.fundingAllocation.findUniqueOrThrow({ where: { id: funding.id } }), funding);
          assert.equal(await db.accountLedger.count({ where: { accountId: account.id } }), 0);
          assert.equal(await db.auditLog.count({ where: { actorUserId: user.id } }), 0);
          assert.equal(await db.rechargeDocument.count({ where: { storeId: store.id } }), 0);
          assert.equal(await db.clearingDocument.count({ where: { storeId: store.id } }), 0);
          const command = await db.commandRecord.findFirstOrThrow({ where: { actorUserId: user.id } });
          assert.equal(command.action, actions[operation]);
          assert.equal(command.status, 'PROCESSING');
          assert.equal(command.responseBody, null);
        }
      } finally {
        const storeIds = (await db.store.findMany({ where: { code }, select: { id: true } })).map(row => row.id);
        const own = { storeId: { in: storeIds } };
        await db.auditLog.deleteMany({ where: { actor: { username: code } } });
        await db.commandRecord.deleteMany({ where: { actor: { username: code } } });
        await db.accountLedger.deleteMany({ where: { account: own } });
        await db.clearingDocument.deleteMany({ where: own });
        await db.rechargeDocument.deleteMany({ where: own });
        await db.fundingAllocation.deleteMany({ where: own });
        await db.storeAccount.deleteMany({ where: own });
        await db.store.deleteMany({ where: { code } });
        await db.user.deleteMany({ where: { username: code } });
        await db.collectionAccount.deleteMany({ where: { name: code } });
        await db.$disconnect();
      }
    });
  }
}

test('atomic commands serialize a stale started handle and credit-limit updates serialize funding locks', async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const code = `ATC${Date.now()}race`;
  try {
    const user = await db.user.create({ data: { username: code, displayName: code } });
    const store = await db.store.create({ data: { code, name: code } });
    const account = await db.storeAccount.create({ data: { storeId: store.id, creditLimit: '100' } });
    const database = { client: db } as never;
    const commands = new CommandsService(database), stores = new StoresService(database), audit = new AuditService(database);
    const started = await commands.begin({ actorUserId: user.id, action: 'store.recharge.create', idempotencyKey: code, requestBody: { storeId: store.id }, traceId: code });
    let calls = 0;
    const run = () => commands.performAtomic(started, async tx => {
      calls++;
      const result = await stores.createRecharge(store.id, { amount: '10', businessDate: new Date(), collectionAccountId: 'isolated' }, tx);
      await commands.succeed({ commandId: started.command.id, responseBody: result as never }, tx);
      await audit.record({ actorUserId: user.id, activeScope: { roles: ['HQ_FINANCE'] }, action: 'store.recharge.create', entityType: 'RechargeDocument', entityId: result.id, traceId: code }, tx);
      return result;
    });
    const results = await Promise.all([run(), run()]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(calls, 1);
    assert.equal(await db.rechargeDocument.count({ where: { storeId: store.id } }), 1);
    assert.equal(await db.auditLog.count({ where: { actorUserId: user.id } }), 1);
    const current = await db.storeAccount.findUniqueOrThrow({ where: { id: account.id } });
    const updates = await Promise.allSettled(['150', '200'].map(limit => stores.updateCreditLimit(store.id, { limit, expectedVersion: current.version, reason: 'Concurrent approvals' })));
    assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = updates.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof ConflictException);
    assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { id: account.id } })).version, current.version + 1);
    const before = await db.storeAccount.findUniqueOrThrow({ where: { id: account.id } });
    const incomplete = await commands.begin({ actorUserId: user.id, action: 'store.recharge.create', idempotencyKey: `${code}-incomplete`, requestBody: { storeId: store.id }, traceId: code });
    await assert.rejects(commands.performAtomic(incomplete, tx => stores.createRecharge(store.id, { amount: '10', businessDate: new Date(), collectionAccountId: 'isolated' }, tx)), /must save its successful response/);
    assert.deepEqual(await db.storeAccount.findUniqueOrThrow({ where: { id: account.id } }), before);
    assert.equal(await db.rechargeDocument.count({ where: { storeId: store.id } }), 1);
  } finally {
    const own = { store: { code } };
    const ids = (await db.store.findMany({ where: { code }, select: { id: true } })).map(row => row.id);
    await db.auditLog.deleteMany({ where: { actor: { username: code } } });
    await db.commandRecord.deleteMany({ where: { actor: { username: code } } });
    await db.accountLedger.deleteMany({ where: { account: { storeId: { in: ids } } } });
    await db.rechargeDocument.deleteMany({ where: own });
    await db.storeAccount.deleteMany({ where: { storeId: { in: ids } } });
    await db.store.deleteMany({ where: { code } });
    await db.user.deleteMany({ where: { username: code } });
    await db.$disconnect();
  }
});

test('atomic credit-limit failure preserves missing-account semantics and replays the definite error', async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const code = `ATC${Date.now()}missing`;
  try {
    const user = await db.user.create({ data: { username: code, displayName: code } });
    const store = await db.store.create({ data: { code, name: code } });
    const database = { client: db } as never;
    const controller = new StoresController(new StoresService(database), new CommandsService(database), new AuditService(database));
    const auth = { user: { id: user.id, roles: ['HQ_FINANCE'] } } as never;
    const request = { headers: { 'idempotency-key': code }, auth } as never;
    const run = () => controller.updateCreditLimit(request, auth, store.id, { limit: '150', expectedVersion: 1, reason: 'Missing account must not be created' });
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(run(), (error: unknown) => {
        const http = error as { getStatus(): number; getResponse(): { code: string } };
        assert.equal(http.getStatus(), 404);
        assert.equal(http.getResponse().code, 'STORE_ACCOUNT_NOT_FOUND');
        return true;
      });
    }
    assert.equal(await db.storeAccount.count({ where: { storeId: store.id } }), 0);
    assert.equal(await db.auditLog.count({ where: { actorUserId: user.id } }), 0);
    assert.equal((await db.commandRecord.findFirstOrThrow({ where: { actorUserId: user.id } })).status, 'FAILED');
  } finally {
    await db.auditLog.deleteMany({ where: { actor: { username: code } } });
    await db.commandRecord.deleteMany({ where: { actor: { username: code } } });
    await db.store.deleteMany({ where: { code } });
    await db.user.deleteMany({ where: { username: code } });
    await db.$disconnect();
  }
});
