import { StorePricePrivacyInterceptor } from '../common/store-price-privacy.interceptor.js';
import { UseInterceptors } from '@nestjs/common';
import { Body, ConflictException, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { BusinessScopeGuard } from '../auth/business-scope.guard.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { type AuthenticatedSession } from '../auth/auth.service.js';
import { getOrCreateTraceId } from '../common/request-context.js';
import { requireIdempotencyKey, throwIfInvalid } from '../common/request-contract.js';
import { CommandsService } from '../commands/commands.service.js';
import {
  PurchaseRequestPreviewService,
  type PurchaseRequestPreview,
  type PreviewItemInput,
} from './purchase-request-preview.service.js';
import {
  PurchaseRequestsService,
  type ConfirmPurchaseRequestResult,
  type ListPurchaseRequestsInput,
  type PurchaseRequestDetailView,
  type PurchaseRequestSummaryView,
  type PurchaseRequestView,
  type ReassignPurchaseRequestPreview,
  type ReallocatePurchaseRequestAssignmentInput,
  type ReplacePurchaseRequestItemInput,
  type RejectPurchaseRequestResult,
} from './purchase-requests.service.js';
import { PurchaseRequestStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import {
  validateDecimalString,
  validateExpectedVersion,
  validateUuid,
  type ValidationIssue,
} from '../../../../packages/domain/src/validation.js';

type PreviewBody = {
  expectedTemplateId?: unknown;
  storeId?: unknown;
  items?: unknown;
};

type ListQuery = {
  storeId?: unknown;
  status?: unknown;
};

type ConfirmBody = {
  expectedVersion?: unknown;
};

type RejectBody = {
  expectedVersion?: unknown;
  reason?: unknown;
};

type PatchItemsBody = {
  expectedVersion?: unknown;
  reason?: unknown;
  items?: unknown;
};

type ReassignBody = {
  expectedVersion?: unknown;
  itemIds?: unknown;
  supplierId?: unknown;
  expectedPrices?: unknown;
};

type ReallocateBody = {
  expectedVersion?: unknown;
  rejectedOrderId?: unknown;
  assignments?: unknown;
  reason?: unknown;
};

@Controller('purchase-requests')
@UseGuards(AuthGuard, RolesGuard, BusinessScopeGuard)
@UseInterceptors(StorePricePrivacyInterceptor)
export class PurchaseRequestsController {
  constructor(
    private readonly previewService: PurchaseRequestPreviewService,
    private readonly purchaseRequestsService: PurchaseRequestsService,
    private readonly commandsService: CommandsService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly database: DatabaseService,
  ) {}

  @Get()
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  list(@Req() request: AuthenticatedRequest, @Query() query: ListQuery): Promise<PurchaseRequestSummaryView[]> {
    const scope = storeScope(request);
    const input = parseListQuery(query);
    if (scope) {
      if (!scope.storeId) throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Store scope is not configured' });
      if (input.storeId && input.storeId !== scope.storeId) throw new ForbiddenException({ code: 'SCOPE_MISMATCH', message: 'Purchase requests are outside the current store scope' });
      input.storeId = scope.storeId;
    }
    return this.purchaseRequestsService.list(input);
  }

  @Get('rejection-todos')
  @RequireRoles('ADMIN', 'PURCHASER')
  rejectionTodos() {
    return this.purchaseRequestsService.rejectionTodos();
  }

  @Get(':id')
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<PurchaseRequestDetailView> {
    throwIfInvalid(validateUuid('id', id));
    const scope = storeScope(request);
    if (scope && !scope.storeId) throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Store scope is not configured' });
    return this.purchaseRequestsService.get(id, scope);
  }

  @Get(':id/edit-catalog')
  @RequireRoles('ADMIN', 'PURCHASER')
  async editCatalog(@Param('id') id: string) {
    throwIfInvalid(validateUuid('id', id));
    const detail = await this.purchaseRequestsService.get(id);
    if (!['PENDING_PROCUREMENT', 'PENDING_FUNDS'].includes(detail.status) || detail.supplierOrders.length) {
      throw new ConflictException({ code: 'PURCHASE_REQUEST_ITEMS_NOT_EDITABLE', message: 'Purchase request items cannot be edited in its current status' });
    }
    return this.catalog.readTemplateCatalog(detail.storeId, detail.templateId);
  }

  @Post('preview')
  @RequireRoles('ADMIN', 'PURCHASER', 'STORE')
  preview(@Req() request: AuthenticatedRequest, @Body() body: PreviewBody): Promise<PurchaseRequestPreview> {
    const input = parsePreviewBody(body);
    assertStoreScope(request, input.storeId);
    return this.previewService.preview(input);
  }

  @Post()
  @RequireRoles('ADMIN', 'PURCHASER', 'STORE')
  async create(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Body() body: PreviewBody,
  ): Promise<PurchaseRequestView> {
    const input = parsePreviewBody(body);
    assertStoreScope(request, input.storeId);
    const traceId = getOrCreateTraceId(request);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'purchase-request.create',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: body as never,
      traceId,
    });

    if (command.state === 'replay') {
      return command.command.responseBody as PurchaseRequestView;
    }

    return this.commandsService.performAtomic(command, async tx => {
      const result = await this.purchaseRequestsService.create(input, tx);
      await this.commandsService.succeed({
        commandId: command.command.id,
        resourceType: 'PurchaseRequest',
        resourceId: result.id,
        responseBody: result as never,
      }, tx);
      await this.audit.record({
        actorUserId: auth.user.id,
        activeScope: auditScope(auth),
        action: 'purchase-request.create',
        entityType: 'PurchaseRequest',
        entityId: result.id,
        traceId,
        after: {
          storeId: result.storeId,
          status: result.status,
          paymentStatus: result.paymentStatus,
          itemCount: result.items.length,
          salesGoodsAmount: result.totals.salesGoodsAmount,
        },
      }, tx);

      return result;
    });
  }

  @Patch(':id/items')
  @RequireRoles('ADMIN', 'PURCHASER')
  async replaceItems(@Param('id') id: string, @Body() body: PatchItemsBody, @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession): Promise<PurchaseRequestDetailView> {
    const input = parsePatchItemsBody(id, body);
    return this.editCommand(request, auth, 'purchase-request.items.replace', id, body,
      tx => this.purchaseRequestsService.replaceItems(input.id, input.expectedVersion, input.items, tx));
  }

  @Post(':id/items-preview')
  @RequireRoles('ADMIN', 'PURCHASER')
  previewItems(@Param('id') id: string, @Body() body: PatchItemsBody) {
    const input = parsePatchItemsBody(id, body);
    return this.purchaseRequestsService.previewReplacement(input.id, input.expectedVersion, input.items);
  }

  @Post(':id/reassign-preview')
  @RequireRoles('ADMIN', 'PURCHASER')
  reassignPreview(@Param('id') id: string, @Body() body: ReassignBody): Promise<ReassignPurchaseRequestPreview> {
    const input = parseReassignBody(id, body);
    return this.purchaseRequestsService.reassignPreview(input.id, input.expectedVersion, input.itemIds, input.supplierId);
  }

  @Post(':id/assign')
  @RequireRoles('ADMIN', 'PURCHASER')
  async assign(@Param('id') id: string, @Body() body: ReassignBody, @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession): Promise<PurchaseRequestDetailView> {
    const input = parseReassignBody(id, body);
    return this.editCommand(request, auth, 'purchase-request.assign', id, body,
      tx => this.purchaseRequestsService.assign(input.id, input.expectedVersion, input.itemIds, input.supplierId, input.expectedPrices, tx));
  }

  private async editCommand(request: AuthenticatedRequest, auth: AuthenticatedSession, action: string,
    id: string, body: object, operation: (tx?: Prisma.TransactionClient) => Promise<PurchaseRequestDetailView>): Promise<PurchaseRequestDetailView> {
    const traceId = getOrCreateTraceId(request);
    const command = request.headers['idempotency-key'] === undefined ? null : await this.commandsService.begin({
      actorUserId: auth.user.id, action, idempotencyKey: requireIdempotencyKey(request.headers), requestBody: { id, ...body } as never, traceId,
    });
    if (command?.state === 'replay') return command.command.responseBody as PurchaseRequestDetailView;
    const execute = async (tx: Prisma.TransactionClient) => {
      const result = await operation(tx);
      if (command) await this.commandsService.succeed({ commandId: command.command.id, resourceType: 'PurchaseRequest', resourceId: id, responseBody: result as never }, tx);
      await this.audit.record({ actorUserId: auth.user.id, activeScope: auditScope(auth), action, entityType: 'PurchaseRequest', entityId: id,
        traceId, reason: 'reason' in body && typeof body.reason === 'string' ? body.reason.trim() : undefined,
        after: { version: result.version, salesGoodsAmount: result.salesGoodsAmount, items: result.items.map(item => ({ productId: item.productId, supplierId: item.supplierId, quantity: item.quantity })),
          ...(!command ? { submissionMode: 'LEGACY_HEADERLESS' } : {}) } }, tx);
      return result;
    };
    return command ? this.commandsService.performAtomic(command, execute) : this.database.client.$transaction(execute);
  }

  @Post(':id/reallocate')
  @RequireRoles('ADMIN', 'PURCHASER')
  async reallocate(@Req() request: AuthenticatedRequest, @CurrentAuth() auth: AuthenticatedSession, @Param('id') id: string, @Body() body: ReallocateBody): Promise<PurchaseRequestDetailView> {
    const input = parseReallocateBody(id, body);
    const traceId = getOrCreateTraceId(request);
    const command = await this.commandsService.begin({ actorUserId: auth.user.id, action: 'purchase-request.reallocate',
      idempotencyKey: requireIdempotencyKey(request.headers), requestBody: { id, ...body } as never, traceId });
    if (command.state === 'replay') return command.command.responseBody as PurchaseRequestDetailView;
    return this.commandsService.performAtomic(command, async tx => {
      const result = await this.purchaseRequestsService.reallocate(input.id, input.expectedVersion, input.rejectedOrderId, input.assignments, tx);
      await this.commandsService.succeed({ commandId: command.command.id, resourceType: 'PurchaseRequest', resourceId: result.id, responseBody: result as never }, tx);
      await this.audit.record({ actorUserId: auth.user.id, activeScope: auditScope(auth), action: 'purchase-request.reallocate',
        entityType: 'PurchaseRequest', entityId: result.id, traceId, reason: input.reason, after: { rejectedOrderId: input.rejectedOrderId, assignments: input.assignments } }, tx);
      return result;
    });
  }

  @Post(':id/confirm')
  @RequireRoles('ADMIN', 'PURCHASER')
  async confirm(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: ConfirmBody,
  ): Promise<ConfirmPurchaseRequestResult> {
    const input = parseConfirmBody(id, body);
    const traceId = getOrCreateTraceId(request);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'purchase-request.confirm',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId,
    });

    if (command.state === 'replay') {
      return command.command.responseBody as ConfirmPurchaseRequestResult;
    }

    return this.commandsService.performAtomic(command, async tx => {
      const result = await this.purchaseRequestsService.confirm(input.id, input.expectedVersion, tx);
      await this.commandsService.succeed({
        commandId: command.command.id,
        resourceType: 'PurchaseRequest',
        resourceId: result.requestId,
        responseBody: result as never,
      }, tx);
      await this.audit.record({
        actorUserId: auth.user.id,
        activeScope: auditScope(auth),
        action: 'purchase-request.confirm',
        entityType: 'PurchaseRequest',
        entityId: result.requestId,
        traceId,
        after: {
          status: result.status,
          supplierOrderIds: result.supplierOrderIds,
        },
      }, tx);

      return result;
    });
  }

  @Post(':id/reject')
  @RequireRoles('ADMIN', 'PURCHASER')
  async reject(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: RejectBody,
  ): Promise<RejectPurchaseRequestResult> {
    const input = parseRejectBody(id, body);
    const traceId = getOrCreateTraceId(request);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'purchase-request.reject',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId,
    });

    if (command.state === 'replay') {
      return command.command.responseBody as RejectPurchaseRequestResult;
    }

    return this.commandsService.performAtomic(command, async tx => {
      const result = await this.purchaseRequestsService.reject(input.id, input.expectedVersion, input.reason, tx);
      await this.commandsService.succeed({
        commandId: command.command.id,
        resourceType: 'PurchaseRequest',
        resourceId: result.requestId,
        responseBody: result as never,
      }, tx);
      await this.audit.record({
        actorUserId: auth.user.id,
        activeScope: auditScope(auth),
        action: 'purchase-request.reject',
        entityType: 'PurchaseRequest',
        entityId: result.requestId,
        traceId,
        reason: input.reason,
        after: {
          status: result.status,
          rejectedAt: result.rejectedAt,
        },
      }, tx);

      return result;
    });
  }
}

