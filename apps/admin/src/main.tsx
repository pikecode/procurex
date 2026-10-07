import { lazy, StrictMode, Suspense, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Alert, App as AntApp, Button, ConfigProvider, Drawer, Form, Input, Menu, Result, Spin, Tooltip } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BarChart3, Building2, ChevronLeft, ExternalLink, Folders, Landmark, LogOut, Menu as MenuIcon, Package, Settings, ShoppingCart, SlidersHorizontal, Store as StoreIcon } from 'lucide-react';
import { clearSession, getSession, hasRole, login, logout, onExpired, restore, type User } from './lib/api';
import './styles.css';
import { Notifications } from './components/Notifications';

const Stores = lazy(() => import('./pages/Stores'));
const Directories = lazy(() => import('./pages/Directories'));
const CatalogRegistries = lazy(() => import('./pages/CatalogRegistries'));
const Products = lazy(() => import('./pages/Products'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Templates = lazy(() => import('./pages/Templates'));
const PurchaseWorkspace = lazy(() => import('./pages/PurchaseWorkspace'));
const SupplierOrders = lazy(() => import('./pages/SupplierOrders'));
const SupplierWorkspace = lazy(() => import('./pages/SupplierWorkspace'));
const Discrepancies = lazy(() => import('./pages/Discrepancies'));
const StoreOrders = lazy(() => import('./pages/StoreOrders'));
const StoreFinance = lazy(() => import('./pages/StoreFinance'));
const Billing = lazy(() => import('./pages/Billing'));
const SettlementDifferences = lazy(() => import('./pages/SettlementDifferences'));
const Reports = lazy(() => import('./pages/Reports'));
const Commands = lazy(() => import('./pages/Commands'));
const legacyUrl = import.meta.env.VITE_LEGACY_URL || (import.meta.env.DEV ? 'http://127.0.0.1:4173/app.html' : '/legacy/');

function Login({ authenticated }: { authenticated: (user: User) => void }) {
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  return <main className="login-page"><section className="login-form">
    <div className="login-brand"><Building2 size={32} /><div><h1>ProcureX</h1><span>后台管理</span></div></div>
    <h2>账号登录</h2>
    {error && <Alert type="error" showIcon title={error} />}
    <Form layout="vertical" onFinish={async ({ username, password }) => {
      if (loading) return; setLoading(true); setError('');
      try { authenticated(await login(username.trim(), password)); } catch (failure) { setError((failure as Error).message); }
      finally { setLoading(false); }
    }} disabled={loading}>
      <Form.Item label="用户名" name="username" rules={[{ required: true, whitespace: true, message: '请输入用户名' }]}><Input autoComplete="username" /></Form.Item>
      <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}><Input.Password autoComplete="current-password" /></Form.Item>
      <Button type="primary" htmlType="submit" block loading={loading}>登录</Button>
    </Form>
  </section></main>;
}
const labels: Record<string, string> = { '/stores': '门店管理', '/store-groups': '门店分组', '/collection-accounts': '收款账户', '/categories': '商品分类', '/brands': '品牌管理', '/units': '单位管理', '/products': '商品管理', '/suppliers': '供应商管理', '/templates': '订货模板', '/purchase-requests': '采购申请', '/supplier-orders': '供应商订单', '/discrepancies': '收货差异' };
labels['/reports'] = '业务报表'; labels['/settlement-differences'] = '结算差异';
labels['/commands'] = '命令诊断';
function Shell({ user, signedOut }: { user: User; signedOut: () => void }) {
  const [collapsed, setCollapsed] = useState(false); const [mobileOpen, setMobileOpen] = useState(false); const [leaving, setLeaving] = useState(false);
  const { message } = AntApp.useApp(); const location = useLocation(); const navigate = useNavigate();
  const central = hasRole(user, 'ADMIN', 'HQ_FINANCE'); const storeRole = ['STORE', 'STORE_FINANCE'].includes(user.scope?.type || '') || (!hasRole(user, 'ADMIN', 'HQ_FINANCE', 'PURCHASER') && hasRole(user, 'STORE', 'STORE_FINANCE'));
  const supplierRole = user.scope?.type === 'SUPPLIER' || (!storeRole && !hasRole(user, 'ADMIN', 'HQ_FINANCE', 'PURCHASER') && hasRole(user, 'SUPPLIER'));
  const home = supplierRole ? '/supplier-orders' : storeRole ? '/store-orders' : '/stores'; const supported = supplierRole || storeRole || hasRole(user, 'ADMIN', 'HQ_FINANCE', 'PURCHASER');
  const items: { key: string; label: string; icon: ReactNode; children?: { key: string; label: string; icon: ReactNode }[] }[] = storeRole ? [{ key: '/store-orders', label: '门店订单', icon: <StoreIcon size={16} /> }, { key: '/store-finance', label: '门店账户', icon: <Landmark size={16} /> }, { key: '/finance', label: '账单与付款', icon: <Landmark size={16} /> }] : [
    { key: 'master', label: '基础资料', icon: <StoreIcon size={17} />, children: [
      { key: '/stores', label: '门店管理', icon: <StoreIcon size={16} /> },
      { key: '/store-groups', label: '门店分组', icon: <Folders size={16} /> },
      { key: '/suppliers', label: '供应商管理', icon: <Building2 size={16} /> },
    ] },
    { key: 'catalog', label: '商品资料', icon: <Package size={17} />, children: ['products', 'categories', 'brands', 'units'].map(kind => ({ key: `/${kind}`, label: labels[`/${kind}`], icon: <Folders size={16} /> })) },
    ...(hasRole(user, 'ADMIN', 'PURCHASER') ? [{ key: 'ordering', label: '订货配置', icon: <SlidersHorizontal size={17} />, children: ['templates'].map(kind => ({ key: `/${kind}`, label: labels[`/${kind}`], icon: <Folders size={16} /> })) }] : []),
    { key: 'procurement', label: '采购履约', icon: <ShoppingCart size={17} />, children: ['purchase-requests', 'supplier-orders', ...(hasRole(user, 'ADMIN') ? ['discrepancies'] : [])].map(kind => ({ key: `/${kind}`, label: labels[`/${kind}`], icon: <Folders size={16} /> })) },
    ...(central ? [{ key: 'finance', label: '财务结算', icon: <Landmark size={17} />, children: [{ key: '/store-finance', label: '门店财务', icon: <Landmark size={16} /> }, { key: '/finance', label: '账单与付款', icon: <Landmark size={16} /> }, { key: '/settlement-differences', label: '结算差异', icon: <Landmark size={16} /> }, { key: '/collection-accounts', label: '收款账户', icon: <Landmark size={16} /> }] }] : []),
  ];
  if (storeRole) items.push({ key: '/settlement-differences', label: '结算差异', icon: <Landmark size={16} /> });
  if (supplierRole) items.splice(0, items.length, { key: '/supplier-orders', label: '供应商工作台', icon: <Folders size={16} /> }, { key: '/discrepancies', label: '收货差异', icon: <Folders size={16} /> }, { key: 'finance', label: '财务管理', icon: <Landmark size={17} />, children: [{ key: '/finance', label: '账单与收款', icon: <Landmark size={16} /> }, { key: '/settlement-differences', label: '结算差异', icon: <Landmark size={16} /> }] }, { key: '/reports', label: '业务报表', icon: <Folders size={16} /> });
  else if (storeRole) items.push({ key: '/reports', label: '业务报表', icon: <BarChart3 size={16} /> });
  else items.push({ key: 'statistics', label: '统计报表', icon: <BarChart3 size={17} />, children: [{ key: '/reports', label: '业务报表', icon: <BarChart3 size={16} /> }] });
  if (!storeRole && !supplierRole && hasRole(user, 'ADMIN')) items.push({ key: 'system', label: '系统管理', icon: <Settings size={17} />, children: [{ key: '/commands', label: '命令诊断', icon: <Settings size={16} /> }] });
  const activeGroup = items.find(item => item.children?.some(child => child.key === location.pathname))?.key;
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  useEffect(() => { setOpenKeys(activeGroup ? [activeGroup] : []); }, [activeGroup]);
  const navigation = <Menu mode="inline" selectedKeys={[location.pathname]} openKeys={collapsed ? undefined : openKeys} onOpenChange={setOpenKeys} items={items}
    onClick={({ key }) => { navigate(key); setMobileOpen(false); }} inlineCollapsed={collapsed} />;
  if (!supported) return <Result status="403" title="当前账号暂未迁移" extra={<div className="actions"><a href={legacyUrl}><Button>打开原后台</Button></a><Button onClick={async () => { try { await logout(); } finally { signedOut(); } }}>退出登录</Button></div>} />;
  const authorized = storeRole ? ['/', '/store-orders', '/store-finance', '/finance', '/settlement-differences', '/reports'].includes(location.pathname) : location.pathname !== '/store-orders' && (!['/collection-accounts', '/store-finance', '/finance', '/settlement-differences'].includes(location.pathname) || central) && (location.pathname !== '/discrepancies' || hasRole(user, 'ADMIN')) && (!['/templates'].includes(location.pathname) || hasRole(user, 'ADMIN', 'PURCHASER'));
  return <div className={`admin-shell ${collapsed ? 'is-collapsed' : ''}`}>
    <aside className="sidebar"><Link className="brand" to={home}><Building2 size={24} /><span>ProcureX<small>采购协同</small></span></Link>{navigation}</aside>
    <Drawer title="ProcureX" placement="left" open={mobileOpen} onClose={() => setMobileOpen(false)} width={250}><Menu mode="inline" selectedKeys={[location.pathname]} openKeys={openKeys} onOpenChange={setOpenKeys} items={items} onClick={({ key }) => { navigate(key); setMobileOpen(false); }} /></Drawer>
    <div className="main-column"><header className="topbar"><div className="actions">
      <Tooltip title={collapsed ? '展开菜单' : '收起菜单'}><Button className="desktop-menu" type="text" aria-label={collapsed ? '展开菜单' : '收起菜单'} icon={<ChevronLeft size={18} style={{ transform: collapsed ? 'rotate(180deg)' : undefined }} />} onClick={() => setCollapsed(!collapsed)} /></Tooltip>
      <Button className="mobile-menu" type="text" aria-label="打开菜单" icon={<MenuIcon size={18} />} onClick={() => setMobileOpen(true)} />
      <span className="breadcrumb">{location.pathname === '/finance' ? (supplierRole ? '账单与收款' : '账单与付款') : location.pathname === '/store-finance' ? (storeRole ? '门店账户' : '门店财务') : location.pathname === '/store-orders' ? '门店订单' : labels[location.pathname] || '后台管理'}</span></div>
      <div className="actions"><Notifications key={user.id} userId={user.id} /><a className="legacy-link" href={legacyUrl} target="_blank" rel="noreferrer">原后台<ExternalLink size={13} /></a>
        <span className="user-name">{user.displayName || user.username || '管理员'}</span>
        <Tooltip title="退出登录"><Button type="text" aria-label="退出登录" loading={leaving} icon={<LogOut size={17} />} onClick={async () => {
          setLeaving(true); try { await logout(); } catch (failure) { message.warning((failure as Error).message); } finally { signedOut(); setLeaving(false); }
        }} /></Tooltip></div>
    </header><main className="page-content">{(supplierRole ? ['/', '/supplier-orders', '/discrepancies', '/finance', '/settlement-differences', '/reports'].includes(location.pathname) : authorized) ? <Suspense fallback={<Spin />}><Routes>
      <Route path="/commands" element={hasRole(user, 'ADMIN') ? <Commands user={user} /> : <Result status="403" title="无权访问此页面" />} />
      <Route path="/stores" element={<Stores user={user} />} />
      <Route path="/store-orders" element={<StoreOrders user={user} />} />
      <Route path="/store-finance" element={<StoreFinance user={user} />} />
      <Route path="/finance" element={<Billing user={user} />} />
      <Route path="/settlement-differences" element={<SettlementDifferences user={user} />} />
      <Route path="/reports" element={<Reports user={user} />} />
      <Route path="/products" element={<Products user={user} />} />
      <Route path="/suppliers" element={<Suppliers user={user} />} />
      <Route path="/templates" element={<Templates />} />
      <Route path="/prices" element={<Navigate to="/products" replace />} />
      <Route path="/purchase-requests" element={<PurchaseWorkspace user={user} />} />
      <Route path="/supplier-orders" element={supplierRole ? <SupplierWorkspace user={user} /> : <SupplierOrders user={user} />} />
      <Route path="/discrepancies" element={<Discrepancies user={user} />} />
      <Route path="/store-groups" element={<Directories key="groups" user={user} kind="groups" />} />
      <Route path="/collection-accounts" element={<Directories key="accounts" user={user} kind="accounts" />} />
      {(['categories', 'brands', 'units'] as const).map(kind => <Route key={kind} path={`/${kind}`} element={<CatalogRegistries key={kind} kind={kind} user={user} />} />)}
      <Route path="/" element={<Navigate to={home} replace />} />
      <Route path="*" element={<Result status="404" title="页面不存在" extra={<Link to="/stores"><Button>返回门店管理</Button></Link>} />} />
    </Routes></Suspense> : <Result status="403" title="无权访问此页面" extra={<Link to={home}><Button>返回首页</Button></Link>} />}</main></div>
  </div>;
}
function Application() {
  const [user, setUser] = useState<User | null>(null); const [checking, setChecking] = useState(Boolean(getSession()));
  const [restoreError, setRestoreError] = useState(''); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true; onExpired(() => { setUser(null); setChecking(false); });
    if (!getSession()) { setChecking(false); return; }
    setChecking(true); setRestoreError('');
    restore().then(value => { if (alive) setUser(value); }).catch(failure => { if (alive && getSession()) setRestoreError(failure.message); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [attempt]);
  const signedOut = () => { clearSession(); setUser(null); setRestoreError(''); };
  if (checking) return <div className="startup"><Spin size="large" /></div>;
  if (restoreError) return <Result status="warning" title={restoreError} extra={<div className="actions"><Button onClick={() => setAttempt(value => value + 1)}>重试</Button><Button onClick={signedOut}>重新登录</Button></div>} />;
  return user ? <Shell user={user} signedOut={signedOut} /> : <Login authenticated={setUser} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><ConfigProvider locale={zhCN} button={{ autoInsertSpace: false }} theme={{ token: {
  colorPrimary: '#147d64', colorInfo: '#147d64', colorText: '#26333c', colorBgLayout: '#f4f6f8', borderRadius: 4, fontSize: 13, controlHeight: 34,
}, components: { Table: { cellPaddingBlockSM: 10, cellPaddingInlineSM: 12, headerBg: '#eef2f5' }, Menu: { itemHeight: 38, itemBorderRadius: 4 } } }}>
  <AntApp><BrowserRouter><Application /></BrowserRouter></AntApp>
</ConfigProvider></StrictMode>);
