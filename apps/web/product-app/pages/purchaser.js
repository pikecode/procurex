import { login, request } from '../api.js';
import { state } from '../state.js';
import { esc, money, metric, tableRows, setNotice } from '../ui.js';
import { setHeader } from '../shell.js';

export async function render() {
  setHeader({ title: '采购工作台', subtitle: '采购申请、确认拆单和拒单改派。', routeLabel: '采购', status: '加载中' });
  const token = state.tokens.purchaser || await login(state.seed.username, state.seed.password, 'product-app-purchaser');
  state.tokens.purchaser = token;
  const [requests, messages] = await Promise.all([request('/purchase-requests', {}, token), request('/notifications', {}, token)]);
  const rejections = (messages.notifications || []).filter((item) => item.payload?.type === 'SUPPLIER_ORDER_REJECTED').slice(0, 8);
  setHeader({ title: '采购工作台', subtitle: '采购申请、确认拆单和拒单改派。', routeLabel: '采购', status: 'READY' });
  document.getElementById('app-view').innerHTML = `
    <section class="summary-grid">${metric('采购账号', state.seed.username, '已登录真实 API', true)}${metric('申请数', requests.length, '/purchase-requests')}${metric('拒单待办', rejections.length, '/notifications')}${metric('备用供应商', state.seed.secondarySupplierId || '未生成', '改派目标')}</section>
    <section class="store-layout"><section class="data-card"><div class="data-head"><div><h3>采购申请</h3><p>选择后读取详情并确认</p></div></div><div class="table-wrap"><table><thead><tr><th>单号</th><th>状态</th><th>资金</th><th></th></tr></thead><tbody>${tableRows(requests.slice(0, 10).map((item) => `<tr><td>${esc(item.requestNo || item.id)}</td><td>${esc(item.status || '—')}</td><td>${esc(item.paymentStatus || '—')}</td><td><button class="secondary" data-app-request-id="${esc(item.id)}">详情</button></td></tr>`), 4, '暂无采购申请')}</tbody></table></div></section><section class="data-card"><div class="data-head"><div><h3>拒单待办</h3><p>供应商拒单通知</p></div></div><div class="store-notification-list">${rejections.length ? rejections.map((item) => `<article><div><strong>${esc(item.title)}</strong><small>${esc(item.payload?.supplierOrderNo || item.payload?.supplierOrderId)}</small></div><button class="secondary" data-app-reject-request="${esc(item.payload.purchaseRequestId)}" data-app-reject-order="${esc(item.payload.supplierOrderId)}">处理</button></article>`).join('') : '<div class="empty"><strong>暂无拒单</strong><small>供应商拒单后显示</small></div>'}</div></section></section>
    <section class="data-card acceptance-card"><div class="data-head"><div><h3>申请详情</h3><p>读取 version 后执行确认或改派</p></div><span id="app-purchaser-label" class="tag">等待选择</span></div><div class="receipt-panel"><label>采购申请 ID<input id="app-request-id"></label><label>被拒供应商单 ID<input id="app-rejected-order-id"></label><label>目标供应商 ID<input id="app-target-supplier-id" value="${esc(state.seed.secondarySupplierId || '')}"></label><div class="form-actions"><button id="app-load-request" class="secondary">读取详情</button><button id="app-confirm-request" class="primary">确认</button><button id="app-reallocate-request" class="secondary">改派</button></div></div><div id="app-request-detail" class="store-result"><small>选择采购申请后显示详情。</small></div></section>`;
  bindPurchaser(token);
}

function bindPurchaser(token) {
  let detail = null;
  const load = async () => {
    const requestId = document.getElementById('app-request-id').value.trim();
    if (!requestId) throw new Error('请先填写采购申请 ID');
    detail = await request(`/purchase-requests/${requestId}`, {}, token);
    document.getElementById('app-purchaser-label').textContent = detail.status || '已读取';
    document.getElementById('app-request-detail').innerHTML = `<article><span>申请单</span><strong>${esc(detail.requestNo || detail.id)}</strong></article><article><span>版本</span><strong>${esc(detail.version)}</strong></article><article><span>资金</span><strong>${esc(detail.paymentStatus || '—')}</strong></article><article><span>金额</span><strong>${esc(money(detail.totals?.salesGoodsAmount || detail.salesGoodsAmount))}</strong></article>`;
    return detail;
  };
  document.querySelectorAll('[data-app-request-id]').forEach((button) => button.addEventListener('click', async () => {
    document.getElementById('app-request-id').value = button.dataset.appRequestId;
    try { await load(); setNotice(''); } catch (error) { setNotice(error.message); }
  }));
  document.querySelectorAll('[data-app-reject-request]').forEach((button) => button.addEventListener('click', async () => {
    document.getElementById('app-request-id').value = button.dataset.appRejectRequest;
    document.getElementById('app-rejected-order-id').value = button.dataset.appRejectOrder;
    try { await load(); setNotice(''); } catch (error) { setNotice(error.message); }
  }));
  document.getElementById('app-load-request').addEventListener('click', async () => { try { await load(); setNotice(''); } catch (error) { setNotice(error.message); } });
  document.getElementById('app-confirm-request').addEventListener('click', async () => {
    try {
      if (!detail) await load();
      const confirmed = await request(`/purchase-requests/${detail.id}/confirm`, { method: 'POST', headers: { 'idempotency-key': `product-app-confirm-${crypto.randomUUID()}` }, body: JSON.stringify({ expectedVersion: detail.version }) }, token);
      document.getElementById('app-purchaser-label').textContent = confirmed.status || 'CONFIRMED';
      setNotice('');
    } catch (error) { setNotice(error.message); }
  });
  document.getElementById('app-reallocate-request').addEventListener('click', async () => {
    try {
      if (!detail) await load();
      const targetSupplierId = document.getElementById('app-target-supplier-id').value.trim();
      const rejectedOrderId = document.getElementById('app-rejected-order-id').value.trim();
      await request(`/purchase-requests/${detail.id}/reallocate`, { method: 'POST', headers: { 'idempotency-key': `product-app-reallocate-${crypto.randomUUID()}` }, body: JSON.stringify({ expectedVersion: detail.version, rejectedOrderId, reason: '产品应用改派供应商', assignments: (detail.items || []).map((item) => ({ requestItemId: item.id, supplierId: targetSupplierId })) }) }, token);
      document.getElementById('app-purchaser-label').textContent = 'REALLOCATED';
      setNotice('');
    } catch (error) { setNotice(error.message); }
  });
}