function storeScope(request: AuthenticatedRequest): { type: string; storeId?: string } | undefined {
  const scope = request.auth?.user.scope;
  return scope?.type === 'STORE' || scope?.type === 'STORE_FINANCE' ? scope : undefined;
}

function assertStoreScope(request: AuthenticatedRequest, storeId: string): void {
  const scope = storeScope(request);
  if (!scope) return;
  if (!scope.storeId) throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Store scope is not configured' });
  if (scope.storeId !== storeId) throw new ForbiddenException({ code: 'SCOPE_MISMATCH', message: 'Purchase request is outside the current store scope' });
}

function auditScope(auth: AuthenticatedSession) {
  return { roles: auth.user.roles, ...(auth.user.scope ? { scope: auth.user.scope } : {}) };
}

function parseListQuery(query: ListQuery): ListPurchaseRequestsInput {
  const issues: ValidationIssue[] = [];
  let storeId: string | undefined;
  let status: PurchaseRequestStatus | undefined;

  if (query.storeId !== undefined) {
    issues.push(...validateUuid('storeId', query.storeId));
    if (typeof query.storeId === 'string') {
      storeId = query.storeId;
    }
  }

  if (query.status !== undefined) {
    status = optionalPurchaseRequestStatus(query.status, issues);
  }

  throwIfInvalid(issues);
  return { storeId, status };
}

