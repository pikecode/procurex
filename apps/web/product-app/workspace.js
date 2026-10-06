import { esc } from './ui.js';
import { allowedRoutes, createWorkspaceClient, resolveApiBase } from './workspace-session.js';
import { renderManagement } from './workspace-management.js';
import { renderOperations } from './workspace-operations.js';
import { navigationGroups } from './workspace-navigation.js';

const labels = { products: '商品资料', stores: '门店管理', suppliers: '供应商管理', templates: '订货模板',
  categories: '商品分类', brands: '商品品牌', units: '商品单位',
  prices: '价格管理', purchaser: '采购处理', supplier: '供应商订单', store: '门店订单', finance: '账单查询', profile: '自身资料', 'supplier-products': '供货商品' };
const root = () => document.getElementById('product-app');
let generation = 0;
let busy = false;
let currentHash = '';
let controller;
let client;
let cleanups = [];
const expandedGroups = new Map();
let navigationRoute;
let sidebarCollapsed = false;
try { sidebarCollapsed = sessionStorage.getItem('procurex-sidebar-collapsed') === 'true'; } catch { /* Keep an in-memory preference when storage is blocked. */ }
const routeIcons = { products: 'package', categories: 'list-tree', brands: 'tag', units: 'ruler', stores: 'store', suppliers: 'truck', templates: 'notebook-tabs', prices: 'badge-dollar-sign', purchaser: 'clipboard-list', supplier: 'package-check', store: 'shopping-cart', finance: 'wallet', profile: 'user-round', 'supplier-products': 'boxes' };
function cleanup() { cleanups.splice(0).forEach(dispose => dispose()); }

export const iconButton = (icon, title, attrs = '') => `<button class="ws-icon" type="button" title="${esc(title)}" aria-label="${esc(title)}" ${attrs}><i data-lucide="${esc(icon)}"></i></button>`;
export function icons() { globalThis.lucide?.createIcons({ attrs: { 'stroke-width': 1.8 } }); }

