const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const api = `${location.protocol}//${location.hostname}:3100/api/v1`;

let seed = null;
let token = null;
let state = {
  requests: [],
  rejections: [],
  detail: null,
  confirmed: null,
  reallocated: null,
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
  $('purchaser-notice').textContent = message || '';
  $('purchaser-notice').classList.toggle('hidden', !message);
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

async function loginPurchaser() {
  const login = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: seed.username, password: seed.password, client: 'purchaser-workbench' }),
  });
  token = login.accessToken;
}

async function refreshRequests() {
  const data = await call('/purchase-requests');
  state.requests = Array.isArray(data) ? data.slice(0, 12) : [];
}

async function refreshRejections() {
  const data = await call('/notifications');
  state.rejections = (data.notifications || [])
    .filter((item) => item.payload?.type === 'SUPPLIER_ORDER_REJECTED' && item.payload?.purchaseRequestId && item.payload?.supplierOrderId)
    .slice(0, 12);
}

async function refreshAll() {
  try {
    await Promise.all([refreshRequests(), refreshRejections()]);
    $('purchaser-page-status').textContent = 'READY';
    $('purchaser-page-status').classList.add('tag-ok');
    $('purchaser-updated').textContent = new Date().toLocaleString();
    setNotice('');
  } catch (error) {
    setNotice(error.message);
  }
  render();
}

function render() {
  renderSummary();
  renderRequests();
  renderRejections();
  renderDetail();
  renderReallocateResult();
}

function renderSummary() {
  const pending = state.requests.filter((item) => item.status === 'PENDING_PROCUREMENT' || item.status === 'SUBMITTED').length;
  $('purchaser-summary').innerHTML = [
    metric('采购账号', seed?.username || '未加载', token ? '已登录真实 API' : '等待登录', Boolean(token)),
    metric('申请数', state.requests.length, '来自 /purchase-requests', true),
    metric('待确认', pending, 'PENDING_PROCUREMENT / SUBMITTED'),
    metric('拒单待办', state.rejections.length, '来自 /notifications'),
  ].join('');
}

function renderRequests() {
  $('purchase-requests').innerHTML = state.requests.length
    ? state.requests.map((item) => `<tr><td>${esc(item.requestNo || item.id)}</td><td><span class="tag">${esc(item.status || '—')}</span></td><td>${esc(item.paymentStatus || item.fundsStatus || '—')}</td><td><button class="secondary" data-request-id="${esc(item.id)}">详情</button></td></tr>`).join('')
    : '<tr><td colspan="4">暂无采购申请</td></tr>';
  $('purchase-requests').querySelectorAll('[data-request-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      $('request-id').value = button.dataset.requestId;
      await loadRequestDetail();
    });
  });
}

function renderRejections() {
  if (!state.rejections.length) {
    $('rejection-todos').innerHTML = '<div class="empty"><strong>暂无拒单待办</strong><small>供应商拒单后会在这里进入改派</small></div>';
    return;
  }
  $('rejection-todos').innerHTML = state.rejections.map((item) => {
    const purchaseRequestId = item.payload?.purchaseRequestId || '';
    const supplierOrderId = item.payload?.supplierOrderId || '';
    return `<article><div><strong>${esc(item.title || '供应商拒单待处理')}</strong><small>${esc(item.payload?.supplierOrderNo || supplierOrderId)} · ${esc(item.payload?.reason || item.createdAt || '')}</small></div><button class="secondary" data-rejection-request-id="${esc(purchaseRequestId)}" data-rejected-order-id="${esc(supplierOrderId)}">处理</button></article>`;
  }).join('');
  $('rejection-todos').querySelectorAll('[data-rejection-request-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      $('request-id').value = button.dataset.rejectionRequestId;
      $('rejected-order-id').value = button.dataset.rejectedOrderId;
      $('target-supplier-id').value = seed.secondarySupplierId || '';
      await loadRequestDetail();
    });
  });
}

