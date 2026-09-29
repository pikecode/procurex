import { login, request } from '../api.js';
import { state } from '../state.js';
import { esc, money, metric, tableRows, setNotice } from '../ui.js';
import { setHeader } from '../shell.js';
import { loadWorkflowContext, saveWorkflowContext } from '../workflow.js';

export async function render() {
  setHeader({ title: '采购工作台', subtitle: '采购申请、确认拆单和拒单改派。', routeLabel: '采购', status: '加载中' });
  const token = state.tokens.purchaser || await login(state.seed.username, state.seed.password, 'product-app-purchaser');
  state.tokens.purchaser = token;
  const [requests, messages] = await Promise.all([request('/purchase-requests', {}, token), request('/notifications', {}, token)]);
  const rejections = (messages.notifications || []).filter((item) => item.payload?.type === 'SUPPLIER_ORDER_REJECTED').slice(0, 8);
  const workflow = loadWorkflowContext();
  setHeader({ title: '采购工作台', subtitle: '采购申请、确认拆单和拒单改派。', routeLabel: '采购', status: 'READY' });
  document.getElementById('app-view').innerHTML = `
    <section class="summary-grid">${metric('采购账号', state.seed.username, '已登录真实 API', true)}${metric('申请数', requests.length, '/purchase-requests')}${metric('拒单待办', rejections.length, '/notifications')}${metric('备用供应商', state.seed.secondarySupplierId || '未生成', '改派目标')}</section>
    <section class="store-layout"><section class="data-card"><div class="data-head"><div><h3>采购申请</h3><p>选择后读取详情并确认</p></div></div><div class="table-wrap"><table><thead><tr><th>单号</th><th>状态</th><th>资金</th><th></th></tr></thead><tbody>${tableRows(requests.slice(0, 10).map((item) => `<tr><td>${esc(item.requestNo || item.id)}</td><td>${esc(item.status || '—')}</td><td>${esc(item.paymentStatus || '—')}</td><td><button class="secondary" data-app-request-id="${esc(item.id)}">详情</button></td></tr>`), 4, '暂无采购申请')}</tbody></table></div></section><section class="data-card"><div class="data-head"><div><h3>拒单待办</h3><p>供应商拒单通知</p></div></div><div class="store-notification-list">${rejections.length ? rejections.map((item) => `<article><div><strong>${esc(item.title)}</strong><small>${esc(item.payload?.supplierOrderNo || item.payload?.supplierOrderId)}</small></div><button class="secondary" data-app-reject-request="${esc(item.payload.purchaseRequestId)}" data-app-reject-order="${esc(item.payload.supplierOrderId)}">处理</button></article>`).join('') : '<div class="empty"><strong>暂无拒单</strong><small>供应商拒单后显示</small></div>'}</div></section></section>
    <section class="data-card acceptance-card"><div class="data-head"><div><h3>申请详情</h3><p>读取 version 后执行确认或改派</p></div><span id="app-purchaser-label" class="tag">等待选择</span></div><div class="receipt-panel"><label>采购申请 ID<input id="app-request-id" value="${esc(workflow?.purchaseRequestId || '')}"></label><label>被拒供应商单 ID<input id="app-rejected-order-id"></label><label>目标供应商 ID<input id="app-target-supplier-id" value="${esc(state.seed.secondarySupplierId || '')}"></label><div class="form-actions"><button id="app-load-request" class="secondary">刷新采购申请</button><button id="app-confirm-request" class="primary">确认</button><button id="app-reallocate-request" class="secondary">改派</button></div></div><div id="app-request-detail" class="store-result"><small>${esc(workflow?.purchaseRequestId ? '已带入最近流程交接的采购申请，可直接读取复核。' : '选择采购申请后显示详情。')}</small></div><div class="table-wrap compact"><table><thead><tr><th>商品行</th><th>目标供应商</th><th>数量</th><th class="money">销售额</th></tr></thead><tbody id="app-request-items"><tr><td colspan="4">暂无商品行</td></tr></tbody></table></div></section>
    <section class="data-card acceptance-card"><div class="data-head"><div><h3>处理结果</h3><p>展示采购确认或拒单改派后的服务端返回。</p></div><span id="app-purchaser-action-label" class="tag">等待操作</span></div><div id="app-purchaser-action-result" class="store-result"><small>确认或改派后显示结果。</small></div></section>`;
  bindPurchaser(token);
}

