import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { type AuthenticatedSession } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CommandsService } from '../commands/commands.service.js';
import { getOrCreateTraceId } from '../common/request-context.js';
import { requireIdempotencyKey, throwIfInvalid } from '../common/request-contract.js';
import {
  StoresService,
  type AccountLedgerView,
  type ClearingDocumentView,
  type ClearingPreviewView,
  type RechargeDocumentView,
  type StoreAccountView,
  type StoreLedgerQuery,
  type StoreView,
} from './stores.service.js';
import { StoreStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import {
  validateDecimalString,
  validateExpectedVersion,
  validateUuid,
  type ValidationIssue,
} from '../../../../packages/domain/src/validation.js';

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

type LedgerQuery = {
  occurredFrom?: unknown;
  occurredTo?: unknown;
};

type CreateRechargeBody = {
  amount?: unknown;
  businessDate?: unknown;
  collectionAccountId?: unknown;
  remark?: unknown;
};

type UpdateCreditLimitBody = {
  expectedVersion?: unknown;
  limit?: unknown;
  reason?: unknown;
};

type ClearingPreviewBody = {
  fundingAllocationIds?: unknown;
};

type CreateClearingBody = {
  items?: unknown;
  businessDate?: unknown;
  remark?: unknown;
};

@Controller('stores')
@UseGuards(AuthGuard, RolesGuard)
export class StoresController {
  constructor(
    private readonly storesService: StoresService,
    private readonly commandsService: CommandsService,
  ) {}

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

  @Get(':id/account')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE')
  getAccount(@Param('id') id: string): Promise<StoreAccountView> {
    throwIfInvalid(validateUuid('id', id));
    return this.storesService.getAccount(id);
  }

  @Get(':id/ledgers')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE')
  listLedgers(@Param('id') id: string, @Query() query: LedgerQuery): Promise<AccountLedgerView[]> {
    throwIfInvalid(validateUuid('id', id));
    return this.storesService.listLedgers(id, parseLedgerQuery(query));
  }

  @Post(':id/recharges')
  @RequireRoles('ADMIN', 'HQ_FINANCE')
  async createRecharge(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: CreateRechargeBody,
  ): Promise<RechargeDocumentView> {
    const input = parseCreateRechargeBody(id, body);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'store.recharge.create',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as RechargeDocumentView;
    }

    const result = await this.storesService.createRecharge(input.id, input.recharge);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'RechargeDocument',
      resourceId: result.id,
      responseBody: result as never,
    });

    return result;
  }

  @Patch(':id/credit-limit')
  @RequireRoles('ADMIN', 'HQ_FINANCE')
  async updateCreditLimit(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: UpdateCreditLimitBody,
  ): Promise<StoreAccountView> {
    const input = parseUpdateCreditLimitBody(id, body);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'store.credit-limit.update',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as StoreAccountView;
    }

    const result = await this.storesService.updateCreditLimit(input.id, input.creditLimit);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'StoreAccount',
      resourceId: result.id ?? input.id,
      responseBody: result as never,
    });

    return result;
  }

  @Post(':id/clearings/preview')
  @RequireRoles('ADMIN', 'HQ_FINANCE')
  previewClearing(@Param('id') id: string, @Body() body: ClearingPreviewBody): Promise<ClearingPreviewView> {
    const input = parseClearingPreviewBody(id, body);
    return this.storesService.previewClearing(input.id, input.preview);
  }

  @Post(':id/clearings')
  @RequireRoles('ADMIN', 'HQ_FINANCE')
  async createClearing(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: CreateClearingBody,
  ): Promise<ClearingDocumentView> {
    const input = parseCreateClearingBody(id, body);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'store.clearing.create',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as ClearingDocumentView;
    }

    const result = await this.storesService.createClearing(input.id, input.clearing);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'ClearingDocument',
      resourceId: result.id,
      responseBody: result as never,
    });

    return result;
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

function parseLedgerQuery(query: LedgerQuery): StoreLedgerQuery {
  const issues: ValidationIssue[] = [];
  const occurredFrom = optionalDate('occurredFrom', query.occurredFrom, issues);
  const occurredTo = optionalDate('occurredTo', query.occurredTo, issues);

  throwIfInvalid(issues);
  return { occurredFrom, occurredTo };
}

function parseCreateRechargeBody(
  id: string,
  body: CreateRechargeBody,
): { id: string; recharge: { amount: string; businessDate: Date; collectionAccountId: string; remark?: string } } {
  const issues: ValidationIssue[] = [...validateUuid('id', id), ...validateDecimalString('amount', body.amount, 2)];
  const businessDate = requiredDate('businessDate', body.businessDate, issues);
  const collectionAccountId = requiredTrimmedString('collectionAccountId', body.collectionAccountId, issues);
  const remark = optionalTrimmedString('remark', body.remark, issues);

  throwIfInvalid(issues);
  return {
    id,
    recharge: {
      amount: body.amount as string,
      businessDate: businessDate!,
      collectionAccountId: collectionAccountId!,
      remark,
    },
  };
}

