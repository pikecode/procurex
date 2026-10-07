const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const api = `${location.protocol}//${location.hostname}:3100/api/v1`;

let seed = null;
let run = null;
let activeRole = 'Store';
let storeToken = null;
let purchaserToken = null;
let supplierToken = null;
let storeAction = null;
let purchaserAction = null;
let shipmentAction = null;
let receiptAction = null;
let discrepancyAction = null;
let rejectionAction = null;
let discrepancyBranchesAction = null;
let actionRunning = false;

const roleDefinitions = {
  Store: {
    title: '门店工作台',
    entry: 'S01/S04',
    scope: '门店账号只看本门店订单、收货和通知',
    todos: ['创建或复核门店订货', '处理待收货提醒', '查看差异处理结果'],
    actions: ['下单入口', '收货确认', '差异结果通知'],
    next: '门店下单、收货和差异结果通知已接入真实 API；下一步继续接移动端验收。',
  },
  Purchaser: {
    title: '采购工作台',
    entry: 'W01/W02',
    scope: '采购账号处理确认、分派、拒单和异常队列',
    todos: ['确认采购申请', '查看供应商拒单通知', '追踪订单审计动作'],
    actions: ['采购确认', '供应商改派', '异常队列'],
    next: '采购确认、拒单处理和多供应商改派已接入真实 API；下一步继续接移动端异常队列。',
  },
  Supplier: {
    title: '供应商工作台',
    entry: 'S06/S07',
    scope: '供应商账号只看本供应商订单、发货和差异',
    todos: ['查看待发货订单', '创建发货记录', '处理收货差异'],
    actions: ['发货', '差异处理', '拒单'],
    next: '供应商发货、差异处理、补发、退回和拒单已接入真实 API；下一步继续接移动端异常队列。',
  },
  Operator: {
    title: '运营联调台',
    entry: 'M5/MainFlow',
    scope: '联调账号继续覆盖完整链路冒烟',
    todos: ['一键执行订单到付款预览', '复核通知和审计证据', '守住 M5 close gate'],
    actions: ['主流程冒烟', '证据复核', '门禁回归'],
    next: '继续作为端到端回归入口，避免角色拆分后主链路断裂。',
  },
};

function roleOrder() {
  return ['Store', 'Purchaser', 'Supplier', 'Operator'];
}

function evidenceFor(role) {
  return (run?.roleEvidence || []).find((item) => item.role === role);
}

function seedFor(role) {
  return (seed?.roleAccounts || []).find((item) => item.role === role);
}

function statusFor(role) {
  return evidenceFor(role)?.status || (seedFor(role) ? 'PENDING' : 'MISSING');
}

