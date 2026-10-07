import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { CommandStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import { Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import type { CommandRecord } from '../../../../packages/backend/generated/prisma/client.js';
import { requestHash } from '../../../../packages/domain/src/idempotency.js';
import { validateIdempotencyKey } from '../../../../packages/domain/src/validation.js';
import { DatabaseService } from '../database/database.service.js';

type JsonBody = null | boolean | number | string | JsonBody[] | { [key: string]: JsonBody | undefined };

export type BeginCommandInput = {
  actorUserId: string;
  action: string;
  idempotencyKey: string;
  requestBody: JsonBody;
  traceId: string;
  expiresAt?: Date;
  resourceType?: string;
  resourceId?: string;
  atomicPriceExecution?: boolean;
};

export type BeginCommandResult =
  | { state: 'started'; command: CommandRecord }
  | { state: 'replay'; command: CommandRecord }
  | { state: 'processing'; command: CommandRecord }
  | { state: 'failed'; command: CommandRecord };

export type CompleteCommandInput = {
  commandId: string;
  resourceType?: string;
  resourceId?: string;
  responseBody: JsonBody;
};

export type FailCommandInput = {
  commandId: string;
  errorBody: JsonBody;
};

export type FindCommandByKeyInput = {
  actorUserId: string;
  action: string;
  idempotencyKey: string;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CommandsService {
  constructor(private readonly database: DatabaseService) {}

  async performAtomic<T>(command: BeginCommandResult, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    let callbackRejected = false;
    return this.perform(command, async () => {
      try {
        return await this.database.client.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "CommandRecord" WHERE id = ${command.command.id}::uuid FOR UPDATE`;
          const current = await tx.commandRecord.findUniqueOrThrow({ where: { id: command.command.id } });
          if (current.status !== CommandStatus.PROCESSING) {
            return this.perform(this.existingResult(current, command.command.requestHash), async () => {
              throw new ConflictException({ code: 'COMMAND_STATE_CHANGED', message: 'Command state changed' });
            });
          }
          let result: T;
          try { result = await operation(tx); }
          catch (error) { callbackRejected = true; throw error; }
          const completed = await tx.commandRecord.findUniqueOrThrow({ where: { id: current.id } });
          if (completed.status !== CommandStatus.SUCCEEDED) {
            throw new Error('Atomic command must save its successful response before commit');
          }
          return result;
        });
      } catch (error) {
        if (callbackRejected && command.command.action === 'price.process' && !(error instanceof HttpException)) {
          try {
            await this.database.client.commandRecord.updateMany({
              where: { id: command.command.id, action: 'price.process', status: CommandStatus.PROCESSING },
              data: { errorBody: { code: 'COMMAND_ROLLBACK_CONFIRMED', observedAt: new Date().toISOString(), proof: 'PRICE_PROCESS_CALLBACK_REJECTED' } },
            });
          } catch { /* Missing proof leaves the command blocked. */ }
        }
        throw error;
      }
    });
  }

  async perform<T>(command: BeginCommandResult, operation: () => Promise<T>): Promise<T> {
    if (command.state === 'replay') return command.command.responseBody as T;
    if (command.state === 'processing') throw new ConflictException({ code: 'COMMAND_PROCESSING', message: 'Submission is still processing; retry with the same idempotency key' });
    if (command.state === 'failed') {
      const error = command.command.errorBody as { code?: string; message?: string; httpStatus?: number } | null;
      throw new HttpException(error ?? { code: 'COMMAND_FAILED', message: 'Submission failed' }, error?.httpStatus ?? 409);
    }
    try { return await operation(); }
    catch (error) {
      // Only definite business rejection is terminal; unknown outcomes stay processing.
      if (error instanceof HttpException && error.getStatus() < 500) {
        const body = error.getResponse();
        await this.fail({ commandId: command.command.id, errorBody: {
          ...(typeof body === 'object' ? body : { message: body }), httpStatus: error.getStatus(),
        } as JsonBody });
      } else {
        // Diagnostic persistence must not turn an unknown outcome into permission to retry.
        try {
          await this.database.client.commandRecord.updateMany({
            where: { id: command.command.id, status: CommandStatus.PROCESSING,
              OR: [{ errorBody: { equals: Prisma.DbNull } }, { NOT: { errorBody: { path: ['code'], equals: 'COMMAND_ROLLBACK_CONFIRMED' } } }] },
            data: { errorBody: { code: 'COMMAND_OUTCOME_UNKNOWN', observedAt: new Date().toISOString() } },
          });
        } catch { /* A database outage must not mask the original failure. */ }
      }
      throw error;
    }
  }

  async begin(input: BeginCommandInput): Promise<BeginCommandResult> {
    this.assertValidIdempotencyKey(input.idempotencyKey);

    const hash = requestHash(input.requestBody);
    const existing = await this.findExisting(input);

    if (existing) {
      return this.existingResult(existing, hash);
    }

    try {
      const command = await this.database.client.commandRecord.create({
        data: {
          actorUserId: input.actorUserId,
          action: input.action,
          idempotencyKey: input.idempotencyKey,
          requestHash: hash,
          traceId: input.traceId,
          expiresAt: input.expiresAt ?? new Date(Date.now() + DEFAULT_TTL_MS),
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          atomicPriceExecution: input.atomicPriceExecution ?? false,
        },
      });

      return { state: 'started', command };
    } catch (error) {
      const raced = await this.findExisting(input);
      if (raced) {
        return this.existingResult(raced, hash);
      }

      throw error;
    }
  }

  async succeed(input: CompleteCommandInput, tx?: Prisma.TransactionClient): Promise<CommandRecord> {
    const client = tx ?? (this.database.client as Prisma.TransactionClient);
    return client.commandRecord.update({
      where: { id: input.commandId },
      data: {
        status: CommandStatus.SUCCEEDED,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        responseBody: input.responseBody as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
  }

  async fail(input: FailCommandInput): Promise<CommandRecord> {
    await this.database.client.commandRecord.updateMany({
      where: { id: input.commandId, status: CommandStatus.PROCESSING },
      data: {
        status: CommandStatus.FAILED,
        errorBody: input.errorBody as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    return this.database.client.commandRecord.findUniqueOrThrow({ where: { id: input.commandId } });
  }

  async findByKey(input: FindCommandByKeyInput): Promise<CommandRecord | null> {
    this.assertValidIdempotencyKey(input.idempotencyKey);
    return this.findExisting(input);
  }

  async findById(actorUserId: string, commandId: string): Promise<CommandRecord | null> {
    return this.database.client.commandRecord.findFirst({
      where: {
        id: commandId,
        actorUserId,
      },
    });
  }

  async listDiagnostics(input: { actorUserId?: string; staleOnly?: boolean; resourceType?: string; resourceId?: string; action?: string; limit: number }) {
    const now = new Date();
    const records = await this.database.client.commandRecord.findMany({
      where: { ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        resourceType: input.resourceType, resourceId: input.resourceId, action: input.action,
        ...(input.staleOnly ? { status: CommandStatus.PROCESSING, expiresAt: { lte: now } } : {}) },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: input.limit,
      select: { id: true, actorUserId: true, action: true, status: true, resourceType: true, resourceId: true,
        traceId: true, startedAt: true, finishedAt: true, expiresAt: true, errorBody: true },
    });
    return records.map(({ errorBody, ...record }) => {
      const diagnostic = errorBody && typeof errorBody === 'object' && !Array.isArray(errorBody) ? errorBody : {};
      const code = typeof diagnostic.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(diagnostic.code) ? diagnostic.code : null;
      return { ...record, errorCode: code, stale: record.status === CommandStatus.PROCESSING && record.expiresAt <= now,
        recovery: record.status === CommandStatus.PROCESSING ? 'RECONCILIATION_REQUIRED' : 'REPLAY_ORIGINAL_KEY' };
    });
  }

  async reviewSnapshot(id: string, expectedStatus: string, tx: Prisma.TransactionClient) {
    const target = await tx.commandRecord.findUnique({ where: { id } });
    if (!target) throw new NotFoundException({ code: 'COMMAND_NOT_FOUND', message: 'Command was not found' });
    if (target.action === 'command.review') throw new ConflictException({ code: 'COMMAND_REVIEW_NOT_ALLOWED', message: 'Review commands cannot themselves be reviewed' });
    await tx.$queryRaw`SELECT id FROM "CommandRecord" WHERE id = ${id}::uuid FOR UPDATE`;
    const current = await tx.commandRecord.findUniqueOrThrow({ where: { id } });
    if (current.status !== expectedStatus) throw new ConflictException({ code: 'COMMAND_STATE_CHANGED', message: 'Refresh command status before recording a review' });
    return { commandId: current.id, status: current.status, action: current.action, traceId: current.traceId,
      resourceType: current.resourceType, resourceId: current.resourceId, resolution: 'REVIEW_RECORDED_NO_STATE_CHANGE' };
  }

  async closeRolledBackPriceCommand(id: string, tx: Prisma.TransactionClient) {
    const initial = await tx.commandRecord.findUnique({ where: { id } });
    if (!initial) throw new NotFoundException({ code: 'COMMAND_NOT_FOUND', message: 'Command was not found' });
    if (initial.action !== 'price.process') throw new ConflictException({ code: 'COMMAND_ROLLBACK_NOT_PROVEN', message: 'Only price execution commands can be closed' });
    await tx.$queryRaw`SELECT id FROM "CommandRecord" WHERE id = ${id}::uuid FOR UPDATE`;
    const target = await tx.commandRecord.findUnique({ where: { id } });
    if (!target) throw new NotFoundException({ code: 'COMMAND_NOT_FOUND', message: 'Command was not found' });
    const proof = target.errorBody as { code?: string; proof?: string } | null;
    if (target.status !== CommandStatus.PROCESSING || target.action !== 'price.process' || target.resourceType !== 'PriceChangeRun'
      || !target.resourceId || proof?.code !== 'COMMAND_ROLLBACK_CONFIRMED' || proof.proof !== 'PRICE_PROCESS_CALLBACK_REJECTED') {
      throw new ConflictException({ code: 'COMMAND_ROLLBACK_NOT_PROVEN', message: 'Only a proven rolled-back price execution can be closed' });
    }
    await tx.commandRecord.update({ where: { id }, data: { status: CommandStatus.FAILED, finishedAt: new Date(),
      errorBody: { code: 'COMMAND_ROLLED_BACK', message: 'Price execution was rolled back; refresh the task before a new submission', httpStatus: 409 } } });
    return { commandId: id, resourceId: target.resourceId, previousStatus: 'PROCESSING', status: 'FAILED', resolution: 'ROLLED_BACK_PRICE_COMMAND_CLOSED' };
  }

  async closeUncommittedPriceCommand(id: string, tx: Prisma.TransactionClient) {
    const initial = await tx.commandRecord.findUnique({ where: { id } });
    if (!initial) throw new NotFoundException({ code: 'COMMAND_NOT_FOUND', message: 'Command was not found' });
    if (initial.action !== 'price.process') throw new ConflictException({ code: 'COMMAND_ATOMIC_CONTRACT_REQUIRED', message: 'Only atomic price execution can be reconciled' });
    await tx.$queryRaw`SELECT id FROM "CommandRecord" WHERE id = ${id}::uuid FOR UPDATE`;
    const target = await tx.commandRecord.findUniqueOrThrow({ where: { id } });
    if (target.status !== CommandStatus.PROCESSING || !target.atomicPriceExecution || target.resourceType !== 'PriceChangeRun' || !target.resourceId) {
      throw new ConflictException({ code: 'COMMAND_ATOMIC_CONTRACT_REQUIRED', message: 'Refresh status; a processing atomic price execution contract is required' });
    }
    await tx.commandRecord.update({ where: { id }, data: { status: CommandStatus.FAILED, finishedAt: new Date(),
      errorBody: { code: 'COMMAND_NOT_COMMITTED', message: 'Atomic price execution did not commit; refresh the task before a new submission', httpStatus: 409 } } });
    return { commandId: id, resourceId: target.resourceId, previousStatus: 'PROCESSING', status: 'FAILED', resolution: 'UNCOMMITTED_ATOMIC_PRICE_COMMAND_CLOSED' };
  }

  private async findExisting(input: Pick<BeginCommandInput, 'actorUserId' | 'action' | 'idempotencyKey'>): Promise<CommandRecord | null> {
    return this.database.client.commandRecord.findUnique({
      where: {
        actorUserId_action_idempotencyKey: {
          actorUserId: input.actorUserId,
          action: input.action,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
  }

  private existingResult(command: CommandRecord, requestHashValue: string): BeginCommandResult {
    if (command.requestHash !== requestHashValue) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Idempotency-Key was already used with different request parameters',
        details: { commandId: command.id, action: command.action },
      });
    }

    switch (command.status) {
      case CommandStatus.SUCCEEDED:
        return { state: 'replay', command };
      case CommandStatus.FAILED:
        return { state: 'failed', command };
      default:
        return { state: 'processing', command };
    }
  }

  private assertValidIdempotencyKey(idempotencyKey: unknown): void {
    const issues = validateIdempotencyKey(idempotencyKey);
    if (issues.length > 0) {
      throw new BadRequestException({
        code: issues[0]?.code ?? 'BAD_REQUEST',
        message: 'Request validation failed',
        details: { issues },
      });
    }
  }
}
