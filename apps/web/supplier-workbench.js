const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const api = `${location.protocol}//${location.hostname}:3100/api/v1`;

let seed = null;
let token = null;
let state = {
  orders: [],
  discrepancies: [],
  statements: [],
  payments: [],
  order: null,
  shipment: null,
  rejected: null,
  discrepancy: null,
  resolved: null,
  payment: null,
};

async function loadJson(path) {
  const response = await fetch(`${path}?ts=${Date.now()}`);
  if (!response.ok) throw new Error(`${path} 未生成`);
  return response.json();
}

async function call(path, options = {}) {
  const response = await fetch(`${api}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error?.message || `请求失败（${response.status}）`);
  return body.data ?? body;
}

function setNotice(message) {
  $('supplier-notice').textContent = message || '';
  $('supplier-notice').classList.toggle('hidden', !message);
}

function money(value) {
  if (value === undefined || value === null || value === '') return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `¥${numeric.toFixed(2)}`;
}

function metric(label, value, foot, emphasis = false) {
  return `<article class="metric ${emphasis ? 'emphasis' : ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></article>`;
}

function resultLine(label, value) {
  return `<article><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`;
}

async function loginSupplier() {
  const login = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: seed.supplierUsername, password: seed.password, client: 'supplier-workbench' }),
  });
  token = login.accessToken;
}

async function refreshOrders() {
  const data = await call('/supplier-orders');
  state.orders = Array.isArray(data) ? data.slice(0, 12) : [];
}

async function refreshDiscrepancies() {
  const data = await call('/notifications');
  const notifications = data.notifications || [];
  const discrepancies = [];
  for (const item of notifications) {
    const ids = item.payload?.discrepancyIds;
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      discrepancies.push({ id, title: item.title, receiptId: item.payload.receiptId, createdAt: item.createdAt });
    }
  }
  state.discrepancies = discrepancies.slice(0, 12);
}

async function refreshFinance() {
  const [statements, payments] = await Promise.all([
    call('/supplier-statements'),
    call('/payment-records?direction=COMPANY_TO_SUPPLIER'),
  ]);
  state.statements = Array.isArray(statements) ? statements.slice(0, 8) : [];
  state.payments = Array.isArray(payments) ? payments.slice(0, 8) : [];
}

async function refreshAll() {
  try {
    await Promise.all([refreshOrders(), refreshDiscrepancies(), refreshFinance()]);
    $('supplier-page-status').textContent = 'READY';
    $('supplier-page-status').classList.add('tag-ok');
    $('supplier-updated').textContent = new Date().toLocaleString();
    setNotice('');
  } catch (error) {
    setNotice(error.message);
  }
  render();
}

function render() {
  renderSummary();
  renderOrders();
  renderDiscrepancies();
  renderOrderDetail();
  renderFinance();
  renderDiscrepancyResult();
  renderPaymentResult();
}

function renderSummary() {
  const shippable = state.orders.filter((item) => item.status === 'CONFIRMED' || item.fulfillmentStatus === 'PENDING').length;
  const payable = state.statements.reduce((sum, item) => sum + Number(item.payableAmount || item.totalPayableAmount || 0), 0);
  $('supplier-summary').innerHTML = [
    metric('供应商账号', seed?.supplierUsername || '未加载', token ? '已登录真实 API' : '等待登录', Boolean(token)),
    metric('执行单', state.orders.length, '来自 /supplier-orders', true),
    metric('待发货', shippable, 'CONFIRMED / PENDING'),
    metric('待处理差异', state.discrepancies.length, `应付 ${money(payable)}`),
  ].join('');
}

function renderOrders() {
  $('supplier-orders').innerHTML = state.orders.length
    ? state.orders.map((item) => `<tr><td>${esc(item.orderNo || item.supplierOrderNo || item.id)}</td><td><span class="tag">${esc(item.status || '—')}</span></td><td>${esc(item.fulfillmentStatus || '—')}</td><td><button class="secondary" data-supplier-order-id="${esc(item.id)}">处理</button></td></tr>`).join('')
    : '<tr><td colspan="4">暂无供应商执行单</td></tr>';
  $('supplier-orders').querySelectorAll('[data-supplier-order-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      $('supplier-order-id').value = button.dataset.supplierOrderId;
      await loadSupplierOrder();
    });
  });
}

