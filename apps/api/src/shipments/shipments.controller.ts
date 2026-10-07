import { StorePricePrivacyInterceptor } from '../common/store-price-privacy.interceptor.js';
import { UseInterceptors } from '@nestjs/common';
import { Body, ConflictException, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { BusinessScopeGuard } from '../auth/business-scope.guard.js';
import { type AuthenticatedSession } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CommandsService } from '../commands/commands.service.js';
import { getOrCreateTraceId } from '../common/request-context.js';
import { requireIdempotencyKey, throwIfInvalid } from '../common/request-contract.js';
import { ShipmentsService, type CreateReceiptInput, type ReceiptView, type ShipmentDetailView } from './shipments.service.js';
import {
  validateDecimalString,
  validateExpectedVersion,
  validateUuid,
  type ValidationIssue,
} from '../../../../packages/domain/src/validation.js';

type CreateReceiptBody = {
  expectedOrderVersion?: unknown;
  expectedReceiptRevision?: unknown;
  items?: unknown;
  evidenceFileIds?: unknown;
};

@Controller('shipments')
@UseGuards(AuthGuard, RolesGuard, BusinessScopeGuard)
@UseInterceptors(StorePricePrivacyInterceptor)
export class ShipmentsController {
  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly commandsService: CommandsService,
    private readonly audit: AuditService,
  ) {}

  @Get(':id')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  async get(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<ShipmentDetailView> {
    throwIfInvalid(validateUuid('id', id));
    return this.shipmentsService.get(id, storeScope(request));
  }

  @Post(':id/receipts')
  @RequireRoles('ADMIN', 'STORE')
  async createReceipt(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: CreateReceiptBody,
  ): Promise<ReceiptView> {
    const input = parseCreateReceiptBody(id, body);
    const traceId = getOrCreateTraceId(request);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'shipment.receipt.create',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId,
    });

    if (command.state === 'replay') {
      if (storeScope(request)) await this.shipmentsService.get(input.id, storeScope(request));
      return command.command.responseBody as ReceiptView;
    }
    if (command.state === 'processing') throw new ConflictException({ code: 'COMMAND_PROCESSING', message: 'Receipt submission is still processing; check again with the same idempotency key' });

    return this.commandsService.performAtomic(command, async tx => {
      const result = await this.shipmentsService.createReceipt(input.id, input.receipt, storeScope(request), auth.user.id, tx);
      await this.commandsService.succeed({
        commandId: command.command.id,
        resourceType: 'Receipt',
        resourceId: result.id,
        responseBody: result as never,
      }, tx);
      await this.audit.record({
        actorUserId: auth.user.id,
        activeScope: auditScope(auth),
        action: 'shipment.receipt.create',
        entityType: 'Receipt',
        entityId: result.id,
        traceId,
        after: {
          shipmentId: result.shipmentId,
          receiptNo: result.receiptNo,
          revision: result.revision,
          itemCount: result.items.length,
          evidenceFileIds: result.evidenceFiles.map(file => file.id),
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

function auditScope(auth: AuthenticatedSession) {
  return { roles: auth.user.roles, ...(auth.user.scope ? { scope: auth.user.scope } : {}) };
}

function parseCreateReceiptBody(id: string, body: CreateReceiptBody): { id: string; receipt: CreateReceiptInput } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedOrderVersion', body.expectedOrderVersion),
  ];
  if (typeof body.expectedReceiptRevision !== 'number' || !Number.isInteger(body.expectedReceiptRevision) || body.expectedReceiptRevision < 0) {
    issues.push({
      field: 'expectedReceiptRevision',
      code: 'INVALID_EXPECTED_RECEIPT_REVISION',
      message: 'expectedReceiptRevision must be an integer greater than or equal to 0',
    });
  }

  const items: CreateReceiptInput['items'] = [];
  if (!Array.isArray(body.items) || body.items.length === 0) {
    issues.push({ field: 'items', code: 'INVALID_ITEMS', message: 'items must be a non-empty array' });
  } else {
    const seen = new Set<string>();
    for (const [index, item] of body.items.entries()) {
      if (!isRecord(item)) {
        issues.push({ field: `items.${index}`, code: 'INVALID_ITEM', message: 'item must be an object' });
        continue;
      }
      issues.push(...validateUuid(`items.${index}.shipmentItemId`, item.shipmentItemId));
      issues.push(...validateDecimalString(`items.${index}.receivedQuantity`, item.receivedQuantity, 6));
      if (typeof item.shipmentItemId === 'string') {
        if (seen.has(item.shipmentItemId)) {
          issues.push({
            field: `items.${index}.shipmentItemId`,
            code: 'DUPLICATE_SHIPMENT_ITEM_ID',
            message: 'shipment item ids must not repeat',
          });
        }
        seen.add(item.shipmentItemId);
      }
      if (typeof item.shipmentItemId === 'string' && typeof item.receivedQuantity === 'string') {
        items.push({ shipmentItemId: item.shipmentItemId, receivedQuantity: item.receivedQuantity });
      }
    }
  }

  const evidenceFileIds: string[] | undefined = body.evidenceFileIds === undefined ? undefined : [];
  if (body.evidenceFileIds !== undefined) {
    if (!Array.isArray(body.evidenceFileIds) || body.evidenceFileIds.length < 1 || body.evidenceFileIds.length > 6) {
      issues.push({ field: 'evidenceFileIds', code: 'INVALID_EVIDENCE', message: 'Provide one to six receipt images' });
    } else {
      for (const [index, fileId] of body.evidenceFileIds.entries()) {
        issues.push(...validateUuid(`evidenceFileIds.${index}`, fileId));
        if (typeof fileId === 'string') evidenceFileIds!.push(fileId);
      }
      if (new Set(evidenceFileIds).size !== evidenceFileIds!.length) issues.push({ field: 'evidenceFileIds', code: 'DUPLICATE_EVIDENCE', message: 'Receipt images must not repeat' });
    }
  }
  throwIfInvalid(issues);
  return {
    id,
    receipt: {
      expectedOrderVersion: body.expectedOrderVersion as number,
      expectedReceiptRevision: body.expectedReceiptRevision as number,
      items,
      evidenceFileIds,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
