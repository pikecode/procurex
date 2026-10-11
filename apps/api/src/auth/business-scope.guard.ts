import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard.js';
import { Reflector } from '@nestjs/core';
import { assignedStoreIds, ASSIGNED_STORE_ROLES, MULTI_STORE_READY } from './store-scope.js';

@Injectable()
export class BusinessScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().auth!.user;
    if (user.roles.some(role => ['ADMIN', 'PURCHASER', 'HQ_FINANCE'].includes(role))) return true;
    if (user.roles.some(role => (ASSIGNED_STORE_ROLES as readonly string[]).includes(role))) {
      if (user.scope?.type !== 'MULTI_STORE') throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: '请先分配可管理的门店' });
      assignedStoreIds(user.scope);
      // Only explicitly migrated handlers may receive multi-store accounts.
      if (!this.reflector.getAllAndOverride<boolean>(MULTI_STORE_READY, [context.getHandler(), context.getClass()])) {
        throw new ForbiddenException({ code: 'ROLE_SCOPE_UNSUPPORTED', message: '该功能尚未开放多门店授权访问' });
      }
      return true;
    }
    const supplier = user.roles.includes('SUPPLIER');
    const store = user.roles.some(role => ['STORE', 'STORE_FINANCE'].includes(role));
    // New roles must opt into a scope policy before accessing business records.
    if (!supplier && !store) {
      throw new ForbiddenException({ code: 'ROLE_SCOPE_UNSUPPORTED', message: 'Business account role is not supported' });
    }
    if ((supplier && (user.scope?.type !== 'SUPPLIER' || !user.scope.supplierId))
      || (store && (!['STORE', 'STORE_FINANCE'].includes(user.scope?.type ?? '') || !user.scope?.storeId))) {
      throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Business account scope is not configured' });
    }
    return true;
  }
}
