const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const amountKey = (key) => key.includes('Amount') || key === 'amount' || key === 'totalPayableAmount' || key === 'payableAmount';
const statusKey = (key) => key.includes('status') || key.includes('Status') || key === 'direction' || key === 'channel' || key === 'cycle' || key === 'method';

const gateDefinitions = [
  {
    id: 'DEV-402',
    title: '结算金额与周期',
    state: 'Partial',
    autoEvidence: [
      ['stored-value-payable', '储值单生成供应商应付'],
      ['credit-period', '信用账期半月周期'],
      ['direct-term-preview', '直营账期预览为 DIRECT'],
      ['company-term-block', '公司账期先收后付阻断'],
    ],
    manualEvidence: ['W09/S05/S08 四种结算模式截图', '周期标签与付款状态复核'],
  },
  {
    id: 'DEV-403',
    title: '账单家族与共享项',
    state: 'Partial',
    autoEvidence: [
      ['store-view', '门店账单视图'],
      ['supplier-total-view', '供应商总单视图'],
      ['supplier-store-view', '供应商分店账单视图'],
      ['direct-view', '直营账单视图'],
      ['shared-pending-reservation', '共享结算项显示待确认金额'],
      ['shared-payment-visible', '共享付款记录可见'],
    ],
    manualEvidence: ['四类账单视图切换录屏', '共享结算项不可重复付款复核'],
  },
  {
    id: 'DEV-406',
    title: '调整与差额处置',
    state: 'Partial',
    autoEvidence: [
      ['adjustment-list', 'W10 调整列表'],
      ['adjustment-detail', 'W10 调整详情'],
      ['offset-target', '正调整可作为抵扣目标'],
      ['offset-created', '抵扣处置已创建'],
      ['receiver-confirmed', '收款方确认通过'],
      ['disposed-state', '处置状态已确认'],
    ],
    manualEvidence: ['W10 列表/详情截图', '离线返还、抵扣、收款确认录屏'],
  },
];

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

async function loadResult() {
  $('notice').classList.add('hidden');
  try {
    const [billing, mainFlow] = await Promise.all([
      fetchJson('/billing-acceptance-run.json'),
      fetchJson('/main-flow-run.json'),
    ]);
    render(billing, mainFlow);
  } catch (error) {
    $('status-label').textContent = '未生成';
    $('generated').textContent = '运行 acceptance:m4-browserless 后查看';
    $('summary').innerHTML = metric('运行命令', 'acceptance:m4-browserless', '会生成 M4 和主流程结果', true);
    renderGates();
    renderAccounts();
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
  renderGates(billingSteps);
  renderAccounts();
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
  $('gates').innerHTML = gateDefinitions.map((gate) => {
    const passed = evidenceByGate.get(gate.id) || new Set();
    const count = gate.autoEvidence.filter(([id]) => passed.has(id)).length;
    const evidence = count ? `自动证据 ${count}/${gate.autoEvidence.length}` : '等待自动证据';
    return `<article class="gate-card"><div class="gate-top"><span class="gate-id">${esc(gate.id)}</span><span class="gate-state">${esc(gate.state)}</span></div><h3>${esc(gate.title)}</h3><div class="gate-evidence">${esc(evidence)}</div><ul>${gate.autoEvidence.map(([id, label]) => `<li class="${passed.has(id) ? 'passed' : ''}">${esc(label)}</li>`).join('')}</ul><div class="manual-title">最终关闭还需要</div><ol>${gate.manualEvidence.map((item) => `<li>${esc(item)}</li>`).join('')}</ol></article>`;
  }).join('');
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

$('refresh').addEventListener('click', loadResult);
loadResult();
