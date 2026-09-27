const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const amountKey = (key) => key.includes('Amount') || key === 'amount' || key === 'totalPayableAmount' || key === 'payableAmount';
const statusKey = (key) => key.includes('status') || key.includes('Status') || key === 'direction' || key === 'channel' || key === 'cycle' || key === 'method';
const manualStorageKey = 'procurex:m4-manual-evidence';

let gateDefinitions = [];

const accounts = [
  ['pxacc_admin', 'ADMIN / HQ_FINANCE', '全部账单、W10 调整、付款登记与确认'],
  ['pxacc_store', 'STORE / STORE_FINANCE', '门店账单、直营账期、门店侧确认'],
  ['pxacc_supplier_company', 'SUPPLIER', '公司账期供应商视角'],
  ['pxacc_supplier_direct', 'SUPPLIER', '直营供应商视角'],
];

function metric(label, value, foot, emphasis = false) {
  return `<div class="metric ${emphasis ? 'emphasis' : ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></div>`;
}

async function fetchJson(path) {
  const response = await fetch(`${path}?ts=${Date.now()}`);
  if (!response.ok) throw new Error(`${path} 未生成`);
  return response.json();
}

async function loadGateDefinitions() {
  if (!gateDefinitions.length) gateDefinitions = await fetchJson('/m4-gates.json');
  return gateDefinitions;
}

async function loadResult() {
  $('notice').classList.add('hidden');
  try {
    await loadGateDefinitions();
    const [billing, mainFlow] = await Promise.all([
      fetchJson('/billing-acceptance-run.json'),
      fetchJson('/main-flow-run.json'),
    ]);
    render(billing, mainFlow);
  } catch (error) {
    $('status-label').textContent = '未生成';
    $('generated').textContent = '运行 acceptance:m4-browserless 后查看';
    $('summary').innerHTML = metric('运行命令', 'acceptance:m4-browserless', '会生成 M4 和主流程结果', true);
    window.currentBillingSteps = [];
    renderGates();
    renderManualPlan();
    renderAccounts();
    renderEvidenceSummary([], null);
    $('steps').innerHTML = '';
    $('empty').classList.remove('hidden');
    $('notice').textContent = error.message;
    $('notice').classList.remove('hidden');
  }
}

function render(billing, mainFlow) {
  const billingSteps = billing.steps || [];
  const mainSteps = mainFlow.steps || [];
  const allSteps = [
    ...billingSteps.map((step) => ({ ...step, group: 'M4 账单' })),
    ...mainSteps.map((step) => ({ ...step, group: '主流程' })),
  ];
  $('status-label').textContent = billing.status === 'PASSED' && mainFlow.status === 'PASSED' ? 'PASSED' : 'CHECK';
  $('generated').textContent = new Date(billing.generatedAt).toLocaleString('zh-CN');
  $('summary').innerHTML =
    metric('M4 账单验收', billing.status || 'UNKNOWN', `${billingSteps.length} 个检查`, true) +
    metric('主流程验收', mainFlow.status || 'UNKNOWN', `${mainSteps.length} 个步骤`) +
    metric('直接账期预览', findValue(billingSteps, 'channel') || '—', findValue(billingSteps, 'direction') || '付款方向') +
    metric('W10 Offset', findValue(billingSteps, 'status') || '—', findValue(billingSteps, 'amount') || '处置金额');
  window.currentBillingSteps = billingSteps;
  renderGates(billingSteps);
  renderManualPlan();
  renderAccounts();
  renderEvidenceSummary(billingSteps, billing);
  $('empty').classList.toggle('hidden', allSteps.length > 0);
  $('steps').innerHTML = allSteps.map((step) => {
    const parts = splitData(step.data);
    return `<tr><td><strong>${esc(step.group)}</strong><br>${esc(step.title)}</td><td>${parts.state.map(esc).join('<br>') || '—'}</td><td class="money">${parts.amounts.map(esc).join('<br>') || '—'}</td><td>${parts.other.map(esc).join('<br>') || '—'}</td></tr>`;
  }).join('');
}

function splitData(data) {
  const state = [];
  const amounts = [];
  const other = [];
  for (const [key, value] of Object.entries(data || {})) {
    const text = `${key}: ${value}`;
    if (amountKey(key)) amounts.push(text);
    else if (statusKey(key)) state.push(text);
    else other.push(text);
  }
  return { state, amounts, other };
}

function findValue(steps, key) {
  for (const step of [...steps].reverse()) {
    if (step.data && step.data[key] !== undefined) return String(step.data[key]);
  }
  return null;
}