async function call(path, options = {}, token = storeToken) {
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

async function loadJson(path) {
  const response = await fetch(`${path}?ts=${Date.now()}`);
  if (!response.ok) throw new Error(`${path} 未生成`);
  return response.json();
}

async function init() {
  try {
    [seed, run] = await Promise.all([
      loadJson('/main-flow-demo-seed.json'),
      loadJson('/main-flow-demo-run.json'),
    ]);
    $('identity').textContent = `${seed.username} · ${run.status}`;
    $('role-workbench-status').textContent = run.status || 'UNKNOWN';
    $('role-workbench-status').classList.toggle('tag-ok', run.status === 'PASSED');
    render();
  } catch (error) {
    $('notice').textContent = error.message;
    $('notice').classList.remove('hidden');
    $('summary').innerHTML = metric('运行命令', 'main-flow:seed-demo', '生成角色账号') + metric('运行命令', 'main-flow:check-demo', '生成角色证据');
    $('role-lanes-label').textContent = '未生成';
    $('role-detail-label').textContent = '未生成';
    $('role-action-label').textContent = '未生成';
    $('role-actions').innerHTML = '';
    $('evidence-label').textContent = '未生成';
  }
}

function render() {
  const roles = roleOrder();
  if (!roles.includes(activeRole)) activeRole = roles[0];
  $('summary').innerHTML = [
    metric('角色入口', roles.length, '门店 / 采购 / 供应商 / 运营', true),
    metric('主流程状态', run?.status || 'UNKNOWN', run?.generatedAt || ''),
    metric('角色证据', `${run?.roleEvidence?.length || 0}/4`, '来自 main-flow-demo-run.json'),
    metric('下一步', '真实页面拆分', '先页面骨架，后接操作 API'),
  ].join('');
  $('role-lanes-label').textContent = run?.status || 'UNKNOWN';
  $('role-lanes-label').classList.toggle('tag-ok', run?.status === 'PASSED');
  $('role-lanes').innerHTML = roles.map((role) => laneCard(role)).join('');
  $('role-tabs').innerHTML = roles.map((role) => `<button class="tab ${role === activeRole ? 'active' : ''}" data-role="${esc(role)}">${esc(roleDefinitions[role].title)}<span>${esc(statusFor(role))}</span></button>`).join('');
  $('role-tabs').querySelectorAll('[data-role]').forEach((button) => button.addEventListener('click', () => {
    activeRole = button.dataset.role;
    render();
  }));
  renderDetail();
  renderActions();
  renderEvidenceMap();
}

function laneCard(role) {
  const definition = roleDefinitions[role];
  const evidence = evidenceFor(role);
  const account = evidence?.account || seedFor(role)?.username || '未生成';
  return `<article class="role-lane ${role === activeRole ? 'active' : ''}" data-role="${esc(role)}"><button data-lane="${esc(role)}"><strong>${esc(definition.title)}</strong><span>${esc(statusFor(role))}</span></button><small>${esc(account)} · ${esc(definition.entry)}</small><p>${esc(evidence?.surface || definition.scope)}</p></article>`;
}

function renderDetail() {
  const definition = roleDefinitions[activeRole];
  const evidence = evidenceFor(activeRole);
  const account = evidence?.account || seedFor(activeRole)?.username || '未生成';
  $('role-detail-label').textContent = statusFor(activeRole);
  $('role-detail-label').classList.toggle('tag-ok', statusFor(activeRole) === 'PASSED');
  $('role-detail').innerHTML = [
    panel('角色账号', account, definition.scope),
    panel('当前待办', definition.todos.join(' · '), evidence?.surface || '等待角色证据'),
    panel('可执行动作', definition.actions.join(' · '), '后续将接入真实 API 按钮'),
    panel('下一步页面边界', definition.next, evidence?.evidence || '等待 main-flow:check-demo'),
  ].join('');
  $('role-lanes').querySelectorAll('[data-lane]').forEach((button) => button.addEventListener('click', () => {
    activeRole = button.dataset.lane;
    render();
  }));
}

function renderActions() {
  $('role-action-label').textContent = discrepancyBranchesAction?.status || rejectionAction?.status || discrepancyAction?.status || receiptAction?.status || shipmentAction?.status || purchaserAction?.status || storeAction?.status || (actionRunning ? '执行中' : '等待操作');
  $('role-action-label').classList.toggle('tag-ok', discrepancyBranchesAction?.status === 'BRANCHES_READY' || rejectionAction?.status === 'REALLOCATED' || discrepancyAction?.status === 'RESOLVED' || receiptAction?.status === 'COMPLETED' || shipmentAction?.status === 'SHIPPED' || purchaserAction?.status === 'CONFIRMED' || storeAction?.status === 'PENDING_PROCUREMENT');
  const storeDisabled = !seed || actionRunning ? 'disabled' : '';
  const purchaserDisabled = !seed || actionRunning || !storeAction?.requestId || purchaserAction?.status === 'CONFIRMED' ? 'disabled' : '';
  const supplierDisabled = !seed || actionRunning || !purchaserAction?.supplierOrderIds?.length || shipmentAction?.status === 'SHIPPED' ? 'disabled' : '';
  const receiptDisabled = !seed || actionRunning || !shipmentAction?.shipmentId || receiptAction?.status === 'COMPLETED' ? 'disabled' : '';
  const discrepancyDisabled = !seed || actionRunning || discrepancyAction?.status === 'RESOLVED' ? 'disabled' : '';
  const rejectionDisabled = !seed || actionRunning || rejectionAction?.status === 'REALLOCATED' ? 'disabled' : '';
  const discrepancyBranchesDisabled = !seed || actionRunning || discrepancyBranchesAction?.status === 'BRANCHES_READY' ? 'disabled' : '';
  $('role-actions').innerHTML = [
    `<article><strong>门店真实下单</strong><small>使用 ${esc(seed?.storeUsername || 'pxflow_store')} 登录，调用 /purchase-requests/preview 和 /purchase-requests</small><button id="store-order-action" class="primary" ${storeDisabled}>${actionRunning ? '执行中...' : '预览并创建订货单'}</button></article>`,
    `<article><strong>采购真实确认</strong><small>使用 ${esc(seed?.username || 'pxflow_user')} 的采购权限，调用 /purchase-requests/{id}/confirm 生成供应商单</small><button id="purchaser-confirm-action" class="primary" ${purchaserDisabled}>确认并生成供应商单</button></article>`,
    `<article><strong>供应商真实发货</strong><small>使用 ${esc(seed?.supplierUsername || 'pxflow_supplier')} 登录，调用 /supplier-orders/{id}/shipment-preview 和 /supplier-orders/{id}/shipments</small><button id="supplier-shipment-action" class="primary" ${supplierDisabled}>预览并创建发货单</button></article>`,
    `<article><strong>门店真实收货</strong><small>使用 ${esc(seed?.storeUsername || 'pxflow_store')} 的门店权限，调用 /shipments/{id}/receipts 完成收货</small><button id="store-receipt-action" class="primary" ${receiptDisabled}>确认收货并完成订单</button></article>`,
    `<article><strong>供应商差异处理</strong><small>创建一张少收异常单，读取供应商差异通知，并调用 /discrepancies/{id}/resolve 同意少收</small><button id="supplier-discrepancy-action" class="primary" ${discrepancyDisabled}>少收并处理差异</button></article>`,
    `<article><strong>供应商拒单改派</strong><small>创建一张待发供应商单，供应商拒单后由采购调用 /purchase-requests/{id}/reallocate 改派到备用供应商</small><button id="supplier-rejection-action" class="primary" ${rejectionDisabled}>拒单并改派供应商</button></article>`,
    `<article><strong>差异补发与退回</strong><small>分别演练 REPLENISH 补发到货和 RETURN 退回记录，覆盖差异处理剩余分支</small><button id="supplier-discrepancy-branches-action" class="primary" ${discrepancyBranchesDisabled}>补发并退回分支</button></article>`,
    `<article><strong>门店结果</strong><small id="store-order-result">${esc(storeResultText())}</small></article>`,
    `<article><strong>采购结果</strong><small id="purchaser-confirm-result">${esc(purchaserResultText())}</small></article>`,
    `<article><strong>供应商结果</strong><small id="supplier-shipment-result">${esc(shipmentResultText())}</small></article>`,
    `<article><strong>收货结果</strong><small id="store-receipt-result">${esc(receiptResultText())}</small></article>`,
    `<article><strong>差异结果</strong><small id="supplier-discrepancy-result">${esc(discrepancyResultText())}</small></article>`,
    `<article><strong>拒单结果</strong><small id="supplier-rejection-result">${esc(rejectionResultText())}</small></article>`,
    `<article><strong>差异分支</strong><small id="supplier-discrepancy-branches-result">${esc(discrepancyBranchesResultText())}</small></article>`,
  ].join('');
  $('store-order-action')?.addEventListener('click', runStoreOrderAction);
  $('purchaser-confirm-action')?.addEventListener('click', runPurchaserConfirmAction);
  $('supplier-shipment-action')?.addEventListener('click', runSupplierShipmentAction);
  $('store-receipt-action')?.addEventListener('click', runStoreReceiptAction);
  $('supplier-discrepancy-action')?.addEventListener('click', runSupplierDiscrepancyAction);
  $('supplier-rejection-action')?.addEventListener('click', runSupplierRejectionAction);
  $('supplier-discrepancy-branches-action')?.addEventListener('click', runSupplierDiscrepancyBranchesAction);
}

function storeResultText() {
  if (!storeAction) return '尚未执行真实门店下单';
  return `${storeAction.requestNo} · ${storeAction.status} · ${storeAction.paymentStatus} · ${storeAction.salesGoodsAmount}`;
}

function purchaserResultText() {
  if (!purchaserAction) return storeAction ? '等待采购确认' : '请先执行门店下单';
  return `${purchaserAction.status} · ${purchaserAction.supplierOrderIds.join(', ')}`;
}

function shipmentResultText() {
  if (!shipmentAction) return purchaserAction ? '等待供应商发货' : '请先执行采购确认';
  return `${shipmentAction.status} · ${shipmentAction.shipmentNo || shipmentAction.shipmentId} · ${shipmentAction.shipQuantity || '—'}`;
}

function receiptResultText() {
  if (!receiptAction) return shipmentAction ? '等待门店收货' : '请先执行供应商发货';
  return `${receiptAction.status} · ${receiptAction.receiptNo || receiptAction.receiptId} · ${receiptAction.receivedQuantity || '—'}`;
}

function discrepancyResultText() {
  if (!discrepancyAction) return '尚未执行少收差异处理';
  return `${discrepancyAction.status} · ${discrepancyAction.discrepancyId || discrepancyAction.receiptNo} · ${discrepancyAction.missingQuantity || '—'}`;
}

function rejectionResultText() {
  if (!rejectionAction) return '尚未执行供应商拒单处理';
  return `${rejectionAction.status} · ${rejectionAction.supplierOrderId || rejectionAction.requestId} · ${rejectionAction.targetSupplierId || rejectionAction.requestStatus || '—'}`;
}

function discrepancyBranchesResultText() {
  if (!discrepancyBranchesAction) return '尚未执行补发/退回分支';
  return `${discrepancyBranchesAction.status} · ${discrepancyBranchesAction.replenishStatus || '—'} · ${discrepancyBranchesAction.returnStatus || '—'}`;
}

async function runStoreOrderAction() {
  if (!seed || actionRunning) return;
  actionRunning = true;
  renderActions();
  try {
    const login = await call('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: seed.storeUsername, password: seed.password, client: 'role-workbench' }),
    }, null);
    storeToken = login.accessToken;
    const input = { storeId: seed.storeId, items: [{ productId: seed.productId, quantity: seed.quantity }] };
    const preview = await call('/purchase-requests/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const created = await call('/purchase-requests', {
      method: 'POST',
      headers: { 'idempotency-key': `role-workbench-store-order-${crypto.randomUUID()}` },
      body: JSON.stringify(input),
    });
    storeAction = {
      requestId: created.id,
      requestNo: created.requestNo,
      status: created.status,
      paymentStatus: created.paymentStatus,
      version: created.version,
      salesGoodsAmount: created.totals?.salesGoodsAmount || preview.totals?.salesGoodsAmount,
      previewSupplyAmount: preview.totals?.supplyGoodsAmount,
    };
    purchaserAction = null;
    shipmentAction = null;
    receiptAction = null;
    discrepancyAction = null;
    rejectionAction = null;
    discrepancyBranchesAction = null;
  } catch (error) {
    storeAction = { status: 'FAILED', requestNo: '门店下单失败', paymentStatus: error.message, salesGoodsAmount: '—' };
  } finally {
    actionRunning = false;
    renderActions();
  }
}

