import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { PricingService, type PriceImpactPreview, type PriceQuote } from './pricing.service.js';
import {
  validateDecimalString,
  validateUuid,
  type ValidationIssue,
} from '../../../../packages/domain/src/validation.js';

type PriceChangeBody = {
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
  constructor(private readonly pricingService: PricingService) {}

  @Post('price-changes')
  publishPrice(@Body() body: PriceChangeBody): Promise<PriceQuote> {
    const input = parsePriceChangeBody(body);
    return this.pricingService.publishPrice({ ...input, reason: input.reason! });
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
}

function parsePriceChangeBody(body: PriceChangeBody, requireReason = true): {
  productId: string;
  supplierId: string;
  salesPrice: string;
  supplyPrice: string;
  effectiveAt: Date;
  reason?: string;
} {
  const issues: ValidationIssue[] = [
    ...validateUuid('productId', body.productId),
    ...validateUuid('supplierId', body.supplierId),
    ...validateDecimalString('salesPrice', body.salesPrice, 6),
    ...validateDecimalString('supplyPrice', body.supplyPrice, 6),
  ];
  const effectiveAt = parseEffectiveAt(body.effectiveAt, issues);
  const reason = requireReason ? requiredReason(body.reason, issues) : undefined;

  throwIfInvalid(issues);

  return {
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
