import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpException } from '@nestjs/common';
import { PaymentRecordsController } from '../../apps/api/src/payment-records/payment-records.controller.js';
import { CommandsService, type BeginCommandResult } from '../../apps/api/src/commands/commands.service.js';
import { PaymentRecordsService } from '../../apps/api/src/payment-records/payment-records.service.js';

test('supplier cannot confirm or reject company-channel store collections even for its own supplier', async () => {
  const service = new PaymentRecordsService({ client: { paymentRecord: { findUnique: async () => ({ direction: 'STORE_TO_COMPANY', channel: 'COMPANY', storeId: 'store', supplierId: 'supplier' }) } } } as never);
  for (const action of ['confirm', 'reject'] as const) {
    const promise = action === 'confirm' ? service.confirm('payment', 1, { type: 'SUPPLIER', supplierId: 'supplier' }) : service.reject('payment', 1, 'incorrect', { type: 'SUPPLIER', supplierId: 'supplier' });
    await assert.rejects(promise, (error: unknown) => { assert.ok(error instanceof HttpException); assert.equal(error.getStatus(), 404); return true; });
  }
});

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const auth = { user: { id, roles: ['HQ_FINANCE'] } } as never;
const request = { headers: { 'idempotency-key': 'payment-replay-test' }, auth } as never;
for (const method of ['create', 'confirm', 'reject', 'cancel'] as const) {
  test(`payment ${method} refuses processing/failed and replays without writing`, async () => {
    for (const state of ['processing', 'failed', 'replay'] as const) {
      let writes = 0;
      const commands = new CommandsService({} as never);
      const result = { id };
      commands.begin = async () => ({ state, command: { id, responseBody: result, errorBody: { code: 'PAYMENT_REJECTED', httpStatus: 409 } } }) as unknown as BeginCommandResult;
      const write = async () => { writes++; };
      const controller = new PaymentRecordsController({ create: write, confirm: write, reject: write, cancel: write } as never, commands, {} as never);
      const promise = method === 'create' ? controller.create(request, auth, { direction: 'STORE_TO_COMPANY', businessDate: '2026-10-04', evidenceFileIds: [id], items: [{ settlementItemId: 'item', expectedVersion: 1, expectedAmount: '10.00' }] })
        : method === 'confirm' ? controller.confirm(request, auth, id, { expectedVersion: 1 })
          : controller[method](request, auth, id, { expectedVersion: 1, reason: 'incorrect proof' });
      if (state === 'replay') assert.equal(await promise, result);
      else await assert.rejects(promise, (error: unknown) => { assert.ok(error instanceof HttpException); assert.equal(error.getStatus(), 409); return true; });
      assert.equal(writes, 0);
    }
  });
}
