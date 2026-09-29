import { apiBase, login, request } from '../api.js';
import { state } from '../state.js';
import { esc, money, metric, resultLine, tableRows, setNotice } from '../ui.js';
import { setHeader } from '../shell.js';
import { loadWorkflowContext, saveWorkflowContext } from '../workflow.js';

export async function render() {
  setHeader({ title: '财务结算', subtitle: '供应商账单、付款记录、结算状态和收款确认。', routeLabel: '财务', status: '加载中' });
  const financeToken = state.tokens.finance || await login(state.seed.username, state.seed.password, 'product-app-finance');
  const supplierToken = state.tokens.supplier || await login(state.seed.supplierUsername, state.seed.password, 'product-app-finance-supplier');
  state.tokens.finance = financeToken;
  state.tokens.supplier = supplierToken;
  const [supplierStatements, storeStatements, payments] = await Promise.all([
    request('/supplier-statements', {}, financeToken),
    request('/store-statements', {}, financeToken),
    request('/payment-records?direction=COMPANY_TO_SUPPLIER', {}, financeToken),
  ]);
  const openSupplierStatements = supplierStatements.filter((item) => item.settlementStatus !== 'SETTLED' && item.status !== 'SETTLED');
  const pendingPayments = payments.filter((item) => item.status === 'PENDING');
  const confirmedPayments = payments.filter((item) => item.status === 'CONFIRMED');
  const workflow = loadWorkflowContext();
  const pendingAmount = pendingPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  setHeader({ title: '财务结算', subtitle: '供应商账单、付款记录、结算状态和收款确认。', routeLabel: '财务', status: 'READY' });
  document.getElementById('app-view').innerHTML = `
    <section class="summary-grid">
      ${metric('供应商账单', supplierStatements.length, '/supplier-statements', true)}
      ${metric('门店账单', storeStatements.length, '/store-statements')}
      ${metric('待确认付款', pendingPayments.length, '/payment-records')}
      ${metric('待确认金额', money(pendingAmount), 'COMPANY_TO_SUPPLIER')}
    </section>
    <section class="store-layout">
      <section class="data-card">
        <div class="data-head"><div><h3>供应商账单</h3><p>总部视角读取供应商应付与结算状态</p></div><span class="tag">${esc(openSupplierStatements.length)} 未结</span></div>
        <div class="table-wrap"><table><thead><tr><th>账单</th><th>周期</th><th>状态</th><th class="money">应付</th><th></th></tr></thead><tbody>${tableRows(supplierStatements.slice(0, 8).map((item) => `<tr><td>${esc(item.statementNo || item.id)}</td><td>${esc(item.cycle || item.periodKey || '—')}</td><td>${esc(item.settlementStatus || item.status || '—')}</td><td class="money">${esc(money(item.payableAmount || item.totalPayableAmount || item.totalAmount))}</td><td><button class="secondary" data-app-finance-statement="${esc(item.id)}">明细</button></td></tr>`), 5, '暂无供应商账单')}</tbody></table></div>
      </section>
      <section class="data-card">
        <div class="data-head"><div><h3>付款记录</h3><p>供应商收款确认/驳回入口</p></div><span id="app-finance-label" class="tag">等待选择</span></div>
        <div class="table-wrap compact"><table><thead><tr><th>付款</th><th>状态</th><th class="money">金额</th><th></th></tr></thead><tbody>${tableRows(payments.slice(0, 8).map((item) => `<tr><td>${esc(item.paymentNo || item.id)}</td><td>${esc(item.status || '—')}</td><td class="money">${esc(money(item.amount))}</td><td><button class="secondary" data-app-finance-payment="${esc(item.id)}">选择</button></td></tr>`), 4, '暂无付款记录')}</tbody></table></div>
      </section>
    </section>
    <section class="data-card acceptance-card">
      <div class="data-head"><div><h3>收款处理</h3><p>读取付款 version 后由供应商确认或驳回。</p></div><span id="app-payment-action-label" class="tag">READY</span></div>
      <div class="receipt-panel">
        <label>账单 ID<input id="app-finance-statement-id" value="${esc(openSupplierStatements[0]?.id || supplierStatements[0]?.id || '')}"></label>
        <label>付款 ID<input id="app-finance-payment-id" value="${esc(workflow?.paymentId || pendingPayments[0]?.id || payments[0]?.id || '')}"></label>
        <label>驳回原因<input id="app-finance-payment-reason" value="产品应用驳回付款"></label>
        <div class="form-actions">
          <button id="app-load-statement" class="secondary">读取账单</button>
          <button id="app-load-payment" class="secondary">刷新付款</button>
          <button id="app-create-pending-payment" class="primary">登记付款待确认</button>
          <button id="app-create-confirm-payment" class="primary">登记并确认供应商付款</button>
          <button id="app-create-reject-payment" class="secondary">登记并驳回供应商付款</button>
          <button id="app-confirm-payment" class="primary">确认收款</button>
          <button id="app-reject-payment" class="secondary">驳回付款</button>
        </div>
      </div>
      <div id="app-finance-result" class="store-result">
        ${resultLine('待确认付款', pendingPayments.length)}
        ${resultLine('已确认付款', confirmedPayments.length)}
        ${resultLine('待确认金额', money(pendingAmount))}
      </div>
    </section>
    <section class="store-layout lower">
      <section class="data-card">
        <div class="data-head"><div><h3>账单详情</h3><p>供应商账单行、结算项和付款状态。</p></div><span id="app-statement-label" class="tag">等待账单</span></div>
        <div id="app-statement-detail" class="store-result"><small>选择供应商账单后展示周期、应付、待确认付款和已确认付款。</small></div>
        <div class="table-wrap compact"><table><thead><tr><th>来源单</th><th>结算项</th><th>版本</th><th class="money">商品</th><th class="money">运费</th><th class="money">合计</th></tr></thead><tbody id="app-statement-lines"><tr><td colspan="6">暂无账单明细</td></tr></tbody></table></div>
      </section>
      <section class="data-card">
        <div class="data-head"><div><h3>付款详情</h3><p>付款基础信息、凭证数量和结算分配。</p></div><span class="tag">PAYMENT</span></div>
        <div id="app-payment-detail" class="store-result"><small>选择付款记录或执行登记动作后展示付款明细。</small></div>
        <div class="table-wrap compact"><table><thead><tr><th>结算项</th><th>供应商单</th><th>分配状态</th><th>版本</th><th class="money">金额</th></tr></thead><tbody id="app-payment-allocations"><tr><td colspan="5">暂无付款分配</td></tr></tbody></table></div>
      </section>
    </section>`;
  bindFinance({ financeToken, supplierToken, supplierStatements });
}

