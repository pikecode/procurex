import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import {
  SupplierOrdersService,
  type ListSupplierOrdersInput,
  type SupplierOrderDetailView,
  type SupplierOrderSummaryView,
} from './supplier-orders.service.js';
import { SupplierOrderStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import { validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';

type ListQuery = {
  storeId?: unknown;
  supplierId?: unknown;
  status?: unknown;
};

@Controller('supplier-orders')
@UseGuards(AuthGuard, RolesGuard)
export class SupplierOrdersController {
  constructor(private readonly supplierOrdersService: SupplierOrdersService) {}

  @Get()
  @RequireRoles('ADMIN', 'PURCHASER', 'SUPPLIER')
  list(@Query() query: ListQuery): Promise<SupplierOrderSummaryView[]> {
    return this.supplierOrdersService.list(parseListQuery(query));
  }

  @Get(':id')
  @RequireRoles('ADMIN', 'PURCHASER', 'SUPPLIER')
  get(@Param('id') id: string): Promise<SupplierOrderDetailView> {
    throwIfInvalid(validateUuid('id', id));
    return this.supplierOrdersService.get(id);
  }
}

function parseListQuery(query: ListQuery): ListSupplierOrdersInput {
  const issues: ValidationIssue[] = [];
  let storeId: string | undefined;
  let supplierId: string | undefined;
  let status: SupplierOrderStatus | undefined;

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

  if (query.status !== undefined) {
    status = optionalSupplierOrderStatus(query.status, issues);
  }

  throwIfInvalid(issues);
  return { storeId, supplierId, status };
}

function optionalSupplierOrderStatus(value: unknown, issues: ValidationIssue[]): SupplierOrderStatus | undefined {
  if (
    value === SupplierOrderStatus.DRAFT ||
    value === SupplierOrderStatus.PUSHED ||
    value === SupplierOrderStatus.ACCEPTED ||
    value === SupplierOrderStatus.REJECTED ||
    value === SupplierOrderStatus.PARTIAL_SHIPPED ||
    value === SupplierOrderStatus.SHIPPED ||
    value === SupplierOrderStatus.COMPLETED ||
    value === SupplierOrderStatus.CANCELED
  ) {
    return value;
  }

  issues.push({
    field: 'status',
    code: 'INVALID_SUPPLIER_ORDER_STATUS',
    message: 'status is invalid',
  });
  return undefined;
}