async function ensureStoreToken() {
  if (storeToken) return storeToken;
  const login = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: seed.storeUsername, password: seed.password, client: 'role-workbench' }),
  }, null);
  storeToken = login.accessToken;
  return storeToken;
}

async function ensurePurchaserToken() {
  if (purchaserToken) return purchaserToken;
  const login = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: seed.username, password: seed.password, client: 'role-workbench' }),
  }, null);
  purchaserToken = login.accessToken;
  return purchaserToken;
}

async function ensureSupplierToken() {
  if (supplierToken) return supplierToken;
  const login = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: seed.supplierUsername, password: seed.password, client: 'role-workbench' }),
  }, null);
  supplierToken = login.accessToken;
  return supplierToken;
}

async function createConfirmedSupplierOrder(prefix) {
  const storeAuth = await ensureStoreToken();
  const input = { storeId: seed.storeId, items: [{ productId: seed.productId, quantity: seed.quantity }] };
  const created = await call('/purchase-requests', {
    method: 'POST',
    headers: { 'idempotency-key': `${prefix}-store-order-${crypto.randomUUID()}` },
    body: JSON.stringify(input),
  }, storeAuth);
  const purchaserAuth = await ensurePurchaserToken();
  const confirmed = await call(`/purchase-requests/${created.id}/confirm`, {
    method: 'POST',
    headers: { 'idempotency-key': `${prefix}-purchaser-confirm-${crypto.randomUUID()}` },
    body: JSON.stringify({ expectedVersion: created.version }),
  }, purchaserAuth);
  return {
    requestId: created.id,
    requestNo: created.requestNo,
    supplierOrderId: confirmed.supplierOrderIds[0],
  };
}

