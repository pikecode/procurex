import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpException } from '@nestjs/common';
import { DifferenceDisposalsController } from '../../apps/api/src/difference-disposals/difference-disposals.controller.js';
import { CommandsService, type BeginCommandResult } from '../../apps/api/src/commands/commands.service.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const auth = { user: { id, roles: ['HQ_FINANCE'] } } as never;
const request = { headers: { 'idempotency-key': 'difference-replay-test' }, auth } as never;
for (const method of ['create', 'confirm'] as const) {
  test(`difference ${method} refuses processing/failed and replays without financial writes`, async () => {
    for (const state of ['processing', 'failed', 'replay'] as const) {
      let writes = 0;
      const commands = new CommandsService({} as never); const result = { id };
      commands.begin = async () => ({ state, command: { id, responseBody: result, errorBody: { code: 'DIFFERENCE_REJECTED', httpStatus: 409 } } }) as unknown as BeginCommandResult;
      const controller = new DifferenceDisposalsController({ create: async () => { writes++; }, confirm: async () => { writes++; } } as never, commands, {} as never);
      const promise = method === 'create' ? controller.create(request, auth, { method: 'OFFLINE_RETURN', creditItemIds: [id], amount: '10.00', businessDate: '2026-10-04' })
        : controller.confirm(request, auth, id, { expectedVersion: 1 });
      if (state === 'replay') assert.equal(await promise, result);
      else await assert.rejects(promise, (error: unknown) => { assert.ok(error instanceof HttpException); assert.equal(error.getStatus(), 409); return true; });
      assert.equal(writes, 0);
    }
  });
}
