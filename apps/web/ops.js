const api = `${location.protocol}//${location.hostname}:3100/api/v1`;
let token = sessionStorage.getItem('procurex-token');
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = (value) => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const labels = {
  STORE_BALANCE_LEDGER_MISMATCH: '账户余额与最新流水不一致',
  STORE_CREDIT_USED_MISMATCH: '挂账占用与资金占用不一致',
};

function metric(label, value, foot, emphasis = false) {
  return `<div class="metric ${emphasis ? 'emphasis' : ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></div>`;
}

function showSession(user) {
  $('login').classList.toggle('hidden', !!token);
  $('workspace').classList.toggle('hidden', !token);
  $('logout').classList.toggle('hidden', !token);
  $('identity').textContent = user ? `${user.displayName} · ${(user.roles || []).join(', ')}` : (token ? '已登录' : '未登录');
}

async function call(path, options = {}) {
  const response = await fetch(`${api}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error?.message || `请求失败（${response.status}）`);
  return body.data ?? body;
}

async function loadMe() {
  if (!token) return;
  try {
    const me = await call('/me');
    showSession(me.user || me);
    await loadIssues();
  } catch {
    token = null;
    sessionStorage.removeItem('procurex-token');
    showSession();
  }
}

async function loadIssues() {
  $('notice').classList.add('hidden');
  try {
    const issues = await call('/reconciliation-issues');
    const stores = new Set(issues.map((issue) => issue.storeId));
    $('summary').innerHTML =
      metric('异常数', issues.length, 'R05 当前发现') +
      metric('影响门店', stores.size, '按门店聚合') +
      metric('处理方式', issues.length ? '人工核查' : '无需处理', '不会自动改账', true);
    $('empty').classList.toggle('hidden', issues.length > 0);
    $('issues').innerHTML = issues.map((issue) => `<tr><td><strong>${esc(issue.storeCode)}</strong><br>${esc(issue.storeName)}</td><td><span class="tag ${issue.severity === 'ERROR' ? 'tag-fail' : 'tag-pending'}">${esc(labels[issue.type] || issue.type)}</span></td><td class="money">${money(issue.actualAmount)}</td><td class="money">${money(issue.expectedAmount)}</td><td class="money">${money(issue.deltaAmount)}</td><td>${esc(issue.basis)}</td></tr>`).join('');
  } catch (error) {
    $('notice').textContent = error.message;
    $('notice').classList.remove('hidden');
  }
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('login-error').textContent = '';
  const form = new FormData(event.currentTarget);
  try {
    const result = await call('/auth/login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password'), client: 'WEB' }) });
    token = result.accessToken;
    sessionStorage.setItem('procurex-token', token);
    showSession(result.user);
    await loadIssues();
  } catch (error) {
    $('login-error').textContent = error.message;
  }
});
$('logout').addEventListener('click', async () => { try { await call('/auth/logout', { method: 'POST' }); } catch {} token = null; sessionStorage.removeItem('procurex-token'); showSession(); });
$('refresh').addEventListener('click', loadIssues);
showSession();
loadMe();
