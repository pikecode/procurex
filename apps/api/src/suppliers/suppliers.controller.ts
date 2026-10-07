import { BusinessScopeGuard } from '../auth/business-scope.guard.js';
import { masterDataAuditContext } from '../audit/master-data-audit.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import type { AuthenticatedSession } from '../auth/auth.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { parseSupplierProfile, profileText, type SupplierProfile } from '../common/master-data-profile.js';
import { SuppliersService, type SupplierProductsView, type SupplierView } from './suppliers.service.js';
import { DeliveryMode, SettlementMode, SupplierStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import { validateExpectedVersion, validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';

type CreateSupplierBody = Record<string, unknown> & {
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

type PutSupplierProductsBody = {
  expectedVersion?: unknown;
  productIds?: unknown;
};

@Controller('suppliers')
@UseGuards(AuthGuard, RolesGuard, BusinessScopeGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post(':id/archive')
  @RequireRoles('ADMIN', 'PURCHASER')
  archive(@Param('id') id: string, @Body() body: { expectedVersion?: unknown }, @Req() request: AuthenticatedRequest): Promise<SupplierView> {
    throwIfInvalid([...validateUuid('id', id), ...validateExpectedVersion('expectedVersion', body.expectedVersion)]);
    return this.suppliersService.archiveSupplier(id, body.expectedVersion as number, masterDataAuditContext(request));
  }

  @Get(':id')
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE', 'SUPPLIER')
  getSupplier(@Param('id') id: string, @CurrentAuth() auth: AuthenticatedSession): Promise<SupplierView> {
    throwIfInvalid(validateUuid('id', id));
    requireSupplierScope(id, auth);
    return this.suppliersService.getSupplier(id);
  }

  @Get(':id/catalog')
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE', 'SUPPLIER')
  getCatalog(@Param('id') id: string, @CurrentAuth() auth: AuthenticatedSession) {
    throwIfInvalid(validateUuid('id', id));
    requireSupplierScope(id, auth);
    return this.suppliersService.getSupplierCatalog(id);
  }

  @Get()
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE')
  listSuppliers(): Promise<SupplierView[]> {
    return this.suppliersService.listSuppliers();
  }

  @Get(':id/products')
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE')
  getProducts(@Param('id') id: string): Promise<SupplierProductsView> {
    throwIfInvalid(validateUuid('id', id));
    return this.suppliersService.getSupplierProducts(id);
  }

  @Post()
  @RequireRoles('ADMIN', 'PURCHASER')
  createSupplier(@Body() body: CreateSupplierBody, @Req() request: AuthenticatedRequest): Promise<SupplierView> {
    return this.suppliersService.createSupplier(parseCreateSupplierBody(body), masterDataAuditContext(request));
  }

  @Patch(':id')
  @RequireRoles('ADMIN', 'PURCHASER')
  updateSupplier(@Param('id') id: string, @Body() body: PatchSupplierBody, @Req() request: AuthenticatedRequest): Promise<SupplierView> {
    return this.suppliersService.updateSupplier(id, parsePatchSupplierBody(id, body), masterDataAuditContext(request));
  }

  @Put(':id/products')
  @RequireRoles('ADMIN', 'PURCHASER')
  replaceProducts(@Param('id') id: string, @Body() body: PutSupplierProductsBody, @Req() request: AuthenticatedRequest): Promise<SupplierProductsView> {
    const input = parsePutSupplierProductsBody(id, body);
    return this.suppliersService.replaceSupplierProducts(id, input.expectedVersion, input.productIds, masterDataAuditContext(request));
  }
}

function requireSupplierScope(id: string, auth: AuthenticatedSession): void {
  if (auth.user.roles.some(role => ['ADMIN', 'PURCHASER', 'HQ_FINANCE'].includes(role))) return;
  if (!auth.user.scope?.supplierId) throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Supplier scope is not configured' });
  if (auth.user.scope.supplierId.toLowerCase() !== id.toLowerCase()) throw new ForbiddenException({ code: 'SCOPE_MISMATCH', message: 'Supplier is outside the current scope' });
}

function parseCreateSupplierBody(body: CreateSupplierBody): SupplierProfile & {
  code?: string;
  name: string;
  deliveryMode: DeliveryMode;
  defaultSettlementMode: SettlementMode;
  defaultSettlementCycle: string;
  contactName?: string;
  contactPhone?: string;
} {
  const issues: ValidationIssue[] = [];
  const code = profileText('code', body.code, 80, false, false, issues) ?? undefined;
  const name = requiredTrimmedString('name', body.name, issues);
  const deliveryMode = requiredDeliveryMode(body.deliveryMode, issues);
  const defaultSettlementMode = requiredSettlementMode(body.defaultSettlementMode, issues);
  const defaultSettlementCycle = requiredTrimmedString('defaultSettlementCycle', body.defaultSettlementCycle, issues);
  const contactName = profileText('contactName', body.contactName, 120, false, true, issues) ?? undefined;
  const contactPhone = profileText('contactPhone', body.contactPhone, 32, false, true, issues) ?? undefined;
  const profile = parseSupplierProfile(body, true, issues);
  profileText('name', body.name, 200, true, false, issues);

  throwIfInvalid(issues);

  return {
    code,
    ...profile,
    name: name!,
    deliveryMode: deliveryMode!,
    defaultSettlementMode: defaultSettlementMode!,
    defaultSettlementCycle: defaultSettlementCycle!,
    contactName,
    contactPhone,
  };
}

function parsePatchSupplierBody(id: string, body: PatchSupplierBody): SupplierProfile & {
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
  const contactName = profileText('contactName', body.contactName, 120, false, true, issues);
  const contactPhone = profileText('contactPhone', body.contactPhone, 32, false, true, issues);
  const profile = parseSupplierProfile(body, false, issues);
  profileText('name', body.name, 200, false, false, issues);
  const deliveryMode = optionalDeliveryMode(body.deliveryMode, issues);
  const defaultSettlementMode = optionalSettlementMode(body.defaultSettlementMode, issues);
  const defaultSettlementCycle = optionalTrimmedString('defaultSettlementCycle', body.defaultSettlementCycle, issues);
  const status = optionalSupplierStatus(body.status, issues);

  throwIfInvalid(issues);

  return {
    expectedVersion: body.expectedVersion as number,
    ...profile,
    name,
    contactName,
    contactPhone,
    deliveryMode,
    defaultSettlementMode,
    defaultSettlementCycle,
    status,
  };
}

function parsePutSupplierProductsBody(id: string, body: PutSupplierProductsBody): { expectedVersion: number; productIds: string[] } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];

  const productIds: string[] = [];
  if (!Array.isArray(body.productIds)) {
    issues.push({ field: 'productIds', code: 'INVALID_PRODUCT_IDS', message: 'productIds must be an array' });
  } else {
    for (const [index, productId] of body.productIds.entries()) {
      issues.push(...validateUuid(`productIds.${index}`, productId));
      if (typeof productId === 'string') {
        productIds.push(productId);
      }
    }
  }

  throwIfInvalid(issues);

  return {
    expectedVersion: body.expectedVersion as number,
    productIds,
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
