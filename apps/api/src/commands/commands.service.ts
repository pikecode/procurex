import { ConflictException, Injectable } from '@nestjs/common';
import { CommandStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import { Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import type { CommandRecord } from '../../../../packages/backend/generated/prisma/client.js';
import { requestHash } from '../../../../packages/domain/src/idempotency.js';
import { DatabaseService } from '../database/database.service.js';

type JsonBody = null | boolean | number | string | JsonBody[] | { [key: string]: JsonBody | undefined };

export type BeginCommandInput = {
  actorUserId: string;
  action: string;
  idempotencyKey: string;
  requestBody: JsonBody;
  traceId: string;
  expiresAt?: Date;
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

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CommandsService {
  constructor(private readonly database: DatabaseService) {}

  async begin(input: BeginCommandInput): Promise<BeginCommandResult> {
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

  async succeed(input: CompleteCommandInput): Promise<CommandRecord> {
    return this.database.client.commandRecord.update({
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
    return this.database.client.commandRecord.update({
      where: { id: input.commandId },
      data: {
        status: CommandStatus.FAILED,
        errorBody: input.errorBody as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
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
}
