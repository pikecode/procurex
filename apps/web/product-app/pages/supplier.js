import { login, request } from '../api.js';
import { state } from '../state.js';
import { esc, money, metric, tableRows, setNotice } from '../ui.js';
import { setHeader } from '../shell.js';
import { loadWorkflowContext, saveWorkflowContext } from '../workflow.js';

export async function render() {
  setHeader({ title: '供应商工作台', subtitle: '供应商执行单、发货、差异和收款。', routeLabel: '供应商', status: '加载中' });
  const token = state.tokens.supplier || await login(state.seed.supplierUsername, state.seed.password, 'product-app-supplier');
  state.tokens.supplier = token;
  const [orders, messages, statements, payments] = await Promise.all([
    request('/supplier-orders', {}, token),
    request('/notifications', {}, token),
    request('/supplier-statements', {}, token),
    request('/payment-records?direction=COMPANY_TO_SUPPLIER', {}, token),
  ]);
  const discrepancies = [];
  for (const item of messages.notifications || []) {
    for (const id of item.payload?.discrepancyIds || []) discrepancies.push({ id, title: item.title, receiptId: item.payload.receiptId });
  }
  const workflow = loadWorkflowContext();
  setHeader({ title: '供应商工作台', subtitle: '供应商执行单、发货、差异和收款。', routeLabel: '供应商', status: 'READY' });
  document.getElementById('app-view').innerHTML = `
    <section class="summary-grid">${metric('供应商账号', state.seed.supplierUsername, '已登录真实 API', true)}${metric('执行单', orders.length, '/supplier-orders')}${metric('差异待办', discrepancies.length, '/notifications')}${metric('付款记录', payments.length, '/payment-records')}</section>
    <section class="store-layout"><section class="data-card"><div class="data-head"><div><h3>供应商执行单</h3><p>选择后发货或拒单</p></div></div><div class="table-wrap"><table><thead><tr><th>单号</th><th>状态</th><th>履约</th><th></th></tr></thead><tbody>${tableRows(orders.slice(0, 10).map((item) => `<tr><td>${esc(item.orderNo || item.supplierOrderNo || item.id)}</td><td>${esc(item.status || '—')}</td><td>${esc(item.fulfillmentStatus || '—')}</td><td><button class="secondary" data-app-supplier-order="${esc(item.id)}">处理</button></td></tr>`), 4, '暂无执行单')}</tbody></table></div></section><section class="data-card"><div class="data-head"><div><h3>差异待办</h3><p>少收差异处理</p></div></div><div class="store-notification-list">${discrepancies.length ? discrepancies.slice(0, 8).map((item) => `<article><div><strong>${esc(item.title)}</strong><small>${esc(item.id)}</small></div><button class="secondary" data-app-discrepancy="${esc(item.id)}">处理</button></article>`).join('') : '<div class="empty"><strong>暂无差异</strong><small>门店少收后显示</small></div>'}</div></section></section>
    <section class="data-card acceptance-card"><div class="data-head"><div><h3>发货 / 差异 / 收款</h3><p>供应商关键动作集中处理</p></div><span id="app-supplier-label" class="tag">等待选择</span></div><div class="receipt-panel"><label>供应商单 ID<input id="app-supplier-order-id" value="${esc(workflow?.supplierOrderId || '')}"></label><label>发货数量<input id="app-ship-quantity" value="${esc(state.seed.quantity)}"></label><label>差异 ID<input id="app-discrepancy-id"></label><label>付款 ID<input id="app-payment-id" value="${esc(workflow?.paymentId || '')}"></label><label>驳回原因<input id="app-payment-reason" value="供应商工作台驳回付款"></label><div class="form-actions"><button id="app-load-supplier-order" class="secondary">刷新供应商单</button><button id="app-ship-order" class="primary">发货</button><button id="app-reject-order" class="secondary">拒单</button><button id="app-accept-discrepancy" class="secondary">同意少收</button><button id="app-load-payment" class="secondary">刷新付款</button><button id="app-confirm-payment" class="primary">确认收款</button><button id="app-reject-payment" class="secondary">驳回付款</button></div></div><div id="app-supplier-result" class="store-result"><small>${esc(workflow?.supplierOrderId ? '已带入最近流程交接的供应商单，可直接读取复核。' : '选择执行单、差异或付款后处理。')}</small></div></section>
    <section class="store-layout lower"><section class="data-card"><div class="data-head"><div><h3>供应商账单</h3><p>应付账单</p></div></div><div class="table-wrap compact"><table><thead><tr><th>账单</th><th>状态</th><th class="money">应付</th></tr></thead><tbody>${tableRows(statements.slice(0, 6).map((item) => `<tr><td>${esc(item.statementNo || item.id)}</td><td>${esc(item.status || '—')}</td><td class="money">${esc(money(item.payableAmount || item.totalPayableAmount))}</td></tr>`), 3, '暂无账单')}</tbody></table></div></section><section class="data-card"><div class="data-head"><div><h3>付款记录</h3><p>选择后可确认收款</p></div></div><div class="table-wrap compact"><table><thead><tr><th>付款</th><th>状态</th><th></th></tr></thead><tbody>${tableRows(payments.slice(0, 6).map((item) => `<tr><td>${esc(item.paymentNo || item.id)}</td><td>${esc(item.status || '—')}</td><td><button class="secondary" data-app-payment="${esc(item.id)}">选择</button></td></tr>`), 3, '暂无付款')}</tbody></table></div></section></section>`;
  bindSupplier(token);
}