function bindFinance({ financeToken, supplierToken, supplierStatements }) {
  let payment = null;
  let statement = null;
  const show = (label, data) => {
    document.getElementById('app-payment-action-label').textContent = label;
    document.getElementById('app-finance-result').innerHTML = Object.entries(data).map(([key, value]) => `<article><span>${esc(key)}</span><strong>${esc(value)}</strong></article>`).join('');
  };
  const renderStatementDetail = (detail) => {
    document.getElementById('app-statement-detail').innerHTML = [
      resultLine('账单', detail.statementNo || detail.id),
      resultLine('周期', `${detail.periodStart || '—'} → ${detail.periodEndExclusive || '—'}`),
      resultLine('结算状态', detail.settlementStatus || detail.status || '—'),
      resultLine('应付金额', money(detail.payableAmount || detail.totalPayableAmount || detail.totalAmount)),
      resultLine('待确认付款', money(detail.pendingPaymentAmount)),
      resultLine('已确认付款', money(detail.confirmedPaidAmount)),
    ].join('');
    const rows = [
      ...(detail.lines || []).map((line) => `<tr><td>${esc(line.supplierOrderNo || line.supplierOrderId)}</td><td>${esc(line.settlementItemId)}</td><td>${esc(line.sourceRevision ?? '—')}</td><td class="money">${esc(money(line.goodsAmount))}</td><td class="money">${esc(money(line.freightAmount))}</td><td class="money">${esc(money(line.totalAmount))}</td></tr>`),
      ...(detail.adjustmentItems || []).map((item) => `<tr><td>价格调整</td><td>${esc(item.settlementItemId)}</td><td>—</td><td class="money">—</td><td class="money">—</td><td class="money">${esc(money(item.amount))}</td></tr>`),
    ];
    document.getElementById('app-statement-lines').innerHTML = tableRows(rows, 6, '暂无账单明细');
  };
  const renderPaymentDetail = (detail) => {
    document.getElementById('app-payment-detail').innerHTML = [
      resultLine('付款记录', detail.paymentNo || detail.id),
      resultLine('付款方向', detail.direction || '—'),
      resultLine('通道', detail.channel || '—'),
      resultLine('业务日期', detail.businessDate || '—'),
      resultLine('付款金额', money(detail.amount)),
      resultLine('凭证数量', (detail.evidenceFileIds || []).length),
    ].join('');
    document.getElementById('app-payment-allocations').innerHTML = tableRows((detail.allocations || []).map((item) => `<tr><td>${esc(item.settlementItemId)}</td><td>${esc(item.supplierOrderId || '—')}</td><td>${esc(item.state || '—')}</td><td>${esc(item.sourceVersion ?? '—')}</td><td class="money">${esc(money(item.amount))}</td></tr>`), 5, '暂无付款分配');
  };
  const loadStatement = async () => {
    const statementId = document.getElementById('app-finance-statement-id').value.trim();
    if (!statementId) throw new Error('请先选择供应商账单');
    statement = await request(`/supplier-statements/${statementId}`, {}, financeToken);
    renderStatementDetail(statement);
    document.getElementById('app-statement-label').textContent = statement.settlementStatus || statement.status || '已读取';
    return statement;
  };
  const loadPayment = async () => {
    const paymentId = document.getElementById('app-finance-payment-id').value.trim();
    if (!paymentId) throw new Error('请先选择付款记录');
    payment = await request(`/payment-records/${paymentId}`, {}, supplierToken);
    saveWorkflowContext({ paymentId: payment.id, paymentNo: payment.paymentNo, paymentStatus: payment.status, paymentVersion: payment.version });
    document.getElementById('app-finance-label').textContent = payment.status || '已读取';
    renderPaymentDetail(payment);
    show(payment.status || '已读取', {
      付款记录: payment.paymentNo || payment.id,
      付款状态: payment.status || '—',
      付款金额: money(payment.amount),
      当前版本: payment.version ?? '—',
    });
    return payment;
  };
  document.querySelectorAll('[data-app-finance-statement]').forEach((button) => button.addEventListener('click', async () => {
    document.getElementById('app-finance-statement-id').value = button.dataset.appFinanceStatement;
    try { await loadStatement(); setNotice(''); } catch (error) { setNotice(error.message); }
  }));
  document.querySelectorAll('[data-app-finance-payment]').forEach((button) => button.addEventListener('click', async () => {
    document.getElementById('app-finance-payment-id').value = button.dataset.appFinancePayment;
    try { await loadPayment(); setNotice(''); } catch (error) { setNotice(error.message); }
  }));
  document.getElementById('app-load-statement').addEventListener('click', async () => {
    try { await loadStatement(); setNotice(''); } catch (error) { setNotice(error.message); }
  });
  document.getElementById('app-load-payment').addEventListener('click', async () => {
    try { await loadPayment(); setNotice(''); } catch (error) { setNotice(error.message); }
  });
  document.getElementById('app-create-pending-payment').addEventListener('click', async () => {
    try {
      payment = await createPayment({ financeToken, supplierStatements });
      document.getElementById('app-finance-payment-id').value = payment.id;
      document.getElementById('app-finance-label').textContent = payment.status || 'PENDING';
      saveWorkflowContext({ paymentId: payment.id, paymentNo: payment.paymentNo, paymentStatus: payment.status || 'PENDING' });
      renderPaymentDetail(payment);
      show('PENDING', {
        付款记录: payment.paymentNo || payment.id,
        付款状态: payment.status || 'PENDING',
        付款金额: money(payment.amount),
        当前版本: payment.version ?? '—',
      });
      setNotice('');
    } catch (error) { setNotice(error.message); }
  });
  document.getElementById('app-confirm-payment').addEventListener('click', async () => {
    try {
      if (!payment) await loadPayment();
      const confirmed = await request(`/payment-records/${payment.id}/confirm`, {
        method: 'POST',
        headers: { 'idempotency-key': `product-app-payment-confirm-${crypto.randomUUID()}` },
        body: JSON.stringify({ expectedVersion: payment.version }),
      }, supplierToken);
      payment = confirmed;
      saveWorkflowContext({ paymentId: confirmed.id, paymentNo: confirmed.paymentNo, paymentStatus: confirmed.status || 'CONFIRMED' });
      renderPaymentDetail(confirmed);
      show('CONFIRMED', { 付款记录: confirmed.paymentNo || confirmed.id, 付款状态: confirmed.status || 'CONFIRMED', 付款金额: money(confirmed.amount), 当前版本: confirmed.version ?? '—' });
      setNotice('');
    } catch (error) { setNotice(error.message); }
  });
  document.getElementById('app-create-confirm-payment').addEventListener('click', async () => {
    try {
      const confirmed = await createAndConfirmPayment({ financeToken, supplierToken, supplierStatements });
      payment = confirmed;
      document.getElementById('app-finance-payment-id').value = confirmed.id;
      document.getElementById('app-finance-label').textContent = confirmed.status || 'CONFIRMED';
      saveWorkflowContext({ paymentId: confirmed.id, paymentNo: confirmed.paymentNo, paymentStatus: confirmed.status || 'CONFIRMED' });
      renderPaymentDetail(confirmed);
      show('CONFIRMED', {
        付款记录: confirmed.paymentNo || confirmed.id,
        付款状态: confirmed.status || 'CONFIRMED',
        付款金额: money(confirmed.amount),
        当前版本: confirmed.version ?? '—',
      });
      setNotice('');
    } catch (error) { setNotice(error.message); }
  });
  document.getElementById('app-create-reject-payment').addEventListener('click', async () => {
    try {
      const rejected = await createAndRejectPayment({ financeToken, supplierToken, supplierStatements });
      payment = rejected;
      document.getElementById('app-finance-payment-id').value = rejected.id;
      document.getElementById('app-finance-label').textContent = rejected.status || 'REJECTED';
      saveWorkflowContext({ paymentId: rejected.id, paymentNo: rejected.paymentNo, paymentStatus: rejected.status || 'REJECTED' });
      renderPaymentDetail(rejected);
      show('REJECTED', {
        付款记录: rejected.paymentNo || rejected.id,
        付款状态: rejected.status || 'REJECTED',
        付款金额: money(rejected.amount),
        当前版本: rejected.version ?? '—',
      });
      setNotice('');
    } catch (error) { setNotice(error.message); }
  });
  document.getElementById('app-reject-payment').addEventListener('click', async () => {
    try {
      if (!payment) await loadPayment();
      const rejected = await request(`/payment-records/${payment.id}/reject`, {
        method: 'POST',
        headers: { 'idempotency-key': `product-app-payment-reject-${crypto.randomUUID()}` },
        body: JSON.stringify({ expectedVersion: payment.version, reason: document.getElementById('app-finance-payment-reason').value.trim() || '产品应用驳回付款' }),
      }, supplierToken);
      payment = rejected;
      saveWorkflowContext({ paymentId: rejected.id, paymentNo: rejected.paymentNo, paymentStatus: rejected.status || 'REJECTED' });
      renderPaymentDetail(rejected);
      show('REJECTED', { 付款记录: rejected.paymentNo || rejected.id, 付款状态: rejected.status || 'REJECTED', 付款金额: money(rejected.amount), 当前版本: rejected.version ?? '—' });
      setNotice('');
    } catch (error) { setNotice(error.message); }
  });
}