function renderDiscrepancies() {
  if (!state.discrepancies.length) {
    $('supplier-discrepancies').innerHTML = '<div class="empty"><strong>暂无差异待办</strong><small>门店少收后会在这里进入处理</small></div>';
    return;
  }
  $('supplier-discrepancies').innerHTML = state.discrepancies.map((item) => `<article><div><strong>${esc(item.title || '收货差异待处理')}</strong><small>${esc(item.id)} · ${esc(item.receiptId || item.createdAt || '')}</small></div><button class="secondary" data-discrepancy-id="${esc(item.id)}">处理</button></article>`).join('');
  $('supplier-discrepancies').querySelectorAll('[data-discrepancy-id]').forEach((button) => {
    button.addEventListener('click', () => {
      $('discrepancy-id').value = button.dataset.discrepancyId;
    });
  });
}

function renderOrderDetail() {
  const order = state.order;
  $('shipment-label').textContent = state.shipment?.status || state.rejected?.status || order?.status || '等待订单';
  $('shipment-label').classList.toggle('tag-ok', Boolean(state.shipment || state.rejected));
  if (!order) {
    $('supplier-order-detail').innerHTML = '<small>从执行单列表选择供应商单后，这里展示版本、状态和发货结果。</small>';
    $('supplier-order-items').innerHTML = '<tr><td colspan="4">暂无商品行</td></tr>';
    return;
  }
  $('supplier-order-detail').innerHTML = [
    resultLine('供应商单', order.orderNo || order.supplierOrderNo || order.id),
    resultLine('当前版本', order.version ?? '—'),
    resultLine('订单状态', order.status || '—'),
    resultLine('履约状态', order.fulfillmentStatus || '—'),
    resultLine('发货结果', state.shipment ? `${state.shipment.shipmentNo || state.shipment.id}` : '未发货'),
    resultLine('拒单结果', state.rejected ? `${state.rejected.status || 'REJECTED'}` : '未拒单'),
  ].join('');
  $('supplier-order-items').innerHTML = (order.items || []).length
    ? order.items.map((item) => `<tr><td>${esc(item.productName || item.productId || item.id)}</td><td>${esc(item.quantity || '—')}</td><td>${esc(item.shippedQuantity || item.fulfilledQuantity || '0')}</td><td>${esc(item.status || '—')}</td></tr>`).join('')
    : '<tr><td colspan="4">暂无商品行</td></tr>';
}

function renderFinance() {
  $('supplier-statements').innerHTML = state.statements.length
    ? state.statements.map((item) => `<tr><td>${esc(item.statementNo || item.id)}</td><td>${esc(item.status || '—')}</td><td class="money">${esc(money(item.payableAmount || item.totalPayableAmount))}</td></tr>`).join('')
    : '<tr><td colspan="3">暂无供应商账单</td></tr>';
  $('supplier-payments').innerHTML = state.payments.length
    ? state.payments.map((item) => `<tr><td>${esc(item.paymentNo || item.id)}</td><td>${esc(item.status || '—')}</td><td><button class="secondary" data-payment-id="${esc(item.id)}">选择</button></td></tr>`).join('')
    : '<tr><td colspan="3">暂无付款记录</td></tr>';
  $('supplier-payments').querySelectorAll('[data-payment-id]').forEach((button) => {
    button.addEventListener('click', () => {
      $('payment-id').value = button.dataset.paymentId;
    });
  });
}

function renderDiscrepancyResult() {
  $('discrepancy-label').textContent = state.resolved?.status || state.discrepancy?.status || '等待差异';
  $('discrepancy-label').classList.toggle('tag-ok', Boolean(state.resolved));
  if (!state.resolved && !state.discrepancy) {
    $('discrepancy-result').innerHTML = '<small>选择差异通知后可同意少收、安排补发或退回核对。</small>';
    return;
  }
  $('discrepancy-result').innerHTML = [
    resultLine('差异 ID', state.resolved?.id || state.discrepancy?.id || $('discrepancy-id').value),
    resultLine('当前版本', state.discrepancy?.version ?? '—'),
    resultLine('处理状态', state.resolved?.status || state.discrepancy?.status || '—'),
    resultLine('差异数量', state.resolved?.missingQuantity || state.discrepancy?.missingQuantity || '—'),
  ].join('');
}

function renderPaymentResult() {
  $('payment-label').textContent = state.payment?.status || '等待付款';
  $('payment-label').classList.toggle('tag-ok', Boolean(state.payment));
  if (!state.payment) {
    $('payment-result').innerHTML = '<small>选择付款记录后可确认收款或驳回付款。</small>';
    return;
  }
  $('payment-result').innerHTML = [
    resultLine('付款记录', state.payment.paymentNo || state.payment.id),
    resultLine('付款状态', state.payment.status || '—'),
    resultLine('付款金额', money(state.payment.amount)),
    resultLine('当前版本', state.payment.version ?? '—'),
  ].join('');
}

async function loadSupplierOrder() {
  const supplierOrderId = $('supplier-order-id').value.trim();
  if (!supplierOrderId) throw new Error('请先填写供应商单 ID');
  state.order = await call(`/supplier-orders/${supplierOrderId}`);
  state.shipment = null;
  state.rejected = null;
  render();
}

