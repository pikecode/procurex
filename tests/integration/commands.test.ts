import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { CommandStatus } from '../../packages/backend/generated/prisma/enums.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { CommandsService } from '../../apps/api/src/commands/commands.service.js';
import { CommandsController } from '../../apps/api/src/commands/commands.controller.js';
import { AuditService } from '../../apps/api/src/audit/audit.service.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';

function createClient(): InstanceType<typeof PrismaClient> {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

function createService(prisma: InstanceType<typeof PrismaClient>): CommandsService {
  return new CommandsService({ client: prisma } as never);
}

for (const fault of ['none', 'audit', 'completion', 'connection'] as const) {
  test(`uncommitted atomic price closure preserves funds and audit: ${fault}`, async () => {
    const prisma = createClient(), service = createService(prisma), audit = new AuditService({ client: prisma } as never);
    const controller = new CommandsController(service, audit), username = `it_price_contract_${Date.now()}`;
    try {
      const user = await prisma.user.create({ data: { username, displayName: 'Atomic contract' } });
      const input = { actorUserId: user.id, action: 'price.process', idempotencyKey: 'atomic-original', requestBody: { id: user.id },
        resourceType: 'PriceChangeRun', resourceId: user.id, traceId: username, atomicPriceExecution: true };
      const target = await service.begin(input), before = await service.findById(user.id, target.command.id);
      assert.equal(before!.errorBody, null);
      if (fault === 'completion') {
        const save = service.succeed.bind(service); service.succeed = async (...args) => { await save(...args); throw new Error('Completion failure'); };
      } else if (fault === 'audit' || fault === 'connection') {
        const record = audit.record.bind(audit); audit.record = async (...args) => {
          await record(...args);
          if (fault === 'connection') await args[1]!.$queryRaw`SELECT pg_terminate_backend(pg_backend_pid())`;
          throw new Error('Audit failure');
        };
      }
      const request = { headers: { 'idempotency-key': 'close-uncommitted' }, auth: { user: { id: user.id, roles: ['ADMIN'] } } } as never;
      const close = () => controller.closeUncommittedPrice(target.command.id, { reason: 'Locked PROCESSING contract; no business commit' }, request);
      if (fault === 'none') {
        const result = await close(); assert.equal(result.status, 'FAILED'); assert.deepEqual(await close(), result);
        assert.equal(await prisma.auditLog.count({ where: { actorUserId: user.id } }), 1);
        let calls = 0;
        await assert.rejects(service.performAtomic(target, async () => { calls++; return {}; }), HttpException);
        assert.equal(calls, 0);
      } else {
        await assert.rejects(close); assert.deepEqual(await service.findById(user.id, target.command.id), before);
        assert.equal(await prisma.auditLog.count({ where: { actorUserId: user.id } }), 0); await assert.rejects(close, ConflictException);
      }
    } finally {
      await prisma.auditLog.deleteMany({ where: { actor: { username } } });
      await prisma.commandRecord.deleteMany({ where: { actor: { username } } });
      await prisma.user.deleteMany({ where: { username } }); await prisma.$disconnect();
    }
  });
}

for (const outcome of ['commit', 'rollback', 'commit-response-loss']) {
  test(`atomic price closure waits for executing transaction: ${outcome}`, async () => {
    const prisma = createClient(), service = createService(prisma), audit = new AuditService({ client: prisma } as never);
    const controller = new CommandsController(service, audit), username = `it_price_contract_race_${Date.now()}`;
    try {
      const user = await prisma.user.create({ data: { username, displayName: 'Before execution' } });
      const input = { actorUserId: user.id, action: 'price.process', idempotencyKey: 'active', requestBody: { id: user.id },
        resourceType: 'PriceChangeRun', resourceId: user.id, traceId: username, atomicPriceExecution: true };
      const target = await service.begin(input);
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; }), inside = new Promise<void>(resolve => { entered = resolve; });
      const originalTransaction = prisma.$transaction.bind(prisma);
      if (outcome === 'commit-response-loss') {
        prisma.$transaction = (async (callback: never) => { await originalTransaction(callback); throw new Error('Commit response lost'); }) as typeof prisma.$transaction;
      }
      const execution = service.performAtomic(target, async tx => {
        await tx.user.update({ where: { id: user.id }, data: { displayName: 'Executed once' } }); entered(); await gate;
        if (outcome === 'rollback') throw new Error('Interrupted callback');
        await service.succeed({ commandId: target.command.id, responseBody: { done: true } }, tx);
        return { done: true };
      });
      const settledExecution = execution.then(value => ({ value }), error => ({ error }));
      await inside; prisma.$transaction = originalTransaction as typeof prisma.$transaction;
      let settled = false;
      const close = controller.closeUncommittedPrice(target.command.id, { reason: 'Wait for command lock before reconciliation' },
        { headers: { 'idempotency-key': 'race-close' }, auth: { user: { id: user.id, roles: ['ADMIN'] } } } as never);
      const settledClose = close.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
      await new Promise(resolve => setTimeout(resolve, 80)); assert.equal(settled, false); release();
      const [executed, closed] = await Promise.all([settledExecution, settledClose]);
      if (outcome === 'rollback') {
        assert.ok('error' in executed); assert.ok('value' in closed);
        assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).displayName, 'Before execution');
        assert.equal((await service.begin(input)).state, 'failed');
      } else {
        assert.ok('error' in closed); assert.equal((await service.begin(input)).state, 'replay');
        assert.deepEqual(await service.perform(await service.begin(input), async () => { throw new Error('No replay writes'); }), { done: true });
        assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).displayName, 'Executed once');
        assert.equal((await service.findById(user.id, target.command.id))!.errorBody, null);
        if (outcome === 'commit-response-loss') assert.ok('error' in executed);
      }
    } finally {
      await prisma.auditLog.deleteMany({ where: { actor: { username } } });
      await prisma.commandRecord.deleteMany({ where: { actor: { username } } });
      await prisma.user.deleteMany({ where: { username } }); await prisma.$disconnect();
    }
  });
}

