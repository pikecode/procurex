const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const api = `${location.protocol}//${location.hostname}:3100/api/v1`;

let seed = null;
let token = null;
let state = {
  account: null,
  ledgers: [],
  requests: [],
  notifications: [],
  shipment: null,
  receipt: null,
  preview: null,
  created: null,
  error: '',
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

function money(value) {
  if (value === undefined || value === null || value === '') return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `¥${numeric.toFixed(2)}`;
}

function firstValue(object, keys, fallback = '—') {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return fallback;
}

function setNotice(message) {
  $('store-notice').textContent = message || '';
  $('store-notice').classList.toggle('hidden', !message);
}

function metric(label, value, foot, emphasis = false) {
  return `<article class="metric ${emphasis ? 'emphasis' : ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></article>`;
}

function orderInput() {
  return {
    storeId: $('store-id').value.trim(),
    items: [{ productId: $('product-id').value.trim(), quantity: $('quantity').value.trim() }],
  };
}

async function loginStore() {
  const login = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: seed.storeUsername, password: seed.password, client: 'store-workbench' }),
  });
  token = login.accessToken;
}

async function refreshAccount() {
  const storeId = $('store-id').value.trim();
  if (!storeId) throw new Error('请先填写门店 ID');
  const [account, ledgers] = await Promise.all([
    call(`/stores/${storeId}/account`),
    call(`/stores/${storeId}/ledgers`),
  ]);
  state.account = account;
  state.ledgers = Array.isArray(ledgers) ? ledgers.slice(0, 8) : [];
}

async function refreshOrders() {
  const data = await call('/purchase-requests');
  state.requests = Array.isArray(data) ? data.slice(0, 10) : [];
}

async function refreshNotifications() {
  const data = await call('/notifications');
  state.notifications = (data.notifications || [])
    .filter((item) => item.payload?.type === 'SHIPMENT_CREATED' || item.payload?.type === 'DISCREPANCY_RESOLVED' || item.payload?.shipmentId)
    .slice(0, 10);
}

async function refreshAll() {
  try {
    await Promise.all([refreshAccount(), refreshOrders(), refreshNotifications()]);
    state.error = '';
    setNotice('');
    $('store-page-status').textContent = 'READY';
    $('store-page-status').classList.add('tag-ok');
    $('store-updated').textContent = new Date().toLocaleString();
  } catch (error) {
    state.error = error.message;
    setNotice(error.message);
  }
  render();
}

function render() {
  renderSummary();
  renderAccount();
  renderOrders();
  renderNotifications();
  renderOrderResult();
  renderReceipt();
}

function renderSummary() {
  const available = firstValue(state.account, ['availableBalance', 'availableAmount', 'balance']);
  const unread = state.notifications.filter((item) => !item.readAt).length;
  $('store-summary').innerHTML = [
    metric('门店账号', seed?.storeUsername || '未加载', token ? '已登录真实 API' : '等待登录', Boolean(token)),
    metric('可用余额', money(available), '来自 /stores/{id}/account', true),
    metric('最近订单', state.requests.length, '来自 /purchase-requests'),
    metric('待处理提醒', unread || state.notifications.length, '来自 /notifications'),
  ].join('');
}

function renderAccount() {
  const account = state.account;
  if (!account) {
    $('store-account').innerHTML = '<div class="empty"><strong>暂无账户数据</strong><small>刷新后展示门店余额与授信</small></div>';
    $('store-ledgers').innerHTML = '';
    return;
  }
  $('store-account').innerHTML = [
    accountItem('余额', money(firstValue(account, ['balance', 'cashBalance', 'availableBalance']))),
    accountItem('授信额度', money(firstValue(account, ['creditLimit', 'authorizedCreditAmount']))),
    accountItem('已用额度', money(firstValue(account, ['usedCredit', 'creditUsedAmount', 'outstandingAmount']))),
    accountItem('可用', money(firstValue(account, ['availableBalance', 'availableCreditAmount', 'availableAmount']))),
  ].join('');
  $('store-ledgers').innerHTML = state.ledgers.length
    ? state.ledgers.map((item) => `<tr><td>${esc(item.type || item.direction || item.sourceType || 'LEDGER')}</td><td class="money">${esc(money(item.amount || item.deltaAmount || item.balanceDelta))}</td><td>${esc(item.businessNo || item.referenceNo || item.remark || item.createdAt || '—')}</td></tr>`).join('')
    : '<tr><td colspan="3">暂无流水</td></tr>';
}

function accountItem(label, value) {
  return `<article><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`;
}

function renderOrders() {
  $('store-orders').innerHTML = state.requests.length
    ? state.requests.map((item) => `<tr><td>${esc(item.requestNo || item.id)}</td><td><span class="tag">${esc(item.status || '—')}</span></td><td>${esc(item.paymentStatus || item.fundsStatus || '—')}</td><td class="money">${esc(money(item.totals?.salesGoodsAmount || item.salesGoodsAmount || item.totalAmount))}</td></tr>`).join('')
    : '<tr><td colspan="4">暂无订货单</td></tr>';
}

function renderNotifications() {
  if (!state.notifications.length) {
    $('store-notifications').innerHTML = '<div class="empty"><strong>暂无待收货提醒</strong><small>发货后会在这里进入收货</small></div>';
    return;
  }
  $('store-notifications').innerHTML = state.notifications.map((item) => {
    const shipmentId = item.payload?.shipmentId || '';
    const action = shipmentId ? `<button class="secondary" data-shipment-id="${esc(shipmentId)}">选择</button>` : '';
    return `<article><div><strong>${esc(item.title || '门店通知')}</strong><small>${esc(item.content || item.payload?.shipmentNo || item.createdAt || '')}</small></div>${action}</article>`;
  }).join('');
  $('store-notifications').querySelectorAll('[data-shipment-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      $('shipment-id').value = button.dataset.shipmentId;
      await loadShipment();
    });
  });
}

