import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
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
  list(@Query() query: ListQuery): Promise<StoreStatementSummaryView[]> {
    return this.storeStatementsService.list(parseListQuery(query));
  }

  @Get(':id')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  get(@Param('id') id: string): Promise<StoreStatementDetailView> {
    return this.storeStatementsService.get(id);
  }
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
  if (value === 'OPEN') {
    return value;
  }
  issues.push({ field: 'settlementStatus', code: 'INVALID_SETTLEMENT_STATUS', message: 'settlementStatus is invalid' });
  return undefined;
}