test('uncommitted closure rejects pre-contract price and legacy command records', async () => {
  const prisma = createClient(), service = createService(prisma), audit = new AuditService({ client: prisma } as never);
  const controller = new CommandsController(service, audit), username = `it_price_contract_guard_${Date.now()}`;
  try {
    const user = await prisma.user.create({ data: { username, displayName: 'Legacy contract guard' } });
    for (const action of ['price.process', 'payment.confirm']) {
      const target = await service.begin({ actorUserId: user.id, action, idempotencyKey: action, requestBody: {},
        traceId: username, resourceType: 'PriceChangeRun', resourceId: user.id });
      assert.equal(target.command.atomicPriceExecution, false);
      await assert.rejects(controller.closeUncommittedPrice(target.command.id, { reason: 'Cannot infer atomicity from action name' },
        { headers: { 'idempotency-key': `guard-${action}` }, auth: { user: { id: user.id, roles: ['ADMIN'] } } } as never), ConflictException);
      assert.equal((await service.findById(user.id, target.command.id))!.status, 'PROCESSING');
    }
  } finally {
    await prisma.commandRecord.deleteMany({ where: { actor: { username } } });
    await prisma.user.deleteMany({ where: { username } }); await prisma.$disconnect();
  }
});

for (const fault of ['none', 'audit', 'completion', 'connection'] as const) {
  test(`proven rolled-back price command closure is atomic: ${fault}`, async () => {
    const prisma = createClient(), service = createService(prisma), audit = new AuditService({ client: prisma } as never);
    const controller = new CommandsController(service, audit), username = `it_price_rollback_${Date.now()}`;
    try {
      const user = await prisma.user.create({ data: { username, displayName: 'Rollback evidence' } });
      const input = { actorUserId: user.id, action: 'price.process', idempotencyKey: 'price-original', requestBody: { id: user.id },
        resourceType: 'PriceChangeRun', resourceId: user.id, traceId: username };
      const target = await service.begin(input);
      await assert.rejects(service.performAtomic(target, async tx => {
        await tx.user.update({ where: { id: user.id }, data: { displayName: 'Must roll back' } });
        throw new Error('Precommit fault');
      }));
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).displayName, 'Rollback evidence');
      const before = await service.findById(user.id, target.command.id);
      assert.equal((before!.errorBody as { code: string }).code, 'COMMAND_ROLLBACK_CONFIRMED');
      if (fault === 'completion') {
        const save = service.succeed.bind(service); service.succeed = async (...args) => { await save(...args); throw new Error('Completion fault'); };
      } else if (fault === 'audit' || fault === 'connection') {
        const record = audit.record.bind(audit); audit.record = async (...args) => {
          await record(...args);
          if (fault === 'connection') await args[1]!.$queryRaw`SELECT pg_terminate_backend(pg_backend_pid())`;
          throw new Error('Audit fault');
        };
      }
      const request = { headers: { 'idempotency-key': 'close-price-key' }, auth: { user: { id: user.id, roles: ['ADMIN'] } } } as never;
      const close = () => controller.closeRolledBackPrice(target.command.id, { reason: 'Verified server callback rollback proof' }, request);
      if (fault === 'none') {
        const result = await close(); assert.equal(result.status, 'FAILED'); assert.deepEqual(await close(), result);
        assert.equal(await prisma.auditLog.count({ where: { actorUserId: user.id } }), 1);
        const failed = await service.begin(input); assert.equal(failed.state, 'failed');
        await assert.rejects(service.perform(failed, async () => { throw new Error('Must not run'); }), error => error instanceof HttpException && (error.getResponse() as { code: string }).code === 'COMMAND_ROLLED_BACK');
        assert.equal((await service.begin({ ...input, idempotencyKey: 'new-reviewed-submission' })).state, 'started');
      } else {
        await assert.rejects(close); assert.deepEqual(await service.findById(user.id, target.command.id), before);
        assert.equal(await prisma.auditLog.count({ where: { actorUserId: user.id } }), 0); await assert.rejects(close, ConflictException);
      }
    } finally {
      await prisma.auditLog.deleteMany({ where: { actor: { username } } });
      await prisma.commandRecord.deleteMany({ where: { actor: { username } } });
      await prisma.user.deleteMany({ where: { username } }); await prisma.$disconnect();
    }
  });
}