function bindSupplier(token) {
  let order = null;
  let payment = null;
  const show = (label, data) => {
    document.getElementById('app-supplier-label').textContent = label;
    document.getElementById('app-supplier-result').innerHTML = Object.entries(data).map(([key, value]) => `<article><span>${esc(key)}</span><strong>${esc(value)}</strong></article>`).join('');
  };
  const loadOrder = async () => {
    const id = document.getElementById('app-supplier-order-id').value.trim();
    if (!id) throw new Error('请先填写供应商单 ID');
    order = await request(`/supplier-orders/${id}`, {}, token);
    saveWorkflowContext({ supplierOrderId: order.id, supplierOrderStatus: order.status, supplierOrderVersion: order.version, fulfillmentStatus: order.fulfillmentStatus });
    show(order.status || '已读取', { 供应商单: order.orderNo || order.id, 版本: order.version, 履约: order.fulfillmentStatus || '—', 行数: (order.items || []).length });
    return order;
  };
  const loadPayment = async () => {
    const id = document.getElementById('app-payment-id').value.trim();
    if (!id) throw new Error('请先填写付款记录 ID');
    payment = await request(`/payment-records/${id}`, {}, token);
    saveWorkflowContext({ paymentId: payment.id, paymentNo: payment.paymentNo, paymentStatus: payment.status, paymentVersion: payment.version });
    show(payment.status || '已读取', {
      付款记录: payment.paymentNo || payment.id,
      付款状态: payment.status || '—',
      付款金额: money(payment.amount),
      当前版本: payment.version ?? '—',
    });
    return payment;
  };
  document.querySelectorAll('[data-app-supplier-order]').forEach((button) => button.addEventListener('click', async () => {
    document.getElementById('app-supplier-order-id').value = button.dataset.appSupplierOrder;
    try { await loadOrder(); setNotice(''); } catch (error) { setNotice(error.message); }
  }));
  document.querySelectorAll('[data-app-discrepancy]').forEach((button) => button.addEventListener('click', () => { document.getElementById('app-discrepancy-id').value = button.dataset.appDiscrepancy; }));
  document.querySelectorAll('[data-app-payment]').forEach((button) => button.addEventListener('click', async () => {
    document.getElementById('app-payment-id').value = button.dataset.appPayment;
    try { await loadPayment(); setNotice(''); } catch (error) { setNotice(error.message); }
  }));
  document.getElementById('app-load-supplier-order').addEventListener('click', async () => { try { await loadOrder(); setNotice(''); } catch (error) { setNotice(error.message); } });
  document.getElementById('app-load-payment').addEventListener('click', async () => { try { await loadPayment(); setNotice(''); } catch (error) { setNotice(error.message); } });
  document.getElementById('app-ship-order').addEventListener('click', async () => {
    try {
      if (!order) await loadOrder();
      const quantity = document.getElementById('app-ship-quantity').value.trim();
      const input = { expectedVersion: order.version, items: (order.items || []).map((item, index) => ({ orderItemId: item.id, shipQuantity: index === 0 && quantity ? quantity : item.quantity, permanentlyReduceQuantity: '0' })), freight: '0.00', trackingNo: `APP-${Date.now()}` };
      await request(`/supplier-orders/${order.id}/shipment-preview`, { method: 'POST', body: JSON.stringify(input) }, token);
      const shipment = await request(`/supplier-orders/${order.id}/shipments`, { method: 'POST', headers: { 'idempotency-key': `product-app-ship-${crypto.randomUUID()}` }, body: JSON.stringify(input) }, token);
      const updatedOrder = await request(`/supplier-orders/${order.id}`, {}, token);
      saveWorkflowContext({
        supplierOrderId: order.id,
        supplierOrderStatus: updatedOrder.status,
        supplierOrderVersion: updatedOrder.version,
        fulfillmentStatus: updatedOrder.fulfillmentStatus,
        shipmentId: shipment.id,
        shipmentNo: shipment.shipmentNo,
        shipmentStatus: shipment.status || 'SHIPPED',
        receiptId: null,
        receiptNo: null,
        receiptStatus: null,
        receiptRevision: 0,
        paymentId: null,
        paymentNo: null,
        paymentStatus: null,
      });
      show('SHIPPED', { 发货单: shipment.shipmentNo || shipment.id, 状态: shipment.status || 'SHIPPED' });
      setNotice('');
    } catch (error) { setNotice(error.message); }
  });
  document.getElementById('app-reject-order').addEventListener('click', async () => {
    try {
      if (!order) await loadOrder();
      const rejected = await request(`/supplier-orders/${order.id}/reject`, { method: 'POST', headers: { 'idempotency-key': `product-app-reject-${crypto.randomUUID()}` }, body: JSON.stringify({ expectedVersion: order.version, reason: '产品应用供应商拒单' }) }, token);
      saveWorkflowContext({ supplierOrderId: order.id, supplierOrderStatus: 'REJECTED', supplierOrderVersion: rejected.version, shipmentId: null, shipmentNo: null, shipmentStatus: null, receiptId: null, receiptNo: null, receiptStatus: null, paymentId: null, paymentNo: null, paymentStatus: null });
      show('REJECTED', { 供应商单: rejected.supplierOrderId || order.id, 状态: rejected.status || 'REJECTED' });
      setNotice('');
    } catch (error) { setNotice(error.message); }
  });
  document.getElementById('app-accept-discrepancy').addEventListener('click', async () => {
    try {
      const id = document.getElementById('app-discrepancy-id').value.trim();
      const discrepancy = await request(`/discrepancies/${id}`, {}, token);
      const resolved = await request(`/discrepancies/${id}/resolve`, { method: 'POST', headers: { 'idempotency-key': `product-app-discrepancy-${crypto.randomUUID()}` }, body: JSON.stringify({ expectedVersion: discrepancy.version, action: 'ACCEPT', reason: '产品应用同意少收' }) }, token);
      show(resolved.status || 'RESOLVED', { 差异: resolved.id, 数量: resolved.missingQuantity || '—' });
      setNotice('');
    } catch (error) { setNotice(error.message); }
  });
  document.getElementById('app-confirm-payment').addEventListener('click', async () => {
    try {
      if (!payment) await loadPayment();
      payment = await request(`/payment-records/${payment.id}/confirm`, {
        method: 'POST',
        headers: { 'idempotency-key': `product-app-supplier-payment-confirm-${crypto.randomUUID()}` },
        body: JSON.stringify({ expectedVersion: payment.version }),
      }, token);
      saveWorkflowContext({ paymentId: payment.id, paymentNo: payment.paymentNo, paymentStatus: payment.status || 'CONFIRMED' });
      show(payment.status || 'CONFIRMED', { 付款记录: payment.paymentNo || payment.id, 付款状态: payment.status || 'CONFIRMED', 付款金额: money(payment.amount), 当前版本: payment.version ?? '—' });
      setNotice('');
    } catch (error) { setNotice(error.message); }
  });
  document.getElementById('app-reject-payment').addEventListener('click', async () => {
    try {
      if (!payment) await loadPayment();
      payment = await request(`/payment-records/${payment.id}/reject`, {
        method: 'POST',
        headers: { 'idempotency-key': `product-app-supplier-payment-reject-${crypto.randomUUID()}` },
        body: JSON.stringify({ expectedVersion: payment.version, reason: document.getElementById('app-payment-reason').value.trim() || '供应商工作台驳回付款' }),
      }, token);
      saveWorkflowContext({ paymentId: payment.id, paymentNo: payment.paymentNo, paymentStatus: payment.status || 'REJECTED' });
      show(payment.status || 'REJECTED', { 付款记录: payment.paymentNo || payment.id, 付款状态: payment.status || 'REJECTED', 付款金额: money(payment.amount), 当前版本: payment.version ?? '—' });
      setNotice('');
    } catch (error) { setNotice(error.message); }
  });
}