function parsePreviewBody(body: PreviewBody): { storeId: string; expectedTemplateId?: string; items: PreviewItemInput[] } {
  const issues: ValidationIssue[] = [...validateUuid('storeId', body.storeId)];
  if (body.expectedTemplateId !== undefined) issues.push(...validateUuid('expectedTemplateId', body.expectedTemplateId));
  const items: PreviewItemInput[] = [];

  if (!Array.isArray(body.items) || body.items.length === 0) {
    issues.push({ field: 'items', code: 'INVALID_ITEMS', message: 'items must be a non-empty array' });
  } else {
    for (const [index, item] of body.items.entries()) {
      if (!isRecord(item)) {
        issues.push({ field: `items.${index}`, code: 'INVALID_ITEM', message: 'item must be an object' });
        continue;
      }
      issues.push(...validateUuid(`items.${index}.productId`, item.productId));
      issues.push(...validateDecimalString(`items.${index}.quantity`, item.quantity, 6));
      if (item.unitId !== undefined) issues.push(...validateUuid(`items.${index}.unitId`, item.unitId));
      if (item.expectedProductVersion !== undefined) issues.push(...validateExpectedVersion(`items.${index}.expectedProductVersion`, item.expectedProductVersion));
      if (typeof item.productId === 'string' && typeof item.quantity === 'string') {
        items.push({ productId: item.productId, quantity: item.quantity, unitId: item.unitId as string | undefined, expectedProductVersion: item.expectedProductVersion as number | undefined, ...parseApprovedPrices(item, index, issues) });
      }
    }
  }

  throwIfInvalid(issues);
  return { storeId: body.storeId as string, items, expectedTemplateId: body.expectedTemplateId as string | undefined };
}

