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

function renderExternal(data) {
  $('external-status').textContent = data.status || 'UNKNOWN';
  $('external-status').className = `tag ${data.status === 'READY' ? 'tag-ok' : 'tag-fail'}`;
  $('external-summary').textContent = data.summary || '';
  const artifacts = data.expectedArtifacts || {};
  $('external-checks').innerHTML = (data.checks || []).map((check) => {
    const artifact = Object.values(artifacts).find((item) => (check.evidence || []).includes(item.path));
    const evidence = (check.evidence || []).join(' · ');
    const template = artifact?.template ? `<br>模板：${esc(artifact.template)}` : '';
    return `<article><strong>${esc(check.id)} · ${esc(check.title)} <span class="tag ${statusClass(check.status)}">${esc(check.status)}</span></strong><small>${esc(check.detail)}${evidence ? `<br>证据：${esc(evidence)}` : ''}${template}</small></article>`;
  }).join('');
}

function renderPackage(data) {
  $('package-status').textContent = data.status || 'UNKNOWN';
  $('package-status').className = `tag ${data.status === 'LOCAL_READY' ? 'tag-ok' : 'tag-fail'}`;
  $('package-summary').textContent = data.summary || '';
  const commandRows = (data.commands || []).slice(0, 8).map((command) => `<br>命令：${esc(command)}`).join('');
  const files = data.files || [];
  const existing = files.filter((file) => file.exists).length;
  $('package-checks').innerHTML = [
    `<article><strong>Git · ${esc(data.git?.branch || 'unknown')} <span class="tag ${data.git?.dirty ? 'tag-pending' : 'tag-ok'}">${data.git?.dirty ? 'DIRTY' : 'CLEAN'}</span></strong><small>${esc(data.git?.commit || '')}<br>${esc(data.git?.remote || '')}</small></article>`,
    `<article><strong>Evidence Files <span class="tag ${existing === files.length ? 'tag-ok' : 'tag-fail'}">${existing}/${files.length}</span></strong><small>缺失：${esc((data.missingFiles || []).join(' · ') || '无')}</small></article>`,
    `<article><strong>Local Checks <span class="tag ${data.status === 'LOCAL_READY' ? 'tag-ok' : 'tag-fail'}">${esc(data.status || 'UNKNOWN')}</span></strong><small>失败：${esc((data.failedStatusChecks || []).join(' · ') || '无')}${commandRows}</small></article>`,
  ].join('');
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

async function loadExternalEvidence() {
  try {
    const response = await fetch(`/m6-external-evidence.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error('missing external evidence output');
    renderExternal(await response.json());
  } catch {
    $('external-checks').innerHTML = '<article><strong>尚未生成外部证据清单</strong><small>运行 npm run m6:external-evidence 后刷新页面；模板在 docs/m6-evidence-templates/。</small></article>';
  }
}

async function loadEvidencePackage() {
  try {
    const response = await fetch(`/m6-local-evidence-package.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error('missing local evidence package output');
    renderPackage(await response.json());
  } catch {
    $('package-checks').innerHTML = '<article><strong>尚未生成本地证据包</strong><small>运行 npm run m6:package-local-evidence 后刷新页面。</small></article>';
  }
}

loadReadiness();
loadExternalEvidence();
loadEvidencePackage();
