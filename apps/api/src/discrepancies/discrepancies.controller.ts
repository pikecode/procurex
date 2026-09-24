import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { type AuthenticatedSession } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CommandsService } from '../commands/commands.service.js';
import { getOrCreateTraceId } from '../common/request-context.js';
import { requireIdempotencyKey, throwIfInvalid } from '../common/request-contract.js';
import { DiscrepanciesService, type DiscrepancyView, type ResolveDiscrepancyInput } from './discrepancies.service.js';
import { DiscrepancyActionType } from '../../../../packages/backend/generated/prisma/enums.js';
import { validateExpectedVersion, validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';

type ResolveBody = {
  expectedVersion?: unknown;
  action?: unknown;
  reason?: unknown;
};

@Controller('discrepancies')
@UseGuards(AuthGuard, RolesGuard)
export class DiscrepanciesController {
  constructor(
    private readonly discrepanciesService: DiscrepanciesService,
    private readonly commandsService: CommandsService,
  ) {}

  @Post(':id/resolve')
  @RequireRoles('ADMIN', 'SUPPLIER')
  async resolve(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: ResolveBody,
  ): Promise<DiscrepancyView> {
    const input = parseResolveBody(id, body);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'discrepancy.resolve',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as DiscrepancyView;
    }

    const result = await this.discrepanciesService.resolve(input.id, input.resolve);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'Discrepancy',
      resourceId: result.id,
      responseBody: result as never,
    });

    return result;
  }
}

function parseResolveBody(id: string, body: ResolveBody): { id: string; resolve: ResolveDiscrepancyInput } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const action = optionalDiscrepancyAction(body.action, issues);
  const reason = optionalReason(body.reason, issues);

  throwIfInvalid(issues);
  return {
    id,
    resolve: {
      expectedVersion: body.expectedVersion as number,
      action: action!,
      reason,
    },
  };
}

function optionalDiscrepancyAction(value: unknown, issues: ValidationIssue[]): DiscrepancyActionType | undefined {
  if (
    value === DiscrepancyActionType.ACCEPT ||
    value === DiscrepancyActionType.REPLENISH ||
    value === DiscrepancyActionType.RETURN
  ) {
    return value;
  }

  issues.push({
    field: 'action',
    code: 'INVALID_DISCREPANCY_ACTION',
    message: 'action must be ACCEPT, REPLENISH or RETURN',
  });
  return undefined;
}

function optionalReason(value: unknown, issues: ValidationIssue[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 300) {
    issues.push({
      field: 'reason',
      code: 'INVALID_REASON',
      message: 'reason must be a non-empty string with 300 characters or fewer',
    });
    return undefined;
  }

  return value.trim();
}
