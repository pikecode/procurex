import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';

const costFields = new Set(['supplyGoodsAmount', 'supplyUnitPrice', 'supplyLineAmount', 'supplyPrice', 'supplyPriceSnapshot',
  'purchaseSupplyPrice', 'purchaseSupplyUnitPrice', 'previousSupplyPrice', 'newSupplyPrice', 'profit']);

export function storePriceView(value: unknown): unknown {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(storePriceView);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !costFields.has(key)).map(([key, item]) => [key, storePriceView(item)]));
  return value;
}

@Injectable()
export class StorePricePrivacyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const roles = context.switchToHttp().getRequest<AuthenticatedRequest>().auth!.user.roles;
    const store = roles.some(role => ['STORE', 'STORE_FINANCE'].includes(role))
      && !roles.some(role => ['ADMIN', 'PURCHASER', 'HQ_FINANCE'].includes(role));
    return next.handle().pipe(map(value => store ? storePriceView(value) : value));
  }
}
