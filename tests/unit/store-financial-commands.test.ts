import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, HttpException } from '@nestjs/common';
import { StoresController } from '../../apps/api/src/stores/stores.controller.js';
import type { StoresService } from '../../apps/api/src/stores/stores.service.js';
import { CommandsService, type BeginCommandResult } from '../../apps/api/src/commands/commands.service.js';
import type { DatabaseService } from '../../apps/api/src/database/database.service.js';
import type { AuditService } from '../../apps/api/src/audit/audit.service.js';
import type { AuthenticatedRequest } from '../../apps/api/src/auth/auth.guard.js';
import type { AuthenticatedSession } from '../../apps/api/src/auth/auth.service.js';

const storeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const auth = { user: { id: storeId, roles: ['HQ_FINANCE'] } } as AuthenticatedSession;
const request = { headers: { 'idempotency-key': 'financial-command-test' }, auth } as AuthenticatedRequest;
const operations = [
  { name: 'recharge', method: 'createRecharge', body: { amount: '10.00', businessDate: '2026-10-04', collectionAccountId: 'bank-reference' } },
  { name: 'credit limit', method: 'updateCreditLimit', body: { expectedVersion: 1, limit: '100.00', reason: 'approved' } },
  { name: 'clearing', method: 'createClearing', body: { businessDate: '2026-10-04', items: [{ fundingAllocationId: storeId, expectedVersion: 1, expectedAmount: '10.00' }] } },
] as const;

function fixture(state: BeginCommandResult['state'], reject = false) {
  let writes = 0;
  let audits = 0;
  const failures: unknown[] = [];
  const response = { id: storeId, storeId, amount: '10.00', account: { version: 2 }, items: [] };
  const commands = new CommandsService({ client: { commandRecord: {
    updateMany: async ({ data }: { data: unknown }) => { failures.push(data); return { count: 1 }; },
    findUniqueOrThrow: async () => failures.at(-1),
  } } } as unknown as DatabaseService);
  commands.begin = async () => ({ state, command: {
    id: storeId, responseBody: response,
    errorBody: { code: 'ACCOUNT_REJECTED', message: 'rejected', httpStatus: 409 },
  } }) as unknown as BeginCommandResult;
  commands.succeed = async () => ({}) as never;
  commands.performAtomic = (command, operation) => commands.perform(command, () => operation({} as never));
  const write = async () => {
    writes++;
    if (reject) throw new ConflictException({ code: 'ACCOUNT_REJECTED', message: 'rejected' });
    return response;
  };
  const controller = new StoresController({ createRecharge: write, updateCreditLimit: write, createClearing: write } as unknown as StoresService,
    commands, { record: async () => { audits++; } } as unknown as AuditService);
  return { controller, response, failures, writes: () => writes, audits: () => audits };
}

for (const operation of operations) {
  test(`${operation.name}: processing and failed commands never write or audit`, async () => {
    for (const state of ['processing', 'failed'] as const) {
      const f = fixture(state);
      await assert.rejects(f.controller[operation.method](request, auth, storeId, operation.body), (error: unknown) => {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), 409);
        assert.equal((error.getResponse() as { code: string }).code, state === 'processing' ? 'COMMAND_PROCESSING' : 'ACCOUNT_REJECTED');
        return true;
      });
      assert.equal(f.writes(), 0);
      assert.equal(f.audits(), 0);
    }
  });
  test(`${operation.name}: replay returns original result without another write`, async () => {
    const f = fixture('replay');
    assert.equal(await f.controller[operation.method](request, auth, storeId, operation.body), f.response);
    assert.equal(f.writes(), 0);
    assert.equal(f.audits(), 0);
  });
  test(`${operation.name}: success writes and audits once; definite rejection is recorded`, async () => {
    const success = fixture('started');
    assert.equal(await success.controller[operation.method](request, auth, storeId, operation.body), success.response);
    assert.equal(success.writes(), 1);
    assert.equal(success.audits(), 1);
    const failure = fixture('started', true);
    await assert.rejects(failure.controller[operation.method](request, auth, storeId, operation.body), ConflictException);
    assert.equal(failure.writes(), 1);
    assert.equal(failure.audits(), 0);
    assert.equal(failure.failures.length, 1);
    assert.equal((failure.failures[0] as { status: string }).status, 'FAILED');
  });
}

test('account and ledger reads require own store scope, including direct controller calls', () => {
  const controller = fixture('started').controller;
  for (const roles of [['STORE'], ['STORE_FINANCE']]) {
    for (const scope of [undefined, { type: 'SUPPLIER', storeId }, { type: 'STORE', storeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]) {
      const scoped = { auth: { user: { roles, scope } } } as AuthenticatedRequest;
      assert.throws(() => controller.getAccount(storeId, scoped), HttpException);
      assert.throws(() => controller.listLedgers(storeId, {}, scoped), HttpException);
    }
  }
});
