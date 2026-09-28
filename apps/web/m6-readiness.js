const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function metric(label, value, foot, emphasis = false) {
  return `<div class="metric ${emphasis ? 'emphasis' : ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></div>`;
}

function statusClass(status) {
  if (status === 'READY' || status === 'LOCAL_READY') return 'tag-ok';
  if (status === 'BLOCKED') return 'tag-fail';
  return 'tag-pending';
}

function render(data) {
  const counts = data.counts || {};
  $('generated').textContent = data.generatedAt ? `生成于 ${new Date(data.generatedAt).toLocaleString('zh-CN')}` : '未生成';
  $('status-label').textContent = data.status || 'UNKNOWN';
  $('readiness-status').textContent = data.status || 'UNKNOWN';
  $('readiness-status').className = `tag ${data.status === 'READY' ? 'tag-ok' : 'tag-fail'}`;
  $('readiness-summary').textContent = data.summary || '';
  $('summary').innerHTML =
    metric('READY', counts.ready || 0, '可作为上线证据', data.status === 'READY') +
    metric('LOCAL_READY', counts.localReady || 0, '本地证据充分，仍需生产验证') +
    metric('BLOCKED', counts.blocked || 0, '缺外部配置或真实证据') +
    metric('PLANNED', counts.planned || 0, '已列入上线前计划');
  $('checks').innerHTML = (data.checks || []).map((check) => {
    const evidence = (check.evidence || []).join(' · ');
    return `<article><strong>${esc(check.id)} · ${esc(check.title)} <span class="tag ${statusClass(check.status)}">${esc(check.status)}</span></strong><small>${esc(check.detail)}${evidence ? `<br>证据：${esc(evidence)}` : ''}</small></article>`;
  }).join('');
}

async function loadReadiness() {
  try {
    const response = await fetch(`/m6-readiness.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error('missing readiness output');
    render(await response.json());
  } catch {
    $('summary').innerHTML =
      metric('READY', 0, '尚未检查') +
      metric('LOCAL_READY', 0, '尚未检查') +
      metric('BLOCKED', 0, '尚未检查') +
      metric('PLANNED', 0, '尚未检查');
    $('checks').innerHTML = '<article><strong>尚未生成 M6 readiness</strong><small>运行 npm run m6:readiness 后刷新页面；strict gate 暂不应用于当前本地开发状态。</small></article>';
  }
}

loadReadiness();