function parseConfirmBody(id: string, body: ConfirmBody): { id: string; expectedVersion: number } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  throwIfInvalid(issues);
  return { id, expectedVersion: body.expectedVersion as number };
}

function parsePatchItemsBody(
  id: string,
  body: PatchItemsBody,
): { id: string; expectedVersion: number; reason: string; items: ReplacePurchaseRequestItemInput[] } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const reason = requiredReason(body.reason, issues);
  const items: ReplacePurchaseRequestItemInput[] = [];

  if (!Array.isArray(body.items) || body.items.length === 0) {
    issues.push({ field: 'items', code: 'INVALID_ITEMS', message: 'items must be a non-empty array' });
  } else {
    for (const [index, item] of body.items.entries()) {
      if (!isRecord(item)) {
        issues.push({ field: `items.${index}`, code: 'INVALID_ITEM', message: 'item must be an object' });
        continue;
      }
      issues.push(...validateUuid(`items.${index}.productId`, item.productId));
      issues.push(...validateUuid(`items.${index}.supplierId`, item.supplierId));
      issues.push(...validateDecimalString(`items.${index}.quantity`, item.quantity, 6));
      if (item.unitId !== undefined) issues.push(...validateUuid(`items.${index}.unitId`, item.unitId));
      if (item.expectedProductVersion !== undefined) issues.push(...validateExpectedVersion(`items.${index}.expectedProductVersion`, item.expectedProductVersion));
      if (typeof item.productId === 'string' && typeof item.supplierId === 'string' && typeof item.quantity === 'string') {
        items.push({ productId: item.productId, supplierId: item.supplierId, quantity: item.quantity, unitId: item.unitId as string | undefined, expectedProductVersion: item.expectedProductVersion as number | undefined, ...parseApprovedPrices(item, index, issues) });
      }
    }
  }

  throwIfInvalid(issues);
  return { id, expectedVersion: body.expectedVersion as number, reason: reason!, items };
}