async function createShipmentForOrder(supplierOrderId, prefix, options = {}) {
  const supplierAuth = await ensureSupplierToken();
  const order = await call(`/supplier-orders/${supplierOrderId}`, {}, supplierAuth);
  const items = order.items.map((item) => ({
    orderItemId: item.id,
    shipQuantity: options.shipQuantity || item.quantity,
    permanentlyReduceQuantity: options.permanentlyReduceQuantity || '0',
    ...(options.gapId ? { gapAllocations: [{ gapId: options.gapId, quantity: options.gapQuantity || options.shipQuantity || item.quantity }] } : {}),
  }));
  const input = { expectedVersion: order.version, items, freight: '0.00', trackingNo: `PX-${Date.now()}` };
  await call(`/supplier-orders/${supplierOrderId}/shipment-preview`, {
    method: 'POST',
    body: JSON.stringify(input),
  }, supplierAuth);
  const shipment = await call(`/supplier-orders/${supplierOrderId}/shipments`, {
    method: 'POST',
    headers: { 'idempotency-key': `${prefix}-supplier-shipment-${crypto.randomUUID()}` },
    body: JSON.stringify(input),
  }, supplierAuth);
  const updatedOrder = await call(`/supplier-orders/${supplierOrderId}`, {}, supplierAuth);
  return { shipment, supplierOrderVersion: updatedOrder.version };
}

