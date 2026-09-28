const api = `${location.protocol}//${location.hostname}:3100/api/v1`;
let token = sessionStorage.getItem('procurex-token');
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = (value) => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const labels = {
  STORE_BALANCE_LEDGER_MISMATCH: '账户余额与最新流水不一致',
  STORE_CREDIT_USED_MISMATCH: '挂账占用与资金占用不一致',
};
const exportStatusLabels = {
  QUEUED: '排队',
  PROCESSING: '处理中',
  READY: '已完成',
  FAILED: '失败',
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
    await loadOperations();
  } catch {
    token = null;
    sessionStorage.removeItem('procurex-token');
    showSession();
  }
}

async function loadOperations() {
  $('notice').classList.add('hidden');
  await Promise.all([loadIssues(), loadExportHealth(), loadNotifications(), loadAuditLogs()]);
}

async function loadIssues() {
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

async function loadExportHealth() {
  try {
    const health = await call('/exports/health');
    const statusText = health.byStatus.map((row) => `${exportStatusLabels[row.status] || row.status} ${row.count}`).join(' / ');
    const watchedJobs = [
      ...health.staleProcessing.map((job) => ({ kind: '超时处理中', tag: 'tag-fail', ...job, note: `超过 ${health.leaseMinutes} 分钟未完成，当前 ${job.ageMinutes} 分钟` })),
      ...health.recentFailures.map((job) => ({ kind: '近24小时失败', tag: 'tag-pending', ...job, note: job.error || '导出生成失败' })),
    ];
    $('export-health-summary').innerHTML =
      metric('导出任务', health.totalJobsSampled, statusText || '最近任务样本') +
      metric('超时处理中', health.staleProcessing.length, `租约 ${health.leaseMinutes} 分钟`, health.staleProcessing.length > 0) +
      metric('近24小时失败', health.recentFailures.length, '失败任务需要复核', health.recentFailures.length > 0);
    $('export-health-empty').classList.toggle('hidden', watchedJobs.length > 0);
    $('export-health-jobs').innerHTML = watchedJobs.map((job) => `<tr><td><span class="tag ${job.tag}">${esc(job.kind)}</span></td><td><strong>${esc(job.jobId.slice(0, 8))}</strong><br><small>${esc(job.jobId)}</small></td><td>${esc(job.reportType)}</td><td>${esc(new Date(job.createdAt).toLocaleString('zh-CN'))}</td><td>${esc(job.note)}</td></tr>`).join('');
  } catch (error) {
    $('notice').textContent = error.message;
    $('notice').classList.remove('hidden');
  }
}

async function loadNotifications() {
  try {
    const data = await call('/notifications');
    const notifications = data.notifications || [];
    $('notifications-summary').textContent = `I08 当前账号通知与已读处理 · 未读 ${data.unreadCount || 0}`;
    $('read-all-notifications').disabled = !data.unreadCount;
    $('notifications-empty').classList.toggle('hidden', notifications.length > 0);
    $('notifications').innerHTML = notifications.map((item) => `<tr><td><span class="tag ${item.status === 'UNREAD' ? 'tag-pending' : 'tag-ok'}">${item.status === 'UNREAD' ? '未读' : '已读'}</span></td><td><strong>${esc(item.title)}</strong><br><small>${esc(item.channel)}</small></td><td>${esc(item.body)}</td><td>${esc(new Date(item.createdAt).toLocaleString('zh-CN'))}</td><td>${item.status === 'UNREAD' ? `<button class="secondary" data-notification-read="${esc(item.id)}">已读</button>` : ''}</td></tr>`).join('');
    $('notifications').querySelectorAll('[data-notification-read]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await call(`/notifications/${button.dataset.notificationRead}/read`, { method: 'POST' });
        await loadNotifications();
      } catch (error) {
        $('notice').textContent = error.message;
        $('notice').classList.remove('hidden');
      }
    }));
  } catch (error) {
    $('notice').textContent = error.message;
    $('notice').classList.remove('hidden');
  }
}

async function loadAuditLogs() {
  try {
    const filters = new URLSearchParams();
    const form = new FormData($('audit-filter-form'));
    for (const name of ['action', 'entityType', 'traceId']) {
      const value = String(form.get(name) || '').trim();
      if (value) filters.set(name, value);
    }
    const suffix = filters.toString() ? `?${filters}` : '';
    const logs = await call(`/audit-logs${suffix}`);
    $('audit-logs-empty').classList.toggle('hidden', logs.length > 0);
    $('audit-logs').innerHTML = logs.map((item) => `<tr><td><strong>${esc(item.action)}</strong><br><small>${esc(item.reason || '')}</small></td><td>${esc(item.entityType)}<br><small>${esc(item.entityId)}</small></td><td>${esc(item.actorName)}</td><td><small>${esc(item.traceId)}</small></td><td>${esc(new Date(item.createdAt).toLocaleString('zh-CN'))}</td></tr>`).join('');
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
    await loadOperations();
  } catch (error) {
    $('login-error').textContent = error.message;
  }
});
$('logout').addEventListener('click', async () => { try { await call('/auth/logout', { method: 'POST' }); } catch {} token = null; sessionStorage.removeItem('procurex-token'); showSession(); });
$('refresh').addEventListener('click', loadOperations);
$('refresh-issues').addEventListener('click', loadOperations);
$('refresh-notifications').addEventListener('click', loadOperations);
$('read-all-notifications').addEventListener('click', async () => {
  try {
    await call('/notifications/read-all', { method: 'POST' });
    await loadNotifications();
  } catch (error) {
    $('notice').textContent = error.message;
    $('notice').classList.remove('hidden');
  }
});
$('refresh-audit-logs').addEventListener('click', loadOperations);
$('audit-filter-form').addEventListener('submit', async (event) => { event.preventDefault(); await loadAuditLogs(); });
$('clear-audit-filters').addEventListener('click', async () => { $('audit-filter-form').reset(); await loadAuditLogs(); });
showSession();
loadMe();
