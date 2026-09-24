import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
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
import { PurchaseRequestsService, type PurchaseRequestView } from './purchase-requests.service.js';
import { validateDecimalString, validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';

type PreviewBody = {
  storeId?: unknown;
  items?: unknown;
};

@Controller('purchase-requests')
@UseGuards(AuthGuard, RolesGuard)
export class PurchaseRequestsController {
  constructor(
    private readonly previewService: PurchaseRequestPreviewService,
    private readonly purchaseRequestsService: PurchaseRequestsService,
    private readonly commandsService: CommandsService,
  ) {}

  @Post('preview')
  @RequireRoles('ADMIN', 'PURCHASER', 'STORE')
  preview(@Body() body: PreviewBody): Promise<PurchaseRequestPreview> {
    return this.previewService.preview(parsePreviewBody(body));
  }

  @Post()
  @RequireRoles('ADMIN', 'PURCHASER', 'STORE')
  async create(
    @Req() request: AuthenticatedRequest,
    @CurrentAuth() auth: AuthenticatedSession,
    @Body() body: PreviewBody,
  ): Promise<PurchaseRequestView> {
    const input = parsePreviewBody(body);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