async function runPurchaserConfirmAction() {
  if (!seed || !storeAction?.requestId || actionRunning || purchaserAction?.status === 'CONFIRMED') return;
  actionRunning = true;
  renderActions();
  try {
    const login = await call('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: seed.username, password: seed.password, client: 'role-workbench' }),
    }, null);
    purchaserToken = login.accessToken;
    const confirmed = await call(`/purchase-requests/${storeAction.requestId}/confirm`, {
      method: 'POST',
      headers: { 'idempotency-key': `role-workbench-purchaser-confirm-${crypto.randomUUID()}` },
      body: JSON.stringify({ expectedVersion: storeAction.version }),
    }, purchaserToken);
    purchaserAction = {
      requestId: confirmed.requestId,
      status: confirmed.status,
      supplierOrderIds: confirmed.supplierOrderIds || [],
    };
    shipmentAction = null;
    receiptAction = null;
  } catch (error) {
    purchaserAction = { status: 'FAILED', supplierOrderIds: [error.message] };
  } finally {
    actionRunning = false;
    renderActions();
  }
}

async function runSupplierShipmentAction() {
  if (!seed || !purchaserAction?.supplierOrderIds?.length || actionRunning || shipmentAction?.status === 'SHIPPED') return;
  actionRunning = true;
  renderActions();
  try {
    const supplierAuth = await ensureSupplierToken();
    const supplierOrderId = purchaserAction.supplierOrderIds[0];
    const order = await call(`/supplier-orders/${supplierOrderId}`, {}, supplierAuth);
    const items = order.items.map((item) => ({
      orderItemId: item.id,
      shipQuantity: item.quantity,
      permanentlyReduceQuantity: '0',
    }));
    const input = { expectedVersion: order.version, items, freight: '0.00', trackingNo: `PX-${Date.now()}` };
    const preview = await call(`/supplier-orders/${supplierOrderId}/shipment-preview`, {
      method: 'POST',
      body: JSON.stringify(input),
    }, supplierAuth);
    const shipment = await call(`/supplier-orders/${supplierOrderId}/shipments`, {
      method: 'POST',
      headers: { 'idempotency-key': `role-workbench-supplier-shipment-${crypto.randomUUID()}` },
      body: JSON.stringify(input),
    }, supplierAuth);
    const updatedOrder = await call(`/supplier-orders/${supplierOrderId}`, {}, supplierAuth);
    shipmentAction = {
      status: 'SHIPPED',
      supplierOrderId,
      supplierOrderVersion: updatedOrder.version,
      shipmentId: shipment.id,
      shipmentNo: shipment.shipmentNo,
      items: shipment.items,
      shipQuantity: preview.totals?.shipQuantity,
    };
    receiptAction = null;
  } catch (error) {
    shipmentAction = { status: 'FAILED', shipmentNo: error.message, items: [] };
  } finally {
    actionRunning = false;
    renderActions();
  }
}