function parseUpdateCreditLimitBody(
  id: string,
  body: UpdateCreditLimitBody,
): { id: string; creditLimit: { expectedVersion: number; limit: string; reason: string } } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
    ...validateDecimalString('limit', body.limit, 2),
  ];
  const reason = requiredTrimmedString('reason', body.reason, issues);

  throwIfInvalid(issues);
  return {
    id,
    creditLimit: {
      expectedVersion: body.expectedVersion as number,
      limit: body.limit as string,
      reason: reason!,
    },
  };
}

function parseClearingPreviewBody(
  id: string,
  body: ClearingPreviewBody,
): { id: string; preview: { fundingAllocationIds: string[] } } {
  const issues: ValidationIssue[] = [...validateUuid('id', id)];
  const fundingAllocationIds: string[] = [];

  if (!Array.isArray(body.fundingAllocationIds) || body.fundingAllocationIds.length === 0) {
    issues.push({
      field: 'fundingAllocationIds',
      code: 'INVALID_FUNDING_ALLOCATION_IDS',
      message: 'fundingAllocationIds must be a non-empty array',
    });
  } else {
    const seen = new Set<string>();
    for (const [index, value] of body.fundingAllocationIds.entries()) {
      issues.push(...validateUuid(`fundingAllocationIds.${index}`, value));
      if (typeof value === 'string') {
        if (seen.has(value)) {
          issues.push({
            field: `fundingAllocationIds.${index}`,
            code: 'DUPLICATE_FUNDING_ALLOCATION_ID',
            message: 'funding allocation ids must not repeat',
          });
        }
        seen.add(value);
        fundingAllocationIds.push(value);
      }
    }
  }

  throwIfInvalid(issues);
  return { id, preview: { fundingAllocationIds } };
}

function parseCreateClearingBody(
  id: string,
  body: CreateClearingBody,
): {
  id: string;
  clearing: {
    items: Array<{ fundingAllocationId: string; expectedVersion: number; expectedAmount: string }>;
    businessDate: Date;
    remark?: string;
  };
} {
  const issues: ValidationIssue[] = [...validateUuid('id', id)];
  const items: Array<{ fundingAllocationId: string; expectedVersion: number; expectedAmount: string }> = [];

  if (!Array.isArray(body.items) || body.items.length === 0) {
    issues.push({ field: 'items', code: 'INVALID_CLEARING_ITEMS', message: 'items must be a non-empty array' });
  } else {
    const seen = new Set<string>();
    for (const [index, item] of body.items.entries()) {
      if (!isRecord(item)) {
        issues.push({ field: `items.${index}`, code: 'INVALID_CLEARING_ITEM', message: 'item must be an object' });
        continue;
      }
      issues.push(...validateUuid(`items.${index}.fundingAllocationId`, item.fundingAllocationId));
      issues.push(...validateExpectedVersion(`items.${index}.expectedVersion`, item.expectedVersion));
      issues.push(...validateDecimalString(`items.${index}.expectedAmount`, item.expectedAmount, 2));
      if (typeof item.fundingAllocationId === 'string') {
        if (seen.has(item.fundingAllocationId)) {
          issues.push({
            field: `items.${index}.fundingAllocationId`,
            code: 'DUPLICATE_FUNDING_ALLOCATION_ID',
            message: 'funding allocation ids must not repeat',
          });
        }
        seen.add(item.fundingAllocationId);
      }
      if (
        typeof item.fundingAllocationId === 'string' &&
        typeof item.expectedVersion === 'number' &&
        typeof item.expectedAmount === 'string'
      ) {
        items.push({
          fundingAllocationId: item.fundingAllocationId,
          expectedVersion: item.expectedVersion,
          expectedAmount: item.expectedAmount,
        });
      }
    }
  }
  const businessDate = requiredDate('businessDate', body.businessDate, issues);
  const remark = optionalTrimmedString('remark', body.remark, issues);

  throwIfInvalid(issues);
  return { id, clearing: { items, businessDate: businessDate!, remark } };
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

function optionalDate(field: string, value: unknown, issues: ValidationIssue[]): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    issues.push({ field, code: 'INVALID_DATE', message: `${field} must be an ISO date string` });
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    issues.push({ field, code: 'INVALID_DATE', message: `${field} must be an ISO date string` });
    return undefined;
  }

  return parsed;
}

function requiredDate(field: string, value: unknown, issues: ValidationIssue[]): Date | undefined {
  const parsed = optionalDate(field, value, issues);
  if (value === undefined) {
    issues.push({ field, code: 'REQUIRED_DATE', message: `${field} is required` });
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
