import { Controller, ForbiddenException, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';
import {
  type ListStoreStatementsInput,
  type StoreStatementDetailView,
  type StoreStatementSummaryView,
  StoreStatementsService,
} from './store-statements.service.js';

type ListQuery = {
  storeId?: unknown;
  supplierId?: unknown;
  cycle?: unknown;
  settlementStatus?: unknown;
};

@Controller('store-statements')
@UseGuards(AuthGuard, RolesGuard)
export class StoreStatementsController {
  constructor(private readonly storeStatementsService: StoreStatementsService) {}

  @Get()
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  list(@Query() query: ListQuery, @Req() request: AuthenticatedRequest): Promise<StoreStatementSummaryView[]> {
    return this.storeStatementsService.list(applyScope(parseListQuery(query), request));
  }

  @Get(':id')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  get(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<StoreStatementDetailView> {
    applyScope({}, request);
    return this.storeStatementsService.get(id, request.auth?.user.scope);
  }
}

function applyScope(input: ListStoreStatementsInput, request: AuthenticatedRequest): ListStoreStatementsInput {
  const scope = request.auth?.user.scope;
  if (scope?.type === 'STORE' || scope?.type === 'STORE_FINANCE') {
    if (!scope.storeId) throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Store scope is not configured' });
    if (input.storeId && input.storeId !== scope.storeId) throw new ForbiddenException({ code: 'SCOPE_MISMATCH', message: 'Statement is outside the current store scope' });
    return { ...input, storeId: scope.storeId };
  }
  return input;
}

function parseListQuery(query: ListQuery): ListStoreStatementsInput {
  const issues: ValidationIssue[] = [];
  let storeId: string | undefined;
  let supplierId: string | undefined;
  let cycle: ListStoreStatementsInput['cycle'];
  let settlementStatus: ListStoreStatementsInput['settlementStatus'];

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

  if (query.settlementStatus !== undefined) {
    settlementStatus = optionalSettlementStatus(query.settlementStatus, issues);
  }

  throwIfInvalid(issues);
  return { storeId, supplierId, cycle, settlementStatus };
}

function optionalCycle(value: unknown, issues: ValidationIssue[]): ListStoreStatementsInput['cycle'] {
  if (value === 'WEEKLY' || value === 'HALF_MONTHLY' || value === 'MONTHLY' || value === 'IMMEDIATE') {
    return value;
  }
  issues.push({ field: 'cycle', code: 'INVALID_CYCLE', message: 'cycle is invalid' });
  return undefined;
}

function optionalSettlementStatus(value: unknown, issues: ValidationIssue[]): ListStoreStatementsInput['settlementStatus'] {
  if (value === 'OPEN' || value === 'SETTLED') {
    return value;
  }
  issues.push({ field: 'settlementStatus', code: 'INVALID_SETTLEMENT_STATUS', message: 'settlementStatus is invalid' });
  return undefined;
}
