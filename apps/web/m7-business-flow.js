const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = (value) => Number.isFinite(Number(value)) ? `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

const stages = [
  { key: 'store', title: '门店下单', role: '门店', owner: 'Store', href: '/role-workbenches.html', action: '去门店工作台', description: '按订货模板选择商品，提交采购需求，余额不足时保留需求但不直接推单。' },
  { key: 'purchase', title: '采购确认', role: '采购', owner: 'Purchaser', href: '/role-workbenches.html', action: '去采购工作台', description: '复核门店需求，确认商品、供应商和资金状态，处理拒单后的改派。' },
  { key: 'supplier', title: '供应商履约', role: '供应商', owner: 'Supplier', href: '/role-workbenches.html', action: '去供应商工作台', description: '查看供应商执行单，完成发货、拒单、差异处理、补发或退回。' },
  { key: 'receipt', title: '门店收货', role: '门店', owner: 'Store', href: '/role-workbenches.html', action: '处理收货', description: '确认实收数量，少收时生成差异，供应商处理后门店继续跟踪结果。' },
  { key: 'finance', title: '财务结算', role: '财务', owner: 'Operator', href: '/billing.html', action: '去财务结算', description: '按门店应收、供应商应付、直营账期和付款凭证完成结算闭环。' },
];

async function loadJson(path) {
  const response = await fetch(`${path}?ts=${Date.now()}`);
  if (!response.ok) throw new Error(`${path} 未生成`);
  return response.json();
}

function metric(label, value, foot, emphasis = false) {
  return `<div class="metric ${emphasis ? 'emphasis' : ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></div>`;
}

function evidenceFor(run, role) {
  return (run?.roleEvidence || []).find((item) => item.role === role);
}

function stepData(run, title) {
  return (run?.steps || []).find((step) => step.title === title)?.data || {};
}

function stageStatus(run, stage) {
  if (!run) return '等待证据';
  if (stage.key === 'finance') return stepData(run, '6. Main flow still reaches supplier payment preview').direction ? '可结算' : '待结算';
  if (stage.key === 'receipt') return evidenceFor(run, 'Store')?.status === 'PASSED' ? '收货证据可见' : '待收货';
  const evidence = evidenceFor(run, stage.owner);
  return evidence?.status === 'PASSED' ? '待办可用' : '待生成';
}

function currentFocus(run) {
  if (!run) return '生成种子';
  if (run.status !== 'PASSED') return '补齐主流程证据';
  return '进入角色处理';
}

function renderSummary(seed, run) {
  $('summary').innerHTML = [
    metric('业务状态', run?.status || '未生成', currentFocus(run), run?.status === 'PASSED'),
    metric('门店订单额', money(seed?.expectedSalesAmount), seed?.storeUsername || '等待种子'),
    metric('供应商应付', money(seed?.expectedSupplyAmount), seed?.supplierUsername || '等待种子', true),
    metric('角色证据', `${run?.roleEvidence?.length || 0}/4`, '门店 / 采购 / 供应商 / 运营'),
  ].join('');
}

function renderBoard(seed, run) {
  $('business-board').innerHTML = stages.map((stage) => {
    const status = stageStatus(run, stage);
    const account = evidenceFor(run, stage.owner)?.account || (stage.owner === 'Store' ? seed?.storeUsername : stage.owner === 'Supplier' ? seed?.supplierUsername : seed?.username) || '待生成';
    return `<article class="business-stage"><div class="stage-head"><span>${esc(stage.role)}</span><strong>${esc(stage.title)}</strong></div><p>${esc(stage.description)}</p><small>${esc(account)} · ${esc(status)}</small><a class="secondary" href="${esc(stage.href)}">${esc(stage.action)}</a></article>`;
  }).join('');
}

