import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { type AuthenticatedSession } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CommandsService } from '../commands/commands.service.js';
import { getOrCreateTraceId } from '../common/request-context.js';
import { requireIdempotencyKey, throwIfInvalid } from '../common/request-contract.js';
import { PaymentRecordDirection, PaymentRecordStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import {
  validateDecimalString,
  validateExpectedVersion,
  validateUuid,
  type ValidationIssue,
} from '../../../../packages/domain/src/validation.js';
import {
  type CreatePaymentRecordInput,
  type ListPaymentRecordsInput,
  type PaymentPreviewView,
  type PaymentRecordView,
  PaymentRecordsService,
} from './payment-records.service.js';

type PreviewBody = {
  settlementItemIds?: unknown;
};

type ListQuery = {
  direction?: unknown;
  status?: unknown;
  storeId?: unknown;
  supplierId?: unknown;
};

type CreateBody = {
  direction?: unknown;
  items?: unknown;
  businessDate?: unknown;
  remark?: unknown;
};

type ConfirmBody = {
  expectedVersion?: unknown;
};

type RejectBody = {
  expectedVersion?: unknown;
  reason?: unknown;
};

type CancelBody = {
  expectedVersion?: unknown;
  reason?: unknown;
};

@Controller('payment-records')
@UseGuards(AuthGuard, RolesGuard)
export class PaymentRecordsController {
  constructor(
    private readonly paymentRecordsService: PaymentRecordsService,
    private readonly commandsService: CommandsService,
  ) {}

  @Get()
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER')
  list(@Query() query: ListQuery, @Req() request: AuthenticatedRequest): Promise<PaymentRecordView[]> {
    return this.paymentRecordsService.list(parseListQuery(query), request.auth?.user.scope);
  }

  @Get(':id')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER')
  get(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<PaymentRecordView> {
    throwIfInvalid(validateUuid('id', id));
    return this.paymentRecordsService.get(id, request.auth?.user.scope);
  }

  @Post('preview')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  preview(@Body() body: PreviewBody, @Req() request: AuthenticatedRequest): Promise<PaymentPreviewView> {
    return this.paymentRecordsService.preview(parsePreviewBody(body), undefined, request.auth?.user.scope);
  }

  @Post()
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  async create(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Body() body: CreateBody,
  ): Promise<PaymentRecordView> {
    const input = parseCreateBody(body);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'payment-record.create',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: body as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as PaymentRecordView;
    }

    const result = await this.paymentRecordsService.create(input, auth.user.scope);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'PaymentRecord',
      resourceId: result.id,
      responseBody: result as never,
    });

    return result;
  }

  @Post(':id/confirm')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'SUPPLIER')
  async confirm(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: ConfirmBody,
  ): Promise<PaymentRecordView> {
    const input = parseConfirmBody(id, body);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'payment-record.confirm',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as PaymentRecordView;
    }

    const result = await this.paymentRecordsService.confirm(input.id, input.expectedVersion, auth.user.scope);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'PaymentRecord',
      resourceId: result.id,
      responseBody: result as never,
    });

    return result;
  }

  @Post(':id/reject')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'SUPPLIER')
  async reject(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: RejectBody,
  ): Promise<PaymentRecordView> {
    const input = parseRejectBody(id, body);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'payment-record.reject',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as PaymentRecordView;
    }

    const result = await this.paymentRecordsService.reject(input.id, input.expectedVersion, input.reason, auth.user.scope);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'PaymentRecord',
      resourceId: result.id,
      responseBody: result as never,
    });

    return result;
  }

  @Post(':id/cancel')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  async cancel(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: CancelBody,
  ): Promise<PaymentRecordView> {
    const input = parseCancelBody(id, body);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'payment-record.cancel',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as PaymentRecordView;
    }

    const result = await this.paymentRecordsService.cancel(input.id, input.expectedVersion, input.reason, auth.user.scope);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'PaymentRecord',
      resourceId: result.id,
      responseBody: result as never,
    });

    return result;
  }
}

function parseListQuery(query: ListQuery): ListPaymentRecordsInput {
  const issues: ValidationIssue[] = [];
  let direction: PaymentRecordDirection | undefined;
  let status: PaymentRecordStatus | undefined;
  let storeId: string | undefined;
  let supplierId: string | undefined;

  if (query.direction !== undefined) {
    direction = optionalDirection(query.direction, issues);
  }
  if (query.status !== undefined) {
    status = optionalStatus(query.status, issues);
  }
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

  throwIfInvalid(issues);
  return { direction, status, storeId, supplierId };
}

function parsePreviewBody(body: PreviewBody): string[] {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(body.settlementItemIds) || body.settlementItemIds.length === 0) {
    issues.push({
      field: 'settlementItemIds',
      code: 'INVALID_SETTLEMENT_ITEM_IDS',
      message: 'settlementItemIds must be a non-empty array',
    });
  }

  const values = Array.isArray(body.settlementItemIds) ? body.settlementItemIds : [];
  const settlementItemIds = values.flatMap((value, index) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      issues.push({
        field: `settlementItemIds.${index}`,
        code: 'INVALID_SETTLEMENT_ITEM_ID',
        message: 'settlementItemId must be a non-empty string',
      });
      return [];
    }
    return [value];
  });

  throwIfInvalid(issues);
  return settlementItemIds;
}