async function runStoreReceiptAction() {
  if (!seed || !shipmentAction?.shipmentId || actionRunning || receiptAction?.status === 'COMPLETED') return;
  actionRunning = true;
  renderActions();
  try {
    const storeAuth = await ensureStoreToken();
    const items = (shipmentAction.items || []).map((item) => ({
      shipmentItemId: item.id,
      receivedQuantity: item.quantity,
    }));
    const receipt = await call(`/shipments/${shipmentAction.shipmentId}/receipts`, {
      method: 'POST',
      headers: { 'idempotency-key': `role-workbench-store-receipt-${crypto.randomUUID()}` },
      body: JSON.stringify({
        expectedOrderVersion: shipmentAction.supplierOrderVersion,
        expectedReceiptRevision: 0,
        items,
      }),
    }, storeAuth);
    receiptAction = {
      status: 'COMPLETED',
      receiptId: receipt.id,
      receiptNo: receipt.receiptNo,
      receivedQuantity: receipt.items.map((item) => item.receivedQuantity).join(', '),
    };
  } catch (error) {
    receiptAction = { status: 'FAILED', receiptNo: error.message, receivedQuantity: '—' };
  } finally {
    actionRunning = false;
    renderActions();
  }
}

async function runSupplierDiscrepancyAction() {
  if (!seed || actionRunning || discrepancyAction?.status === 'RESOLVED') return;
  actionRunning = true;
  renderActions();
  try {
    const flow = await createConfirmedSupplierOrder('role-workbench-discrepancy');
    const { shipment, supplierOrderVersion } = await createShipmentForOrder(flow.supplierOrderId, 'role-workbench-discrepancy');
    const storeAuth = await ensureStoreToken();
    const receipt = await call(`/shipments/${shipment.id}/receipts`, {
      method: 'POST',
      headers: { 'idempotency-key': `role-workbench-discrepancy-receipt-${crypto.randomUUID()}` },
      body: JSON.stringify({
        expectedOrderVersion: supplierOrderVersion,
        expectedReceiptRevision: 0,
        items: shipment.items.map((item) => ({ shipmentItemId: item.id, receivedQuantity: '8.000000' })),
      }),
    }, storeAuth);
    const supplierAuth = await ensureSupplierToken();
    const notifications = await call('/notifications', {}, supplierAuth);
    const notification = (notifications.notifications || []).find((item) => item.payload?.receiptId === receipt.id);
    const discrepancyId = notification?.payload?.discrepancyIds?.[0];
    if (!discrepancyId) throw new Error('未找到供应商收货差异通知');
    const resolved = await call(`/discrepancies/${discrepancyId}/resolve`, {
      method: 'POST',
      headers: { 'idempotency-key': `role-workbench-discrepancy-resolve-${crypto.randomUUID()}` },
      body: JSON.stringify({
        expectedVersion: 1,
        action: 'ACCEPT',
        reason: 'Role workbench accepts short receipt',
      }),
    }, supplierAuth);
    discrepancyAction = {
      status: resolved.status,
      receiptNo: receipt.receiptNo,
      discrepancyId: resolved.id,
      missingQuantity: resolved.missingQuantity,
    };
  } catch (error) {
    discrepancyAction = { status: 'FAILED', discrepancyId: error.message, missingQuantity: '—' };
  } finally {
    actionRunning = false;
    renderActions();
  }
}

