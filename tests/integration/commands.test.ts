import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { CommandStatus } from '../../packages/backend/generated/prisma/enums.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { CommandsService } from '../../apps/api/src/commands/commands.service.js';

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
