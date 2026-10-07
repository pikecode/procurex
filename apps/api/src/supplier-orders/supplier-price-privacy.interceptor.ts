import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';

const companyPriceFields = new Set(['salesGoodsAmount', 'salesUnitPrice', 'salesLineAmount', 'purchaseSalesUnitPrice', 'salesPriceVersionId']);
export function supplierPriceView(value: unknown): unknown {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(supplierPriceView);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !companyPriceFields.has(key)).map(([key, item]) => [key, supplierPriceView(item)]));
  return value;
}
@Injectable()
export class SupplierPricePrivacyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const roles = context.switchToHttp().getRequest<AuthenticatedRequest>().auth!.user.roles;
    const supplier = roles.includes('SUPPLIER') && !roles.some(role => ['ADMIN', 'PURCHASER', 'HQ_FINANCE'].includes(role));
    return next.handle().pipe(map(value => supplier ? supplierPriceView(value) : value));
  }
}
