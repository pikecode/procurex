import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
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
};

type ReallocateBody = {
  expectedVersion?: unknown;
  rejectedOrderId?: unknown;
  assignments?: unknown;
  reason?: unknown;
};

@Controller('purchase-requests')
@UseGuards(AuthGuard, RolesGuard)
export class PurchaseRequestsController {
  constructor(
    private readonly previewService: PurchaseRequestPreviewService,
    private readonly purchaseRequestsService: PurchaseRequestsService,
    private readonly commandsService: CommandsService,
  ) {}

  @Get()
  @RequireRoles('ADMIN', 'PURCHASER', 'STORE', 'STORE_FINANCE')
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

  @Get(':id')
  @RequireRoles('ADMIN', 'PURCHASER', 'STORE', 'STORE_FINANCE')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<PurchaseRequestDetailView> {
    throwIfInvalid(validateUuid('id', id));
    const scope = storeScope(request);
    if (scope && !scope.storeId) throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Store scope is not configured' });
    return this.purchaseRequestsService.get(id, scope);
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
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'purchase-request.create',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: body as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as PurchaseRequestView;
    }

    const result = await this.purchaseRequestsService.create(input);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'PurchaseRequest',
      resourceId: result.id,
      responseBody: result as never,
    });

    return result;
  }

  @Patch(':id/items')
  @RequireRoles('ADMIN', 'PURCHASER')
  replaceItems(@Param('id') id: string, @Body() body: PatchItemsBody): Promise<PurchaseRequestDetailView> {
    const input = parsePatchItemsBody(id, body);
    return this.purchaseRequestsService.replaceItems(input.id, input.expectedVersion, input.items);
  }

  @Post(':id/reassign-preview')
  @RequireRoles('ADMIN', 'PURCHASER')
  reassignPreview(@Param('id') id: string, @Body() body: ReassignBody): Promise<ReassignPurchaseRequestPreview> {
    const input = parseReassignBody(id, body);
    return this.purchaseRequestsService.reassignPreview(input.id, input.expectedVersion, input.itemIds, input.supplierId);
  }

  @Post(':id/assign')
  @RequireRoles('ADMIN', 'PURCHASER')
  assign(@Param('id') id: string, @Body() body: ReassignBody): Promise<PurchaseRequestDetailView> {
    const input = parseReassignBody(id, body);
    return this.purchaseRequestsService.assign(input.id, input.expectedVersion, input.itemIds, input.supplierId);
  }

  @Post(':id/reallocate')
  @RequireRoles('ADMIN', 'PURCHASER')
  reallocate(@Param('id') id: string, @Body() body: ReallocateBody): Promise<PurchaseRequestDetailView> {
    const input = parseReallocateBody(id, body);
    return this.purchaseRequestsService.reallocate(input.id, input.expectedVersion, input.rejectedOrderId, input.assignments);
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
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'purchase-request.confirm',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as ConfirmPurchaseRequestResult;
    }

    const result = await this.purchaseRequestsService.confirm(input.id, input.expectedVersion);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'PurchaseRequest',
      resourceId: result.requestId,
      responseBody: result as never,
    });

    return result;
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
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'purchase-request.reject',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as RejectPurchaseRequestResult;
    }

    const result = await this.purchaseRequestsService.reject(input.id, input.expectedVersion, input.reason);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'PurchaseRequest',
      resourceId: result.requestId,
      responseBody: result as never,
    });

    return result;
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

function parsePreviewBody(body: PreviewBody): { storeId: string; items: PreviewItemInput[] } {
  const issues: ValidationIssue[] = [...validateUuid('storeId', body.storeId)];
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
      if (typeof item.productId === 'string' && typeof item.quantity === 'string') {
        items.push({ productId: item.productId, quantity: item.quantity });
      }
    }
  }

  throwIfInvalid(issues);
  return { storeId: body.storeId as string, items };
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
      if (typeof item.productId === 'string' && typeof item.supplierId === 'string' && typeof item.quantity === 'string') {
        items.push({ productId: item.productId, supplierId: item.supplierId, quantity: item.quantity });
      }
    }
  }

  throwIfInvalid(issues);
  return { id, expectedVersion: body.expectedVersion as number, reason: reason!, items };
}

function parseReassignBody(
  id: string,
  body: ReassignBody,
): { id: string; expectedVersion: number; itemIds: string[]; supplierId: string } {
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

  throwIfInvalid(issues);
  return { id, expectedVersion: body.expectedVersion as number, itemIds, supplierId: body.supplierId as string };
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