async function uploadPaymentEvidence(token) {
  const content = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF
`;
  const blob = new Blob([content], { type: 'application/pdf' });
  const session = await request('/files/upload-sessions', {
    method: 'POST',
    body: JSON.stringify({
      purpose: 'PAYMENT',
      filename: `product-app-payment-${Date.now()}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: blob.size,
    }),
  }, token);
  const upload = await fetch(`${apiBase}/files/${session.id}/content`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/octet-stream',
      'x-upload-token': session.uploadToken,
    },
    body: blob,
  });
  if (!upload.ok) throw new Error('付款凭证上传失败');
  await request(`/files/${session.id}/complete`, { method: 'POST' }, token);
  return session.id;
}

async function createPayment({ financeToken, supplierStatements }) {
  const supplierScopedStatements = supplierStatements.filter((item) => item.supplierId === state.seed.supplierId);
  const statement = supplierScopedStatements.find((item) => item.settlementStatus !== 'SETTLED' && item.status !== 'SETTLED') || supplierScopedStatements[0];
  if (!statement?.id) throw new Error('暂无可登记付款的供应商账单');
  const detail = await request(`/supplier-statements/${statement.id}`, {}, financeToken);
  const line = (detail.lines || []).find((item) => Number(item.totalAmount || item.payableAmount || 0) > 0);
  const settlementItemId = line?.settlementItemId || detail.adjustmentItems?.find((item) => Number(item.amount || 0) > 0)?.settlementItemId;
  if (!settlementItemId) throw new Error('供应商账单没有可付款结算项');
  const preview = await request('/payment-records/preview', {
    method: 'POST',
    body: JSON.stringify({ settlementItemIds: [settlementItemId] }),
  }, financeToken);
  if (preview.blockedItems?.length) throw new Error(preview.blockedItems.map((item) => item.message).join('；'));
  if (!preview.items?.length) throw new Error('付款预览没有可登记项目');
  const evidenceFileId = await uploadPaymentEvidence(financeToken);
  const payment = await request('/payment-records', {
    method: 'POST',
    headers: { 'idempotency-key': `product-app-payment-create-${crypto.randomUUID()}` },
    body: JSON.stringify({
      direction: preview.direction,
      businessDate: new Date().toISOString().slice(0, 10),
      evidenceFileIds: [evidenceFileId],
      items: preview.items.map((item) => ({
        settlementItemId: item.settlementItemId,
        expectedVersion: item.sourceVersion,
        expectedAmount: item.payableAmount,
      })),
    }),
  }, financeToken);
  return payment;
}

async function createAndConfirmPayment({ financeToken, supplierToken, supplierStatements }) {
  const payment = await createPayment({ financeToken, supplierStatements });
  return request(`/payment-records/${payment.id}/confirm`, {
    method: 'POST',
    headers: { 'idempotency-key': `product-app-payment-auto-confirm-${crypto.randomUUID()}` },
    body: JSON.stringify({ expectedVersion: payment.version }),
  }, supplierToken);
}

async function createAndRejectPayment({ financeToken, supplierToken, supplierStatements }) {
  const payment = await createPayment({ financeToken, supplierStatements });
  return request(`/payment-records/${payment.id}/reject`, {
    method: 'POST',
    headers: { 'idempotency-key': `product-app-payment-auto-reject-${crypto.randomUUID()}` },
    body: JSON.stringify({
      expectedVersion: payment.version,
      reason: document.getElementById('app-finance-payment-reason').value.trim() || '产品应用驳回付款',
    }),
  }, supplierToken);
}