async function runSupplierRejectionAction() {
  if (!seed || actionRunning || rejectionAction?.status === 'REALLOCATED') return;
  actionRunning = true;
  renderActions();
  try {
    const flow = await createConfirmedSupplierOrder('role-workbench-rejection');
    const supplierAuth = await ensureSupplierToken();
    const order = await call(`/supplier-orders/${flow.supplierOrderId}`, {}, supplierAuth);
    const rejected = await call(`/supplier-orders/${flow.supplierOrderId}/reject`, {
      method: 'POST',
      headers: { 'idempotency-key': `role-workbench-supplier-reject-${crypto.randomUUID()}` },
      body: JSON.stringify({
        expectedVersion: order.version,
        reason: 'Role workbench supplier cannot fulfill this order',
      }),
    }, supplierAuth);
    const purchaserAuth = await ensurePurchaserToken();
    const request = await call(`/purchase-requests/${flow.requestId}`, {}, purchaserAuth);
    const reallocated = await call(`/purchase-requests/${flow.requestId}/reallocate`, {
      method: 'POST',
      headers: { 'idempotency-key': `role-reallocate-${crypto.randomUUID()}` },
      body: JSON.stringify({
        expectedVersion: request.version,
        rejectedOrderId: rejected.supplierOrderId,
        reason: 'Role workbench reallocates rejected supplier line',
        assignments: request.items.map((item) => ({ requestItemId: item.id, supplierId: seed.secondarySupplierId })),
      }),
    }, purchaserAuth);
    const targetOrder = (reallocated.supplierOrders || []).find((order) => order.supplierId === seed.secondarySupplierId);
    rejectionAction = {
      status: 'REALLOCATED',
      supplierOrderId: rejected.supplierOrderId,
      requestId: flow.requestId,
      requestStatus: reallocated.status,
      targetSupplierId: targetOrder?.supplierId || seed.secondarySupplierId,
      targetSupplierOrderId: targetOrder?.id,
    };
  } catch (error) {
    rejectionAction = { status: 'FAILED', supplierOrderId: error.message, requestStatus: '—' };
  } finally {
    actionRunning = false;
    renderActions();
  }
}

async function createShortReceiptDiscrepancy(prefix, { shipQuantity = seed.quantity, receivedQuantity = '8.000000' } = {}) {
  const flow = await createConfirmedSupplierOrder(prefix);
  const { shipment, supplierOrderVersion } = await createShipmentForOrder(flow.supplierOrderId, prefix, { shipQuantity });
  const storeAuth = await ensureStoreToken();
  const receipt = await call(`/shipments/${shipment.id}/receipts`, {
    method: 'POST',
    headers: { 'idempotency-key': `${prefix}-receipt-${crypto.randomUUID()}` },
    body: JSON.stringify({
      expectedOrderVersion: supplierOrderVersion,
      expectedReceiptRevision: 0,
      items: shipment.items.map((item) => ({ shipmentItemId: item.id, receivedQuantity })),
    }),
  }, storeAuth);
  const supplierAuth = await ensureSupplierToken();
  const notifications = await call('/notifications', {}, supplierAuth);
  const notification = (notifications.notifications || []).find((item) => item.payload?.receiptId === receipt.id);
  const discrepancyId = notification?.payload?.discrepancyIds?.[0];
  if (!discrepancyId) throw new Error('未找到供应商收货差异通知');
  return { flow, shipment, receipt, discrepancyId };
}