function renderTodos(seed, run) {
  const todos = [
    { title: '门店补充或复核订货', detail: `${seed?.storeUsername || '门店账号'} 查看订单状态、收货和差异结果。`, href: '/role-workbenches.html' },
    { title: '采购处理确认与改派', detail: `${seed?.username || '采购账号'} 处理确认、供应商拒单和审计追踪。`, href: '/role-workbenches.html' },
    { title: '供应商处理发货与差异', detail: `${seed?.supplierUsername || '供应商账号'} 完成发货、少收处理、补发和退回。`, href: '/role-workbenches.html' },
    { title: '财务查看账单和付款', detail: '进入财务结算页查看门店账单、供应商账单、付款记录和凭证。', href: '/billing.html' },
  ];
  $('todo-label').textContent = run?.status === 'PASSED' ? '可处理' : '待生成';
  $('todo-label').classList.toggle('tag-ok', run?.status === 'PASSED');
  $('todo-list').innerHTML = todos.map((todo) => `<article><div><strong>${esc(todo.title)}</strong><small>${esc(todo.detail)}</small></div><a class="secondary" href="${esc(todo.href)}">打开</a></article>`).join('');
}

function renderTimeline(run) {
  const timeline = [
    ['门店提交订单', evidenceFor(run, 'Operator')?.evidence || '等待证据'],
    ['采购确认拆单', evidenceFor(run, 'Purchaser')?.evidence || '等待证据'],
    ['供应商发货', stepData(run, '1. Store shipment notification is created').title || '等待证据'],
    ['门店收货', stepData(run, '3. Store discrepancy-resolution notification is created').title || '等待证据'],
    ['账单付款预览', stepData(run, '6. Main flow still reaches supplier payment preview').direction || '等待证据'],
  ];
  $('timeline-label').textContent = run?.status || '未生成';
  $('timeline-label').classList.toggle('tag-ok', run?.status === 'PASSED');
  $('timeline').innerHTML = timeline.map(([title, status], index) => `<article><span>${index + 1}</span><div><strong>${esc(title)}</strong><small>${esc(status)}</small></div></article>`).join('');
}

function renderFinance(seed, run) {
  const payment = stepData(run, '6. Main flow still reaches supplier payment preview');
  const receipt = stepData(run, '3. Store discrepancy-resolution notification is created');
  $('finance-panel').innerHTML = [
    `<article><strong>门店销售额</strong><span>${money(seed?.expectedSalesAmount)}</span><small>按门店销售价口径</small></article>`,
    `<article><strong>供应商供货额</strong><span>${money(seed?.expectedSupplyAmount)}</span><small>按供应商供货价口径</small></article>`,
    `<article><strong>付款预览</strong><span>${money(payment.totalPayableAmount)}</span><small>${esc(payment.direction || '等待付款预览')}</small></article>`,
    `<article><strong>履约状态</strong><span>${esc(receipt.title || '等待收货')}</span><small>${esc(receipt.discrepancyId || '未生成差异证据')}</small></article>`,
  ].join('');
}

async function init() {
  try {
    const [seed, run] = await Promise.all([
      loadJson('/main-flow-demo-seed.json'),
      loadJson('/main-flow-demo-run.json'),
    ]);
    $('flow-status').textContent = run.status || 'UNKNOWN';
    $('flow-status').classList.toggle('tag-ok', run.status === 'PASSED');
    $('flow-updated').textContent = run.generatedAt ? new Date(run.generatedAt).toLocaleString('zh-CN') : '本地证据';
    renderSummary(seed, run);
    renderBoard(seed, run);
    renderTodos(seed, run);
    renderTimeline(run);
    renderFinance(seed, run);
  } catch (error) {
    $('notice').textContent = `${error.message}。先运行 npm run build && npm run main-flow:seed-demo && npm run main-flow:check-demo。`;
    $('notice').classList.remove('hidden');
    $('flow-status').textContent = '未生成';
    $('summary').innerHTML = metric('运行命令', 'main-flow:seed-demo', '生成业务种子') + metric('运行命令', 'main-flow:check-demo', '生成主流程证据', true);
    renderBoard(null, null);
    renderTodos(null, null);
    renderTimeline(null);
    renderFinance(null, null);
  }
}

init();