function bindPurchaser(token) {
  let detail = null;
  const renderAction = (label, data) => {
    document.getElementById('app-purchaser-action-label').textContent = label;
    document.getElementById('app-purchaser-action-result').innerHTML = Object.entries(data).map(([key, value]) => `<article><span>${esc(key)}</span><strong>${esc(value)}</strong></article>`).join('');
  };
  const load = async () => {
    const requestId = document.getElementById('app-request-id').value.trim();
    if (!requestId) throw new Error('请先填写采购申请 ID');
    detail = await request(`/purchase-requests/${requestId}`, {}, token);
    saveWorkflowContext({ purchaseRequestId: detail.id, purchaseRequestNo: detail.requestNo, purchaseRequestStatus: detail.status, purchaseRequestVersion: detail.version });
    document.getElementById('app-purchaser-label').textContent = detail.status || '已读取';
    document.getElementById('app-request-detail').innerHTML = `<article><span>申请单</span><strong>${esc(detail.requestNo || detail.id)}</strong></article><article><span>版本</span><strong>${esc(detail.version)}</strong></article><article><span>状态</span><strong>${esc(detail.status || '—')}</strong></article><article><span>资金</span><strong>${esc(detail.paymentStatus || '—')}</strong></article><article><span>金额</span><strong>${esc(money(detail.totals?.salesGoodsAmount || detail.salesGoodsAmount))}</strong></article><article><span>商品行</span><strong>${esc((detail.items || []).length)}</strong></article>`;
    document.getElementById('app-request-items').innerHTML = tableRows((detail.items || []).map((item) => `<tr><td>${esc(item.productName || item.productId || item.id)}</td><td>${esc(item.supplierId || item.targetSupplierId || '—')}</td><td>${esc(item.quantity || '—')}</td><td class="money">${esc(money(item.salesAmount || item.salesGoodsAmount || item.salesPrice))}</td></tr>`), 4, '暂无商品行');
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
      const supplierOrders = confirmed.supplierOrders || confirmed.supplierOrderIds || [];
      const supplierOrderId = supplierOrders[0]?.id || supplierOrders[0] || '';
      saveWorkflowContext({
        purchaseRequestId: confirmed.id || detail.id,
        purchaseRequestNo: confirmed.requestNo || detail.requestNo,
        purchaseRequestStatus: confirmed.status || 'CONFIRMED',
        purchaseRequestVersion: confirmed.version,
        supplierOrderId,
        supplierOrderStatus: supplierOrderId ? 'PENDING' : null,
        shipmentId: null,
        shipmentNo: null,
        shipmentStatus: null,
        receiptId: null,
        receiptNo: null,
        receiptStatus: null,
        paymentId: null,
        paymentNo: null,
        paymentStatus: null,
      });
      document.getElementById('app-purchaser-label').textContent = confirmed.status || 'CONFIRMED';
      renderAction(confirmed.status || 'CONFIRMED', {
        采购申请: confirmed.requestNo || confirmed.id || detail.requestNo || detail.id,
        处理状态: confirmed.status || 'CONFIRMED',
        供应商单: (confirmed.supplierOrders || confirmed.supplierOrderIds || []).map((item) => item.id || item).join(', ') || '已生成',
        版本: confirmed.version ?? detail.version,
      });
      setNotice('');
    } catch (error) { setNotice(error.message); }
  });
  document.getElementById('app-reallocate-request').addEventListener('click', async () => {
    try {
      if (!detail) await load();
      const targetSupplierId = document.getElementById('app-target-supplier-id').value.trim();
      const rejectedOrderId = document.getElementById('app-rejected-order-id').value.trim();
      if (!rejectedOrderId) throw new Error('请从拒单待办选择被拒供应商单');
      if (!targetSupplierId) throw new Error('请填写改派目标供应商');
      const rejectedOrder = await request(`/supplier-orders/${rejectedOrderId}`, {}, token);
      const rejectedProducts = new Set((rejectedOrder.items || []).map((item) => item.productId));
      const assignments = (detail.items || [])
        .filter((item) => rejectedProducts.has(item.productId))
        .map((item) => ({ requestItemId: item.id, supplierId: targetSupplierId }));
      if (!assignments.length) throw new Error('被拒供应商单没有关联到当前采购申请的商品行，请刷新拒单待办');
      const reallocated = await request(`/purchase-requests/${detail.id}/reallocate`, { method: 'POST', headers: { 'idempotency-key': `product-app-reallocate-${crypto.randomUUID()}` }, body: JSON.stringify({ expectedVersion: detail.version, rejectedOrderId, reason: '产品应用改派供应商', assignments }) }, token);
      const replacementOrder = (reallocated.supplierOrders || []).find((order) => order.supplierId === targetSupplierId && order.status !== 'REJECTED');
      if (!replacementOrder) throw new Error('改派已处理，但服务端未返回目标供应商的新供应商单');
      const supplierOrderId = replacementOrder.id;
      saveWorkflowContext({
        purchaseRequestId: reallocated.id || detail.id,
        purchaseRequestNo: reallocated.requestNo || detail.requestNo,
        purchaseRequestStatus: reallocated.status || 'REALLOCATED',
        purchaseRequestVersion: reallocated.version,
        supplierOrderId,
        supplierOrderStatus: replacementOrder.status,
        shipmentId: null,
        shipmentNo: null,
        shipmentStatus: null,
        receiptId: null,
        receiptNo: null,
        receiptStatus: null,
        paymentId: null,
        paymentNo: null,
        paymentStatus: null,
      });
      document.getElementById('app-purchaser-label').textContent = reallocated.status || 'REALLOCATED';
      renderAction('REALLOCATED', {
        采购申请: reallocated.requestNo || reallocated.id || detail.requestNo || detail.id,
        申请状态: reallocated.status || '—',
        处理状态: 'REALLOCATED',
        目标供应商: targetSupplierId || '—',
        改派商品行: assignments.length,
        新供应商单: supplierOrderId,
      });
      setNotice('');
    } catch (error) { setNotice(error.message); }
  });
}
