import { ForbiddenException, SetMetadata } from '@nestjs/common';

export const ASSIGNED_STORE_ROLES = ['REGION_MANAGER', 'PURCHASE_FOLLOWER', 'REGION_FINANCE'] as const;
export const COMPANY_ROLES = ['ADMIN', 'PURCHASER', 'HQ_FINANCE'] as const;
export const MULTI_STORE_READY = 'multi-store-ready';
export const AllowAssignedStores = () => SetMetadata(MULTI_STORE_READY, true);

export type BusinessScope = { type?: string; storeId?: string; supplierId?: string; storeIds?: string[] };
export type ScopeUser = { roles: string[]; scope?: BusinessScope | null };

export function isCompanyUser(user: ScopeUser): boolean {
  return user.roles.some(role => (COMPANY_ROLES as readonly string[]).includes(role));
}

export function assignedStoreIds(scope?: BusinessScope | null): string[] | undefined {
  if (scope?.type !== 'MULTI_STORE') return undefined;
  if (!Array.isArray(scope.storeIds) || !scope.storeIds.length || scope.storeIds.some(id => typeof id !== 'string' || !id)) {
    throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: '请先分配可管理的门店' });
  }
  return [...new Set(scope.storeIds.map(id => id.toLowerCase()))].sort();
}

export function assertAssignedStore(scope: BusinessScope | null | undefined, storeId: string): void {
  const ids = assignedStoreIds(scope);
  if (ids && !ids.includes(storeId.toLowerCase())) {
    throw new ForbiddenException({ code: 'SCOPE_MISMATCH', message: '该门店不在账号授权范围内' });
  }
}

export function storeFilter(storeId?: string, storeIds?: string[]): string | { in: string[] } | undefined {
  if (storeIds) {
    if (storeId && !storeIds.includes(storeId.toLowerCase())) {
      throw new ForbiddenException({ code: 'SCOPE_MISMATCH', message: '该门店不在账号授权范围内' });
    }
    return { in: storeId ? [storeId.toLowerCase()] : storeIds };
  }
  return storeId;
}
