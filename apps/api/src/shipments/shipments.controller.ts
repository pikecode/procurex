import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { type AuthenticatedSession } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CommandsService } from '../commands/commands.service.js';
import { getOrCreateTraceId } from '../common/request-context.js';
import { requireIdempotencyKey, throwIfInvalid } from '../common/request-contract.js';
import { ShipmentsService, type CreateReceiptInput, type ReceiptView } from './shipments.service.js';
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
};

@Controller('shipments')
@UseGuards(AuthGuard, RolesGuard)
export class ShipmentsController {
  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly commandsService: CommandsService,
  ) {}

  @Post(':id/receipts')
  @RequireRoles('ADMIN', 'STORE')
  async createReceipt(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Param('id') id: string,
    @Body() body: CreateReceiptBody,
  ): Promise<ReceiptView> {
    const input = parseCreateReceiptBody(id, body);
    const command = await this.commandsService.begin({
      actorUserId: auth.user.id,
      action: 'shipment.receipt.create',
      idempotencyKey: requireIdempotencyKey(request.headers),
      requestBody: { id, ...body } as never,
      traceId: getOrCreateTraceId(request),
    });

    if (command.state === 'replay' || command.state === 'failed') {
      return command.command.responseBody as ReceiptView;
    }

    const result = await this.shipmentsService.createReceipt(input.id, input.receipt);
    await this.commandsService.succeed({
      commandId: command.command.id,
      resourceType: 'Receipt',
      resourceId: result.id,
      responseBody: result as never,
    });

    return result;
  }
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

  throwIfInvalid(issues);
  return {
    id,
    receipt: {
      expectedOrderVersion: body.expectedOrderVersion as number,
      expectedReceiptRevision: body.expectedReceiptRevision as number,
      items,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
