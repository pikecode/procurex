import { Controller, ForbiddenException, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { DirectStatementsService, type DirectStatementDetailView, type DirectStatementSummaryView, type ListDirectStatementsInput } from './direct-statements.service.js';

type ListQuery = { storeId?: unknown; supplierId?: unknown; cycle?: unknown; settlementStatus?: unknown };

@Controller('direct-statements')
@UseGuards(AuthGuard, RolesGuard)
export class DirectStatementsController {
  constructor(private readonly service: DirectStatementsService) {}

  @Get()
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER')
  list(@Query() query: ListQuery, @Req() request: AuthenticatedRequest): Promise<DirectStatementSummaryView[]> { return this.service.list(applyScope(parseQuery(query), request)); }

  @Get(':id')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER')
  get(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<DirectStatementDetailView> { applyScope({}, request); return this.service.get(id, request.auth?.user.scope); }
}

function applyScope(input: ListDirectStatementsInput, request: AuthenticatedRequest): ListDirectStatementsInput {
  const scope = request.auth?.user.scope;
  if (scope?.type === 'STORE' || scope?.type === 'STORE_FINANCE') {
    if (!scope.storeId) throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Store scope is not configured' });
    if (input.storeId && input.storeId !== scope.storeId) throw new ForbiddenException({ code: 'SCOPE_MISMATCH', message: 'Statement is outside the current store scope' });
    return { ...input, storeId: scope.storeId };
  }
  if (scope?.type === 'SUPPLIER') {
    if (!scope.supplierId) throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Supplier scope is not configured' });
    if (input.supplierId && input.supplierId !== scope.supplierId) throw new ForbiddenException({ code: 'SCOPE_MISMATCH', message: 'Statement is outside the current supplier scope' });
    return { ...input, supplierId: scope.supplierId };
  }
  return input;
}

function parseQuery(query: ListQuery): ListDirectStatementsInput {
  const issues: ValidationIssue[] = [];
  const storeId = optionalUuid('storeId', query.storeId, issues);
  const supplierId = optionalUuid('supplierId', query.supplierId, issues);
  const cycle = query.cycle === undefined ? undefined : optionalCycle(query.cycle, issues);
  const settlementStatus = query.settlementStatus === undefined ? undefined : query.settlementStatus === 'OPEN' || query.settlementStatus === 'SETTLED' ? query.settlementStatus : invalidStatus(issues);
  throwIfInvalid(issues);
  return { storeId, supplierId, cycle, settlementStatus };
}

function optionalUuid(field: string, value: unknown, issues: ValidationIssue[]): string | undefined {
  if (value === undefined) return undefined;
  issues.push(...validateUuid(field, value));
  return typeof value === 'string' ? value : undefined;
}

function optionalCycle(value: unknown, issues: ValidationIssue[]): ListDirectStatementsInput['cycle'] {
  if (value === 'WEEKLY' || value === 'HALF_MONTHLY' || value === 'MONTHLY' || value === 'IMMEDIATE') return value;
  issues.push({ field: 'cycle', code: 'INVALID_CYCLE', message: 'cycle is invalid' });
  return undefined;
}

function invalidStatus(issues: ValidationIssue[]): 'OPEN' | 'SETTLED' | undefined {
  issues.push({ field: 'settlementStatus', code: 'INVALID_SETTLEMENT_STATUS', message: 'settlementStatus is invalid' });
  return undefined;
}