function renderOrderResult() {
  const label = state.created?.status || state.preview?.paymentStatus || '待预览';
  $('store-order-label').textContent = label;
  $('store-order-label').classList.toggle('tag-ok', Boolean(state.created));
  if (!state.preview && !state.created) {
    $('order-preview').innerHTML = '<small>填写门店、商品和数量后先预览金额，再提交订货。</small>';
    return;
  }
  const preview = state.preview || {};
  const created = state.created || {};
  $('order-preview').innerHTML = [
    resultLine('预览销售额', money(preview.totals?.salesGoodsAmount || preview.salesGoodsAmount)),
    resultLine('预览供货额', money(preview.totals?.supplyGoodsAmount || preview.supplyGoodsAmount)),
    resultLine('订货单', created.requestNo || created.id || '未提交'),
    resultLine('资金状态', created.paymentStatus || preview.paymentStatus || '—'),
  ].join('');
}

function resultLine(label, value) {
  return `<article><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`;
}

function renderReceipt() {
  const shipment = state.shipment;
  const receipt = state.receipt;
  $('receipt-label').textContent = receipt?.status || shipment?.status || '等待发货单';
  $('receipt-label').classList.toggle('tag-ok', Boolean(receipt));
  if (!shipment && !receipt) {
    $('store-receipt').innerHTML = '<small>可从待收货提醒选择发货单，也可手工输入发货单 ID。</small>';
    return;
  }
  const rows = (shipment?.items || []).map((item) => resultLine(item.productName || item.productId || item.id, `${item.shippedQuantity || item.quantity || '—'}`)).join('');
  $('store-receipt').innerHTML = [
    resultLine('发货单', shipment?.shipmentNo || shipment?.id || '—'),
    resultLine('订单版本', shipment?.supplierOrderVersion ?? '—'),
    resultLine('收货 revision', shipment?.currentReceiptRevision ?? '—'),
    rows,
    receipt ? resultLine('收货结果', `${receipt.receiptNo || receipt.id} · revision ${receipt.revision ?? '—'}`) : '',
  ].join('');
}

async function previewOrder() {
  state.preview = await call('/purchase-requests/preview', {
    method: 'POST',
    body: JSON.stringify(orderInput()),
  });
  state.created = null;
  render();
}

async function submitOrder(event) {
  event.preventDefault();
  if (!state.preview) await previewOrder();
  state.created = await call('/purchase-requests', {
    method: 'POST',
    headers: { 'idempotency-key': `store-workbench-order-${crypto.randomUUID()}` },
    body: JSON.stringify(orderInput()),
  });
  await refreshAll();
}

async function loadShipment() {
  const shipmentId = $('shipment-id').value.trim();
  if (!shipmentId) throw new Error('请先填写发货单 ID');
  state.shipment = await call(`/shipments/${shipmentId}`);
  state.receipt = null;
  render();
}

async function receiveShipment(mode) {
  if (!state.shipment) await loadShipment();
  const shortQuantity = $('short-quantity').value.trim();
  const items = (state.shipment.items || []).map((item, index) => ({
    shipmentItemId: item.id,
    receivedQuantity: mode === 'SHORT' && index === 0 ? shortQuantity : item.shippedQuantity,
  }));
  state.receipt = await call(`/shipments/${state.shipment.id}/receipts`, {
    method: 'POST',
    headers: { 'idempotency-key': `store-workbench-receipt-${mode}-${crypto.randomUUID()}` },
    body: JSON.stringify({
      expectedOrderVersion: state.shipment.supplierOrderVersion,
      expectedReceiptRevision: state.shipment.currentReceiptRevision,
      items,
    }),
  });
  await refreshAll();
}

function bindEvents() {
  $('preview-order').addEventListener('click', async () => {
    try {
      await previewOrder();
      setNotice('');
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('store-order-form').addEventListener('submit', async (event) => {
    try {
      await submitOrder(event);
    } catch (error) {
      event.preventDefault();
      setNotice(error.message);
    }
  });
  $('refresh-store-account').addEventListener('click', async () => {
    try {
      await refreshAccount();
      render();
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('refresh-store-orders').addEventListener('click', async () => {
    try {
      await refreshOrders();
      renderOrders();
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('refresh-store-notifications').addEventListener('click', async () => {
    try {
      await refreshNotifications();
      renderNotifications();
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('load-shipment').addEventListener('click', async () => {
    try {
      await loadShipment();
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('receive-full').addEventListener('click', async () => {
    try {
      await receiveShipment('FULL');
    } catch (error) {
      setNotice(error.message);
    }
  });
  $('receive-short').addEventListener('click', async () => {
    try {
      await receiveShipment('SHORT');
    } catch (error) {
      setNotice(error.message);
    }
  });
}

async function init() {
  bindEvents();
  try {
    seed = await loadJson('/main-flow-demo-seed.json');
    $('store-id').value = seed.storeId || '';
    $('product-id').value = seed.productId || '';
    $('quantity').value = seed.quantity || '10';
    await loginStore();
    await refreshAll();
  } catch (error) {
    setNotice(error.message);
    $('store-page-status').textContent = '需要 main-flow:seed-demo / API';
    render();
  }
}

init();