function parseApprovedPrices(item: Record<string, unknown>, index: number, issues: ValidationIssue[]) {
  for (const field of ['expectedPriceVersionId', 'expectedSupplyPriceVersionId']) {
    if (item[field] !== undefined) issues.push(...validateUuid(`items.${index}.${field}`, item[field]));
  }
  return { expectedPriceVersionId: item.expectedPriceVersionId as string | undefined,
    expectedSupplyPriceVersionId: item.expectedSupplyPriceVersionId as string | undefined };
}

function parseReassignBody(
  id: string,
  body: ReassignBody,
): { id: string; expectedVersion: number; itemIds: string[]; supplierId: string; expectedPrices?: Array<{ requestItemId: string; priceVersionId: string; supplyPriceVersionId: string }> } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
    ...validateUuid('supplierId', body.supplierId),
  ];
  const itemIds: string[] = [];

  if (!Array.isArray(body.itemIds) || body.itemIds.length === 0) {
    issues.push({ field: 'itemIds', code: 'INVALID_ITEM_IDS', message: 'itemIds must be a non-empty array' });
  } else {
    const seen = new Set<string>();
    for (const [index, itemId] of body.itemIds.entries()) {
      issues.push(...validateUuid(`itemIds.${index}`, itemId));
      if (typeof itemId === 'string') {
        if (seen.has(itemId)) {
          issues.push({ field: `itemIds.${index}`, code: 'DUPLICATE_ITEM_ID', message: 'itemIds must not contain duplicates' });
        }
        seen.add(itemId);
        itemIds.push(itemId);
      }
    }
  }

  let expectedPrices: Array<{ requestItemId: string; priceVersionId: string; supplyPriceVersionId: string }> | undefined;
  if (body.expectedPrices !== undefined) {
    if (!Array.isArray(body.expectedPrices)) issues.push({ field: 'expectedPrices', code: 'INVALID_EXPECTED_PRICES', message: 'expectedPrices must be an array' });
    else {
      expectedPrices = [];
      for (const [index, price] of body.expectedPrices.entries()) {
        if (!isRecord(price)) { issues.push({ field: `expectedPrices.${index}`, code: 'INVALID_EXPECTED_PRICES', message: 'Expected price must be an object' }); continue; }
        for (const field of ['requestItemId', 'priceVersionId', 'supplyPriceVersionId']) issues.push(...validateUuid(`expectedPrices.${index}.${field}`, price[field]));
        expectedPrices.push(price as { requestItemId: string; priceVersionId: string; supplyPriceVersionId: string });
      }
      if (expectedPrices.length !== itemIds.length || new Set(expectedPrices.map(price => price.requestItemId)).size !== itemIds.length || expectedPrices.some(price => !itemIds.includes(price.requestItemId))) {
        issues.push({ field: 'expectedPrices', code: 'INVALID_EXPECTED_PRICES', message: 'Expected prices must cover each selected item exactly once' });
      }
    }
  }
  throwIfInvalid(issues);
  return { id, expectedVersion: body.expectedVersion as number, itemIds, supplierId: body.supplierId as string, expectedPrices };
}

