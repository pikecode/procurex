import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { masterDataAuditContext } from '../audit/master-data-audit.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { type AuthenticatedSession } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { BusinessScopeGuard } from '../auth/business-scope.guard.js';
import { CommandsService } from '../commands/commands.service.js';
import { getOrCreateTraceId } from '../common/request-context.js';
import { requireIdempotencyKey, throwIfInvalid } from '../common/request-contract.js';
import {
  StoresService,
  type AccountLedgerView,
  type ClearingDocumentView,
  type ClearingPreviewView,
  type CreditItemView,
  type RechargeDocumentView,
  type StoreAccountView,
  type StoreLedgerQuery,
  type StoreView,
} from './stores.service.js';
import { StoreStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import { parseStoreProfile, profileText, type StoreProfile } from '../common/master-data-profile.js';
import {
  validateDecimalString,
  validateExpectedVersion,
  validateUuid,
  type ValidationIssue,
} from '../../../../packages/domain/src/validation.js';

type CreateStoreBody = Record<string, unknown> & {
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
  evidenceFileIds?: unknown;
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
  evidenceFileIds?: unknown;
  items?: unknown;
  businessDate?: unknown;
  remark?: unknown;
};

@Controller('stores')
@UseGuards(AuthGuard, RolesGuard, BusinessScopeGuard)
export class StoresController {
  constructor(
    private readonly storesService: StoresService,
    private readonly commandsService: CommandsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE')
  listStores(): Promise<StoreView[]> {
    return this.storesService.listStores();
  }

  @Get('finance-overview')
  @RequireRoles('ADMIN', 'HQ_FINANCE')
  financeOverview() { return this.storesService.listFinanceStores(); }

  @Get(':id')
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  getStore(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<StoreView> {
    throwIfInvalid(validateUuid('id', id));
    const user = request.auth!.user;
    if (!user.roles.some(role => ['ADMIN', 'PURCHASER', 'HQ_FINANCE'].includes(role))) {
      if (!user.scope?.storeId) throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Store scope is not configured' });
      if (user.scope.storeId.toLowerCase() !== id.toLowerCase()) throw new ForbiddenException({ code: 'SCOPE_MISMATCH', message: 'Store is outside the current scope' });
    }
    return this.storesService.getStore(id);
  }

  @Post()
  @RequireRoles('ADMIN')
  createStore(@Body() body: CreateStoreBody, @Req() request: AuthenticatedRequest): Promise<StoreView> {
    return this.storesService.createStore(parseCreateStoreBody(body), masterDataAuditContext(request));
  }

  @Post('group-memberships')
  @RequireRoles('ADMIN')
  changeGroups(@Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    const issues: ValidationIssue[] = [];
    if (body.groupName !== null && (typeof body.groupName !== 'string' || !body.groupName.trim() || body.groupName.length > 120)) {
      issues.push({ field: 'groupName', code: 'INVALID_GROUP', message: '请选择有效分组或未分组' });
    }
    const stores = Array.isArray(body.stores) ? body.stores : [];
    if (!stores.length || stores.length > 100) issues.push({ field: 'stores', code: 'INVALID_STORES', message: '请选择1至100个门店' });
    const ids = new Set<string>();
    stores.forEach((value, index) => {
      const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      issues.push(...validateUuid(`stores.${index}.id`, item.id), ...validateExpectedVersion(`stores.${index}.expectedVersion`, item.expectedVersion));
      if (typeof item.id === 'string') {
        const normalized = item.id.toLowerCase();
        if (ids.has(normalized)) issues.push({ field: 'stores', code: 'DUPLICATE_STORE', message: '门店不能重复选择' });
        ids.add(normalized);
      }
    });
    throwIfInvalid(issues);
    return this.storesService.changeGroups(stores as { id: string; expectedVersion: number }[], typeof body.groupName === 'string' ? body.groupName.trim() : null, masterDataAuditContext(request));
  }

  @Get(':id/account')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  getAccount(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<StoreAccountView> {
    throwIfInvalid(validateUuid('id', id));
    applyStoreScope(id, request);
    return this.storesService.getAccount(id);
  }

  @Get(':id/ledgers')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  listLedgers(@Param('id') id: string, @Query() query: LedgerQuery, @Req() request: AuthenticatedRequest): Promise<AccountLedgerView[]> {
    throwIfInvalid(validateUuid('id', id));
    applyStoreScope(id, request);
    return this.storesService.listLedgers(id, parseLedgerQuery(query));
  }

  @Get(':id/credit-items')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  listCreditItems(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<CreditItemView[]> {
    throwIfInvalid(validateUuid('id', id));
    applyStoreScope(id, request);
    return this.storesService.listCreditItems(id);
  }

  @Get(':id/credit-movements')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  listCreditMovements(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    throwIfInvalid(validateUuid('id', id));
    applyStoreScope(id, request);
    return this.storesService.listCreditMovements(id);
  }

  @Get(':id/recharges/:documentId')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  getRecharge(@Param('id') id: string, @Param('documentId') documentId: string, @Req() request: AuthenticatedRequest) {
    throwIfInvalid([...validateUuid('id', id), ...validateUuid('documentId', documentId)]);
    applyStoreScope(id, request);
    return this.storesService.getAccountDocument(id, documentId, 'RECHARGE');
  }

  @Get(':id/clearings/:documentId')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  getClearing(@Param('id') id: string, @Param('documentId') documentId: string, @Req() request: AuthenticatedRequest) {
    throwIfInvalid([...validateUuid('id', id), ...validateUuid('documentId', documentId)]);
    applyStoreScope(id, request);
    return this.storesService.getAccountDocument(id, documentId, 'CLEARING');
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
    const traceId = getOrCreateTraceId(request);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'store.recharge.create',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId,
    });

    if (command.state === 'replay') {
      return command.command.responseBody as RechargeDocumentView;
    }

    return this.commandsService.performAtomic(command, async tx => {
      const result = await this.storesService.createRecharge(input.id, { ...input.recharge, actorUserId: auth.user.id }, tx);
      await this.commandsService.succeed({
        commandId: command.command.id,
        resourceType: 'RechargeDocument',
        resourceId: result.id,
        responseBody: result as never,
      }, tx);
      await this.audit.record({
        actorUserId: auth.user.id,
        activeScope: auditScope(auth),
        action: 'store.recharge.create',
        entityType: 'RechargeDocument',
        entityId: result.id,
        traceId,
        reason: input.recharge.remark,
        after: {
          storeId: result.storeId,
          amount: result.amount,
          businessDate: result.businessDate,
          collectionAccountId: result.collectionAccountId,
          ...(result.evidenceFileIds ? { evidenceFileIds: result.evidenceFileIds } : {}),
          accountVersion: result.account.version,
        },
      }, tx);

      return result;
    });
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
    const traceId = getOrCreateTraceId(request);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'store.credit-limit.update',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId,
    });

    if (command.state === 'replay') {
      return command.command.responseBody as StoreAccountView;
    }

    return this.commandsService.performAtomic(command, async tx => {
      const result = await this.storesService.updateCreditLimit(input.id, input.creditLimit, tx);
      await this.commandsService.succeed({
        commandId: command.command.id,
        resourceType: 'StoreAccount',
        resourceId: result.id ?? input.id,
        responseBody: result as never,
      }, tx);
      await this.audit.record({
        actorUserId: auth.user.id,
        activeScope: auditScope(auth),
        action: 'store.credit-limit.update',
        entityType: 'StoreAccount',
        entityId: result.id ?? input.id,
        traceId,
        reason: input.creditLimit.reason,
        after: {
          storeId: result.storeId,
          creditLimit: result.creditLimit,
          creditUsed: result.creditUsed,
          creditAvailable: result.creditAvailable,
          version: result.version,
        },
      }, tx);

      return result;
    });
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
    const traceId = getOrCreateTraceId(request);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'store.clearing.create',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId,
    });

    if (command.state === 'replay') {
      return command.command.responseBody as ClearingDocumentView;
    }

    return this.commandsService.performAtomic(command, async tx => {
      const result = await this.storesService.createClearing(input.id, { ...input.clearing, actorUserId: auth.user.id }, tx);
      await this.commandsService.succeed({
        commandId: command.command.id,
        resourceType: 'ClearingDocument',
        resourceId: result.id,
        responseBody: result as never,
      }, tx);
      await this.audit.record({
        actorUserId: auth.user.id,
        activeScope: auditScope(auth),
        action: 'store.clearing.create',
        entityType: 'ClearingDocument',
        entityId: result.id,
        traceId,
        reason: input.clearing.remark,
        after: {
          storeId: result.storeId,
          amount: result.amount,
          businessDate: result.businessDate,
          itemCount: result.items.length,
          ...(result.evidenceFileIds ? { evidenceFileIds: result.evidenceFileIds } : {}),
          accountVersion: result.account.version,
        },
      }, tx);

      return result;
    });
  }

  @Patch(':id')
  @RequireRoles('ADMIN')
  updateStore(@Param('id') id: string, @Body() body: PatchStoreBody, @Req() request: AuthenticatedRequest): Promise<StoreView> {
    const input = parsePatchStoreBody(id, body);
    return this.storesService.updateStore(id, input, masterDataAuditContext(request));
  }
}

