type AccessUser = { roles: string[]; scope?: { type?: string } | null };

const companyPages = ['/stores', '/store-groups', '/suppliers', '/products', '/categories', '/brands', '/units', '/purchase-requests', '/supplier-orders', '/reports'];
const financePages = ['/store-finance', '/finance', '/settlement-differences', '/collection-accounts'];
const storePages = ['/store-orders', '/store-finance', '/finance', '/settlement-differences', '/reports'];
const supplierPages = ['/supplier-orders', '/discrepancies', '/finance', '/settlement-differences', '/reports'];

export function allowedPages(user: AccessUser): string[] {
  if (user.scope?.type === 'SUPPLIER') return user.roles.includes('SUPPLIER') ? supplierPages : [];
  if (['STORE', 'STORE_FINANCE'].includes(user.scope?.type || '')) return user.roles.some(role => ['STORE', 'STORE_FINANCE'].includes(role)) ? storePages : [];
  if (user.roles.includes('ADMIN')) return [...companyPages, ...financePages, '/templates', '/discrepancies', '/users', '/commands'];
  const pages = new Set<string>();
  if (user.roles.includes('PURCHASER')) [...companyPages, '/templates'].forEach(page => pages.add(page));
  if (user.roles.includes('HQ_FINANCE')) [...companyPages, ...financePages].forEach(page => pages.add(page));
  return [...pages];
}

export function canAccessPage(user: AccessUser, path: string): boolean {
  const pages = allowedPages(user);
  return path === '/' ? pages.length > 0 : pages.includes(path === '/prices' ? '/products' : path);
}