test('price rollback closure rejects unknown, legacy and terminal commands', async () => {
  const prisma = createClient(), service = createService(prisma), audit = new AuditService({ client: prisma } as never);
  const controller = new CommandsController(service, audit), username = `it_price_rollback_guard_${Date.now()}`;
  try {
    const user = await prisma.user.create({ data: { username, displayName: 'Rollback guard' } });
    for (const kind of ['unknown', 'legacy', 'terminal']) {
      const target = await service.begin({ actorUserId: user.id, action: kind === 'legacy' ? 'payment.confirm' : 'price.process',
        idempotencyKey: kind, requestBody: {}, resourceType: 'PriceChangeRun', resourceId: user.id, traceId: username });
      if (kind === 'terminal') await service.succeed({ commandId: target.command.id, responseBody: { done: true } });
      const before = await service.findById(user.id, target.command.id);
      await assert.rejects(controller.closeRolledBackPrice(target.command.id, { reason: 'Cannot assume no writes' },
        { headers: { 'idempotency-key': `close-${kind}` }, auth: { user: { id: user.id, roles: ['ADMIN'] } } } as never), ConflictException);
      assert.deepEqual(await service.findById(user.id, target.command.id), before);
    }
    assert.equal(await prisma.auditLog.count({ where: { actorUserId: user.id } }), 0);
  } finally {
    await prisma.auditLog.deleteMany({ where: { actor: { username } } });
    await prisma.commandRecord.deleteMany({ where: { actor: { username } } });
    await prisma.user.deleteMany({ where: { username } }); await prisma.$disconnect();
  }
});

