import { login, request } from '../api.js';
import { state } from '../state.js';
import { esc, money, metric, resultLine, tableRows, setNotice } from '../ui.js';
import { setHeader } from '../shell.js';

export async function render() {
  setHeader({ title: '门店工作台', subtitle: '门店订货、账户、订单进度和收货处理。', routeLabel: '门店', status: '加载中' });
  const token = state.tokens.store || await login(state.seed.storeUsername, state.seed.password, 'product-app-store');
  state.tokens.store = token;
  const [account, ledgers, requests, notifications] = await Promise.all([
    request(`/stores/${state.seed.storeId}/account`, {}, token),
    request(`/stores/${state.seed.storeId}/ledgers`, {}, token),
    request('/purchase-requests', {}, token),
    request('/notifications', {}, token),
  ]);
  setHeader({ title: '门店工作台', subtitle: '门店订货、账户、订单进度和收货处理。', routeLabel: '门店', status: 'READY' });
  const shipmentTodos = (notifications.notifications || []).filter((item) => item.payload?.shipmentId).slice(0, 8);
  document.getElementById('app-view').innerHTML = `
    <section class="summary-grid">
      ${metric('门店账号', state.seed.storeUsername, '已登录真实 API', true)}
      ${metric('可用余额', money(account.availableBalance || account.balance), '/stores/{id}/account')}
      ${metric('最近订单', requests.length, '/purchase-requests')}
      ${metric('待收货提醒', shipmentTodos.length, '/notifications')}
    </section>
    <section class="store-layout">
      <section class="data-card"><div class="data-head"><div><h3>快速订货</h3><p>调用 /purchase-requests/preview 和 /purchase-requests</p></div><span id="app-store-order-label" class="tag">待提交</span></div><form id="app-store-order-form" class="store-form"><label>商品 ID<input id="app-product-id" value="${esc(state.seed.productId)}"></label><label>数量<input id="app-quantity" value="${esc(state.seed.quantity)}"></label><div class="form-actions"><button id="app-preview-order" class="secondary" type="button">预览</button><button class="primary" type="submit">提交</button></div></form><div id="app-store-order-result" class="store-result"><small>预览或提交后展示服务端金额。</small></div></section>
      <section class="data-card"><div class="data-head"><div><h3>账户流水</h3><p>最近门店资金流水</p></div><span class="tag">真实数据</span></div><div class="table-wrap compact"><table><thead><tr><th>类型</th><th>金额</th><th>业务</th></tr></thead><tbody>${tableRows(ledgers.slice(0, 6).map((item) => `<tr><td>${esc(item.type || item.direction || 'LEDGER')}</td><td class="money">${esc(money(item.amount || item.deltaAmount || item.balanceDelta))}</td><td>${esc(item.businessNo || item.referenceNo || item.createdAt || '—')}</td></tr>`), 3, '暂无流水')}</tbody></table></div></section>
    </section>
    <section class="store-layout lower"><section class="data-card"><div class="data-head"><div><h3>订单进度</h3><p>门店最近订货单</p></div></div><div class="table-wrap"><table><thead><tr><th>单号</th><th>状态</th><th>资金</th><th class="money">金额</th></tr></thead><tbody>${tableRows(requests.slice(0, 8).map((item) => `<tr><td>${esc(item.requestNo || item.id)}</td><td>${esc(item.status || '—')}</td><td>${esc(item.paymentStatus || '—')}</td><td class="money">${esc(money(item.totals?.salesGoodsAmount || item.salesGoodsAmount))}</td></tr>`), 4, '暂无订单')}</tbody></table></div></section><section class="data-card"><div class="data-head"><div><h3>待收货提醒</h3><p>通知驱动收货入口</p></div></div><div class="store-notification-list">${shipmentTodos.length ? shipmentTodos.map((item) => `<article><div><strong>${esc(item.title)}</strong><small>${esc(item.payload?.shipmentNo || item.payload?.shipmentId)}</small></div></article>`).join('') : '<div class="empty"><strong>暂无待收货</strong><small>供应商发货后显示</small></div>'}</div></section></section>`;
  bindOrder(token);
}

function bindOrder(token) {
  const input = () => ({ storeId: state.seed.storeId, items: [{ productId: document.getElementById('app-product-id').value.trim(), quantity: document.getElementById('app-quantity').value.trim() }] });
  const show = (data, title) => {
    document.getElementById('app-store-order-label').textContent = title;
    document.getElementById('app-store-order-result').innerHTML = [
      resultLine('销售额', money(data.totals?.salesGoodsAmount || data.salesGoodsAmount)),
      resultLine('供货额', money(data.totals?.supplyGoodsAmount || data.supplyGoodsAmount)),
      resultLine('单号', data.requestNo || data.id || '预览'),
      resultLine('状态', data.paymentStatus || data.status || '—'),
    ].join('');
  };
  document.getElementById('app-preview-order').addEventListener('click', async () => {
    try {
      show(await request('/purchase-requests/preview', { method: 'POST', body: JSON.stringify(input()) }, token), '已预览');
      setNotice('');
    } catch (error) {
      setNotice(error.message);
    }
  });
  document.getElementById('app-store-order-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      show(await request('/purchase-requests', { method: 'POST', headers: { 'idempotency-key': `product-app-store-order-${crypto.randomUUID()}` }, body: JSON.stringify(input()) }, token), '已提交');
      setNotice('');
    } catch (error) {
      setNotice(error.message);
    }
  });
}