function renderDetail() {
  const detail = state.detail;
  $('request-detail-label').textContent = state.confirmed?.status || detail?.status || '等待选择';
  $('request-detail-label').classList.toggle('tag-ok', Boolean(state.confirmed));
  if (!detail) {
    $('request-detail').innerHTML = '<small>从申请列表或拒单待办选择采购申请后，这里展示版本、金额和资金状态。</small>';
    $('request-items').innerHTML = '<tr><td colspan="4">暂无商品行</td></tr>';
    return;
  }
  $('request-detail').innerHTML = [
    resultLine('申请单', detail.requestNo || detail.id),
    resultLine('当前版本', detail.version ?? '—'),
    resultLine('订单状态', detail.status || '—'),
    resultLine('资金状态', detail.paymentStatus || detail.fundsStatus || '—'),
    resultLine('销售额', money(detail.totals?.salesGoodsAmount || detail.salesGoodsAmount)),
    resultLine('确认结果', state.confirmed ? `${state.confirmed.status || 'CONFIRMED'} · ${(state.confirmed.supplierOrderIds || []).join(', ')}` : '未确认'),
  ].join('');
  $('request-items').innerHTML = (detail.items || []).length
    ? detail.items.map((item) => `<tr><td>${esc(item.productName || item.productId || item.id)}</td><td>${esc(item.supplierId || item.targetSupplierId || '—')}</td><td>${esc(item.quantity || '—')}</td><td class="money">${esc(money(item.salesAmount || item.salesGoodsAmount))}</td></tr>`).join('')
    : '<tr><td colspan="4">暂无商品行</td></tr>';
}

function renderReallocateResult() {
  $('reallocate-label').textContent = state.reallocated?.status || '等待拒单';
  $('reallocate-label').classList.toggle('tag-ok', Boolean(state.reallocated));
  if (!state.reallocated) {
    $('reallocate-result').innerHTML = '<small>选择拒单通知后会自动填入采购申请和被拒供应商单，目标供应商默认使用 PXFLOW 备用供应商。</small>';
    return;
  }
  $('reallocate-result').innerHTML = [
    resultLine('采购申请', state.reallocated.requestNo || state.reallocated.id || $('request-id').value),
    resultLine('处理状态', state.reallocated.status || 'REALLOCATED'),
    resultLine('目标供应商', $('target-supplier-id').value || '—'),
    resultLine('新供应商单', (state.reallocated.supplierOrders || []).map((order) => order.id).join(', ') || '已生成'),
  ].join('');
}

async function loadRequestDetail() {
  const requestId = $('request-id').value.trim();
  if (!requestId) throw new Error('请先填写采购申请 ID');
  state.detail = await call(`/purchase-requests/${requestId}`);
  state.confirmed = null;
  render();
}

async function confirmRequest() {
  if (!state.detail || state.detail.id !== $('request-id').value.trim()) await loadRequestDetail();
  state.confirmed = await call(`/purchase-requests/${state.detail.id}/confirm`, {
    method: 'POST',
    headers: { 'idempotency-key': `purchaser-workbench-confirm-${crypto.randomUUID()}` },
    body: JSON.stringify({ expectedVersion: state.detail.version }),
  });
  await refreshAll();
}

async function reallocateRequest() {
  if (!state.detail || state.detail.id !== $('request-id').value.trim()) await loadRequestDetail();
  const rejectedOrderId = $('rejected-order-id').value.trim();
  const targetSupplierId = $('target-supplier-id').value.trim();
  if (!rejectedOrderId) throw new Error('请先填写被拒供应商单 ID');
  if (!targetSupplierId) throw new Error('请先填写目标供应商 ID');
  state.reallocated = await call(`/purchase-requests/${state.detail.id}/reallocate`, {
    method: 'POST',
    headers: { 'idempotency-key': `purchaser-workbench-reallocate-${crypto.randomUUID()}` },
    body: JSON.stringify({
      expectedVersion: state.detail.version,
      rejectedOrderId,
      reason: $('reallocate-reason').value.trim() || '供应商拒单后改派',
      assignments: (state.detail.items || []).map((item) => ({ requestItemId: item.id, supplierId: targetSupplierId })),
    }),
  });
  await refreshAll();
}

function bindEvents() {
  $('refresh-purchase-requests').addEventListener('click', async () => {
    try {
      await refreshRequests();
      render();
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('refresh-rejections').addEventListener('click', async () => {
    try {
      await refreshRejections();
      render();
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('load-request').addEventListener('click', async () => {
    try {
      await loadRequestDetail();
      setNotice('');
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('confirm-request').addEventListener('click', async () => {
    try {
      await confirmRequest();
      setNotice('');
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('reallocate-request').addEventListener('click', async () => {
    try {
      await reallocateRequest();
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
    $('target-supplier-id').value = seed.secondarySupplierId || '';
    await loginPurchaser();
    await refreshAll();
  } catch (error) {
    setNotice(error.message);
    $('purchaser-page-status').textContent = '需要 main-flow:seed-demo / API';
    render();
  }
}

init();