function applyStoreScope(storeId: string, request: AuthenticatedRequest): void {
  const user = request.auth!.user;
  if (user.roles.some(role => ['ADMIN', 'HQ_FINANCE', 'PURCHASER'].includes(role))) return;
  const scope = user.scope;
  if (!scope?.storeId || !['STORE', 'STORE_FINANCE'].includes(scope.type)) throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Store scope is not configured' });
  if (scope.storeId.toLowerCase() !== storeId.toLowerCase()) throw new ForbiddenException({ code: 'SCOPE_MISMATCH', message: 'Store is outside the current store scope' });
}

function auditScope(auth: AuthenticatedSession) {
  return { roles: auth.user.roles, ...(auth.user.scope ? { scope: auth.user.scope } : {}) };
}

function parseCreateStoreBody(body: CreateStoreBody): StoreProfile & {
  code?: string;
  name: string;
  contactName?: string;
  contactPhone?: string;
  address?: string;
} {
  const issues: ValidationIssue[] = [];
  const code = profileText('code', body.code, 80, false, false, issues) ?? undefined;
  const name = requiredTrimmedString('name', body.name, issues);
  const contactName = profileText('contactName', body.contactName, 120, true, false, issues) ?? undefined;
  const contactPhone = profileText('contactPhone', body.contactPhone, 32, true, false, issues) ?? undefined;
  const address = profileText('address', body.address, 300, true, false, issues) ?? undefined;
  const profile = parseStoreProfile(body, true, issues);
  profileText('name', body.name, 200, true, false, issues);

  throwIfInvalid(issues);

  return { ...profile, code, name: name!, contactName, contactPhone, address };
}

