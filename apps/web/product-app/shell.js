import { esc } from './ui.js';

const routes = [
  ['overview', '业务总览'],
  ['flow', '业务流转'],
  ['store', '门店'],
  ['purchaser', '采购'],
  ['supplier', '供应商'],
  ['finance', '财务'],
];

export function routeFromHash() {
  const key = location.hash.replace(/^#\/?/, '') || 'overview';
  return routes.some(([route]) => route === key) ? key : 'overview';
}

export function renderShell(activeRoute) {
  const nav = routes.map(([route, label]) => `<a class="nav-item ${route === activeRoute ? 'active' : ''}" href="#/${route}">${esc(label)}</a>`).join('');
  return `
    <aside class="sidebar"><div class="brand"><span class="mark">P</span><span>ProcureX<small>采购协同平台</small></span></div><div class="nav-label">产品应用</div>${nav}<div class="nav-label">兼容入口</div><a class="nav-item" href="/store-workbench.html">门店工作台</a><a class="nav-item" href="/purchaser-workbench.html">采购工作台</a><a class="nav-item" href="/supplier-workbench.html">供应商工作台</a><a class="nav-item" href="/m7-business-flow.html">业务流程</a><a class="nav-item" href="/m6-readiness.html">M6 上线准备</a><div class="side-foot"><span class="pulse"></span>组件化产品端</div></aside>
    <main class="main">
      <header class="topbar"><div class="crumb">产品应用 <span>/</span> <span id="app-route-label">加载中</span></div><div class="profile"><span id="app-status">等待业务数据</span><span class="avatar">P</span></div></header>
      <section class="page-head"><div><div class="eyebrow">ProcureX App</div><h1 id="app-title">采购协同产品应用</h1><p id="app-subtitle">门店、采购、供应商的日常业务集中在同一个组件化入口。</p></div><div class="updated"><span class="pulse"></span><span id="app-updated">等待刷新</span></div></section>
      <div id="app-notice" class="notice hidden"></div>
      <div id="app-view"></div>
      <footer>当前是正式产品应用入口；旧 HTML 工作台保留为兼容和回归证据入口。</footer>
    </main>`;
}

export function setHeader({ title, subtitle, routeLabel, status, updated }) {
  document.getElementById('app-title').textContent = title;
  document.getElementById('app-subtitle').textContent = subtitle;
  document.getElementById('app-route-label').textContent = routeLabel;
  document.getElementById('app-status').textContent = status;
  document.getElementById('app-status').classList.toggle('tag-ok', status === 'READY' || status === 'PASSED');
  document.getElementById('app-updated').textContent = updated || new Date().toLocaleString();
}
