import { login, request } from '../api.js';
import { state } from '../state.js';
import { esc, money, metric, resultLine, setNotice } from '../ui.js';
import { setHeader } from '../shell.js';

const flowState = {
  purchaseRequest: null,
  supplierOrder: null,
  shipment: null,
  receipt: null,
};

export async function render() {
  setHeader({
    title: '业务流转',
    subtitle: '在正式产品应用内执行门店下单、采购确认、供应商发货和门店收货。',
    routeLabel: '业务流转',
    status: 'READY',
  });
  document.getElementById('app-view').innerHTML = `
    <section class="summary-grid">
      ${metric('门店', state.seed.storeUsername, '下单和收货', true)}
      ${metric('采购', state.seed.username, '确认拆单')}
      ${metric('供应商', state.seed.supplierUsername, '发货履约')}
      ${metric('目标金额', money(state.seed.expectedSalesAmount), 'PXFLOW 主流程')}
    </section>
    <section class="data-card acceptance-card">
      <div class="data-head"><div><h3>主流程动作</h3><p>点击后按真实 API 顺序执行，不使用静态 mock。</p></div><span id="app-flow-status" class="tag">READY</span></div>
      <div class="receipt-panel">
        <label>商品 ID<input id="app-flow-product-id" value="${esc(state.seed.productId)}"></label>
        <label>数量<input id="app-flow-quantity" value="${esc(state.seed.quantity)}"></label>
        <div class="form-actions">
          <button id="app-flow-run" class="primary">一键执行业务流转</button>
          <button id="app-flow-reset" class="secondary">清空本页结果</button>
        </div>
      </div>
      <div id="app-flow-result" class="store-result">
        ${stepLine('门店下单', '等待执行', '调用 /purchase-requests/preview 与 /purchase-requests')}
        ${stepLine('采购确认', '等待执行', '调用 /purchase-requests/{id}/confirm')}
        ${stepLine('供应商发货', '等待执行', '调用 /supplier-orders/{id}/shipment-preview 与 /shipments')}
        ${stepLine('门店收货', '等待执行', '调用 /shipments/{id}/receipts')}
      </div>
    </section>
    <section class="app-route-grid">
      <article><strong>门店工作台</strong><p>查看新订单进度、账户和待收货提醒。</p><a class="primary" href="#/store">打开门店</a></article>
      <article><strong>采购工作台</strong><p>查看采购申请详情和供应商执行单。</p><a class="primary" href="#/purchaser">打开采购</a></article>
      <article><strong>供应商工作台</strong><p>查看执行单、发货和差异待办。</p><a class="primary" href="#/supplier">打开供应商</a></article>
    </section>`;
  bindFlow();
}

function stepLine(label, status, detail) {
  return `<article data-flow-step="${esc(label)}"><span>${esc(label)}</span><strong>${esc(status)}</strong><small>${esc(detail)}</small></article>`;
}

function updateStatus(status) {
  document.getElementById('app-flow-status').textContent = status;
}

function renderResult(lines) {
  document.getElementById('app-flow-result').innerHTML = lines.join('');
}

function orderInput() {
  return {
    storeId: state.seed.storeId,
    items: [{
      productId: document.getElementById('app-flow-product-id').value.trim(),
      quantity: document.getElementById('app-flow-quantity').value.trim(),
    }],
  };
}

async function ensureTokens() {
  const [store, purchaser, supplier] = await Promise.all([
    state.tokens.store || login(state.seed.storeUsername, state.seed.password, 'product-app-flow-store'),
    state.tokens.purchaser || login(state.seed.username, state.seed.password, 'product-app-flow-purchaser'),
    state.tokens.supplier || login(state.seed.supplierUsername, state.seed.password, 'product-app-flow-supplier'),
  ]);
  state.tokens.store = store;
  state.tokens.purchaser = purchaser;
  state.tokens.supplier = supplier;
  return { store, purchaser, supplier };
}

