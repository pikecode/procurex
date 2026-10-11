import type { User } from './api';

export function billingAccess(user: User) {
  const roles = user.roles;
  const multi = user.scope?.type === 'MULTI_STORE';
  const scoped = ['STORE', 'STORE_FINANCE'].includes(user.scope?.type || '');
  const supplier = user.scope?.type === 'SUPPLIER';
  const central = !multi && !scoped && !supplier && roles.some(role => ['ADMIN', 'HQ_FINANCE'].includes(role));
  const purchaser = !central && !multi && !scoped && !supplier && roles.includes('PURCHASER');
  const allowed = multi ? Boolean(user.scope?.storeIds?.length && roles.some(role => ['REGION_MANAGER', 'REGION_FINANCE', 'PURCHASE_FOLLOWER'].includes(role)))
    : scoped ? Boolean(user.scope?.storeId && roles.some(role => ['STORE', 'STORE_FINANCE'].includes(role)))
    : supplier ? Boolean(user.scope?.supplierId && roles.includes('SUPPLIER')) : central || purchaser;
  const readonly = multi || !central && purchaser || scoped && !roles.includes('STORE');
  const tabs = scoped ? ['store', 'direct', 'payments'] : multi || purchaser ? ['store', 'supplier-store', 'direct']
    : supplier ? ['supplier', 'supplier-store', 'direct', 'payments'] : ['supplier', 'supplier-store', 'store', 'direct', 'payments'];
  return { allowed, multi, scoped, supplier, readonly, tabs };
}

export function billingRowInScope(user: User, row: { storeId?: string | null; supplierId?: string | null; direction?: string }) {
  const access = billingAccess(user);
  if (!access.allowed) return false;
  if (access.multi) return Boolean(row.storeId && user.scope?.storeIds?.includes(row.storeId));
  if (access.supplier) return row.supplierId === user.scope?.supplierId && (!row.direction || ['COMPANY_TO_SUPPLIER', 'STORE_TO_SUPPLIER'].includes(row.direction));
  if (access.scoped) return row.storeId === user.scope?.storeId && (!row.direction || ['STORE_TO_COMPANY', 'STORE_TO_SUPPLIER'].includes(row.direction));
  return true;
}