function parseReallocateBody(
  id: string,
  body: ReallocateBody,
): {
  id: string;
  expectedVersion: number;
  rejectedOrderId: string;
  reason: string;
  assignments: ReallocatePurchaseRequestAssignmentInput[];
} {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
    ...validateUuid('rejectedOrderId', body.rejectedOrderId),
  ];
  const reason = requiredReason(body.reason, issues);
  const assignments: ReallocatePurchaseRequestAssignmentInput[] = [];

  if (!Array.isArray(body.assignments) || body.assignments.length === 0) {
    issues.push({ field: 'assignments', code: 'INVALID_ASSIGNMENTS', message: 'assignments must be a non-empty array' });
  } else {
    const seen = new Set<string>();
    for (const [index, assignment] of body.assignments.entries()) {
      if (!isRecord(assignment)) {
        issues.push({ field: `assignments.${index}`, code: 'INVALID_ASSIGNMENT', message: 'assignment must be an object' });
        continue;
      }
      issues.push(...validateUuid(`assignments.${index}.requestItemId`, assignment.requestItemId));
      if (typeof assignment.requestItemId === 'string') {
        if (seen.has(assignment.requestItemId)) {
          issues.push({ field: `assignments.${index}.requestItemId`, code: 'DUPLICATE_ITEM_ID', message: 'assignment item ids must not repeat' });
        }
        seen.add(assignment.requestItemId);
      }

      const cancel = assignment.cancel === true;
      if (assignment.cancel !== undefined && typeof assignment.cancel !== 'boolean') {
        issues.push({ field: `assignments.${index}.cancel`, code: 'INVALID_CANCEL', message: 'cancel must be a boolean' });
      }
      if (cancel && assignment.supplierId !== undefined) {
        issues.push({
          field: `assignments.${index}.supplierId`,
          code: 'INVALID_REALLOCATION_TARGET',
          message: 'supplierId must be omitted when cancel is true',
        });
      }
      if (!cancel) {
        issues.push(...validateUuid(`assignments.${index}.supplierId`, assignment.supplierId));
      }

      if (typeof assignment.requestItemId === 'string' && (cancel || typeof assignment.supplierId === 'string')) {
        assignments.push({
          requestItemId: assignment.requestItemId,
          supplierId: typeof assignment.supplierId === 'string' ? assignment.supplierId : undefined,
          cancel,
        });
      }
    }
  }

  throwIfInvalid(issues);
  return {
    id,
    expectedVersion: body.expectedVersion as number,
    rejectedOrderId: body.rejectedOrderId as string,
    reason: reason!,
    assignments,
  };
}

function parseRejectBody(id: string, body: RejectBody): { id: string; expectedVersion: number; reason: string } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const reason = requiredReason(body.reason, issues);

  throwIfInvalid(issues);
  return { id, expectedVersion: body.expectedVersion as number, reason: reason! };
}

function requiredReason(value: unknown, issues: ValidationIssue[]): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 300) {
    issues.push({
      field: 'reason',
      code: 'INVALID_REASON',
      message: 'reason must be a non-empty string with 300 characters or fewer',
    });
    return undefined;
  }

  return value.trim();
}

function optionalPurchaseRequestStatus(value: unknown, issues: ValidationIssue[]): PurchaseRequestStatus | undefined {
  if (
    value === PurchaseRequestStatus.PENDING_FUNDS ||
    value === PurchaseRequestStatus.PENDING_PROCUREMENT ||
    value === PurchaseRequestStatus.CONFIRMED ||
    value === PurchaseRequestStatus.PARTIAL_PUSHED ||
    value === PurchaseRequestStatus.COMPLETED ||
    value === PurchaseRequestStatus.CANCELED
  ) {
    return value;
  }

  issues.push({
    field: 'status',
    code: 'INVALID_PURCHASE_REQUEST_STATUS',
    message: 'status is invalid',
  });
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