async function runFlow() {
  updateStatus('RUNNING');
  setNotice('');
  const tokens = await ensureTokens();
  const lines = [];
  const input = orderInput();

  const preview = await request('/purchase-requests/preview', { method: 'POST', body: JSON.stringify(input) }, tokens.store);
  flowState.purchaseRequest = await request('/purchase-requests', {
    method: 'POST',
    headers: { 'idempotency-key': `product-app-flow-order-${crypto.randomUUID()}` },
    body: JSON.stringify(input),
  }, tokens.store);
  lines.push(resultLine('门店下单', `${flowState.purchaseRequest.requestNo || flowState.purchaseRequest.id} / ${money(preview.totals?.salesGoodsAmount || preview.salesGoodsAmount)}`));
  renderResult(lines);

  const requestDetail = await request(`/purchase-requests/${flowState.purchaseRequest.id}`, {}, tokens.purchaser);
  const confirmed = await request(`/purchase-requests/${requestDetail.id}/confirm`, {
    method: 'POST',
    headers: { 'idempotency-key': `product-app-flow-confirm-${crypto.randomUUID()}` },
    body: JSON.stringify({ expectedVersion: requestDetail.version }),
  }, tokens.purchaser);
  const supplierOrderId = confirmed.supplierOrderIds?.[0] || (confirmed.supplierOrders || confirmed.orders || [])[0]?.id || requestDetail.supplierOrders?.[0]?.id;
  if (!supplierOrderId) throw new Error('采购确认后未返回供应商执行单');
  flowState.supplierOrder = { id: supplierOrderId };
  lines.push(resultLine('采购确认', `${confirmed.status || 'CONFIRMED'} / ${supplierOrderId}`));
  renderResult(lines);

  const supplierDetail = await request(`/supplier-orders/${flowState.supplierOrder.id}`, {}, tokens.supplier);
  const shipInput = {
    expectedVersion: supplierDetail.version,
    items: (supplierDetail.items || []).map((item) => ({
      orderItemId: item.id,
      shipQuantity: item.quantity,
      permanentlyReduceQuantity: '0',
    })),
    freight: '0.00',
    trackingNo: `APPFLOW-${Date.now()}`,
  };
  await request(`/supplier-orders/${supplierDetail.id}/shipment-preview`, { method: 'POST', body: JSON.stringify(shipInput) }, tokens.supplier);
  flowState.shipment = await request(`/supplier-orders/${supplierDetail.id}/shipments`, {
    method: 'POST',
    headers: { 'idempotency-key': `product-app-flow-ship-${crypto.randomUUID()}` },
    body: JSON.stringify(shipInput),
  }, tokens.supplier);
  const supplierDetailAfterShipment = await request(`/supplier-orders/${supplierDetail.id}`, {}, tokens.supplier);
  lines.push(resultLine('供应商发货', `${flowState.shipment.shipmentNo || flowState.shipment.id} / ${flowState.shipment.status || 'SHIPPED'}`));
  renderResult(lines);

  const shipmentDetail = await request(`/shipments/${flowState.shipment.id}`, {}, tokens.store);
  const receiptInput = {
    expectedOrderVersion: supplierDetailAfterShipment.version,
    expectedReceiptRevision: shipmentDetail.receiptRevision || 0,
    items: (shipmentDetail.items || []).map((item) => ({
      shipmentItemId: item.id,
      receivedQuantity: item.shippedQuantity || item.shipQuantity || item.quantity,
    })),
  };
  flowState.receipt = await request(`/shipments/${shipmentDetail.id}/receipts`, {
    method: 'POST',
    headers: { 'idempotency-key': `product-app-flow-receipt-${crypto.randomUUID()}` },
    body: JSON.stringify(receiptInput),
  }, tokens.store);
  lines.push(resultLine('门店收货', `${flowState.receipt.receiptNo || flowState.receipt.id} / ${flowState.receipt.status || 'COMPLETED'}`));
  renderResult(lines);
  updateStatus('COMPLETED');
}

function bindFlow() {
  document.getElementById('app-flow-run').addEventListener('click', async () => {
    try {
      await runFlow();
    } catch (error) {
      updateStatus('FAILED');
      setNotice(error.message);
    }
  });
  document.getElementById('app-flow-reset').addEventListener('click', () => {
    flowState.purchaseRequest = null;
    flowState.supplierOrder = null;
    flowState.shipment = null;
    flowState.receipt = null;
    updateStatus('READY');
    setNotice('');
    renderResult([
      stepLine('门店下单', '等待执行', '调用 /purchase-requests/preview 与 /purchase-requests'),
      stepLine('采购确认', '等待执行', '调用 /purchase-requests/{id}/confirm'),
      stepLine('供应商发货', '等待执行', '调用 /supplier-orders/{id}/shipment-preview 与 /shipments'),
      stepLine('门店收货', '等待执行', '调用 /shipments/{id}/receipts'),
    ]);
  });
}
