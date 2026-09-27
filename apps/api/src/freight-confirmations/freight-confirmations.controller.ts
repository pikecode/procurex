import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { type AuthenticatedSession } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CommandsService } from '../commands/commands.service.js';
import { getOrCreateTraceId } from '../common/request-context.js';
import { requireIdempotencyKey, throwIfInvalid } from '../common/request-contract.js';
import {
  FreightConfirmationsService,
  type FreightConfirmationView,
  type ReviewFreightConfirmationInput,
} from './freight-confirmations.service.js';
import { validateExpectedVersion, validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';

type ReviewBody = {
  expectedVersion?: unknown;
  reason?: unknown;
};

@Controller('freight-confirmations')
@UseGuards(AuthGuard, RolesGuard)
export class FreightConfirmationsController {
  constructor(
    private readonly freightConfirmationsService: FreightConfirmationsService,
    private readonly commandsService: CommandsService,
    private readonly audit: AuditService,
  ) {}

  @Post(':id/confirm')
  @RequireRoles('ADMIN', 'PURCHASER')
  async confirm(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: ReviewBody,
  ): Promise<FreightConfirmationView> {
    return this.review(request, auth, id, body, 'freight-confirmation.confirm');
  }

  @Post(':id/reject')
  @RequireRoles('ADMIN', 'PURCHASER')
  async reject(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: ReviewBody,
  ): Promise<FreightConfirmationView> {
    return this.review(request, auth, id, body, 'freight-confirmation.reject');
  }

  private async review(
    request: AuthenticatedRequest,
    auth: AuthenticatedSession,
    id: string,
    body: ReviewBody,
    action: 'freight-confirmation.confirm' | 'freight-confirmation.reject',
  ): Promise<FreightConfirmationView> {
    const input = parseReviewBody(id, body);
    const traceId = getOrCreateTraceId(request);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action,
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId,
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as FreightConfirmationView;
    }

    const result =
      action === 'freight-confirmation.confirm'
        ? await this.freightConfirmationsService.confirm(input.id, input.review)
        : await this.freightConfirmationsService.reject(input.id, input.review);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'FreightConfirmation',
      resourceId: result.id,
      responseBody: result as never,
    });
    await this.audit.record({
      actorUserId: auth.user.id,
      activeScope: auditScope(auth),
      action,
      entityType: 'FreightConfirmation',
      entityId: result.id,
      traceId,
      reason: input.review.reason,
      after: {
        supplierOrderId: result.supplierOrderId,
        amount: result.amount,
        status: result.status,
        confirmedAt: result.confirmedAt,
        rejectedAt: result.rejectedAt,
      },
    });

    return result;
  }
}

function auditScope(auth: AuthenticatedSession) {
  return { roles: auth.user.roles, ...(auth.user.scope ? { scope: auth.user.scope } : {}) };
}

function parseReviewBody(id: string, body: ReviewBody): { id: string; review: ReviewFreightConfirmationInput } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const reason = optionalReason(body.reason, issues);

  throwIfInvalid(issues);
  return { id, review: { expectedVersion: body.expectedVersion as number, reason } };
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
