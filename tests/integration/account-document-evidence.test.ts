import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type User, type Store, type StoreAccount, type FundingAllocation, type FileObject } from '../../packages/backend/generated/prisma/client.js';
import { StoresController } from '../../apps/api/src/stores/stores.controller.js';
import { StoresService, type RechargeDocumentView, type ClearingDocumentView } from '../../apps/api/src/stores/stores.service.js';
import { CommandsService } from '../../apps/api/src/commands/commands.service.js';
import { AuditService } from '../../apps/api/src/audit/audit.service.js';
import { FilesService } from '../../apps/api/src/files/files.service.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
type ProofFixture = { db: PrismaClient; user: User; store: Store; account: StoreAccount; funding: FundingAllocation; file: FileObject;
  commands: CommandsService; audit: AuditService; service: StoresService; controller: StoresController; auth: never; code: string;
  submit: (key?: string, ids?: string[]) => Promise<RechargeDocumentView | ClearingDocumentView> };
async function fixture(kind: 'RECHARGE' | 'CLEARING', run: (f: ProofFixture) => Promise<void>) {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const code = `APE${Date.now()}${randomUUID().slice(0, 8)}`;
  try {
    const user = await db.user.create({ data: { username: code, displayName: code } });
    const store = await db.store.create({ data: { code, name: code } });
    const collection = await db.collectionAccount.create({ data: { name: code, bankName: '测试银行', accountName: '测试户名', accountNo: code } });
    const account = await db.storeAccount.create({ data: { storeId: store.id, balance: '50', creditLimit: '100', creditUsed: '20' } });
    const funding = await db.fundingAllocation.create({ data: { storeId: store.id, method: 'CREDIT', targetAmount: '20', creditOutstanding: '20' } });
    const file = await db.fileObject.create({ data: { filename: 'isolated.png', mimeType: 'image/png', sizeBytes: 8n,
      purpose: kind, status: 'READY', ownerId: user.id, objectKey: randomUUID(), uploadTokenHash: 'isolated' } });
    const database = { client: db } as never;
    const commands = new CommandsService(database), audit = new AuditService(database), service = new StoresService(database);
    const controller = new StoresController(service, commands, audit);
    const auth = { user: { id: user.id, roles: ['HQ_FINANCE'] } } as never;
    const submit = (key = code, ids = [file.id]) => {
      const request = { auth, headers: { 'idempotency-key': key } } as never;
      return kind === 'RECHARGE'
        ? controller.createRecharge(request, auth, store.id, { amount: '10', businessDate: '2026-10-05', collectionAccountId: collection.id, evidenceFileIds: ids })
        : controller.createClearing(request, auth, store.id, { businessDate: '2026-10-05', evidenceFileIds: ids,
          items: [{ fundingAllocationId: funding.id, expectedVersion: funding.version, expectedAmount: '20' }] });
    };
    await run({ db, user, store, account, funding, file, commands, audit, service, controller, auth, submit, code });
  } finally {
    const own = { store: { code } };
    const storeIds = (await db.store.findMany({ where: { code }, select: { id: true } })).map(row => row.id);
    await db.auditLog.deleteMany({ where: { actor: { username: code } } });
    await db.commandRecord.deleteMany({ where: { actor: { username: code } } });
    await db.fileObject.deleteMany({ where: { owner: { username: code } } });
    await db.accountLedger.deleteMany({ where: { account: own } });
    await db.clearingDocument.deleteMany({ where: own }); await db.rechargeDocument.deleteMany({ where: own });
    await db.fundingAllocation.deleteMany({ where: { storeId: { in: storeIds } } }); await db.storeAccount.deleteMany({ where: own });
    await db.store.deleteMany({ where: { code } }); await db.user.deleteMany({ where: { username: code } });
    await db.collectionAccount.deleteMany({ where: { name: code } });
    await db.$disconnect();
  }
}

