import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import { CommandsService } from '../commands/commands.service.js';
import { getOrCreateTraceId } from '../common/request-context.js';
import { requireIdempotencyKey } from '../common/request-contract.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { PricingService, type PriceChangeAdjustmentView, type PriceChangeRunView, type PriceImpactPreview, type PriceQuote } from './pricing.service.js';
import {
  validateDecimalString,
  validateUuid,
  type ValidationIssue,
} from '../../../../packages/domain/src/validation.js';

type PriceChangeBody = {
  templateId?: unknown;
  productId?: unknown;
  supplierId?: unknown;
  salesPrice?: unknown;
  supplyPrice?: unknown;
  effectiveAt?: unknown;
  reason?: unknown;
};

@Controller()
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('ADMIN', 'PURCHASER')
export class PricingController {
  constructor(private readonly pricingService: PricingService, private readonly commands: CommandsService, private readonly audit: AuditService, private readonly database: DatabaseService) {}

  @Post('price-changes')
  async publishPrice(@Body() body: PriceChangeBody, @Req() request: AuthenticatedRequest): Promise<PriceQuote> {
    const input = parsePriceChangeBody(body);
    const traceId = getOrCreateTraceId(request);
    // Legacy calls remain compatible and audited, but have no durable command identity.
    if (request.headers['idempotency-key'] === undefined) return this.database.client.$transaction(async tx => {
      const result = await this.pricingService.publishPrice({ ...input, reason: input.reason! }, tx);
      await this.audit.record({ actorUserId: request.auth!.user.id,
        activeScope: { roles: request.auth!.user.roles, ...(request.auth!.user.scope ? { scope: request.auth!.user.scope } : {}) },
        action: 'price.publish', entityType: 'PriceVersion', entityId: result.versionId, traceId, reason: input.reason,
        after: { ...result, submissionMode: 'LEGACY_HEADERLESS' } }, tx);
      return result;
    });
    const command = await this.commands.begin({ actorUserId: request.auth!.user.id, action: 'price.publish',
      idempotencyKey: requireIdempotencyKey(request.headers), requestBody: body as never, traceId });
    return this.commands.performAtomic(command, async tx => {
      const result = await this.pricingService.publishPrice({ ...input, reason: input.reason! }, tx);
      await this.commands.succeed({ commandId: command.command.id, resourceType: 'PriceVersion', resourceId: result.versionId, responseBody: result }, tx);
      await this.audit.record({ actorUserId: request.auth!.user.id,
        activeScope: { roles: request.auth!.user.roles, ...(request.auth!.user.scope ? { scope: request.auth!.user.scope } : {}) },
        action: 'price.publish', entityType: 'PriceVersion', entityId: result.versionId, traceId, reason: input.reason,
        after: { ...result },
      }, tx);
      return result;
    });
  }

  @Post('prices/quote')
  quotePrice(@Body() body: PriceChangeBody): Promise<PriceQuote> {
    const issues: ValidationIssue[] = [...validateUuid('productId', body.productId), ...validateUuid('supplierId', body.supplierId),
      ...(body.templateId === undefined ? [] : validateUuid('templateId', body.templateId))];
    const effectiveAt = body.effectiveAt === undefined ? new Date() : parseEffectiveAt(body.effectiveAt, issues);
    throwIfInvalid(issues);
    return this.pricingService.quotePrice({ productId: body.productId as string, supplierId: body.supplierId as string,
      templateId: typeof body.templateId === 'string' ? body.templateId.toLowerCase() : undefined, effectiveAt: effectiveAt! });
  }

  @Post('prices/impact-preview')
  previewImpact(@Body() body: PriceChangeBody): Promise<PriceImpactPreview> {
    const { reason: _reason, ...input } = parsePriceChangeBody(body, false);
    return this.pricingService.previewImpact(input);
  }

  @Get('price-scopes/:id/versions')
  listVersions(@Param('id') id: string): Promise<PriceQuote[]> {
    throwIfInvalid(validateUuid('id', id));
    return this.pricingService.listVersions(id);
  }

  @Get('jobs/:id')
  getRun(@Param('id') id: string): Promise<PriceChangeRunView> {
    throwIfInvalid(validateUuid('id', id));
    return this.pricingService.getRun(id);
  }

