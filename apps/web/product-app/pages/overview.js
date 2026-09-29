import { state } from '../state.js';
import { metric, esc } from '../ui.js';
import { setHeader } from '../shell.js';

export async function render() {
  const seed = state.seed;
  const run = state.run;
  setHeader({
    title: '采购协同产品应用',
    subtitle: '从业务总览进入门店、采购、供应商三个日常工作台。',
    routeLabel: '业务总览',
    status: run?.status || 'READY',
    updated: run?.generatedAt ? new Date(run.generatedAt).toLocaleString('zh-CN') : '',
  });
  document.getElementById('app-view').innerHTML = `
    <section class="summary-grid">
      ${metric('主流程状态', run?.status || '未生成', '来自 main-flow-demo-run.json', run?.status === 'PASSED')}
      ${metric('门店账号', seed?.storeUsername || '未生成', '门店下单 / 收货')}
      ${metric('采购账号', seed?.username || '未生成', '确认 / 改派')}
      ${metric('供应商账号', seed?.supplierUsername || '未生成', '发货 / 差异 / 收款')}
    </section>
    <section class="app-route-grid">
      ${routeCard('门店工作台', '门店订货、账户流水、待收货和收货登记。', '#/store')}
      ${routeCard('采购工作台', '采购申请详情、确认拆单和供应商拒单改派。', '#/purchaser')}
      ${routeCard('供应商工作台', '执行单发货、拒单、差异处理、账单和收款。', '#/supplier')}
    </section>
    <section class="data-card acceptance-card"><div class="data-head"><div><h3>组件化迁移状态</h3><p>当前入口由 ES modules 渲染，不再新增孤立业务 HTML 页面</p></div><span class="tag tag-ok">M7 APP</span></div><div class="finance-panel"><article><strong>入口</strong><span>app.html</span><small>单页产品应用壳</small></article><article><strong>模块</strong><span>product-app/</span><small>共享 API、状态、页面模块</small></article><article><strong>兼容</strong><span>保留</span><small>旧工作台仍可作为回归入口</small></article><article><strong>下一步</strong><span>交互证据</span><small>把页面动作纳入 app 级证据</small></article></div></section>`;
}

function routeCard(title, detail, href) {
  return `<article><strong>${esc(title)}</strong><p>${esc(detail)}</p><a class="primary" href="${esc(href)}">打开</a></article>`;
}
