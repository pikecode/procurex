const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const moneyKeys = new Set(['salesGoodsAmount', 'supplyGoodsAmount', 'goodsAmount', 'payableAmount', 'totalPayableAmount', 'freight']);
const idKeys = new Set(['requestId', 'supplierOrderId', 'shipmentId', 'receiptId', 'statementId']);

function metric(label, value, foot, emphasis = false) {
  return `<div class="metric ${emphasis ? 'emphasis' : ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></div>`;
}

function splitData(data) {
  const state = [];
  const amounts = [];
  const ids = [];
  for (const [key, value] of Object.entries(data || {})) {
    if (idKeys.has(key) || key.endsWith('Id')) ids.push(`${key}: ${value}`);
    else if (moneyKeys.has(key) || key.includes('Amount') || key === 'quantity') amounts.push(`${key}: ${value}`);
    else state.push(`${key}: ${value}`);
  }
  return { state, amounts, ids };
}

async function loadResult() {
  $('notice').classList.add('hidden');
  try {
    const response = await fetch(`/main-flow-run.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error('还没有主流程验收结果');
    const result = await response.json();
    render(result);
  } catch (error) {
    $('status-label').textContent = '未生成';
    $('generated').textContent = '运行 acceptance:main-flow 后查看';
    $('summary').innerHTML = metric('运行命令', 'acceptance:main-flow', '先执行 npm run build', true);
    $('steps').innerHTML = '';
    $('empty').classList.remove('hidden');
    $('notice').textContent = error.message;
    $('notice').classList.remove('hidden');
  }
}

function render(result) {
  const steps = result.steps || [];
  $('status-label').textContent = result.status || 'UNKNOWN';
  $('generated').textContent = new Date(result.generatedAt).toLocaleString('zh-CN');
  $('summary').innerHTML =
    metric('验收状态', result.status || 'UNKNOWN', result.summary || '主流程') +
    metric('步骤数', steps.length, '真实 API 步骤') +
    metric('最终付款预览', findValue(steps, 'totalPayableAmount') || '—', '供应商应付') +
    metric('订单完成状态', findValue(steps, 'fulfillmentStatus') || '—', '收货后状态', true);
  $('empty').classList.toggle('hidden', steps.length > 0);
  $('steps').innerHTML = steps.map((step) => {
    const parts = splitData(step.data);
    return `<tr><td><strong>${esc(step.title)}</strong></td><td>${parts.state.map(esc).join('<br>') || '—'}</td><td class="money">${parts.amounts.map(esc).join('<br>') || '—'}</td><td>${parts.ids.map(esc).join('<br>') || '—'}</td></tr>`;
  }).join('');
}

function findValue(steps, key) {
  for (const step of [...steps].reverse()) {
    if (step.data && step.data[key] !== undefined) return String(step.data[key]);
  }
  return null;
}

$('refresh').addEventListener('click', loadResult);
loadResult();
