import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { PricingService, type PriceQuote } from './pricing.service.js';
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
};

@Controller()
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('ADMIN', 'PURCHASER')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post('price-changes')
  publishPrice(@Body() body: PriceChangeBody): Promise<PriceQuote> {
    return this.pricingService.publishPrice(parsePriceChangeBody(body));
  }

  @Get('price-scopes/:id/versions')
  listVersions(@Param('id') id: string): Promise<PriceQuote[]> {
    throwIfInvalid(validateUuid('id', id));
    return this.pricingService.listVersions(id);
  }
}

function parsePriceChangeBody(body: PriceChangeBody): {
  productId: string;
  supplierId: string;
  salesPrice: string;
  supplyPrice: string;
  effectiveAt: Date;
} {
  const issues: ValidationIssue[] = [
    ...validateUuid('productId', body.productId),
    ...validateUuid('supplierId', body.supplierId),
    ...validateDecimalString('salesPrice', body.salesPrice, 6),
    ...validateDecimalString('supplyPrice', body.supplyPrice, 6),
  ];
  const effectiveAt = parseEffectiveAt(body.effectiveAt, issues);

  throwIfInvalid(issues);

  return {
    productId: body.productId as string,
    supplierId: body.supplierId as string,
    salesPrice: body.salesPrice as string,
    supplyPrice: body.supplyPrice as string,
    effectiveAt: effectiveAt!,
  };
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