for (const fault of ['none', 'audit', 'completion', 'connection'] as const) {
  test(`command review records evidence without resolving original outcome: ${fault}`, async () => {
    const prisma = createClient(), service = createService(prisma), audit = new AuditService({ client: prisma } as never);
    const controller = new CommandsController(service, audit), username = `it_command_review_${Date.now()}`;
    try {
      const user = await prisma.user.create({ data: { username, displayName: 'Review admin' } });
      const target = await service.begin({ actorUserId: user.id, action: 'price.process', idempotencyKey: 'original-key',
        requestBody: { id: user.id }, traceId: username, expiresAt: new Date('2000-01-01') });
      const before = await service.findById(user.id, target.command.id);
      const request = { headers: { 'idempotency-key': 'review-key' }, auth: { user: { id: user.id, roles: ['ADMIN'] } } } as never;
      if (fault === 'completion') {
        const save = service.succeed.bind(service);
        service.succeed = async (...args) => { await save(...args); throw new Error('Completion failure'); };
      } else if (fault === 'audit' || fault === 'connection') {
        const record = audit.record.bind(audit);
        audit.record = async (...args) => {
          await record(...args);
          if (fault === 'connection') await args[1]!.$queryRaw`SELECT pg_terminate_backend(pg_backend_pid())`;
          throw new Error('Audit failure');
        };
      }
      const review = () => controller.review(target.command.id, { expectedStatus: 'PROCESSING', reason: 'Task and ledger inspected; outcome remains unverified' }, request);
      if (fault === 'none') {
        const result = await review();
        assert.equal(result.resolution, 'REVIEW_RECORDED_NO_STATE_CHANGE');
        assert.deepEqual(await review(), result);
        assert.equal(await prisma.auditLog.count({ where: { actorUserId: user.id, action: 'command.review' } }), 1);
        const note = await prisma.auditLog.findFirstOrThrow({ where: { actorUserId: user.id } });
        assert.equal(note.entityId, target.command.id); assert.ok(note.reason);
      } else {
        await assert.rejects(review);
        assert.equal(await prisma.auditLog.count({ where: { actorUserId: user.id } }), 0);
        await assert.rejects(review, ConflictException);
      }
      assert.deepEqual(await service.findById(user.id, target.command.id), before);
      let executions = 0;
      await assert.rejects(service.perform(await service.begin({ actorUserId: user.id, action: 'price.process', idempotencyKey: 'original-key',
        requestBody: { id: user.id }, traceId: username }), async () => { executions++; }), ConflictException);
      assert.equal(executions, 0);
    } finally {
      await prisma.auditLog.deleteMany({ where: { actor: { username } } });
      await prisma.commandRecord.deleteMany({ where: { actor: { username } } });
      await prisma.user.deleteMany({ where: { username } }); await prisma.$disconnect();
    }
  });
}

test('command reviews reject stale status, missing target, self-review and invalid reasons', async () => {
  const prisma = createClient(), service = createService(prisma), audit = new AuditService({ client: prisma } as never);
  const controller = new CommandsController(service, audit), username = `it_command_review_guard_${Date.now()}`;
  try {
    const user = await prisma.user.create({ data: { username, displayName: 'Review guard' } });
    const target = await service.begin({ actorUserId: user.id, action: 'price.process', idempotencyKey: 'target-key', requestBody: {}, traceId: username });
    await service.succeed({ commandId: target.command.id, responseBody: { done: true } });
    const request = (key: string) => ({ headers: { 'idempotency-key': key }, auth: { user: { id: user.id, roles: ['ADMIN'] } } }) as never;
    const body = { expectedStatus: 'PROCESSING', reason: 'Inspected resource' };
    await assert.rejects(controller.review(target.command.id, body, request('stale-key')), ConflictException);
    await assert.rejects(controller.review(user.id, body, request('missing-key')), error => error instanceof HttpException && error.getStatus() === 404);
    const reviewCommand = await prisma.commandRecord.findFirstOrThrow({ where: { actorUserId: user.id, action: 'command.review' } });
    await assert.rejects(controller.review(reviewCommand.id, { ...body, expectedStatus: 'FAILED' }, request('nested-key')), ConflictException);
    for (const reason of ['', ' ', 'x'.repeat(501)]) await assert.rejects(controller.review(target.command.id, { ...body, reason }, request('invalid-key')), BadRequestException);
    assert.equal(await prisma.auditLog.count({ where: { actorUserId: user.id } }), 0);
    assert.equal((await service.findById(user.id, target.command.id))!.status, 'SUCCEEDED');
  } finally {
    await prisma.auditLog.deleteMany({ where: { actor: { username } } });
    await prisma.commandRecord.deleteMany({ where: { actor: { username } } });
    await prisma.user.deleteMany({ where: { username } }); await prisma.$disconnect();
  }
});