function parseCreateBody(body: CreateBody): CreatePaymentRecordInput {
  const issues: ValidationIssue[] = [];
  const direction = requiredDirection(body.direction, issues);
  const items: CreatePaymentRecordInput['items'] = [];

  if (!Array.isArray(body.items) || body.items.length === 0) {
    issues.push({ field: 'items', code: 'INVALID_PAYMENT_ITEMS', message: 'items must be a non-empty array' });
  } else {
    const seen = new Set<string>();
    for (const [index, item] of body.items.entries()) {
      if (!isRecord(item)) {
        issues.push({ field: `items.${index}`, code: 'INVALID_PAYMENT_ITEM', message: 'item must be an object' });
        continue;
      }
      const settlementItemId = optionalNonEmptyString(`items.${index}.settlementItemId`, item.settlementItemId, issues);
      issues.push(...validateExpectedVersion(`items.${index}.expectedVersion`, item.expectedVersion));
      issues.push(...validateDecimalString(`items.${index}.expectedAmount`, item.expectedAmount, 2));
      if (settlementItemId) {
        if (seen.has(settlementItemId)) {
          issues.push({
            field: `items.${index}.settlementItemId`,
            code: 'DUPLICATE_SETTLEMENT_ITEM_ID',
            message: 'settlement item ids must not repeat',
          });
        }
        seen.add(settlementItemId);
      }
      if (settlementItemId && typeof item.expectedVersion === 'number' && typeof item.expectedAmount === 'string') {
        items.push({
          settlementItemId,
          expectedVersion: item.expectedVersion,
          expectedAmount: item.expectedAmount,
        });
      }
    }
  }

  const businessDate = requiredDate('businessDate', body.businessDate, issues);
  const remark = optionalString('remark', body.remark, issues);

  throwIfInvalid(issues);
  return {
    direction: direction!,
    items,
    businessDate: businessDate!,
    remark,
  };
}

function parseConfirmBody(id: string, body: ConfirmBody): { id: string; expectedVersion: number } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];

  throwIfInvalid(issues);
  return { id, expectedVersion: body.expectedVersion as number };
}

function parseRejectBody(id: string, body: RejectBody): { id: string; expectedVersion: number; reason: string } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const reason = optionalNonEmptyString('reason', body.reason, issues);

  throwIfInvalid(issues);
  return { id, expectedVersion: body.expectedVersion as number, reason: reason! };
}

function parseCancelBody(id: string, body: CancelBody): { id: string; expectedVersion: number; reason: string } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const reason = optionalNonEmptyString('reason', body.reason, issues);

  throwIfInvalid(issues);
  return { id, expectedVersion: body.expectedVersion as number, reason: reason! };
}

function requiredDirection(value: unknown, issues: ValidationIssue[]): PaymentRecordDirection | undefined {
  const direction = optionalDirection(value, issues);
  if (direction) {
    return direction;
  }
  return undefined;
}

function optionalDirection(value: unknown, issues: ValidationIssue[]): PaymentRecordDirection | undefined {
  if (value === PaymentRecordDirection.STORE_TO_COMPANY || value === PaymentRecordDirection.COMPANY_TO_SUPPLIER || value === PaymentRecordDirection.STORE_TO_SUPPLIER) {
    return value;
  }
  issues.push({
    field: 'direction',
    code: 'INVALID_PAYMENT_DIRECTION',
    message: 'direction must be STORE_TO_COMPANY, COMPANY_TO_SUPPLIER, or STORE_TO_SUPPLIER',
  });
  return undefined;
}

function optionalStatus(value: unknown, issues: ValidationIssue[]): PaymentRecordStatus | undefined {
  if (
    value === PaymentRecordStatus.PENDING ||
    value === PaymentRecordStatus.CONFIRMED ||
    value === PaymentRecordStatus.REJECTED ||
    value === PaymentRecordStatus.CANCELLED
  ) {
    return value;
  }
  issues.push({
    field: 'status',
    code: 'INVALID_PAYMENT_STATUS',
    message: 'status is invalid',
  });
  return undefined;
}

function optionalNonEmptyString(field: string, value: unknown, issues: ValidationIssue[]): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ field, code: 'REQUIRED_STRING', message: `${field} is required` });
    return undefined;
  }
  return value;
}

function optionalString(field: string, value: unknown, issues: ValidationIssue[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ field, code: 'INVALID_STRING', message: `${field} must be a non-empty string` });
    return undefined;
  }
  return value.trim();
}

function requiredDate(field: string, value: unknown, issues: ValidationIssue[]): Date | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    issues.push({ field, code: 'INVALID_DATE', message: `${field} must be YYYY-MM-DD` });
    return undefined;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    issues.push({ field, code: 'INVALID_DATE', message: `${field} is invalid` });
    return undefined;
  }
  return date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
