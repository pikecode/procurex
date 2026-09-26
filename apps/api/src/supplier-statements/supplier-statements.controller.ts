import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';
import {
  type ListSupplierStatementsInput,
  type SupplierStatementDetailView,
  type SupplierStatementSummaryView,
  SupplierStatementsService,
} from './supplier-statements.service.js';

type ListQuery = {
  supplierId?: unknown;
  cycle?: unknown;
  settlementStatus?: unknown;
};

@Controller('supplier-statements')
@UseGuards(AuthGuard, RolesGuard)
export class SupplierStatementsController {
  constructor(private readonly supplierStatementsService: SupplierStatementsService) {}

  @Get()
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'SUPPLIER')
  list(@Query() query: ListQuery): Promise<SupplierStatementSummaryView[]> {
    return this.supplierStatementsService.list(parseListQuery(query));
  }

  @Get(':id')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'SUPPLIER')
  get(@Param('id') id: string): Promise<SupplierStatementDetailView> {
    return this.supplierStatementsService.get(id);
  }
}

function parseListQuery(query: ListQuery): ListSupplierStatementsInput {
  const issues: ValidationIssue[] = [];
  let supplierId: string | undefined;
  let cycle: ListSupplierStatementsInput['cycle'];
  let settlementStatus: ListSupplierStatementsInput['settlementStatus'];

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
  return { supplierId, cycle, settlementStatus };
}

function optionalCycle(value: unknown, issues: ValidationIssue[]): ListSupplierStatementsInput['cycle'] {
  if (value === 'WEEKLY' || value === 'HALF_MONTHLY' || value === 'MONTHLY' || value === 'IMMEDIATE') {
    return value;
  }
  issues.push({ field: 'cycle', code: 'INVALID_CYCLE', message: 'cycle is invalid' });
  return undefined;
}

function optionalSettlementStatus(value: unknown, issues: ValidationIssue[]): ListSupplierStatementsInput['settlementStatus'] {
  if (value === 'OPEN' || value === 'SETTLED') {
    return value;
  }
  issues.push({ field: 'settlementStatus', code: 'INVALID_SETTLEMENT_STATUS', message: 'settlementStatus is invalid' });
  return undefined;
}
