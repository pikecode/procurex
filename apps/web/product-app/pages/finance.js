import { apiBase, login, request } from '../api.js';
import { state } from '../state.js';
import { esc, money, metric, resultLine, tableRows, setNotice } from '../ui.js';
import { setHeader } from '../shell.js';

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
        <div class="table-wrap"><table><thead><tr><th>账单</th><th>周期</th><th>状态</th><th class="money">应付</th></tr></thead><tbody>${tableRows(supplierStatements.slice(0, 8).map((item) => `<tr><td>${esc(item.statementNo || item.id)}</td><td>${esc(item.cycle || item.periodKey || '—')}</td><td>${esc(item.settlementStatus || item.status || '—')}</td><td class="money">${esc(money(item.payableAmount || item.totalPayableAmount || item.totalAmount))}</td></tr>`), 4, '暂无供应商账单')}</tbody></table></div>
      </section>
      <section class="data-card">
        <div class="data-head"><div><h3>付款记录</h3><p>供应商收款确认/驳回入口</p></div><span id="app-finance-label" class="tag">等待选择</span></div>
        <div class="table-wrap compact"><table><thead><tr><th>付款</th><th>状态</th><th class="money">金额</th><th></th></tr></thead><tbody>${tableRows(payments.slice(0, 8).map((item) => `<tr><td>${esc(item.paymentNo || item.id)}</td><td>${esc(item.status || '—')}</td><td class="money">${esc(money(item.amount))}</td><td><button class="secondary" data-app-finance-payment="${esc(item.id)}">选择</button></td></tr>`), 4, '暂无付款记录')}</tbody></table></div>
      </section>
    </section>
    <section class="data-card acceptance-card">
      <div class="data-head"><div><h3>收款处理</h3><p>读取付款 version 后由供应商确认或驳回。</p></div><span id="app-payment-action-label" class="tag">READY</span></div>
      <div class="receipt-panel">
        <label>付款 ID<input id="app-finance-payment-id" value="${esc(pendingPayments[0]?.id || payments[0]?.id || '')}"></label>
        <label>驳回原因<input id="app-finance-payment-reason" value="产品应用驳回付款"></label>
        <div class="form-actions">
          <button id="app-load-payment" class="secondary">读取付款</button>
          <button id="app-create-confirm-payment" class="primary">登记并确认供应商付款</button>
          <button id="app-confirm-payment" class="primary">确认收款</button>
          <button id="app-reject-payment" class="secondary">驳回付款</button>
        </div>
      </div>
      <div id="app-finance-result" class="store-result">
        ${resultLine('待确认付款', pendingPayments.length)}
        ${resultLine('已确认付款', confirmedPayments.length)}
        ${resultLine('待确认金额', money(pendingAmount))}
      </div>
    </section>`;
  bindFinance({ financeToken, supplierToken, supplierStatements });
}

function bindFinance({ financeToken, supplierToken, supplierStatements }) {
  let payment = null;
  const show = (label, data) => {
    document.getElementById('app-payment-action-label').textContent = label;
    document.getElementById('app-finance-result').innerHTML = Object.entries(data).map(([key, value]) => `<article><span>${esc(key)}</span><strong>${esc(value)}</strong></article>`).join('');
  };
  const loadPayment = async () => {
    const paymentId = document.getElementById('app-finance-payment-id').value.trim();
    if (!paymentId) throw new Error('请先选择付款记录');
    payment = await request(`/payment-records/${paymentId}`, {}, supplierToken);
    document.getElementById('app-finance-label').textContent = payment.status || '已读取';
    show(payment.status || '已读取', {
      付款记录: payment.paymentNo || payment.id,
      付款状态: payment.status || '—',
      付款金额: money(payment.amount),
      当前版本: payment.version ?? '—',
    });
    return payment;
  };
  document.querySelectorAll('[data-app-finance-payment]').forEach((button) => button.addEventListener('click', async () => {
    document.getElementById('app-finance-payment-id').value = button.dataset.appFinancePayment;
    try { await loadPayment(); setNotice(''); } catch (error) { setNotice(error.message); }
  }));
  document.getElementById('app-load-payment').addEventListener('click', async () => {
    try { await loadPayment(); setNotice(''); } catch (error) { setNotice(error.message); }
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
      show('CONFIRMED', {
        付款记录: confirmed.paymentNo || confirmed.id,
        付款状态: confirmed.status || 'CONFIRMED',
        付款金额: money(confirmed.amount),
        当前版本: confirmed.version ?? '—',
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

async function createAndConfirmPayment({ financeToken, supplierToken, supplierStatements }) {
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
  return request(`/payment-records/${payment.id}/confirm`, {
    method: 'POST',
    headers: { 'idempotency-key': `product-app-payment-auto-confirm-${crypto.randomUUID()}` },
    body: JSON.stringify({ expectedVersion: payment.version }),
  }, supplierToken);
}
