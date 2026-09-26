import { Controller, ForbiddenException, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';
import {
  type ListSupplierStoreStatementsInput,
  type SupplierStoreStatementDetailView,
  type SupplierStoreStatementSummaryView,
  SupplierStoreStatementsService,
} from './supplier-store-statements.service.js';

type ListQuery = {
  storeId?: unknown;
  supplierId?: unknown;
  cycle?: unknown;
  settlementStatus?: unknown;
};

@Controller('supplier-store-statements')
@UseGuards(AuthGuard, RolesGuard)
export class SupplierStoreStatementsController {
  constructor(private readonly supplierStoreStatementsService: SupplierStoreStatementsService) {}

  @Get()
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'SUPPLIER')
  list(@Query() query: ListQuery, @Req() request: AuthenticatedRequest): Promise<SupplierStoreStatementSummaryView[]> {
    return this.supplierStoreStatementsService.list(applyScope(parseListQuery(query), request));
  }

  @Get(':id')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'SUPPLIER')
  get(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<SupplierStoreStatementDetailView> {
    return this.supplierStoreStatementsService.get(id, request.auth?.user.scope);
  }
}

function applyScope(input: ListSupplierStoreStatementsInput, request: AuthenticatedRequest): ListSupplierStoreStatementsInput {
  const scope = request.auth?.user.scope;
  if (scope?.type !== 'SUPPLIER') return input;
  if (!scope.supplierId) throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Supplier scope is not configured' });
  if (input.supplierId && input.supplierId !== scope.supplierId) throw new ForbiddenException({ code: 'SCOPE_MISMATCH', message: 'Statement is outside the current supplier scope' });
  return { ...input, supplierId: scope.supplierId };
}

function parseListQuery(query: ListQuery): ListSupplierStoreStatementsInput {
  const issues: ValidationIssue[] = [];
  let storeId: string | undefined;
  let supplierId: string | undefined;
  let cycle: ListSupplierStoreStatementsInput['cycle'];
  let settlementStatus: ListSupplierStoreStatementsInput['settlementStatus'];

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

function optionalCycle(value: unknown, issues: ValidationIssue[]): ListSupplierStoreStatementsInput['cycle'] {
  if (value === 'WEEKLY' || value === 'HALF_MONTHLY' || value === 'MONTHLY' || value === 'IMMEDIATE') {
    return value;
  }
  issues.push({ field: 'cycle', code: 'INVALID_CYCLE', message: 'cycle is invalid' });
  return undefined;
}

function optionalSettlementStatus(value: unknown, issues: ValidationIssue[]): ListSupplierStoreStatementsInput['settlementStatus'] {
  if (value === 'OPEN' || value === 'SETTLED') {
    return value;
  }
  issues.push({ field: 'settlementStatus', code: 'INVALID_SETTLEMENT_STATUS', message: 'settlementStatus is invalid' });
  return undefined;
}
