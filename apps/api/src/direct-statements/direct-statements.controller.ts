import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';
import { AuthGuard } from '../auth/auth.guard.js';
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
  list(@Query() query: ListQuery): Promise<DirectStatementSummaryView[]> { return this.service.list(parseQuery(query)); }

  @Get(':id')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER')
  get(@Param('id') id: string): Promise<DirectStatementDetailView> { return this.service.get(id); }
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
