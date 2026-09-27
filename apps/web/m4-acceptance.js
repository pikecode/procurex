const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const amountKey = (key) => key.includes('Amount') || key === 'amount' || key === 'totalPayableAmount' || key === 'payableAmount';
const statusKey = (key) => key.includes('status') || key.includes('Status') || key === 'direction' || key === 'channel' || key === 'cycle' || key === 'method';

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

$('refresh').addEventListener('click', loadResult);
loadResult();
