import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { type ValidationIssue } from '../../../../packages/domain/src/validation.js';
import { type PaymentPreviewView, PaymentRecordsService } from './payment-records.service.js';

type PreviewBody = {
  settlementItemIds?: unknown;
};

@Controller('payment-records')
@UseGuards(AuthGuard, RolesGuard)
export class PaymentRecordsController {
  constructor(private readonly paymentRecordsService: PaymentRecordsService) {}

  @Post('preview')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  preview(@Body() body: PreviewBody): Promise<PaymentPreviewView> {
    return this.paymentRecordsService.preview(parsePreviewBody(body));
  }
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