function shipmentInput() {
  const quantity = $('ship-quantity').value.trim();
  return {
    expectedVersion: state.order.version,
    items: (state.order.items || []).map((item, index) => ({
      orderItemId: item.id,
      shipQuantity: index === 0 && quantity ? quantity : item.quantity,
      permanentlyReduceQuantity: '0',
    })),
    freight: '0.00',
    trackingNo: $('tracking-no').value.trim() || `PX-SUP-${Date.now()}`,
  };
}

async function shipOrder() {
  if (!state.order || state.order.id !== $('supplier-order-id').value.trim()) await loadSupplierOrder();
  const input = shipmentInput();
  await call(`/supplier-orders/${state.order.id}/shipment-preview`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  state.shipment = await call(`/supplier-orders/${state.order.id}/shipments`, {
    method: 'POST',
    headers: { 'idempotency-key': `supplier-workbench-ship-${crypto.randomUUID()}` },
    body: JSON.stringify(input),
  });
  await refreshAll();
}

async function rejectOrder() {
  if (!state.order || state.order.id !== $('supplier-order-id').value.trim()) await loadSupplierOrder();
  state.rejected = await call(`/supplier-orders/${state.order.id}/reject`, {
    method: 'POST',
    headers: { 'idempotency-key': `supplier-workbench-reject-${crypto.randomUUID()}` },
    body: JSON.stringify({ expectedVersion: state.order.version, reason: '供应商工作台拒单' }),
  });
  await refreshAll();
}

async function resolveDiscrepancy(action) {
  const discrepancyId = $('discrepancy-id').value.trim();
  if (!discrepancyId) throw new Error('请先填写差异 ID');
  state.discrepancy = await call(`/discrepancies/${discrepancyId}`);
  state.resolved = await call(`/discrepancies/${discrepancyId}/resolve`, {
    method: 'POST',
    headers: { 'idempotency-key': `supplier-workbench-discrepancy-${action}-${crypto.randomUUID()}` },
    body: JSON.stringify({
      expectedVersion: state.discrepancy.version,
      action,
      reason: $('discrepancy-reason').value.trim() || undefined,
    }),
  });
  await refreshAll();
}

async function handlePayment(action) {
  const paymentId = $('payment-id').value.trim();
  if (!paymentId) throw new Error('请先填写付款记录 ID');
  const payment = await call(`/payment-records/${paymentId}`);
  const payload = action === 'confirm'
    ? { expectedVersion: payment.version }
    : { expectedVersion: payment.version, reason: $('payment-reason').value.trim() || '供应商工作台驳回付款' };
  state.payment = await call(`/payment-records/${paymentId}/${action}`, {
    method: 'POST',
    headers: { 'idempotency-key': `supplier-workbench-payment-${action}-${crypto.randomUUID()}` },
    body: JSON.stringify(payload),
  });
  await refreshFinance();
  render();
}

function bindEvents() {
  $('refresh-supplier-orders').addEventListener('click', async () => {
    try {
      await refreshOrders();
      render();
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('refresh-discrepancies').addEventListener('click', async () => {
    try {
      await refreshDiscrepancies();
      render();
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('refresh-supplier-finance').addEventListener('click', async () => {
    try {
      await refreshFinance();
      render();
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('load-supplier-order').addEventListener('click', async () => {
    try {
      await loadSupplierOrder();
      setNotice('');
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('ship-order').addEventListener('click', async () => {
    try {
      await shipOrder();
      setNotice('');
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('reject-order').addEventListener('click', async () => {
    try {
      await rejectOrder();
      setNotice('');
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('resolve-accept').addEventListener('click', async () => {
    try {
      await resolveDiscrepancy('ACCEPT');
      setNotice('');
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('resolve-replenish').addEventListener('click', async () => {
    try {
      await resolveDiscrepancy('REPLENISH');
      setNotice('');
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('resolve-return').addEventListener('click', async () => {
    try {
      await resolveDiscrepancy('RETURN');
      setNotice('');
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('confirm-payment').addEventListener('click', async () => {
    try {
      await handlePayment('confirm');
      setNotice('');
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('reject-payment').addEventListener('click', async () => {
    try {
      await handlePayment('reject');
      setNotice('');
    } catch (error) {
      setNotice(error.message);
    }
  });
}

async function init() {
  bindEvents();
  try {
    seed = await loadJson('/main-flow-demo-seed.json');
    await loginSupplier();
    await refreshAll();
  } catch (error) {
    setNotice(error.message);
    $('supplier-page-status').textContent = '需要 main-flow:seed-demo / API';
    render();
  }
}

init();
