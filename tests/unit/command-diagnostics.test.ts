import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CommandsService } from '../../apps/api/src/commands/commands.service.js';
import { CommandsController } from '../../apps/api/src/commands/commands.controller.js';
import { RolesGuard } from '../../apps/api/src/auth/roles.guard.js';

test('stale command diagnostics require ADMIN while own diagnostics allow authenticated roles', () => {
  const guard = new RolesGuard(new Reflector());
  const context = (handler: unknown, roles: string[]) => ({ getHandler: () => handler, getClass: () => CommandsController,
    switchToHttp: () => ({ getRequest: () => ({ auth: { user: { roles } } }) }) }) as never;
  for (const roles of [[], ['PURCHASER'], ['HQ_FINANCE'], ['SUPPLIER']]) {
    assert.throws(() => guard.canActivate(context(CommandsController.prototype.listStale, roles)), ForbiddenException);
    assert.throws(() => guard.canActivate(context(CommandsController.prototype.review, roles)), ForbiddenException);
    assert.throws(() => guard.canActivate(context(CommandsController.prototype.closeRolledBackPrice, roles)), ForbiddenException);
    assert.throws(() => guard.canActivate(context(CommandsController.prototype.closeUncommittedPrice, roles)), ForbiddenException);
    assert.equal(guard.canActivate(context(CommandsController.prototype.listOwn, roles)), true);
  }
  assert.equal(guard.canActivate(context(CommandsController.prototype.listStale, ['ADMIN'])), true);
  assert.equal(guard.canActivate(context(CommandsController.prototype.review, ['ADMIN'])), true);
  assert.equal(guard.canActivate(context(CommandsController.prototype.closeRolledBackPrice, ['ADMIN'])), true);
  assert.equal(guard.canActivate(context(CommandsController.prototype.closeUncommittedPrice, ['ADMIN'])), true);
});

test('diagnostic persistence failure preserves original unknown exception', async () => {
  const service = new CommandsService({ client: { commandRecord: { updateMany: async () => { throw new Error('Database down'); } } } } as never);
  const original = new Error('Original failure');
  await assert.rejects(service.perform({ state: 'started', command: { id: 'command' } } as never,
    async () => { throw original; }), error => error === original);
});

test('commit-stage failure cannot produce callback rollback proof', async () => {
  const writes: Array<{ data: { errorBody: { code: string } } }> = [];
  let reads = 0;
  const tx = { $queryRaw: async () => [], commandRecord: { findUniqueOrThrow: async () => ({ id: 'command', status: ++reads === 1 ? 'PROCESSING' : 'SUCCEEDED' }) } };
  const service = new CommandsService({ client: {
    $transaction: async (callback: (client: unknown) => Promise<unknown>) => { await callback(tx); throw new Error('Commit response lost'); },
    commandRecord: { updateMany: async (input: typeof writes[number]) => { writes.push(input); } }
  } } as never);
  await assert.rejects(service.performAtomic({ state: 'started', command: { id: 'command', action: 'price.process' } } as never, async () => ({ done: true })));
  assert.equal(writes.length, 1); assert.equal(writes[0]!.data.errorBody.code, 'COMMAND_OUTCOME_UNKNOWN');
});
