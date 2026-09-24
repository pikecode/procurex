import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { SuppliersService, type SupplierView } from './suppliers.service.js';
import { DeliveryMode, SettlementMode, SupplierStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import { validateExpectedVersion, validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';

type CreateSupplierBody = {
  code?: unknown;
  name?: unknown;
  contactName?: unknown;
  contactPhone?: unknown;
  deliveryMode?: unknown;
  defaultSettlementMode?: unknown;
  defaultSettlementCycle?: unknown;
};

type PatchSupplierBody = CreateSupplierBody & {
  expectedVersion?: unknown;
  status?: unknown;
};

@Controller('suppliers')
@UseGuards(AuthGuard, RolesGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE')
  listSuppliers(): Promise<SupplierView[]> {
    return this.suppliersService.listSuppliers();
  }

  @Post()
  @RequireRoles('ADMIN', 'PURCHASER')
  createSupplier(@Body() body: CreateSupplierBody): Promise<SupplierView> {
    return this.suppliersService.createSupplier(parseCreateSupplierBody(body));
  }

  @Patch(':id')
  @RequireRoles('ADMIN', 'PURCHASER')
  updateSupplier(@Param('id') id: string, @Body() body: PatchSupplierBody): Promise<SupplierView> {
    return this.suppliersService.updateSupplier(id, parsePatchSupplierBody(id, body));
  }
}

function parseCreateSupplierBody(body: CreateSupplierBody): {
  code: string;
  name: string;
  deliveryMode: DeliveryMode;
  defaultSettlementMode: SettlementMode;
  defaultSettlementCycle: string;
  contactName?: string;
  contactPhone?: string;
} {
  const issues: ValidationIssue[] = [];
  const code = requiredTrimmedString('code', body.code, issues);
  const name = requiredTrimmedString('name', body.name, issues);
  const deliveryMode = requiredDeliveryMode(body.deliveryMode, issues);
  const defaultSettlementMode = requiredSettlementMode(body.defaultSettlementMode, issues);
  const defaultSettlementCycle = requiredTrimmedString('defaultSettlementCycle', body.defaultSettlementCycle, issues);
  const contactName = optionalTrimmedString('contactName', body.contactName, issues);
  const contactPhone = optionalTrimmedString('contactPhone', body.contactPhone, issues);

  throwIfInvalid(issues);

  return {
    code: code!,
    name: name!,
    deliveryMode: deliveryMode!,
    defaultSettlementMode: defaultSettlementMode!,
    defaultSettlementCycle: defaultSettlementCycle!,
    contactName,
    contactPhone,
  };
}

function parsePatchSupplierBody(id: string, body: PatchSupplierBody): {
  expectedVersion: number;
  name?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  deliveryMode?: DeliveryMode;
  defaultSettlementMode?: SettlementMode;
  defaultSettlementCycle?: string;
  status?: SupplierStatus;
} {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];

  const name = optionalTrimmedString('name', body.name, issues);
  const contactName = optionalNullableTrimmedString('contactName', body.contactName, issues);
  const contactPhone = optionalNullableTrimmedString('contactPhone', body.contactPhone, issues);
  const deliveryMode = optionalDeliveryMode(body.deliveryMode, issues);
  const defaultSettlementMode = optionalSettlementMode(body.defaultSettlementMode, issues);
  const defaultSettlementCycle = optionalTrimmedString('defaultSettlementCycle', body.defaultSettlementCycle, issues);
  const status = optionalSupplierStatus(body.status, issues);

  throwIfInvalid(issues);

  return {
    expectedVersion: body.expectedVersion as number,
    name,
    contactName,
    contactPhone,
    deliveryMode,
    defaultSettlementMode,
    defaultSettlementCycle,
    status,
  };
}

function requiredTrimmedString(field: string, value: unknown, issues: ValidationIssue[]): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ field, code: 'REQUIRED_STRING', message: `${field} is required` });
    return undefined;
  }

  return value.trim();
}

function optionalTrimmedString(field: string, value: unknown, issues: ValidationIssue[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ field, code: 'INVALID_STRING', message: `${field} must be a non-empty string` });
    return undefined;
  }

  return value.trim();
}

function optionalNullableTrimmedString(field: string, value: unknown, issues: ValidationIssue[]): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return optionalTrimmedString(field, value, issues);
}

function requiredDeliveryMode(value: unknown, issues: ValidationIssue[]): DeliveryMode | undefined {
  const deliveryMode = optionalDeliveryMode(value, issues);
  if (value === undefined) {
    issues.push({ field: 'deliveryMode', code: 'REQUIRED_DELIVERY_MODE', message: 'deliveryMode is required' });
  }

  return deliveryMode;
}

function optionalDeliveryMode(value: unknown, issues: ValidationIssue[]): DeliveryMode | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === DeliveryMode.SELF || value === DeliveryMode.LOGISTICS) {
    return value;
  }

  issues.push({ field: 'deliveryMode', code: 'INVALID_DELIVERY_MODE', message: 'deliveryMode must be SELF or LOGISTICS' });
  return undefined;
}

function requiredSettlementMode(value: unknown, issues: ValidationIssue[]): SettlementMode | undefined {
  const settlementMode = optionalSettlementMode(value, issues);
  if (value === undefined) {
    issues.push({
      field: 'defaultSettlementMode',
      code: 'REQUIRED_SETTLEMENT_MODE',
      message: 'defaultSettlementMode is required',
    });
  }

  return settlementMode;
}

function optionalSettlementMode(value: unknown, issues: ValidationIssue[]): SettlementMode | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === SettlementMode.STORED_VALUE ||
    value === SettlementMode.CREDIT ||
    value === SettlementMode.SUPPLIER_TERM ||
    value === SettlementMode.COMPANY_TERM
  ) {
    return value;
  }

  issues.push({
    field: 'defaultSettlementMode',
    code: 'INVALID_SETTLEMENT_MODE',
    message: 'defaultSettlementMode is invalid',
  });
  return undefined;
}

function optionalSupplierStatus(value: unknown, issues: ValidationIssue[]): SupplierStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === SupplierStatus.ACTIVE || value === SupplierStatus.DISABLED) {
    return value;
  }

  issues.push({ field: 'status', code: 'INVALID_SUPPLIER_STATUS', message: 'status must be ACTIVE or DISABLED' });
  return undefined;
}