function loginView(message = '') {
  expandedGroups.clear();
  navigationRoute = undefined;
  generation += 1;
  cleanup();
  controller?.abort();
  document.querySelectorAll('.ws-dialog').forEach(dialog => { dialog.close(); dialog.remove(); });
  root().innerHTML = `<main class="ws-login"><div class="ws-login-brand">ProcureX<span>采购协同</span></div>
    <form id="ws-login-form"><h1>账号登录</h1><label>账号<input name="username" autocomplete="username" required autofocus></label>
    <label>密码<input name="password" type="password" autocomplete="current-password" required></label>
    <p id="ws-login-error" role="alert">${esc(message)}</p><button class="ws-primary" type="submit">登录</button></form></main>`;
  document.getElementById('ws-login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    const data = new FormData(form);
    try {
      await client.login(data.get('username'), data.get('password'));
      form.reset();
      const routes = allowedRoutes(client.session.user);
      if (!routes.includes(location.hash.replace(/^#\/?/, ''))) history.replaceState(null, '', `#/${routes[0] || ''}`);
      await render();
    } catch (error) {
      form.elements.password.value = '';
      document.getElementById('ws-login-error').textContent = error.message;
      button.disabled = false;
    }
  });
}

async function render() {
  if (busy) { if (location.hash !== currentHash) location.hash = currentHash; return; }
  if (!client.session) return loginView();
  cleanup();
  controller?.abort();
  controller = new AbortController();
  const requestController = controller;
  document.querySelectorAll('.ws-dialog').forEach(dialog => { dialog.close(); dialog.remove(); });
  const id = ++generation;
  const user = client.session.user;
  const routes = allowedRoutes(user);
  const requested = location.hash.replace(/^#\/?/, '');
  const route = requested && !['overview', 'flow'].includes(requested) ? requested : routes[0];
  const groups = navigationGroups(routes);
  if (navigationRoute !== route) {
    const activeGroup = groups.find(group => group.routes.includes(route));
    if (activeGroup) expandedGroups.set(activeGroup.id, true);
    navigationRoute = route;
  }
  currentHash = location.hash;
  root().innerHTML = `<div class="ws-shell ${sidebarCollapsed ? 'ws-sidebar-collapsed' : ''}"><aside class="ws-sidebar" id="ws-sidebar"><a class="ws-brand" href="#/${routes[0] || ''}" aria-label="ProcureX 采购协同"><span class="ws-brand-full">ProcureX<small>采购协同</small></span><span class="ws-brand-mini" aria-hidden="true">PX</span></a>
    <nav class="ws-nav-full" aria-label="业务导航">${groups.map(group => `<details class="ws-nav-group" data-nav-group="${group.id}" ${expandedGroups.get(group.id) ? 'open' : ''}>
      <summary><i data-lucide="${group.icon}"></i><span>${group.label}</span><i class="ws-nav-chevron" data-lucide="chevron-down"></i></summary>
      <div>${group.routes.map(key => `<a href="#/${key}" class="${key === route ? 'active' : ''}" ${key === route ? 'aria-current="page"' : ''}>${esc(labels[key])}</a>`).join('')}</div></details>`).join('')}</nav>
    <nav class="ws-nav-rail" aria-label="业务快捷导航">${groups.map(group => `<div class="ws-rail-group">${group.routes.map(key => `<a href="#/${key}" title="${esc(labels[key])}" aria-label="${esc(labels[key])}" class="${key === route ? 'active' : ''}" ${key === route ? 'aria-current="page"' : ''}><i data-lucide="${routeIcons[key]}"></i></a>`).join('')}</div>`).join('')}</nav></aside>
    <main class="ws-main"><header><div class="ws-page-heading">${iconButton(sidebarCollapsed ? 'panel-left-open' : 'panel-left-close', sidebarCollapsed ? '展开菜单' : '收起菜单', `id="ws-sidebar-toggle" aria-controls="ws-sidebar" aria-expanded="${!sidebarCollapsed}"`)}<span>${esc(labels[route] || '工作台')}</span></div><div class="ws-profile"><span>${esc(user.displayName || user.username)}</span>${iconButton('log-out', '退出登录', 'id="ws-logout"')}</div></header>
    <div id="ws-notice" class="ws-notice" role="status" hidden></div><div id="ws-view"><div class="ws-empty">加载中...</div></div></main></div>`;
  document.getElementById('ws-logout').onclick = async () => {
    if (busy) return;
    busy = true;
    try { await client.logout(); } catch { /* Local credentials are still cleared. */ }
    finally { busy = false; loginView(); }
  };
  root().querySelectorAll('[data-nav-group]').forEach(element => {
    element.addEventListener('toggle', () => expandedGroups.set(element.dataset.navGroup, element.open));
  });
  document.getElementById('ws-sidebar-toggle').onclick = () => {
    sidebarCollapsed = !sidebarCollapsed;
    try { sessionStorage.setItem('procurex-sidebar-collapsed', String(sidebarCollapsed)); } catch { /* The toggle still works without persistence. */ }
    root().querySelector('.ws-shell').classList.toggle('ws-sidebar-collapsed', sidebarCollapsed);
    const button = document.getElementById('ws-sidebar-toggle');
    const label = sidebarCollapsed ? '展开菜单' : '收起菜单';
    button.title = label; button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', String(!sidebarCollapsed));
    button.innerHTML = `<i data-lucide="${sidebarCollapsed ? 'panel-left-open' : 'panel-left-close'}"></i>`;
    icons();
  };
  icons();
  const context = {
    user, client, route, view: document.getElementById('ws-view'),
    active: () => id === generation && Boolean(client.session),
    cleanup: dispose => cleanups.push(dispose),
    get: (path) => client.request(path, { signal: requestController.signal }),
    notice(message, isError = false) {
      if (!this.active()) return;
      const element = document.getElementById('ws-notice');
      element.hidden = !message; element.textContent = message;
      element.classList.toggle('error', isError);
    },
    async save(path, method, body, form) {
      if (busy || !this.active()) throw new Error('当前操作尚未完成。');
      busy = true;
      const fieldset = form?.querySelector('fieldset');
      if (fieldset) fieldset.disabled = true;
      try { return await client.request(path, { method, body }); }
      catch (error) {
        if (error.uncertain && form) { form.dataset.uncertain = 'true'; form.querySelector('[type="submit"]').disabled = true; }
        throw error;
      } finally { busy = false; if (fieldset) fieldset.disabled = false; }
    },
    async command(path, body, recover = false, method = 'POST') {
      if (busy || !this.active()) throw new Error('当前操作尚未完成。');
      busy = true;
      try { return recover ? await client.recoverCommand() : await client.command(path, body, method); }
      finally { busy = false; }
    },
    uploadImage(blob) { return this.uploadFile(blob, 'PRODUCT', 'product.jpg'); },
    async uploadFile(blob, purpose, filename) {
      if (busy || !this.active()) throw new Error('当前操作尚未完成。');
      busy = true;
      try {
        const session = await client.request('/files/upload-sessions', { method: 'POST', body: { purpose, filename, mimeType: blob.type, sizeBytes: blob.size } });
        await client.request(`/files/${session.id}/content`, { method: 'POST', body: blob, rawBody: true, headers: { 'content-type': 'application/octet-stream', 'x-upload-token': session.uploadToken } });
        await client.request(`/files/${session.id}/complete`, { method: 'POST' });
        return session.id;
      } finally { busy = false; }
    },
    refresh: render,
  };
  if (!routes.includes(route)) {
    context.view.innerHTML = '<div class="ws-empty">当前账号无权访问此页面。</div>';
    return;
  }
  try {
    if (['products', 'categories', 'brands', 'units', 'stores', 'suppliers', 'templates', 'prices', 'profile', 'supplier-products'].includes(route)) await renderManagement(context);
    else await renderOperations(context);
    if (context.active()) icons();
  } catch (error) {
    if (!context.active() || controller.signal.aborted) return;
    context.view.innerHTML = `<div class="ws-empty" role="alert">${esc(error.message)}<button id="ws-retry" class="ws-secondary">重新加载</button></div>`;
    document.getElementById('ws-retry').onclick = render;
  }
}

export async function startWorkspace() {
  document.body.classList.add('business-workspace');
  try {
    client = createWorkspaceClient({ base: resolveApiBase(location.href), storage: sessionStorage, onExpired: () => loginView('登录已失效，请重新登录。') });
    window.addEventListener('hashchange', render);
    window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
    if (client.session) {
      root().innerHTML = '<div class="ws-empty">正在验证登录...</div>';
      try { await client.restore(); } catch (error) { if (client.session) { loginView(error.message); return; } }
    }
    await render();
  } catch (error) { root().innerHTML = `<div class="ws-empty">${esc(error.message)}</div>`; }
}

export function openEditor(context, title, content, submit) {
  const dialog = document.createElement('dialog');
  dialog.className = 'ws-dialog';
  dialog.innerHTML = `<form><div class="ws-dialog-head"><h2>${esc(title)}</h2>${iconButton('x', '关闭')}</div><div class="ws-form-error" role="alert" hidden></div>
    <fieldset><div class="ws-form-grid">${content}</div><div class="ws-dialog-actions"><button type="button" class="ws-secondary" data-close>取消</button><button type="submit" class="ws-primary">保存</button></div></fieldset></form>`;
  document.body.append(dialog); dialog.showModal(); icons();
  const form = dialog.querySelector('form');
  if (!submit) {
    form.querySelector('[type="submit"]').remove();
    form.querySelector('[data-close]').textContent = '关闭';
  }
  const close = () => { if (!busy) { dialog.close(); dialog.remove(); } };
  dialog.querySelector('.ws-icon').onclick = close;
  dialog.querySelector('[data-close]').onclick = close;
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!submit || busy || form.dataset.submitting || form.dataset.uncertain || !context.active()) return;
    form.dataset.submitting = 'true';
    const errorElement = form.querySelector('.ws-form-error'); errorElement.hidden = true;
    try { await submit(new FormData(form), form); close(); }
    catch (error) {
      if (dialog.isConnected) { errorElement.textContent = error.message; errorElement.hidden = false; }
    }
    finally { delete form.dataset.submitting; }
  });
  return { dialog, form };
}
