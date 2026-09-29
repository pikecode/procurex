import { login, request } from '../api.js';
import { state } from '../state.js';
import { esc, money, metric, resultLine, setNotice } from '../ui.js';
import { setHeader } from '../shell.js';

const flowState = {
  purchaseRequest: null,
  supplierOrder: null,
  shipment: null,
  receipt: null,
  exception: null,
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
    <section class="data-card acceptance-card">
      <div class="data-head"><div><h3>异常分支动作</h3><p>把供应商拒单、采购改派、少收同意、补发和退回纳入正式 App。</p></div><span id="app-exception-status" class="tag">READY</span></div>
      <div class="form-actions">
        <button id="app-exception-run" class="primary">一键执行异常分支</button>
        <button id="app-exception-reset" class="secondary">清空异常结果</button>
      </div>
      <div id="app-exception-result" class="store-result">
        ${stepLine('供应商拒单', '等待执行', '调用 /supplier-orders/{id}/reject')}
        ${stepLine('采购改派', '等待执行', '调用 /purchase-requests/{id}/reallocate')}
        ${stepLine('差异同意', '等待执行', '调用 /discrepancies/{id}/resolve ACCEPT')}
        ${stepLine('补发退回', '等待执行', '调用 REPLENISH 与 RETURN 分支')}
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

function updateExceptionStatus(status) {
  document.getElementById('app-exception-status').textContent = status;
}

function renderResult(lines) {
  document.getElementById('app-flow-result').innerHTML = lines.join('');
}

function renderExceptionResult(lines) {
  document.getElementById('app-exception-result').innerHTML = lines.join('');
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

async function createConfirmedSupplierOrder(prefix, tokens) {
  const input = orderInput();
  const created = await request('/purchase-requests', {
    method: 'POST',
    headers: { 'idempotency-key': `${prefix}-order-${crypto.randomUUID()}` },
    body: JSON.stringify(input),
  }, tokens.store);
  const detail = await request(`/purchase-requests/${created.id}`, {}, tokens.purchaser);
  const confirmed = await request(`/purchase-requests/${detail.id}/confirm`, {
    method: 'POST',
    headers: { 'idempotency-key': `${prefix}-confirm-${crypto.randomUUID()}` },
    body: JSON.stringify({ expectedVersion: detail.version }),
  }, tokens.purchaser);
  const supplierOrderId = confirmed.supplierOrderIds?.[0] || (confirmed.supplierOrders || [])[0]?.id;
  if (!supplierOrderId) throw new Error('采购确认后未返回供应商执行单');
  return { requestId: created.id, requestNo: created.requestNo, supplierOrderId };
}

async function createShipmentForOrder(supplierOrderId, prefix, tokens, options = {}) {
  const order = await request(`/supplier-orders/${supplierOrderId}`, {}, tokens.supplier);
  const items = (order.items || []).map((item) => ({
    orderItemId: item.id,
    shipQuantity: options.shipQuantity || item.quantity,
    permanentlyReduceQuantity: options.permanentlyReduceQuantity || '0',
    ...(options.gapId ? { gapAllocations: [{ gapId: options.gapId, quantity: options.gapQuantity || options.shipQuantity || item.quantity }] } : {}),
  }));
  const input = { expectedVersion: order.version, items, freight: '0.00', trackingNo: `APPFLOW-${Date.now()}` };
  await request(`/supplier-orders/${supplierOrderId}/shipment-preview`, { method: 'POST', body: JSON.stringify(input) }, tokens.supplier);
  const shipment = await request(`/supplier-orders/${supplierOrderId}/shipments`, {
    method: 'POST',
    headers: { 'idempotency-key': `${prefix}-ship-${crypto.randomUUID()}` },
    body: JSON.stringify(input),
  }, tokens.supplier);
  const updatedOrder = await request(`/supplier-orders/${supplierOrderId}`, {}, tokens.supplier);
  return { shipment, supplierOrderVersion: updatedOrder.version };
}

async function createShortReceiptDiscrepancy(prefix, tokens, { shipQuantity = state.seed.quantity, receivedQuantity = '8.000000' } = {}) {
  const flow = await createConfirmedSupplierOrder(prefix, tokens);
  const { shipment, supplierOrderVersion } = await createShipmentForOrder(flow.supplierOrderId, prefix, tokens, { shipQuantity });
  const receipt = await request(`/shipments/${shipment.id}/receipts`, {
    method: 'POST',
    headers: { 'idempotency-key': `${prefix}-receipt-${crypto.randomUUID()}` },
    body: JSON.stringify({
      expectedOrderVersion: supplierOrderVersion,
      expectedReceiptRevision: 0,
      items: (shipment.items || []).map((item) => ({ shipmentItemId: item.id, receivedQuantity })),
    }),
  }, tokens.store);
  const notifications = await request('/notifications', {}, tokens.supplier);
  const notification = (notifications.notifications || []).find((item) => item.payload?.receiptId === receipt.id);
  const discrepancyId = notification?.payload?.discrepancyIds?.[0];
  if (!discrepancyId) throw new Error('未找到供应商收货差异通知');
  return { flow, shipment, receipt, discrepancyId };
}

async function runExceptionBranches() {
  updateExceptionStatus('RUNNING');
  setNotice('');
  const tokens = await ensureTokens();
  const lines = [];

  const rejectedFlow = await createConfirmedSupplierOrder('product-app-rejection', tokens);
  const order = await request(`/supplier-orders/${rejectedFlow.supplierOrderId}`, {}, tokens.supplier);
  const rejected = await request(`/supplier-orders/${rejectedFlow.supplierOrderId}/reject`, {
    method: 'POST',
    headers: { 'idempotency-key': `product-app-reject-${crypto.randomUUID()}` },
    body: JSON.stringify({ expectedVersion: order.version, reason: '产品应用供应商拒单' }),
  }, tokens.supplier);
  lines.push(resultLine('供应商拒单', `${rejected.supplierOrderId || rejectedFlow.supplierOrderId} / ${rejected.status || 'REJECTED'}`));
  renderExceptionResult(lines);

  const requestDetail = await request(`/purchase-requests/${rejectedFlow.requestId}`, {}, tokens.purchaser);
  const reallocated = await request(`/purchase-requests/${rejectedFlow.requestId}/reallocate`, {
    method: 'POST',
    headers: { 'idempotency-key': `product-app-reallocate-${crypto.randomUUID()}` },
    body: JSON.stringify({
      expectedVersion: requestDetail.version,
      rejectedOrderId: rejected.supplierOrderId || rejectedFlow.supplierOrderId,
      reason: '产品应用改派供应商',
      assignments: (requestDetail.items || []).map((item) => ({ requestItemId: item.id, supplierId: state.seed.secondarySupplierId })),
    }),
  }, tokens.purchaser);
  const targetOrder = (reallocated.supplierOrders || []).find((item) => item.supplierId === state.seed.secondarySupplierId);
  lines.push(resultLine('采购改派', `${reallocated.status || 'REALLOCATED'} / ${targetOrder?.id || state.seed.secondarySupplierId}`));
  renderExceptionResult(lines);

  const acceptFlow = await createShortReceiptDiscrepancy('product-app-accept', tokens);
  const acceptDetail = await request(`/discrepancies/${acceptFlow.discrepancyId}`, {}, tokens.supplier);
  const accepted = await request(`/discrepancies/${acceptFlow.discrepancyId}/resolve`, {
    method: 'POST',
    headers: { 'idempotency-key': `product-app-accept-${crypto.randomUUID()}` },
    body: JSON.stringify({ expectedVersion: acceptDetail.version, action: 'ACCEPT', reason: '产品应用同意少收' }),
  }, tokens.supplier);
  lines.push(resultLine('差异同意', `${accepted.status || 'RESOLVED'} / ${accepted.missingQuantity || acceptFlow.discrepancyId}`));
  renderExceptionResult(lines);

  const replenishFlow = await createShortReceiptDiscrepancy('product-app-replenish', tokens, {
    shipQuantity: '8.000000',
    receivedQuantity: '6.000000',
  });
  const replenishDetail = await request(`/discrepancies/${replenishFlow.discrepancyId}`, {}, tokens.supplier);
  const replenished = await request(`/discrepancies/${replenishFlow.discrepancyId}/resolve`, {
    method: 'POST',
    headers: { 'idempotency-key': `product-app-replenish-${crypto.randomUUID()}` },
    body: JSON.stringify({ expectedVersion: replenishDetail.version, action: 'REPLENISH', reason: '产品应用安排补发' }),
  }, tokens.supplier);
  const gap = replenished.replenishmentGap;
  if (!gap?.id) throw new Error('补发缺口未生成');
  const replenishmentShipment = await createShipmentForOrder(replenishFlow.flow.supplierOrderId, 'product-app-replenish-gap', tokens, {
    shipQuantity: gap.quantity,
    gapId: gap.id,
    gapQuantity: gap.quantity,
  });
  const replenishReceipt = await request(`/shipments/${replenishmentShipment.shipment.id}/receipts`, {
    method: 'POST',
    headers: { 'idempotency-key': `product-app-replenish-receipt-${crypto.randomUUID()}` },
    body: JSON.stringify({
      expectedOrderVersion: replenishmentShipment.supplierOrderVersion,
      expectedReceiptRevision: 0,
      items: (replenishmentShipment.shipment.items || []).map((item) => ({ shipmentItemId: item.id, receivedQuantity: item.quantity })),
    }),
  }, tokens.store);

  const returnFlow = await createShortReceiptDiscrepancy('product-app-return', tokens);
  const returnDetail = await request(`/discrepancies/${returnFlow.discrepancyId}`, {}, tokens.supplier);
  const returned = await request(`/discrepancies/${returnFlow.discrepancyId}/resolve`, {
    method: 'POST',
    headers: { 'idempotency-key': `product-app-return-${crypto.randomUUID()}` },
    body: JSON.stringify({ expectedVersion: returnDetail.version, action: 'RETURN', reason: '产品应用退回核对' }),
  }, tokens.supplier);
  lines.push(resultLine('补发退回', `${replenished.status}/${replenishReceipt.revision} + ${returned.status}/${returned.returnRecord?.id ? 'RETURN' : 'MISSING'}`));
  renderExceptionResult(lines);

  flowState.exception = { status: 'BRANCHES_READY', targetOrderId: targetOrder?.id, gapId: gap.id, returnRecordId: returned.returnRecord?.id };
  updateExceptionStatus('BRANCHES_READY');
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
  document.getElementById('app-exception-run').addEventListener('click', async () => {
    try {
      await runExceptionBranches();
    } catch (error) {
      updateExceptionStatus('FAILED');
      setNotice(error.message);
    }
  });
  document.getElementById('app-exception-reset').addEventListener('click', () => {
    flowState.exception = null;
    updateExceptionStatus('READY');
    setNotice('');
    renderExceptionResult([
      stepLine('供应商拒单', '等待执行', '调用 /supplier-orders/{id}/reject'),
      stepLine('采购改派', '等待执行', '调用 /purchase-requests/{id}/reallocate'),
      stepLine('差异同意', '等待执行', '调用 /discrepancies/{id}/resolve ACCEPT'),
      stepLine('补发退回', '等待执行', '调用 REPLENISH 与 RETURN 分支'),
    ]);
  });
}