  @Post('jobs/:id/process')
  async processRun(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<PriceChangeRunView> {
    throwIfInvalid(validateUuid('id', id));
    const traceId = getOrCreateTraceId(request);
    if (request.headers['idempotency-key'] === undefined) return this.database.client.$transaction(async tx => {
      const result = await this.pricingService.processRun(id, tx);
      await this.audit.record({ actorUserId: request.auth!.user.id,
        activeScope: { roles: request.auth!.user.roles, ...(request.auth!.user.scope ? { scope: request.auth!.user.scope } : {}) },
        action: 'price.process', entityType: 'PriceChangeRun', entityId: id, traceId,
        after: { ...result, submissionMode: 'LEGACY_HEADERLESS' } }, tx);
      return result;
    });
    const command = await this.commands.begin({ actorUserId: request.auth!.user.id, action: 'price.process',
      idempotencyKey: requireIdempotencyKey(request.headers), requestBody: { id }, traceId,
      resourceType: 'PriceChangeRun', resourceId: id, atomicPriceExecution: true });
    return this.commands.performAtomic(command, async tx => {
      const result = await this.pricingService.processRun(id, tx);
      await this.commands.succeed({ commandId: command.command.id, resourceType: 'PriceChangeRun', resourceId: id, responseBody: result }, tx);
      await this.audit.record({ actorUserId: request.auth!.user.id,
        activeScope: { roles: request.auth!.user.roles, ...(request.auth!.user.scope ? { scope: request.auth!.user.scope } : {}) },
        action: 'price.process', entityType: 'PriceChangeRun', entityId: id, traceId, after: { ...result },
      }, tx);
      return result;
    });
  }

  @Get('jobs/:id/adjustments')
  listAdjustments(@Param('id') id: string): Promise<PriceChangeAdjustmentView[]> {
    throwIfInvalid(validateUuid('id', id));
    return this.pricingService.listAdjustments(id);
  }

  @Get('jobs/:id/submissions')
  async listSubmissions(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    throwIfInvalid(validateUuid('id', id));
    await this.pricingService.getRun(id);
    return this.commands.listDiagnostics({ resourceType: 'PriceChangeRun', resourceId: id, action: 'price.process', limit: 100,
      ...(request.auth!.user.roles.includes('ADMIN') ? {} : { actorUserId: request.auth!.user.id }) });
  }
}

function parsePriceChangeBody(body: PriceChangeBody, requireReason = true): {
  templateId?: string;
  productId: string;
  supplierId: string;
  salesPrice: string;
  supplyPrice: string;
  effectiveAt: Date;
  reason?: string;
} {
  const issues: ValidationIssue[] = [
    ...(body.templateId === undefined ? [] : validateUuid('templateId', body.templateId)),
    ...validateUuid('productId', body.productId),
    ...validateUuid('supplierId', body.supplierId),
    ...validateDecimalString('salesPrice', body.salesPrice, 6),
    ...validateDecimalString('supplyPrice', body.supplyPrice, 6),
  ];
  const effectiveAt = parseEffectiveAt(body.effectiveAt, issues);
  for (const field of ['salesPrice', 'supplyPrice'] as const) {
    if (!validateDecimalString(field, body[field], 6).length && new Decimal(body[field] as string).gte('100000000000000')) issues.push({ field, code: 'DECIMAL_PRECISION_EXCEEDED', message: 'Price exceeds Decimal(20,6)' });
  }
  const reason = requireReason ? requiredReason(body.reason, issues) : undefined;

  throwIfInvalid(issues);

  return {
    templateId: typeof body.templateId === 'string' ? body.templateId.toLowerCase() : undefined,
    productId: body.productId as string,
    supplierId: body.supplierId as string,
    salesPrice: body.salesPrice as string,
    supplyPrice: body.supplyPrice as string,
    effectiveAt: effectiveAt!,
    reason,
  };
}

function requiredReason(value: unknown, issues: ValidationIssue[]): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 500) return value.trim();
  issues.push({ field: 'reason', code: 'INVALID_REASON', message: 'reason must contain 1 to 500 characters' });
  return undefined;
}

function parseEffectiveAt(value: unknown, issues: ValidationIssue[]): Date | undefined {
  if (typeof value !== 'string') {
    issues.push({ field: 'effectiveAt', code: 'INVALID_TIMESTAMP', message: 'effectiveAt must be an ISO timestamp string' });
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    issues.push({ field: 'effectiveAt', code: 'INVALID_TIMESTAMP', message: 'effectiveAt must be a valid timestamp' });
    return undefined;
  }

  return parsed;
}