function parsePatchStoreBody(id: string, body: PatchStoreBody): StoreProfile & {
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
  const contactName = profileText('contactName', body.contactName, 120, false, false, issues);
  const contactPhone = profileText('contactPhone', body.contactPhone, 32, false, false, issues);
  const address = profileText('address', body.address, 300, false, false, issues);
  const profile = parseStoreProfile(body, false, issues);
  profileText('name', body.name, 200, false, false, issues);
  const status = optionalStoreStatus(body.status, issues);

  throwIfInvalid(issues);

  return {
    expectedVersion: body.expectedVersion as number,
    ...profile,
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

function accountEvidence(value: unknown, issues: ValidationIssue[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 5 || new Set(value).size !== value.length) {
    issues.push({ field: 'evidenceFileIds', code: 'ACCOUNT_EVIDENCE_INVALID', message: 'Provide one to five distinct evidence IDs' });
    return undefined;
  }
  value.forEach((id, index) => issues.push(...validateUuid(`evidenceFileIds.${index}`, id)));
  return value as string[];
}

function parseCreateRechargeBody(
  id: string,
  body: CreateRechargeBody,
): { id: string; recharge: { amount: string; businessDate: Date; collectionAccountId: string; remark?: string; evidenceFileIds?: string[] } } {
  const issues: ValidationIssue[] = [...validateUuid('id', id), ...validateDecimalString('amount', body.amount, 2)];
  const businessDate = requiredDate('businessDate', body.businessDate, issues);
  const collectionAccountId = requiredTrimmedString('collectionAccountId', body.collectionAccountId, issues);
  const remark = optionalTrimmedString('remark', body.remark, issues);

  const evidenceFileIds = accountEvidence(body.evidenceFileIds, issues);

  throwIfInvalid(issues);
  return {
    id,
    recharge: {
      amount: body.amount as string,
      businessDate: businessDate!,
      collectionAccountId: collectionAccountId!,
      remark,
      ...(evidenceFileIds ? { evidenceFileIds } : {}),
    },
  };
}

function parseUpdateCreditLimitBody(
  id: string,
  body: UpdateCreditLimitBody,
): { id: string; creditLimit: { expectedVersion: number; limit: string; reason: string } } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...(body.expectedVersion === 0 ? [] : validateExpectedVersion('expectedVersion', body.expectedVersion)),
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
    evidenceFileIds?: string[];
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

  const evidenceFileIds = accountEvidence(body.evidenceFileIds, issues);

  throwIfInvalid(issues);
  return { id, clearing: { items, businessDate: businessDate!, remark, ...(evidenceFileIds ? { evidenceFileIds } : {}) } };
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
