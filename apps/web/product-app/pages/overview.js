import { state } from '../state.js';
import { metric, esc } from '../ui.js';
import { setHeader } from '../shell.js';
import { loadWorkflowContext, workflowNextAction } from '../workflow.js';

export async function render() {
  const seed = state.seed;
  const run = state.run;
  const readiness = state.readiness;
  const workflow = loadWorkflowContext();
  const readinessCounts = readiness?.counts || {};
  const roleEvidence = run?.roleEvidence || [];
  const nextAction = workflowNextAction(workflow);
  setHeader({
    title: '采购协同产品应用',
    subtitle: '主流程、角色待办、异常处理和财务结算集中在正式产品入口。',
    routeLabel: '业务总览',
    status: run?.status || 'READY',
    updated: run?.generatedAt ? new Date(run.generatedAt).toLocaleString('zh-CN') : '',
  });
  document.getElementById('app-view').innerHTML = `
    <section class="summary-grid">
      ${metric('主流程状态', run?.status || '未生成', '来自 main-flow-demo-run.json', run?.status === 'PASSED')}
      ${metric('本地证据', `${readinessCounts.ready || 0}+${readinessCounts.localReady || 0}`, 'READY + LOCAL_READY')}
      ${metric('外部缺口', readinessCounts.blocked ?? '—', '生产/微信/客户材料')}
      ${metric('角色覆盖', `${roleEvidence.length || 0}/4`, '门店 / 采购 / 供应商 / 财务', roleEvidence.length >= 4)}
    </section>
    <section class="app-route-grid">
      ${routeCard('业务流转', '一键执行主流程和异常分支，覆盖门店下单、采购确认、供应商履约、门店收货。', '#/flow', 'COMPLETED')}
      ${routeCard('门店工作台', '门店订货、账户流水、订单进度、待收货提醒和收货登记。', '#/store', seed?.storeUsername || 'STORE')}
      ${routeCard('采购工作台', '采购申请详情、确认拆单、拒单通知和备用供应商改派。', '#/purchaser', seed?.username || 'PURCHASER')}
      ${routeCard('供应商工作台', '执行单发货、拒单、差异处理、供应商账单和收款处理。', '#/supplier', seed?.supplierUsername || 'SUPPLIER')}
      ${routeCard('财务结算', '供应商账单、付款记录、付款凭证、确认收款和驳回付款。', '#/finance', 'CONFIRM/REJECT')}
    </section>
    <section class="store-layout">
      <section class="data-card">
        <div class="data-head"><div><h3>今日角色证据</h3><p>来自主流程验收输出，帮助判断角色链路是否跑通。</p></div><span class="tag tag-ok">业务闭环</span></div>
        <div class="overview-role-list">
          ${roleEvidence.length ? roleEvidence.map((item) => roleCard(item)).join('') : '<div class="empty"><strong>暂无角色证据</strong><small>运行 main-flow:check-demo 后生成</small></div>'}
        </div>
      </section>
      <section class="data-card">
        <div class="data-head"><div><h3>流程交接</h3><p>最近一次正式 App 主流程上下文。</p></div><span class="tag">${esc(workflow?.paymentStatus || workflow?.status || '等待流程')}</span></div>
        <div class="overview-next-list">
          ${nextItem('采购申请', workflow?.purchaseRequestNo || workflow?.purchaseRequestId || '运行主流程后生成', '#/purchaser')}
          ${nextItem('收货状态', workflow?.receiptNo || workflow?.receiptId || '等待收货', '#/store')}
          ${nextItem('付款状态', workflow?.paymentStatus ? `${workflow.paymentStatus} · ${workflow.paymentNo || workflow.paymentId || ''}` : '等待财务登记', '#/finance')}
        </div>
      </section>
    </section>
    <section class="data-card acceptance-card">
      <div class="data-head"><div><h3>下一步处理</h3><p>根据最近流程交接判断当前最该处理的角色页面。</p></div><span class="tag">WORKFLOW</span></div>
      <div class="finance-panel">
        ${statusCard('建议动作', nextAction.title, nextAction.detail)}
        ${statusCard('供应商单', workflow?.supplierOrderId || '待生成', '供应商履约入口')}
        ${statusCard('发货单', workflow?.shipmentNo || workflow?.shipmentId || '待生成', '门店收货入口')}
        ${statusCard('付款单', workflow?.paymentNo || workflow?.paymentId || '待登记', '财务/供应商收款入口')}
      </div>
      <div class="overview-next-list">
        ${nextItem(nextAction.title, nextAction.detail, nextAction.href)}
      </div>
    </section>
    <section class="data-card acceptance-card">
      <div class="data-head"><div><h3>下一步推进</h3><p>当前正式 App 的开发焦点。</p></div><span class="tag">M7</span></div>
      <div class="overview-next-list">
        ${nextItem('正式工作流串联', '从业务流转保存上下文，并在角色页自动带入关键 ID。', '#/flow')}
        ${nextItem('财务结算处理', '从交接上下文继续查看账单、付款凭证和收款状态。', '#/finance')}
        ${nextItem('小程序真机证据', '生产服务器和域名准备好后，补微信真机流程截图/录屏。', '/m6-readiness.html')}
      </div>
    </section>
    <section class="data-card acceptance-card">
      <div class="data-head"><div><h3>产品化与上线状态</h3><p>组件化迁移状态、正式 App 闭环和外部上线材料。</p></div><span class="tag tag-ok">M7 APP</span></div>
      <div class="finance-panel">
        ${statusCard('正式入口', 'app.html', 'ES modules 产品应用壳')}
        ${statusCard('业务闭环', '已跑通', '主流程、异常、财务确认和驳回')}
        ${statusCard('本地证据', `${readinessCounts.ready || 0}+${readinessCounts.localReady || 0}`, 'M6 local evidence package')}
        ${statusCard('上线缺口', readinessCounts.blocked ?? '—', '生产环境、微信真机、客户签字')}
      </div>
    </section>`;
}

function routeCard(title, detail, href, badge) {
  return `<article><div class="route-title"><strong>${esc(title)}</strong><span class="tag">${esc(badge)}</span></div><p>${esc(detail)}</p><a class="primary" href="${esc(href)}">打开</a></article>`;
}

function roleCard(item) {
  return `<article><div><strong>${esc(item.role)}</strong><small>${esc(item.account)}</small></div><span class="tag tag-ok">${esc(item.status)}</span><p>${esc(item.surface)}</p><small>${esc(item.evidence)}</small></article>`;
}

function nextItem(title, detail, href) {
  return `<article><div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div><a class="secondary" href="${esc(href)}">查看</a></article>`;
}

function statusCard(title, value, detail) {
  return `<article><strong>${esc(title)}</strong><span>${esc(value)}</span><small>${esc(detail)}</small></article>`;
}
