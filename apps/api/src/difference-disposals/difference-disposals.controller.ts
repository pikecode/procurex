import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { type AuthenticatedSession } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CommandsService } from '../commands/commands.service.js';
import { getOrCreateTraceId } from '../common/request-context.js';
import { requireIdempotencyKey, throwIfInvalid } from '../common/request-contract.js';
import { DifferenceDisposalMethod } from '../../../../packages/backend/generated/prisma/enums.js';
import {
  validateDecimalString,
  validateExpectedVersion,
  validateUuid,
  type ValidationIssue,
} from '../../../../packages/domain/src/validation.js';
import {
  type CreateDifferenceDisposalInput,
  type DifferenceDisposalView,
  DifferenceDisposalsService,
} from './difference-disposals.service.js';

type CreateBody = {
  method?: unknown;
  creditItemIds?: unknown;
  targetDebitItemIds?: unknown;
  amount?: unknown;
  businessDate?: unknown;
  reason?: unknown;
};

type ConfirmBody = {
  expectedVersion?: unknown;
};

@Controller('difference-disposals')
@UseGuards(AuthGuard, RolesGuard)
export class DifferenceDisposalsController {
  constructor(
    private readonly differenceDisposalsService: DifferenceDisposalsService,
    private readonly commandsService: CommandsService,
  ) {}

  @Get(':id')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'SUPPLIER')
  get(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<DifferenceDisposalView> {
    throwIfInvalid(validateUuid('id', id));
    return this.differenceDisposalsService.get(id, request.auth?.user.scope);
  }

  @Post()
  @RequireRoles('ADMIN', 'HQ_FINANCE')
  async create(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Body() body: CreateBody,
  ): Promise<DifferenceDisposalView> {
    const input = parseCreateBody(body);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'difference-disposal.create',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: body as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as DifferenceDisposalView;
    }

    const result = await this.differenceDisposalsService.create(input);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'DifferenceDisposal',
      resourceId: result.id,
      responseBody: result as never,
    });

    return result;
  }

  @Post(':id/confirm')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'SUPPLIER')
  async confirm(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: ConfirmBody,
  ): Promise<DifferenceDisposalView> {
    const input = parseConfirmBody(id, body);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'difference-disposal.confirm',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as DifferenceDisposalView;
    }

    const result = await this.differenceDisposalsService.confirm(input.id, { expectedVersion: input.expectedVersion }, auth.user.scope);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'DifferenceDisposal',
      resourceId: result.id,
      responseBody: result as never,
    });

    return result;
  }
}

function parseCreateBody(body: CreateBody): CreateDifferenceDisposalInput {
  const issues: ValidationIssue[] = [...validateDecimalString('amount', body.amount, 2)];
  const method = requiredMethod(body.method, issues);
  const creditItemIds = requiredUuidArray('creditItemIds', body.creditItemIds, issues);
  const targetDebitItemIds = optionalStringArray('targetDebitItemIds', body.targetDebitItemIds, issues);
  const businessDate = requiredDate('businessDate', body.businessDate, issues);
  const reason = optionalString('reason', body.reason, issues);

  throwIfInvalid(issues);
  return {
    method: method!,
    creditItemIds,
    targetDebitItemIds,
    amount: body.amount as string,
    businessDate: businessDate!,
    reason,
  };
}

function parseConfirmBody(id: string, body: ConfirmBody): { id: string; expectedVersion: number } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  throwIfInvalid(issues);
  return { id, expectedVersion: body.expectedVersion as number };
}

function requiredMethod(value: unknown, issues: ValidationIssue[]): DifferenceDisposalMethod | undefined {
  if (value === DifferenceDisposalMethod.OFFSET || value === DifferenceDisposalMethod.OFFLINE_RETURN) {
    return value;
  }
  issues.push({ field: 'method', code: 'INVALID_DIFFERENCE_DISPOSAL_METHOD', message: 'method is invalid' });
  return undefined;
}

function requiredUuidArray(field: string, value: unknown, issues: ValidationIssue[]): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ field, code: 'INVALID_UUID_ARRAY', message: `${field} must be a non-empty array` });
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    issues.push(...validateUuid(`${field}.${index}`, item));
    if (typeof item === 'string') {
      if (seen.has(item)) {
        issues.push({ field: `${field}.${index}`, code: 'DUPLICATE_ID', message: `${field} must not repeat` });
      }
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function optionalStringArray(field: string, value: unknown, issues: ValidationIssue[]): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push({ field, code: 'INVALID_ARRAY', message: `${field} must be an array` });
    return undefined;
  }
  const result: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      issues.push({ field: `${field}.${index}`, code: 'INVALID_STRING', message: `${field}.${index} must be a non-empty string` });
      continue;
    }
    result.push(item);
  }
  return result;
}

function optionalString(field: string, value: unknown, issues: ValidationIssue[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ field, code: 'INVALID_STRING', message: `${field} must be a non-empty string` });
    return undefined;
  }
  return value.trim();
}

function requiredDate(field: string, value: unknown, issues: ValidationIssue[]): Date | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    issues.push({ field, code: 'INVALID_DATE', message: `${field} must be YYYY-MM-DD` });
    return undefined;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    issues.push({ field, code: 'INVALID_DATE', message: `${field} is invalid` });
    return undefined;
  }
  return date;
}
