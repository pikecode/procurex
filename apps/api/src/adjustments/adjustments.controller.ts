import { Controller, Get, Param, Query, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';
import {
  type AdjustmentDetailView,
  type AdjustmentSummaryView,
  AdjustmentsService,
  type ListAdjustmentsInput,
} from './adjustments.service.js';

type ListQuery = {
  storeId?: unknown;
  supplierId?: unknown;
  cycle?: unknown;
  periodStart?: unknown;
  periodEndExclusive?: unknown;
  processingStatus?: unknown;
};

@Controller('adjustments')
@UseGuards(AuthGuard, RolesGuard)
export class AdjustmentsController {
  constructor(private readonly adjustmentsService: AdjustmentsService) {}

  @Get()
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER')
  list(@Query() query: ListQuery, @Req() request: AuthenticatedRequest): Promise<AdjustmentSummaryView[]> {
    return this.adjustmentsService.list(applyScope(parseListQuery(query), request));
  }

  @Get(':id')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER')
  get(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<AdjustmentDetailView> {
    const scope = request.auth?.user.scope;
    if (scope?.type === 'STORE' || scope?.type === 'SUPPLIER') {
      return this.adjustmentsService.get(id, scope);
    }
    return this.adjustmentsService.get(id);
  }
}

function applyScope(input: ListAdjustmentsInput, request: AuthenticatedRequest): ListAdjustmentsInput {
  const scope = request.auth?.user.scope;
  if (scope?.type === 'STORE') {
    if (!scope.storeId) throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Store scope is not configured' });
    if (input.storeId && input.storeId !== scope.storeId) throw new ForbiddenException({ code: 'SCOPE_MISMATCH', message: 'Adjustment is outside the current store scope' });
    return { ...input, storeId: scope.storeId };
  }
  if (scope?.type === 'SUPPLIER') {
    if (!scope.supplierId) throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Supplier scope is not configured' });
    if (input.supplierId && input.supplierId !== scope.supplierId) throw new ForbiddenException({ code: 'SCOPE_MISMATCH', message: 'Adjustment is outside the current supplier scope' });
    return { ...input, supplierId: scope.supplierId };
  }
  return input;
}

function parseListQuery(query: ListQuery): ListAdjustmentsInput {
  const issues: ValidationIssue[] = [];
  let storeId: string | undefined;
  let supplierId: string | undefined;
  let cycle: ListAdjustmentsInput['cycle'];
  let periodStart: string | undefined;
  let periodEndExclusive: string | undefined;
  let processingStatus: ListAdjustmentsInput['processingStatus'];

  if (query.storeId !== undefined) {
    issues.push(...validateUuid('storeId', query.storeId));
    if (typeof query.storeId === 'string') {
      storeId = query.storeId;
    }
  }

  if (query.supplierId !== undefined) {
    issues.push(...validateUuid('supplierId', query.supplierId));
    if (typeof query.supplierId === 'string') {
      supplierId = query.supplierId;
    }
  }

  if (query.cycle !== undefined) {
    cycle = optionalCycle(query.cycle, issues);
  }

  if (query.periodStart !== undefined) {
    periodStart = optionalDate('periodStart', query.periodStart, issues);
  }

  if (query.periodEndExclusive !== undefined) {
    periodEndExclusive = optionalDate('periodEndExclusive', query.periodEndExclusive, issues);
  }

  if (query.processingStatus !== undefined) {
    processingStatus = optionalProcessingStatus(query.processingStatus, issues);
  }

  throwIfInvalid(issues);
  return { storeId, supplierId, cycle, periodStart, periodEndExclusive, processingStatus };
}

function optionalCycle(value: unknown, issues: ValidationIssue[]): ListAdjustmentsInput['cycle'] {
  if (value === 'WEEKLY' || value === 'HALF_MONTHLY' || value === 'MONTHLY' || value === 'IMMEDIATE') {
    return value;
  }
  issues.push({ field: 'cycle', code: 'INVALID_CYCLE', message: 'cycle is invalid' });
  return undefined;
}

function optionalProcessingStatus(value: unknown, issues: ValidationIssue[]): ListAdjustmentsInput['processingStatus'] {
  if (value === 'PENDING_DISPOSAL' || value === 'DISPOSED') {
    return value;
  }
  issues.push({ field: 'processingStatus', code: 'INVALID_PROCESSING_STATUS', message: 'processingStatus is invalid' });
  return undefined;
}

function optionalDate(field: string, value: unknown, issues: ValidationIssue[]): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    issues.push({ field, code: 'INVALID_DATE', message: `${field} must be YYYY-MM-DD` });
    return undefined;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    issues.push({ field, code: 'INVALID_DATE', message: `${field} is invalid` });
    return undefined;
  }
  return value;
}