for (const kind of ['RECHARGE', 'CLEARING'] as const) {
  for (const failure of ['none', 'completion', 'audit', 'connection'] as const) {
    test(`account proof ${kind} ${failure}: links share funds, command and audit transaction`, () => fixture(kind, async f => {
      if (failure === 'completion') {
        const original = f.commands.succeed.bind(f.commands);
        f.commands.succeed = async (...args: Parameters<CommandsService['succeed']>) => { await original(...args); throw new Error('Injected proof completion failure'); };
      } else if (failure !== 'none') {
        const original = f.audit.record.bind(f.audit);
        f.audit.record = async (...args: Parameters<AuditService['record']>) => { await original(...args);
          if (failure === 'connection') await args[1]!.$queryRaw`SELECT pg_terminate_backend(pg_backend_pid())`;
          else throw new Error('Injected proof audit failure'); };
      }
      if (failure === 'none') {
        const result = await f.submit(); assert.deepEqual(await f.submit(), result);
        const linked = await f.db.fileObject.findUniqueOrThrow({ where: { id: f.file.id } });
        assert.equal(kind === 'RECHARGE' ? linked.rechargeId : linked.clearingId, result.id);
        const detail = await f.service.getAccountDocument(f.store.id, result.id, kind);
        assert.equal(detail.evidenceFiles[0]!.id, f.file.id);
        assert.equal(detail.operatorName, f.user.displayName);
        const files = new FilesService({ client: f.db } as never);
        for (const scope of [{ type: 'STORE', storeId: randomUUID() }, { type: 'SUPPLIER', supplierId: randomUUID() }]) {
          await assert.rejects(files.download(randomUUID(), f.file.id, scope, [scope.type]), (error: unknown) =>
            (error as { getStatus(): number }).getStatus() === 404);
        }
        await assert.rejects(f.service.getAccountDocument(randomUUID(), result.id, kind));
        const account = await f.db.storeAccount.findUniqueOrThrow({ where: { id: f.account.id } });
        assert.equal(account.balance.toFixed(2), kind === 'RECHARGE' ? '60.00' : '50.00');
        assert.equal(account.creditUsed.toFixed(2), kind === 'CLEARING' ? '0.00' : '20.00');
        assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
      } else {
        await assert.rejects(f.submit()); await assert.rejects(f.submit());
        assert.deepEqual(await f.db.storeAccount.findUniqueOrThrow({ where: { id: f.account.id } }), f.account);
        assert.deepEqual(await f.db.fileObject.findUniqueOrThrow({ where: { id: f.file.id } }), f.file);
        assert.equal(await f.db.accountLedger.count({ where: { accountId: f.account.id } }), 0);
        assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
      }
    }));
  }
  for (const invalid of ['foreign', 'purpose', 'uploading', 'duplicate', 'missing'] as const) {
    test(`account proof ${kind} rejects ${invalid} without financial writes`, () => fixture(kind, async f => {
      if (invalid === 'foreign') await f.db.fileObject.update({ where: { id: f.file.id }, data: { ownerId: (await f.db.user.findFirstOrThrow({ where: { id: { not: f.user.id } } })).id } });
      if (invalid === 'purpose') await f.db.fileObject.update({ where: { id: f.file.id }, data: { purpose: 'PAYMENT' } });
      if (invalid === 'uploading') await f.db.fileObject.update({ where: { id: f.file.id }, data: { status: 'UPLOADING' } });
      const ids = invalid === 'duplicate' ? [f.file.id, f.file.id] : invalid === 'missing' ? [randomUUID()] : [f.file.id];
      try {
        await assert.rejects(f.submit(f.code, ids)); await assert.rejects(f.submit(f.code, ids));
        assert.deepEqual(await f.db.storeAccount.findUniqueOrThrow({ where: { id: f.account.id } }), f.account);
        assert.equal(await f.db.rechargeDocument.count({ where: { storeId: f.store.id } }), 0);
        assert.equal(await f.db.clearingDocument.count({ where: { storeId: f.store.id } }), 0);
      } finally { if (invalid === 'foreign') await f.db.fileObject.update({ where: { id: f.file.id }, data: { ownerId: f.user.id } }); }
    }));
  }
  test(`account proof ${kind} concurrent reuse commits only once`, () => fixture(kind, async f => {
    const results = await Promise.allSettled([f.submit(`${f.code}-1`), f.submit(`${f.code}-2`)]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(await f.db.accountLedger.count({ where: { accountId: f.account.id } }), 1);
  }));
}

test('account proof upload purposes deny noncentral roles and PDF', () => fixture('RECHARGE', async f => {
  const files = new FilesService({ client: f.db } as never);
  for (const purpose of ['RECHARGE', 'CLEARING']) {
    await assert.rejects(files.create(f.user.id, { purpose, filename: 'proof.png', mimeType: 'image/png', sizeBytes: 8 }, ['STORE_FINANCE']));
    await assert.rejects(files.create(f.user.id, { purpose, filename: 'proof.pdf', mimeType: 'application/pdf', sizeBytes: 8 }, ['HQ_FINANCE']));
  }
}));
