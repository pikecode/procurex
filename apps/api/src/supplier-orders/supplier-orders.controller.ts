import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { type AuthenticatedSession } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CommandsService } from '../commands/commands.service.js';
import { getOrCreateTraceId } from '../common/request-context.js';
import { requireIdempotencyKey, throwIfInvalid } from '../common/request-contract.js';
import {
  type RejectSupplierOrderResult,
  type ShipmentPreviewInput,
  type ShipmentPreviewView,
  SupplierOrdersService,
  type ListSupplierOrdersInput,
  type SupplierOrderDetailView,
  type SupplierOrderSummaryView,
} from './supplier-orders.service.js';
import { SupplierOrderStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import {
  validateDecimalString,
  validateExpectedVersion,
  validateUuid,
  type ValidationIssue,
} from '../../../../packages/domain/src/validation.js';

type ListQuery = {
  storeId?: unknown;
  supplierId?: unknown;
  status?: unknown;
};

type RejectBody = {
  expectedVersion?: unknown;
  reason?: unknown;
};

type ShipmentPreviewBody = {
  expectedVersion?: unknown;
  items?: unknown;
  freight?: unknown;
  trackingNo?: unknown;
};

@Controller('supplier-orders')
@UseGuards(AuthGuard, RolesGuard)
export class SupplierOrdersController {
  constructor(
    private readonly supplierOrdersService: SupplierOrdersService,
    private readonly commandsService: CommandsService,
  ) {}

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

  @Post(':id/shipment-preview')
  @RequireRoles('ADMIN', 'SUPPLIER')
  shipmentPreview(@Param('id') id: string, @Body() body: ShipmentPreviewBody): Promise<ShipmentPreviewView> {
    const input = parseShipmentPreviewBody(id, body);
    return this.supplierOrdersService.shipmentPreview(input.id, input.expectedVersion, input.preview);
  }

  @Post(':id/reject')
  @RequireRoles('ADMIN', 'SUPPLIER')
  async reject(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: RejectBody,
  ): Promise<RejectSupplierOrderResult> {
    const input = parseRejectBody(id, body);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'supplier-order.reject',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as RejectSupplierOrderResult;
    }

    const result = await this.supplierOrdersService.reject(input.id, input.expectedVersion, input.reason);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'SupplierOrder',
      resourceId: result.supplierOrderId,
      responseBody: result as never,
    });

    return result;
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

function parseRejectBody(id: string, body: RejectBody): { id: string; expectedVersion: number; reason: string } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const reason = requiredReason(body.reason, issues);

  throwIfInvalid(issues);
  return { id, expectedVersion: body.expectedVersion as number, reason: reason! };
}

function parseShipmentPreviewBody(
  id: string,
  body: ShipmentPreviewBody,
): { id: string; expectedVersion: number; preview: ShipmentPreviewInput } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const items: ShipmentPreviewInput['items'] = [];

  if (!Array.isArray(body.items) || body.items.length === 0) {
    issues.push({ field: 'items', code: 'INVALID_ITEMS', message: 'items must be a non-empty array' });
  } else {
    const seen = new Set<string>();
    for (const [index, item] of body.items.entries()) {
      if (!isRecord(item)) {
        issues.push({ field: `items.${index}`, code: 'INVALID_ITEM', message: 'item must be an object' });
        continue;
      }
      issues.push(...validateUuid(`items.${index}.orderItemId`, item.orderItemId));
      issues.push(...validateDecimalString(`items.${index}.shipQuantity`, item.shipQuantity, 6));
      issues.push(...validateDecimalString(`items.${index}.permanentlyReduceQuantity`, item.permanentlyReduceQuantity, 6));
      if (typeof item.orderItemId === 'string') {
        if (seen.has(item.orderItemId)) {
          issues.push({ field: `items.${index}.orderItemId`, code: 'DUPLICATE_ITEM_ID', message: 'order item ids must not repeat' });
        }
        seen.add(item.orderItemId);
      }
      if (
        typeof item.orderItemId === 'string' &&
        typeof item.shipQuantity === 'string' &&
        typeof item.permanentlyReduceQuantity === 'string'
      ) {
        items.push({
          orderItemId: item.orderItemId,
          shipQuantity: item.shipQuantity,
          permanentlyReduceQuantity: item.permanentlyReduceQuantity,
        });
      }
    }
  }

  const freight = body.freight === undefined ? '0.00' : body.freight;
  issues.push(...validateDecimalString('freight', freight, 2));
  const trackingNo = optionalTrimmedString('trackingNo', body.trackingNo, issues);

  throwIfInvalid(issues);
  return {
    id,
    expectedVersion: body.expectedVersion as number,
    preview: {
      items,
      freight: freight as string,
      trackingNo,
    },
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