async function runSupplierDiscrepancyBranchesAction() {
  if (!seed || actionRunning || discrepancyBranchesAction?.status === 'BRANCHES_READY') return;
  actionRunning = true;
  renderActions();
  try {
    const supplierAuth = await ensureSupplierToken();
    const replenishFlow = await createShortReceiptDiscrepancy('role-workbench-replenish', {
      shipQuantity: '8.000000',
      receivedQuantity: '6.000000',
    });
    const replenished = await call(`/discrepancies/${replenishFlow.discrepancyId}/resolve`, {
      method: 'POST',
      headers: { 'idempotency-key': `role-workbench-replenish-resolve-${crypto.randomUUID()}` },
      body: JSON.stringify({
        expectedVersion: 1,
        action: 'REPLENISH',
        reason: 'Role workbench schedules replenishment',
      }),
    }, supplierAuth);
    const replenishmentGap = replenished.replenishmentGap;
    if (!replenishmentGap?.id) throw new Error('补发缺口未生成');
    const replenishmentShipment = await createShipmentForOrder(replenishFlow.flow.supplierOrderId, 'role-workbench-replenish', {
      shipQuantity: replenishmentGap.quantity,
      gapId: replenishmentGap.id,
      gapQuantity: replenishmentGap.quantity,
    });
    const storeAuth = await ensureStoreToken();
    const replenishReceipt = await call(`/shipments/${replenishmentShipment.shipment.id}/receipts`, {
      method: 'POST',
      headers: { 'idempotency-key': `role-workbench-replenish-receipt-${crypto.randomUUID()}` },
      body: JSON.stringify({
        expectedOrderVersion: replenishmentShipment.supplierOrderVersion,
        expectedReceiptRevision: 0,
        items: replenishmentShipment.shipment.items.map((item) => ({ shipmentItemId: item.id, receivedQuantity: item.quantity })),
      }),
    }, storeAuth);

    const returnFlow = await createShortReceiptDiscrepancy('role-workbench-return', {
      shipQuantity: seed.quantity,
      receivedQuantity: '8.000000',
    });
    const returned = await call(`/discrepancies/${returnFlow.discrepancyId}/resolve`, {
      method: 'POST',
      headers: { 'idempotency-key': `role-workbench-return-resolve-${crypto.randomUUID()}` },
      body: JSON.stringify({
        expectedVersion: 1,
        action: 'RETURN',
        reason: 'Role workbench records return shortage',
      }),
    }, supplierAuth);
    discrepancyBranchesAction = {
      status: 'BRANCHES_READY',
      replenishStatus: `${replenished.status}/${replenishReceipt.revision}`,
      returnStatus: `${returned.status}/${returned.returnRecord?.id ? 'RETURN' : 'MISSING'}`,
      replenishmentGapId: replenishmentGap.id,
      returnRecordId: returned.returnRecord?.id,
    };
  } catch (error) {
    discrepancyBranchesAction = { status: 'FAILED', replenishStatus: error.message, returnStatus: '—' };
  } finally {
    actionRunning = false;
    renderActions();
  }
}

function renderEvidenceMap() {
  const steps = run?.steps || [];
  $('evidence-label').textContent = run?.status || 'UNKNOWN';
  $('evidence-label').classList.toggle('tag-ok', run?.status === 'PASSED');
  $('evidence-map').innerHTML = steps.map((step) => `<article><strong>${esc(step.title)}</strong><small>${esc(flatten(step.data))}</small></article>`).join('');
}

function panel(title, body, foot) {
  return `<article><strong>${esc(title)}</strong><p>${esc(body)}</p><small>${esc(foot)}</small></article>`;
}

function metric(label, value, foot, emphasis = false) {
  return `<div class="metric ${emphasis ? 'emphasis' : ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></div>`;
}

function flatten(data) {
  return Object.entries(data || {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' · ');
}

init();
