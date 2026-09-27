import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';
import { AuditService, type ListAuditLogsInput } from './audit.service.js';

type ListQuery = {
  action?: unknown;
  entityType?: unknown;
  entityId?: unknown;
  actorUserId?: unknown;
  traceId?: unknown;
  limit?: unknown;
};

@Controller('audit-logs')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('ADMIN', 'HQ_FINANCE')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: ListQuery) {
    return this.audit.listRecent(parseListQuery(query));
  }
}

function parseListQuery(query: ListQuery): ListAuditLogsInput {
  const issues: ValidationIssue[] = [];
  const input: ListAuditLogsInput = {};
  input.action = optionalToken('action', query.action, issues);
  input.entityType = optionalToken('entityType', query.entityType, issues);
  input.traceId = optionalToken('traceId', query.traceId, issues);
  if (query.entityId !== undefined) {
    issues.push(...validateUuid('entityId', query.entityId));
    if (typeof query.entityId === 'string') input.entityId = query.entityId;
  }
  if (query.actorUserId !== undefined) {
    issues.push(...validateUuid('actorUserId', query.actorUserId));
    if (typeof query.actorUserId === 'string') input.actorUserId = query.actorUserId;
  }
  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      issues.push({ field: 'limit', code: 'INVALID_LIMIT', message: 'limit must be an integer between 1 and 100' });
    } else {
      input.limit = limit;
    }
  }
  throwIfInvalid(issues);
  return input;
}

function optionalToken(field: string, value: unknown, issues: ValidationIssue[]): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 160 || !/^[a-zA-Z0-9._:-]+$/.test(value)) {
    issues.push({ field, code: 'INVALID_TOKEN', message: `${field} is invalid` });
    return undefined;
  }
  return value;
}
