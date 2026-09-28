const api = `${location.protocol}//${location.hostname}:3100/api/v1`;
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = (value) => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let token = null;
let seed = null;
let state = {};
let running = false;

const steps = [
  { key: 'login', title: '登录演示账号', run: login },
  { key: 'create', title: '门店下单', run: createRequest },
  { key: 'confirm', title: '采购确认并推送供应商单', run: confirmRequest },
  { key: 'ship', title: '供应商发货', run: createShipment },
  { key: 'receive', title: '门店收货完成订单', run: createReceipt },
  { key: 'billing', title: '读取账单并预览付款', run: previewPayment },
];

function notice(message) {
  $('notice').textContent = message;
  $('notice').classList.remove('hidden');
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

async function loadSeed() {
  $('notice').classList.add('hidden');
  try {
    const response = await fetch(`/main-flow-demo-seed.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error('还没有主流程 demo 种子数据');
    seed = await response.json();
    state = {};
    token = null;
    $('seed-status').textContent = new Date(seed.generatedAt).toLocaleString('zh-CN');
    $('identity').textContent = seed.username;
    render();
  } catch (error) {
    seed = null;
    state = {};
    $('seed-status').textContent = '未生成';
    $('identity').textContent = '未登录';
    $('summary').innerHTML = metric('运行命令', 'main-flow:seed-demo', '先执行 npm run build');
    $('steps').innerHTML = '';
    $('empty').classList.remove('hidden');
    notice(error.message);
  }
}

async function loadDemoEvidence() {
  try {
    const response = await fetch(`/main-flow-demo-run.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error('missing demo run output');
    const result = await response.json();
    const steps = result.steps || [];
    $('demo-evidence-label').textContent = result.status || 'UNKNOWN';
    $('demo-evidence-label').classList.toggle('tag-ok', result.status === 'PASSED');
    $('demo-evidence-label').classList.toggle('tag-fail', result.status && result.status !== 'PASSED');
    $('demo-evidence').innerHTML = [
      `<article><strong>${esc(result.summary || '主流程证据已生成')}</strong><small>${esc(result.generatedAt || '')}</small></article>`,
      ...steps.map((step) => `<article><strong>${esc(step.title)}</strong><small>${esc(flattenData(step.data))}</small></article>`),
    ].join('');
  } catch {
    $('demo-evidence-label').textContent = '未生成';
    $('demo-evidence').innerHTML = '<article><strong>尚未生成主流程证据</strong><small>运行 npm run main-flow:check-demo 后刷新页面</small></article>';
  }
}

function flattenData(data) {
  return Object.entries(data || {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' · ');
}

function render() {
  $('empty').classList.toggle('hidden', !!seed);
  $('run-all').disabled = !seed || running || allDone();
  $('run-all').textContent = running ? '执行中...' : allDone() ? '已完成' : '一键执行';
  $('reset').disabled = running;
  $('summary').innerHTML =
    metric('门店下单金额', seed?.expectedSalesAmount || '—', seed ? money(seed.expectedSalesAmount) : '等待种子') +
    metric('供应商应付', seed?.expectedSupplyAmount || '—', seed ? money(seed.expectedSupplyAmount) : '等待种子', true) +
    metric('当前阶段', currentStage(), '按顺序推进') +
    metric('付款预览', state.paymentPreview?.totalPayableAmount || '—', state.paymentPreview ? state.paymentPreview.direction : '未到达');
  $('steps').innerHTML = steps.map((step, index) => {
    const done = state[step.key];
    const enabled = seed && !running && (index === 0 || state[steps[index - 1].key]) && !done;
    return `<tr><td><strong>${esc(step.title)}</strong></td><td>${done ? '<span class="tag tag-settled">已完成</span>' : '<span class="tag tag-open">待执行</span>'}</td><td>${esc(summary(step.key))}</td><td><button class="payment-button" data-step="${esc(step.key)}" ${enabled ? '' : 'disabled'}>执行</button></td></tr>`;
  }).join('');
  $('steps').querySelectorAll('[data-step]').forEach((button) => button.addEventListener('click', () => runStep(button.dataset.step)));
}

function metric(label, value, foot, emphasis = false) {
  return `<div class="metric ${emphasis ? 'emphasis' : ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></div>`;
}

function currentStage() {
  const last = [...steps].reverse().find((step) => state[step.key]);
  return last ? last.title : '尚未开始';
}

function allDone() {
  return steps.every((step) => state[step.key]);
}

function summary(key) {
  if (key === 'login' && state.login) return `token ready`;
  if (key === 'create' && state.create) return `${state.create.status} / ${money(state.create.totals.salesGoodsAmount)}`;
  if (key === 'confirm' && state.confirm) return `${state.supplierOrder.status} / ${state.supplierOrder.id}`;
  if (key === 'ship' && state.ship) return `${state.ship.kind} / ${state.ship.id}`;
  if (key === 'receive' && state.receive) return `${state.completedOrder.fulfillmentStatus} / ${state.receive.id}`;
  if (key === 'billing' && state.billing) return `${state.paymentPreview.direction} / ${money(state.paymentPreview.totalPayableAmount)}`;
  return '—';
}

async function runStep(key) {
  $('notice').classList.add('hidden');
  const step = steps.find((item) => item.key === key);
  try {
    running = true;
    render();
    await step.run();
    running = false;
    render();
  } catch (error) {
    running = false;
    render();
    notice(error.message);
  }
}

async function runAll() {
  if (!seed || running || allDone()) return;
  $('notice').classList.add('hidden');
  running = true;
  render();
  try {
    for (const step of steps) {
      if (!state[step.key]) {
        await step.run();
        render();
      }
    }
    notice('主流程已执行到付款预览。');
  } catch (error) {
    notice(error.message);
  } finally {
    running = false;
    render();
  }
}

async function login() {
  const data = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: seed.username, password: seed.password, client: 'web' }),
  });
  token = data.accessToken;
  state.login = true;
  $('identity').textContent = `${data.user.displayName} · ${(data.user.roles || []).join(', ')}`;
}

