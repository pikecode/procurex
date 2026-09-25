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
async function loadMe() { if (!token) return; try { const me = await call('/me'); showSession(me.user || me); } catch { token = null; sessionStorage.removeItem('procurex-token'); showSession(); } }
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { active = tab.dataset.report; document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab)); updateMeta(); if (latest) runReport(); }));
function updateMeta() { const meta = reportMeta[active]; $('report-title').textContent = meta.title; $('report-desc').textContent = meta.desc; $('table-title').textContent = meta.table; }
$('login-form').addEventListener('submit', async (event) => { event.preventDefault(); $('login-error').textContent = ''; const form = new FormData(event.currentTarget); try { const result = await call('/auth/login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password'), client: 'WEB' }) }); token = result.accessToken; sessionStorage.setItem('procurex-token', token); showSession(result.user); } catch (error) { $('login-error').textContent = error.message; } });
$('logout').addEventListener('click', async () => { try { await call('/auth/logout', { method: 'POST' }); } catch {} token = null; sessionStorage.removeItem('procurex-token'); showSession(); });
$('run').addEventListener('click', runReport);
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
$('download').addEventListener('click', async () => { if (!latest) return; const button = $('download'); button.disabled = true; button.querySelector('span').textContent = '生成中…'; try { const job = await call('/exports', { method: 'POST', body: JSON.stringify({ reportType: active, filters: { from: $('from').value || undefined, to: $('to').value || undefined, storeId: $('storeId').value || undefined, supplierId: $('supplierId').value || undefined } }) }); let status; for (let i = 0; i < 30; i++) { status = await call(`/exports/${job.jobId}`); if (status.status === 'READY' || status.status === 'FAILED') break; await new Promise((resolve) => setTimeout(resolve, 1000)); } if (status.status !== 'READY') throw new Error(status.error || '导出仍在处理中，请稍后重试'); const response = await fetch(`${api}/exports/${job.jobId}/download`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('下载失败，请重新生成'); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = `procurex-${active}.csv`; link.click(); URL.revokeObjectURL(url); } catch (error) { $('notice').textContent = error.message; $('notice').classList.remove('hidden'); } finally { button.disabled = false; button.querySelector('span').textContent = '导出 CSV'; } });
showSession(); loadMe(); updateMeta();