function renderGates(billingSteps = []) {
  const evidenceByGate = collectEvidence(billingSteps);
  const manualEvidence = loadManualEvidence();
  $('gates').innerHTML = gateDefinitions.map((gate) => {
    const passed = evidenceByGate.get(gate.id) || new Set();
    const autoCount = gate.autoEvidence.filter(([id]) => passed.has(id)).length;
    const manualCount = gate.manualEvidence.filter(([id]) => manualEvidence.has(`${gate.id}:${id}`)).length;
    const evidence = autoCount ? `自动证据 ${autoCount}/${gate.autoEvidence.length}` : '等待自动证据';
    return `<article class="gate-card"><div class="gate-top"><span class="gate-id">${esc(gate.id)}</span><span class="gate-state">${esc(gate.state)}</span></div><h3>${esc(gate.title)}</h3><div class="gate-evidence">${esc(evidence)} · 人工证据 ${manualCount}/${gate.manualEvidence.length}</div><ul>${gate.autoEvidence.map(([id, label]) => `<li class="${passed.has(id) ? 'passed' : ''}">${esc(label)}</li>`).join('')}</ul><div class="manual-title">最终关闭还需要</div><div class="manual-checks">${gate.manualEvidence.map(([id, label]) => manualCheck(gate.id, id, label, manualEvidence)).join('')}</div></article>`;
  }).join('');
  bindManualChecks();
}

function collectEvidence(steps) {
  const evidenceByGate = new Map();
  for (const step of steps) {
    for (const gate of step.gates || []) {
      if (!evidenceByGate.has(gate.gateId)) evidenceByGate.set(gate.gateId, new Set());
      evidenceByGate.get(gate.gateId).add(gate.evidenceId);
    }
  }
  return evidenceByGate;
}

function renderAccounts() {
  $('accounts').innerHTML = accounts.map(([username, role, scope]) => `<div class="account-item"><strong>${esc(username)}</strong><span>${esc(role)}</span><small>${esc(scope)}</small></div>`).join('');
}

function renderManualPlan() {
  $('manual-plan').innerHTML = gateDefinitions.map((gate) => `<article class="manual-plan-group"><h4>${esc(gate.id)} ${esc(gate.title)}</h4>${(gate.manualSteps || []).map((step, index) => `<div class="manual-step"><strong>${index + 1}</strong><div><span>${esc(step.account)} · ${esc(step.entry)}</span><p>${esc(step.action)}</p><small>${esc(step.expected)}</small></div></div>`).join('')}</article>`).join('');
}

function manualCheck(gateId, evidenceId, label, manualEvidence) {
  const key = `${gateId}:${evidenceId}`;
  return `<label class="manual-check"><input type="checkbox" data-manual-evidence="${esc(key)}" ${manualEvidence.has(key) ? 'checked' : ''}><span>${esc(label)}</span></label>`;
}

function loadManualEvidence() {
  try {
    return new Set(JSON.parse(localStorage.getItem(manualStorageKey) || '[]'));
  } catch {
    return new Set();
  }
}

function saveManualEvidence(manualEvidence) {
  localStorage.setItem(manualStorageKey, JSON.stringify([...manualEvidence].sort()));
}

function bindManualChecks() {
  for (const input of document.querySelectorAll('[data-manual-evidence]')) {
    input.addEventListener('change', () => {
      const manualEvidence = loadManualEvidence();
      if (input.checked) manualEvidence.add(input.dataset.manualEvidence);
      else manualEvidence.delete(input.dataset.manualEvidence);
      saveManualEvidence(manualEvidence);
      renderGates(window.currentBillingSteps || []);
      renderEvidenceSummary(window.currentBillingSteps || [], window.currentBillingResult || null);
    });
  }
}

function renderEvidenceSummary(billingSteps = [], billing = null) {
  window.currentBillingResult = billing;
  const evidenceByGate = collectEvidence(billingSteps);
  const manualEvidence = loadManualEvidence();
  const lines = [
    'ProcureX M4 acceptance summary',
    `Generated: ${billing?.generatedAt ? new Date(billing.generatedAt).toLocaleString('zh-CN') : 'not generated'}`,
    `Command: npm run acceptance:m4-browserless`,
    '',
  ];
  for (const gate of gateDefinitions) {
    const automatic = evidenceByGate.get(gate.id) || new Set();
    const automaticLabels = gate.autoEvidence.filter(([id]) => automatic.has(id)).map(([, label]) => label);
    const manualDone = gate.manualEvidence.filter(([id]) => manualEvidence.has(`${gate.id}:${id}`)).map(([, label]) => label);
    const manualTodo = gate.manualEvidence.filter(([id]) => !manualEvidence.has(`${gate.id}:${id}`)).map(([, label]) => label);
    lines.push(`${gate.id} ${gate.title}`);
    lines.push(`  Automatic evidence: ${automaticLabels.length}/${gate.autoEvidence.length}`);
    for (const label of automaticLabels) lines.push(`    - ${label}`);
    lines.push(`  Manual evidence: ${manualDone.length}/${gate.manualEvidence.length}`);
    for (const label of manualDone) lines.push(`    - done: ${label}`);
    for (const label of manualTodo) lines.push(`    - todo: ${label}`);
    for (const step of gate.manualSteps || []) lines.push(`    - step: ${step.account} / ${step.entry} / ${step.expected}`);
    lines.push('');
  }
  $('evidence-summary').value = lines.join('\n').trim();
}

async function copyEvidenceSummary() {
  const text = $('evidence-summary').value;
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
  else $('evidence-summary').select();
  $('copy-summary').textContent = '已复制';
  setTimeout(() => {
    $('copy-summary').textContent = '复制摘要';
  }, 1200);
}

$('refresh').addEventListener('click', loadResult);
$('copy-summary').addEventListener('click', copyEvidenceSummary);
loadResult();