async function createRequest() {
  state.create = await call('/purchase-requests', {
    method: 'POST',
    headers: { 'idempotency-key': `flow-demo-create-${crypto.randomUUID()}` },
    body: JSON.stringify({ storeId: seed.storeId, items: [{ productId: seed.productId, quantity: seed.quantity }] }),
  });
}

async function confirmRequest() {
  state.confirm = await call(`/purchase-requests/${state.create.id}/confirm`, {
    method: 'POST',
    headers: { 'idempotency-key': `flow-demo-confirm-${crypto.randomUUID()}` },
    body: JSON.stringify({ expectedVersion: state.create.version }),
  });
  state.supplierOrder = await call(`/supplier-orders/${state.confirm.supplierOrderIds[0]}`);
}

async function createShipment() {
  const item = state.supplierOrder.items[0];
  state.ship = await call(`/supplier-orders/${state.supplierOrder.id}/shipments`, {
    method: 'POST',
    headers: { 'idempotency-key': `flow-demo-ship-${crypto.randomUUID()}` },
    body: JSON.stringify({
      expectedVersion: state.supplierOrder.version,
      freight: '0.00',
      items: [{ orderItemId: item.id, shipQuantity: item.quantity, permanentlyReduceQuantity: '0.000000' }],
    }),
  });
  state.orderAfterShipment = await call(`/supplier-orders/${state.supplierOrder.id}`);
}

async function createReceipt() {
  state.receive = await call(`/shipments/${state.ship.id}/receipts`, {
    method: 'POST',
    headers: { 'idempotency-key': `flow-demo-receive-${crypto.randomUUID()}` },
    body: JSON.stringify({
      expectedOrderVersion: state.orderAfterShipment.version,
      expectedReceiptRevision: 0,
      items: state.ship.items.map((item) => ({ shipmentItemId: item.id, receivedQuantity: item.quantity })),
    }),
  });
  state.completedOrder = await call(`/supplier-orders/${state.supplierOrder.id}`);
}

async function previewPayment() {
  const statements = await call(`/supplier-statements?supplierId=${seed.supplierId}`);
  state.billing = statements.find((statement) => statement.supplierId === seed.supplierId);
  const detail = await call(`/supplier-statements/${encodeURIComponent(state.billing.id)}`);
  state.paymentPreview = await call('/payment-records/preview', {
    method: 'POST',
    body: JSON.stringify({ settlementItemIds: [detail.lines[0].settlementItemId] }),
  });
}

$('reset').addEventListener('click', loadSeed);
$('run-all').addEventListener('click', runAll);
loadSeed();
loadDemoEvidence();
