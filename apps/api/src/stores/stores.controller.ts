import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { StoresService, type StoreView } from './stores.service.js';
import { StoreStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import { validateExpectedVersion, validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';

type CreateStoreBody = {
  code?: unknown;
  name?: unknown;
  contactName?: unknown;
  contactPhone?: unknown;
  address?: unknown;
};

type PatchStoreBody = CreateStoreBody & {
  expectedVersion?: unknown;
  status?: unknown;
};

@Controller('stores')
@UseGuards(AuthGuard, RolesGuard)
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE')
  listStores(): Promise<StoreView[]> {
    return this.storesService.listStores();
  }

  @Post()
  @RequireRoles('ADMIN')
  createStore(@Body() body: CreateStoreBody): Promise<StoreView> {
    return this.storesService.createStore(parseCreateStoreBody(body));
  }

  @Patch(':id')
  @RequireRoles('ADMIN')
  updateStore(@Param('id') id: string, @Body() body: PatchStoreBody): Promise<StoreView> {
    const input = parsePatchStoreBody(id, body);
    return this.storesService.updateStore(id, input);
  }
}

function parseCreateStoreBody(body: CreateStoreBody): {
  code: string;
  name: string;
  contactName?: string;
  contactPhone?: string;
  address?: string;
} {
  const issues: ValidationIssue[] = [];
  const code = requiredTrimmedString('code', body.code, issues);
  const name = requiredTrimmedString('name', body.name, issues);
  const contactName = optionalTrimmedString('contactName', body.contactName, issues);
  const contactPhone = optionalTrimmedString('contactPhone', body.contactPhone, issues);
  const address = optionalTrimmedString('address', body.address, issues);

  throwIfInvalid(issues);

  return { code: code!, name: name!, contactName, contactPhone, address };
}

function parsePatchStoreBody(id: string, body: PatchStoreBody): {
  expectedVersion: number;
  name?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  status?: StoreStatus;
} {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];

  const name = optionalTrimmedString('name', body.name, issues);
  const contactName = optionalNullableTrimmedString('contactName', body.contactName, issues);
  const contactPhone = optionalNullableTrimmedString('contactPhone', body.contactPhone, issues);
  const address = optionalNullableTrimmedString('address', body.address, issues);
  const status = optionalStoreStatus(body.status, issues);

  throwIfInvalid(issues);

  return {
    expectedVersion: body.expectedVersion as number,
    name,
    contactName,
    contactPhone,
    address,
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

function optionalStoreStatus(value: unknown, issues: ValidationIssue[]): StoreStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === StoreStatus.ACTIVE || value === StoreStatus.DISABLED) {
    return value;
  }

  issues.push({ field: 'status', code: 'INVALID_STORE_STATUS', message: 'status must be ACTIVE or DISABLED' });
  return undefined;
}
