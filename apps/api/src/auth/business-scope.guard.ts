import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard.js';

@Injectable()
export class BusinessScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().auth!.user;
    if (user.roles.some(role => ['ADMIN', 'PURCHASER', 'HQ_FINANCE'].includes(role))) return true;
    const supplier = user.roles.includes('SUPPLIER');
    const store = user.roles.some(role => ['STORE', 'STORE_FINANCE'].includes(role));
    if ((supplier && (user.scope?.type !== 'SUPPLIER' || !user.scope.supplierId))
      || (store && (!['STORE', 'STORE_FINANCE'].includes(user.scope?.type ?? '') || !user.scope?.storeId))) {
      throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Business account scope is not configured' });
    }
    return true;
  }
}
