const api = `${location.protocol}//${location.hostname}:3100/api/v1`;
let token = sessionStorage.getItem('procurex-token');
let active = 'order-amounts';
let latest = null;
const $ = (id) => document.getElementById(id);
const reportMeta = {
  'order-amounts': { title: '完成订货金额', desc: '按订单完成日期统计，包含全部结算方式。', table: '月度趋势' },
  'product-quantities': { title: '商品流转数量', desc: '按订单完成日期汇总最终有效实收数量，最多查询三个月。', table: '商品汇总' },
  profit: { title: '商品经营差额', desc: '按首次发货日期统计已完成订单，运费单列且不计入差额。', table: '订单商品明细' },
};
const reportNames = { 'order-amounts': '订货金额', 'product-quantities': '商品数量', profit: '商品差额' };
function showSession(user) {
  $('login').classList.toggle('hidden', !!token); $('workspace').classList.toggle('hidden', !token);
  $('logout').classList.toggle('hidden', !token); $('identity').textContent = user ? `${user.displayName} · ${(user.roles || []).join(', ')}` : (token ? '已登录' : '未登录');
  const company = (user?.roles || []).some((r) => ['ADMIN', 'HQ_FINANCE', 'PURCHASER'].includes(r));
  $('company-filters').classList.toggle('hidden', !company); $('supplier-filter').classList.toggle('hidden', !company);
  if (user?.roles?.some((r) => ['STORE', 'STORE_FINANCE', 'SUPPLIER'].includes(r))) $('identity').textContent += ' · 已按账号范围过滤';
}
async function call(path, options = {}) {
  const response = await fetch(`${api}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error?.message || `请求失败（${response.status}）`);
  return body.data ?? body;
}
async function loadMe() { if (!token) return; try { const me = await call('/me'); showSession(me.user || me); await loadExportJobs(); } catch { token = null; sessionStorage.removeItem('procurex-token'); showSession(); } }
async function loadAcceptance() {
  try {
    const response = await fetch(`/reports-acceptance-run.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error('missing acceptance output');
    const data = await response.json();
    $('m5-acceptance-status').textContent = data.status === 'PASSED' ? 'PASSED' : data.status || 'UNKNOWN';
    $('m5-acceptance-status').classList.toggle('tag-ok', data.status === 'PASSED');
    $('m5-acceptance').innerHTML = (data.steps || []).map((step) => `<article><strong>${esc(step.title)}</strong><small>${esc(Object.entries(step.data || {}).map(([key, value]) => `${key}: ${value}`).join(' · '))}</small></article>`).join('');
  } catch {
    $('m5-acceptance-status').textContent = '未生成';
    $('m5-acceptance').innerHTML = '<article><strong>尚未生成 M5 验收结果</strong><small>运行 npm run acceptance:m5-browserless 后刷新页面</small></article>';
  }
}
async function loadM5Status() {
  try {
    const response = await fetch(`/m5-status.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error('missing M5 status output');
    const data = await response.json();
    const blocked = (data.checks || []).some((check) => check.status === 'BLOCKED');
    $('m5-status-label').textContent = blocked ? 'BLOCKED' : 'READY';
    $('m5-status-label').classList.toggle('tag-fail', blocked);
    $('m5-status-label').classList.toggle('tag-ok', !blocked);
    $('m5-status').innerHTML = [
      `<article><strong>${esc(data.summary || 'M5 状态已生成')}</strong><small>${esc(data.generatedAt || '')}</small></article>`,
      ...(data.checks || []).map((check) => `<article><strong>${esc(check.label)} · ${esc(check.status)}</strong><small>${esc(check.detail)}</small></article>`),
    ].join('');
  } catch {
    $('m5-status-label').textContent = '未生成';
    $('m5-status').innerHTML = '<article><strong>尚未生成 M5 状态总览</strong><small>运行 npm run m5:status 后刷新页面</small></article>';
  }
}
async function loadM5GateStatus() {
  try {
    const response = await fetch(`/m5-gate-status.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error('missing M5 gate output');
    const data = await response.json();
    const blocked = (data.gates || []).some((gate) => gate.status !== 'READY');
    $('m5-gate-label').textContent = blocked ? '需复核' : 'READY';
    $('m5-gate-label').classList.toggle('tag-fail', blocked);
    $('m5-gate-label').classList.toggle('tag-ok', !blocked);
    $('m5-gate-status').innerHTML = [
      `<article><strong>${esc(data.summary || 'M5 收口状态已生成')}</strong><small>${esc(data.generatedAt || '')}</small></article>`,
      ...(data.gates || []).map((gate) => `<article><strong>${esc(gate.id)} · ${esc(gate.status)}</strong><small>${esc(gate.title)} · ${esc(gate.detail)}</small></article>`),
    ].join('');
  } catch {
    $('m5-gate-label').textContent = '未生成';
    $('m5-gate-status').innerHTML = '<article><strong>尚未生成 M5 收口状态</strong><small>运行 npm run acceptance:m5-close 后刷新页面</small></article>';
  }
}
async function loadExportJobs() {
  if (!token) return;
  try {
    const jobs = await call('/exports');
    $('exports-empty').classList.toggle('hidden', !!jobs.length);
    $('export-jobs').innerHTML = jobs.map((job) => `<tr><td>${new Date(job.createdAt).toLocaleString('zh-CN')}</td><td><strong>${esc(reportNames[job.reportType] || job.reportType)}</strong></td><td><span class="tag ${job.status === 'READY' ? 'tag-ok' : job.status === 'FAILED' ? 'tag-fail' : 'tag-pending'}">${esc(job.status)}</span>${job.error ? `<small>${esc(job.error)}</small>` : ''}</td><td>${new Date(job.expiresAt).toLocaleString('zh-CN')}</td><td>${job.status === 'READY' ? `<button class="secondary" data-export-download="${esc(job.jobId)}">下载</button>` : job.status === 'FAILED' ? `<button class="secondary" data-export-retry="${esc(job.jobId)}">重试</button>` : ''}</td></tr>`).join('');
    $('export-jobs').querySelectorAll('[data-export-download]').forEach((button) => button.addEventListener('click', async () => { try { await downloadExportJob(button.dataset.exportDownload); } catch (error) { $('notice').textContent = error.message; $('notice').classList.remove('hidden'); } }));
    $('export-jobs').querySelectorAll('[data-export-retry]').forEach((button) => button.addEventListener('click', async () => { try { await retryExportJob(button.dataset.exportRetry); } catch (error) { $('notice').textContent = error.message; $('notice').classList.remove('hidden'); } }));
  } catch (error) {
    $('notice').textContent = error.message;
    $('notice').classList.remove('hidden');
  }
}
async function downloadExportJob(jobId) {
  const response = await fetch(`${api}/exports/${jobId}/download`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('下载失败，请重新生成');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `procurex-${jobId}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
async function retryExportJob(jobId) {
  await call(`/exports/${jobId}/retry`, { method: 'POST' });
  await loadExportJobs();
}
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { active = tab.dataset.report; document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab)); updateMeta(); if (latest) runReport(); }));
function updateMeta() { const meta = reportMeta[active]; $('report-title').textContent = meta.title; $('report-desc').textContent = meta.desc; $('table-title').textContent = meta.table; }
$('login-form').addEventListener('submit', async (event) => { event.preventDefault(); $('login-error').textContent = ''; const form = new FormData(event.currentTarget); try { const result = await call('/auth/login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password'), client: 'WEB' }) }); token = result.accessToken; sessionStorage.setItem('procurex-token', token); showSession(result.user); await loadExportJobs(); } catch (error) { $('login-error').textContent = error.message; } });
$('logout').addEventListener('click', async () => { try { await call('/auth/logout', { method: 'POST' }); } catch {} token = null; sessionStorage.removeItem('procurex-token'); showSession(); });
$('run').addEventListener('click', runReport);
$('refresh-exports').addEventListener('click', loadExportJobs);
async function runReport() {
  const params = new URLSearchParams(); if ($('from').value) params.set('from', $('from').value); if ($('to').value) params.set('to', $('to').value);
  if ($('storeId').value) params.set('storeId', $('storeId').value); if ($('supplierId').value) params.set('supplierId', $('supplierId').value);
  $('notice').classList.add('hidden'); $('run').disabled = true; $('run').textContent = '查询中…';
  try { latest = await call(`/reports/${active}?${params}`); render(latest); } catch (error) { $('notice').textContent = error.message; $('notice').classList.remove('hidden'); } finally { $('run').disabled = false; $('run').innerHTML = '<span>⌕</span> 查询报表'; }
}
const money = (value) => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function metric(label, value, foot, emphasis = false) { return `<div class="metric ${emphasis ? 'emphasis' : ''}"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`; }
function render(data) {
  $('asof').textContent = `统计口径 ${data.dateBasis || '—'} · 更新于 ${new Date(data.asOf).toLocaleString('zh-CN')}`;
  let head = '', rows = '', cards = '';
  if (active === 'order-amounts') {
    const months = data.months || []; const orders = data.orders || [];
    const totals = months.reduce((a, row) => ({ count: a.count + row.orderCount, goods: a.goods + Number(row.goodsAmount), freight: a.freight + Number(row.freightAmount), total: a.total + Number(row.totalAmount) }), { count: 0, goods: 0, freight: 0, total: 0 });
    cards = metric('完成订单', totals.count.toLocaleString(), '所选期间内完成') + metric('商品金额', money(totals.goods), '按最终有效数量计价') + metric('运费', money(totals.freight), '独立统计') + metric('订货总额', money(totals.total), '商品金额 + 运费', true);
    head = '<tr><th>统计月份</th><th>完成订单</th><th class="money">商品金额</th><th class="money">运费</th><th class="money">合计</th></tr>';
    rows = months.map((r) => `<tr><td><strong>${r.month}</strong></td><td>${r.orderCount}</td><td class="money">${money(r.goodsAmount)}</td><td class="money">${money(r.freightAmount)}</td><td class="money">${money(r.totalAmount)}</td></tr>`).join('');
  } else if (active === 'product-quantities') {
    const products = data.products || []; const total = products.reduce((n, p) => n + Number(p.quantity), 0);
    cards = metric('商品种类', products.length.toLocaleString(), '有完成记录的商品') + metric('实收总量', total.toLocaleString('zh-CN', { maximumFractionDigits: 2 }), '按商品基础单位汇总', true) + metric('统计区间', `${$('from').value} — ${$('to').value}`, '最多 3 个月') + metric('数据状态', products.length ? '已更新' : '暂无数据', '按完成日期');
    head = '<tr><th>商品名称</th><th>商品 ID</th><th>计量单位</th><th class="money">最终实收数量</th></tr>';
    rows = products.map((p) => `<tr><td><strong>${esc(p.productName)}</strong></td><td>${esc(p.productId)}</td><td><span class="tag">${esc(p.unit)}</span></td><td class="money">${Number(p.quantity).toLocaleString('zh-CN', { maximumFractionDigits: 6 })}</td></tr>`).join('');
  } else {
    const t = data.totals || {}; const details = data.rows || [];
    cards = metric('销售商品额', money(t.salesGoodsAmount), '按最终实收数量') + metric('供货商品额', money(t.supplyGoodsAmount), '已排除直接账期') + metric('商品差额', money(t.profit), '收入减商品供货额', true) + metric('运费', money(t.freightAmount), '单独显示，不计入差额');
    head = '<tr><th>首次发货</th><th>商品</th><th>订单 ID</th><th class="money">数量</th><th class="money">销售商品额</th><th class="money">供货商品额</th><th class="money">差额</th></tr>';
    rows = details.map((r) => `<tr><td>${new Date(r.firstShippedAt).toLocaleDateString('zh-CN')}</td><td><strong>${esc(r.productName)}</strong></td><td>${esc(r.supplierOrderId)}</td><td class="money">${Number(r.quantity).toLocaleString('zh-CN', { maximumFractionDigits: 6 })} ${esc(r.unit)}</td><td class="money">${money(r.salesGoodsAmount)}</td><td class="money">${money(r.supplyGoodsAmount)}</td><td class="money">${money(r.profit)}</td></tr>`).join('');
  }
  $('summary').innerHTML = cards; $('thead').innerHTML = head; $('tbody').innerHTML = rows; $('empty').classList.toggle('hidden', !!rows);
}
$('download').addEventListener('click', async () => { if (!latest) return; const button = $('download'); button.disabled = true; button.querySelector('span').textContent = '生成中…'; try { const job = await call('/exports', { method: 'POST', body: JSON.stringify({ reportType: active, filters: { from: $('from').value || undefined, to: $('to').value || undefined, storeId: $('storeId').value || undefined, supplierId: $('supplierId').value || undefined } }) }); await loadExportJobs(); let status; for (let i = 0; i < 30; i++) { status = await call(`/exports/${job.jobId}`); if (status.status === 'READY' || status.status === 'FAILED') break; await new Promise((resolve) => setTimeout(resolve, 1000)); } if (status.status !== 'READY') throw new Error(status.error || '导出仍在处理中，请稍后重试'); await downloadExportJob(job.jobId); await loadExportJobs(); } catch (error) { $('notice').textContent = error.message; $('notice').classList.remove('hidden'); } finally { button.disabled = false; button.querySelector('span').textContent = '导出 CSV'; } });
showSession(); loadMe(); updateMeta(); loadAcceptance(); loadM5Status(); loadM5GateStatus();
