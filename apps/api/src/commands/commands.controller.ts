import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { CommandsService } from './commands.service.js';
import { AuditService } from '../audit/audit.service.js';
import { getOrCreateTraceId } from '../common/request-context.js';
import { requireIdempotencyKey, throwIfInvalid } from '../common/request-contract.js';
import { validateUuid } from '../../../../packages/domain/src/validation.js';

@Controller('commands')
@UseGuards(AuthGuard, RolesGuard)
export class CommandsController {
  constructor(private readonly commands: CommandsService, private readonly audit: AuditService) {}

  @Get()
  listOwn(@Req() request: AuthenticatedRequest, @Query() query: { limit?: unknown }) {
    return this.commands.listDiagnostics({ actorUserId: request.auth!.user.id, limit: parseLimit(query.limit) });
  }

  @Get('stale')
  @RequireRoles('ADMIN')
  listStale(@Query() query: { limit?: unknown }) {
    return this.commands.listDiagnostics({ staleOnly: true, limit: parseLimit(query.limit) });
  }

  @Post(':id/reviews')
  @RequireRoles('ADMIN')
  async review(@Param('id') id: string, @Body() body: { expectedStatus?: unknown; reason?: unknown }, @Req() request: AuthenticatedRequest) {
    throwIfInvalid(validateUuid('id', id));
    if (typeof body.expectedStatus !== 'string' || !['PROCESSING', 'SUCCEEDED', 'FAILED'].includes(body.expectedStatus)
      || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) {
      throw new BadRequestException({ code: 'INVALID_COMMAND_REVIEW', message: 'A current status and reason of 1 to 500 characters are required' });
    }
    const traceId = getOrCreateTraceId(request);
    const command = await this.commands.begin({ actorUserId: request.auth!.user.id, action: 'command.review',
      idempotencyKey: requireIdempotencyKey(request.headers), requestBody: { id, expectedStatus: body.expectedStatus, reason: body.reason },
      traceId, resourceType: 'CommandRecord', resourceId: id });
    return this.commands.performAtomic(command, async tx => {
      const result = await this.commands.reviewSnapshot(id, body.expectedStatus as string, tx);
      await this.audit.record({ actorUserId: request.auth!.user.id, activeScope: { roles: request.auth!.user.roles },
        action: 'command.review', entityType: 'CommandRecord', entityId: id, traceId, reason: body.reason as string, after: result }, tx);
      await this.commands.succeed({ commandId: command.command.id, resourceType: 'CommandRecord', resourceId: id, responseBody: result }, tx);
      return result;
    });
  }

  @Post(':id/close-rolled-back-price')
  @RequireRoles('ADMIN')
  async closeRolledBackPrice(@Param('id') id: string, @Body() body: { reason?: unknown }, @Req() request: AuthenticatedRequest) {
    throwIfInvalid(validateUuid('id', id));
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) {
      throw new BadRequestException({ code: 'INVALID_COMMAND_REVIEW', message: 'A reason of 1 to 500 characters is required' });
    }
    const traceId = getOrCreateTraceId(request);
    const command = await this.commands.begin({ actorUserId: request.auth!.user.id, action: 'command.close-rolled-back-price',
      idempotencyKey: requireIdempotencyKey(request.headers), requestBody: { id, reason: body.reason }, traceId });
    return this.commands.performAtomic(command, async tx => {
      const result = await this.commands.closeRolledBackPriceCommand(id, tx);
      await this.audit.record({ actorUserId: request.auth!.user.id, activeScope: { roles: request.auth!.user.roles }, action: 'command.close-rolled-back-price',
        entityType: 'CommandRecord', entityId: id, traceId, reason: body.reason as string, after: result }, tx);
      await this.commands.succeed({ commandId: command.command.id, resourceType: 'CommandRecord', resourceId: id, responseBody: result }, tx);
      return result;
    });
  }

  @Post(':id/close-uncommitted-price')
  @RequireRoles('ADMIN')
  async closeUncommittedPrice(@Param('id') id: string, @Body() body: { reason?: unknown }, @Req() request: AuthenticatedRequest) {
    throwIfInvalid(validateUuid('id', id));
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) {
      throw new BadRequestException({ code: 'INVALID_COMMAND_REVIEW', message: 'A reason of 1 to 500 characters is required' });
    }
    const traceId = getOrCreateTraceId(request);
    const command = await this.commands.begin({ actorUserId: request.auth!.user.id, action: 'command.close-uncommitted-price',
      idempotencyKey: requireIdempotencyKey(request.headers), requestBody: { id, reason: body.reason }, traceId });
    return this.commands.performAtomic(command, async tx => {
      const result = await this.commands.closeUncommittedPriceCommand(id, tx);
      await this.audit.record({ actorUserId: request.auth!.user.id, activeScope: { roles: request.auth!.user.roles }, action: 'command.close-uncommitted-price',
        entityType: 'CommandRecord', entityId: id, traceId, reason: body.reason as string, after: result }, tx);
      await this.commands.succeed({ commandId: command.command.id, resourceType: 'CommandRecord', resourceId: id, responseBody: result }, tx);
      return result;
    });
  }
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) {
    throw new BadRequestException({ code: 'INVALID_LIMIT', message: 'limit must be an integer between 1 and 100' });
  }
  return Number(value);
}
