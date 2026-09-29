import { login, request } from '../api.js';
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
  bindFinance(supplierToken);
}

function bindFinance(supplierToken) {
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
