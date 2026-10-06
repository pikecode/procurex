const groups = [
  { id: 'operations', label: '业务处理', icon: 'clipboard-list', routes: ['purchaser', 'supplier', 'store'] },
  { id: 'directory', label: '基础资料', icon: 'building-2', routes: ['stores', 'suppliers'] },
  { id: 'catalog', label: '商品配置', icon: 'package', routes: ['products', 'categories', 'brands', 'units', 'templates', 'prices', 'supplier-products'] },
  { id: 'finance', label: '财务管理', icon: 'wallet', routes: ['finance'] },
  { id: 'account', label: '账号资料', icon: 'user-round', routes: ['profile'] },
];

export function navigationGroups(routes) {
  const allowed = new Set(routes);
  return groups.map(group => ({ ...group, routes: group.routes.filter(route => allowed.has(route)) }))
    .filter(group => group.routes.length);
}