test('command diagnostics isolate actors, redact payloads and never unlock expired unknown commands', async () => {
  const prisma = createClient(), service = createService(prisma), controller = new CommandsController(service, new AuditService({ client: prisma } as never));
  const username = `it_command_diagnostic_${Date.now()}`;
  try {
    const owner = await prisma.user.create({ data: { username, displayName: 'Diagnostics owner' } });
    const other = await prisma.user.create({ data: { username: `${username}_other`, displayName: 'Other owner' } });
    const input = { actorUserId: owner.id, action: 'price.process', idempotencyKey: 'diagnostic-key',
      requestBody: { id: owner.id }, resourceType: 'PriceChangeRun', resourceId: owner.id,
      traceId: username, expiresAt: new Date('2000-01-01') };
    const started = await service.begin(input);
    const failure = new Error('secret SQL password must never be exposed');
    await assert.rejects(service.perform(started, async () => { throw failure; }), error => error === failure);
    const stored = await service.findById(owner.id, started.command.id);
    assert.equal(stored!.status, 'PROCESSING'); assert.equal(stored!.finishedAt, null);
    assert.equal((stored!.errorBody as { code: string }).code, 'COMMAND_OUTCOME_UNKNOWN');
    assert.ok(!JSON.stringify(stored!.errorBody).includes('secret'));
    const own = await controller.listOwn({ auth: { user: { id: owner.id } } } as never, {});
    assert.equal(own.length, 1); assert.equal(own[0]!.stale, true);
    assert.equal(own[0]!.resourceId, owner.id); assert.equal(own[0]!.recovery, 'RECONCILIATION_REQUIRED');
    assert.equal(own[0]!.errorCode, 'COMMAND_OUTCOME_UNKNOWN');
    for (const field of ['responseBody', 'errorBody', 'idempotencyKey', 'requestHash']) assert.ok(!(field in own[0]!));
    assert.deepEqual(await controller.listOwn({ auth: { user: { id: other.id } } } as never, {}), []);
    assert.ok((await controller.listStale({})).some(row => row.id === started.command.id));
    let calls = 0;
    await assert.rejects(service.perform(await service.begin(input), async () => { calls++; }), ConflictException);
    assert.equal(calls, 0);
    const done = await service.begin({ ...input, idempotencyKey: 'terminal-diagnostic' });
    await service.succeed({ commandId: done.command.id, responseBody: { sensitive: 'not visible' } });
    await assert.rejects(service.perform(done, async () => { throw failure; }));
    assert.equal((await service.findById(owner.id, done.command.id))!.errorBody, null);
    assert.ok(!(await controller.listStale({})).some(row => row.id === done.command.id));
    assert.equal((await controller.listOwn({ auth: { user: { id: owner.id } } } as never, { limit: '1' })).length, 1);
    for (const limit of ['0', '101', '1.5', 'abc', ['1']]) assert.throws(() => controller.listStale({ limit }), BadRequestException);
  } finally {
    await prisma.commandRecord.deleteMany({ where: { actor: { username: { in: [username, `${username}_other`] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [username, `${username}_other`] } } });
    await prisma.$disconnect();
  }
});

test('late command failure never overwrites an already successful response or terminal error', async () => {
  const prisma = createClient(), service = createService(prisma);
  const username = `it_command_terminal_${Date.now()}`;
  try {
    const user = await prisma.user.create({ data: { username, displayName: 'Terminal command protection' } });
    const input = { actorUserId: user.id, action: 'store.recharge.create', idempotencyKey: 'terminal-key', requestBody: { amount: '10' }, traceId: username };
    const started = await service.begin(input);
    await service.succeed({ commandId: started.command.id, responseBody: { id: user.id } });
    const preserved = await service.fail({ commandId: started.command.id, errorBody: { code: 'LATE_FAILURE' } });
    assert.equal(preserved.status, 'SUCCEEDED');
    assert.deepEqual(preserved.responseBody, { id: user.id });
    assert.equal(preserved.errorBody, null);
    assert.equal((await service.begin(input)).state, 'replay');
    const failed = await service.begin({ ...input, idempotencyKey: 'failed-terminal-key' });
    const original = await service.fail({ commandId: failed.command.id, errorBody: { code: 'ORIGINAL_FAILURE' } });
    const repeated = await service.fail({ commandId: failed.command.id, errorBody: { code: 'LATE_FAILURE' } });
    assert.deepEqual(repeated.errorBody, original.errorBody);
    assert.deepEqual(repeated.finishedAt, original.finishedAt);
  } finally {
    await prisma.commandRecord.deleteMany({ where: { actor: { username } } });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  }
});

test('command execution rejects processing, retains unknown outcomes and replays definite failures', async () => {
  const prisma = createClient(), service = createService(prisma);
  const username = `it_command_execution_${Date.now()}`;
  try {
    const user = await prisma.user.create({ data: { username, displayName: 'Execution guard' } });
    const input = { actorUserId: user.id, action: 'supplier-order.shipment.create', idempotencyKey: 'execution-key', requestBody: { version: 7 }, traceId: 'execution-trace' };
    const started = await service.begin(input);
    let calls = 0;
    await assert.rejects(service.perform(await service.begin(input), async () => { calls++; }), (error: unknown) => error instanceof ConflictException && (error.getResponse() as { code: string }).code === 'COMMAND_PROCESSING');
    assert.equal(calls, 0);
    await assert.rejects(service.perform(started, async () => { throw new Error('Unknown network outcome'); }));
    assert.equal((await service.begin(input)).state, 'processing');
    const failedInput = { ...input, idempotencyKey: 'business-failure-key' };
    const failed = await service.begin(failedInput);
    await assert.rejects(service.perform(failed, async () => { throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Version changed' }); }));
    assert.equal((await service.begin(failedInput)).state, 'failed');
    await assert.rejects(service.perform(await service.begin(failedInput), async () => { calls++; }), (error: unknown) => error instanceof HttpException && error.getStatus() === 409 && (error.getResponse() as { code: string }).code === 'VERSION_CONFLICT');
    assert.equal(calls, 0);
  } finally {
    await prisma.commandRecord.deleteMany({ where: { actor: { username } } });
    await prisma.user.deleteMany({ where: { username } }); await prisma.$disconnect();
  }
});

test('commands service replays same idempotency key with same request body', async () => {
  const prisma = createClient();
  const service = createService(prisma);
  const username = `it_command_replay_${Date.now()}`;

  try {
    const user = await prisma.user.create({
      data: {
        username,
        displayName: 'Integration Command Replay',
      },
    });

    const input = {
      actorUserId: user.id,
      action: 'purchase-request.create',
      idempotencyKey: 'same-key',
      requestBody: { storeId: 'store-a', items: [{ productId: 'p-1', quantity: '2.000000' }] },
      traceId: 'trace-command-replay',
    };

    const started = await service.begin(input);
    assert.equal(started.state, 'started');

    const completed = await service.succeed({
      commandId: started.command.id,
      resourceType: 'PurchaseRequest',
      resourceId: '11111111-1111-4111-8111-111111111111',
      responseBody: { id: '11111111-1111-4111-8111-111111111111' },
    });
    assert.equal(completed.status, CommandStatus.SUCCEEDED);

    const replay = await service.begin({
      ...input,
      requestBody: { items: [{ quantity: '2.000000', productId: 'p-1' }], storeId: 'store-a' },
    });

    assert.equal(replay.state, 'replay');
    assert.equal(replay.command.id, started.command.id);
    assert.deepEqual(replay.command.responseBody, { id: '11111111-1111-4111-8111-111111111111' });
  } finally {
    await prisma.commandRecord.deleteMany({ where: { actor: { username } } });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  }
});

test('commands service rejects reused idempotency key with different request body', async () => {
  const prisma = createClient();
  const service = createService(prisma);
  const username = `it_command_conflict_${Date.now()}`;

  try {
    const user = await prisma.user.create({
      data: {
        username,
        displayName: 'Integration Command Conflict',
      },
    });

    const first = await service.begin({
      actorUserId: user.id,
      action: 'purchase-request.create',
      idempotencyKey: 'conflict-key',
      requestBody: { storeId: 'store-a', items: [{ productId: 'p-1', quantity: '2.000000' }] },
      traceId: 'trace-command-conflict',
    });
    assert.equal(first.state, 'started');

    await assert.rejects(
      service.begin({
        actorUserId: user.id,
        action: 'purchase-request.create',
        idempotencyKey: 'conflict-key',
        requestBody: { storeId: 'store-a', items: [{ productId: 'p-1', quantity: '3.000000' }] },
        traceId: 'trace-command-conflict',
      }),
      (error: unknown) =>
        error instanceof ConflictException &&
        typeof error.getResponse() === 'object' &&
        error.getStatus() === 409,
    );
  } finally {
    await prisma.commandRecord.deleteMany({ where: { actor: { username } } });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  }
});

test('commands service reports processing and failed command states', async () => {
  const prisma = createClient();
  const service = createService(prisma);
  const username = `it_command_states_${Date.now()}`;

  try {
    const user = await prisma.user.create({
      data: {
        username,
        displayName: 'Integration Command States',
      },
    });

    const processingInput = {
      actorUserId: user.id,
      action: 'purchase-request.confirm',
      idempotencyKey: 'processing-key',
      requestBody: { requestId: '22222222-2222-4222-8222-222222222222' },
      traceId: 'trace-command-processing',
    };

    const started = await service.begin(processingInput);
    assert.equal(started.state, 'started');

    const processing = await service.begin(processingInput);
    assert.equal(processing.state, 'processing');
    assert.equal(processing.command.id, started.command.id);

    const failedInput = {
      actorUserId: user.id,
      action: 'purchase-request.confirm',
      idempotencyKey: 'failed-key',
      requestBody: { requestId: '33333333-3333-4333-8333-333333333333' },
      traceId: 'trace-command-failed',
    };

    const failedStarted = await service.begin(failedInput);
    assert.equal(failedStarted.state, 'started');

    await service.fail({
      commandId: failedStarted.command.id,
      errorBody: { code: 'INSUFFICIENT_FUNDS', message: 'Balance is not enough' },
    });

    const failed = await service.begin(failedInput);
    assert.equal(failed.state, 'failed');
    assert.equal(failed.command.status, CommandStatus.FAILED);
    assert.deepEqual(failed.command.errorBody, { code: 'INSUFFICIENT_FUNDS', message: 'Balance is not enough' });
  } finally {
    await prisma.commandRecord.deleteMany({ where: { actor: { username } } });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  }
});

test('commands service validates idempotency keys and scopes command lookup to actor', async () => {
  const prisma = createClient();
  const service = createService(prisma);
  const ownerUsername = `it_command_owner_${Date.now()}`;
  const otherUsername = `it_command_other_${Date.now()}`;

  try {
    const [owner, other] = await Promise.all([
      prisma.user.create({
        data: {
          username: ownerUsername,
          displayName: 'Integration Command Owner',
        },
      }),
      prisma.user.create({
        data: {
          username: otherUsername,
          displayName: 'Integration Command Other',
        },
      }),
    ]);

    await assert.rejects(
      service.begin({
        actorUserId: owner.id,
        action: 'purchase-request.create',
        idempotencyKey: '',
        requestBody: { storeId: 'store-a' },
        traceId: 'trace-command-invalid-key',
      }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        typeof error.getResponse() === 'object' &&
        error.getStatus() === 400,
    );

    const started = await service.begin({
      actorUserId: owner.id,
      action: 'purchase-request.create',
      idempotencyKey: 'lookup-key',
      requestBody: { storeId: 'store-a' },
      traceId: 'trace-command-lookup',
    });
    assert.equal(started.state, 'started');

    const byKey = await service.findByKey({
      actorUserId: owner.id,
      action: 'purchase-request.create',
      idempotencyKey: 'lookup-key',
    });
    assert.equal(byKey?.id, started.command.id);

    const byId = await service.findById(owner.id, started.command.id);
    assert.equal(byId?.id, started.command.id);

    assert.equal(await service.findById(other.id, started.command.id), null);
    assert.equal(
      await service.findByKey({
        actorUserId: other.id,
        action: 'purchase-request.create',
        idempotencyKey: 'lookup-key',
      }),
      null,
    );
  } finally {
    await prisma.commandRecord.deleteMany({ where: { actor: { username: { in: [ownerUsername, otherUsername] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [ownerUsername, otherUsername] } } });
    await prisma.$disconnect();
  }
});
