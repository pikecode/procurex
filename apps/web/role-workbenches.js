const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

let seed = null;
let run = null;
let activeRole = 'Store';

const roleDefinitions = {
  Store: {
    title: '门店工作台',
    entry: 'S01/S04',
    scope: '门店账号只看本门店订单、收货和通知',
    todos: ['创建或复核门店订货', '处理待收货提醒', '查看差异处理结果'],
    actions: ['下单入口', '收货确认', '差异结果通知'],
    next: '把主流程里的门店下单和收货动作拆成独立页面，并保留移动端窄屏证据。',
  },
  Purchaser: {
    title: '采购工作台',
    entry: 'W01/W02',
    scope: '采购账号处理确认、分派、拒单和异常队列',
    todos: ['确认采购申请', '查看供应商拒单通知', '追踪订单审计动作'],
    actions: ['采购确认', '供应商改派', '异常队列'],
    next: '把采购确认、拒单处理和审计追踪从演示账号拆到采购角色页面。',
  },
  Supplier: {
    title: '供应商工作台',
    entry: 'S06/S07',
    scope: '供应商账号只看本供应商订单、发货和差异',
    todos: ['查看待发货订单', '创建发货记录', '处理收货差异'],
    actions: ['发货', '差异处理', '拒单'],
    next: '把供应商发货、差异处理和拒单动作拆成供应商端工作台。',
  },
  Operator: {
    title: '运营联调台',
    entry: 'M5/MainFlow',
    scope: '联调账号继续覆盖完整链路冒烟',
    todos: ['一键执行订单到付款预览', '复核通知和审计证据', '守住 M5 close gate'],
    actions: ['主流程冒烟', '证据复核', '门禁回归'],
    next: '继续作为端到端回归入口，避免角色拆分后主链路断裂。',
  },
};

function roleOrder() {
  return ['Store', 'Purchaser', 'Supplier', 'Operator'];
}

function evidenceFor(role) {
  return (run?.roleEvidence || []).find((item) => item.role === role);
}

function seedFor(role) {
  return (seed?.roleAccounts || []).find((item) => item.role === role);
}

function statusFor(role) {
  return evidenceFor(role)?.status || (seedFor(role) ? 'PENDING' : 'MISSING');
}

async function loadJson(path) {
  const response = await fetch(`${path}?ts=${Date.now()}`);
  if (!response.ok) throw new Error(`${path} 未生成`);
  return response.json();
}

async function init() {
  try {
    [seed, run] = await Promise.all([
      loadJson('/main-flow-demo-seed.json'),
      loadJson('/main-flow-demo-run.json'),
    ]);
    $('identity').textContent = `${seed.username} · ${run.status}`;
    $('role-workbench-status').textContent = run.status || 'UNKNOWN';
    $('role-workbench-status').classList.toggle('tag-ok', run.status === 'PASSED');
    render();
  } catch (error) {
    $('notice').textContent = error.message;
    $('notice').classList.remove('hidden');
    $('summary').innerHTML = metric('运行命令', 'main-flow:seed-demo', '生成角色账号') + metric('运行命令', 'main-flow:check-demo', '生成角色证据');
    $('role-lanes-label').textContent = '未生成';
    $('role-detail-label').textContent = '未生成';
    $('evidence-label').textContent = '未生成';
  }
}

function render() {
  const roles = roleOrder();
  if (!roles.includes(activeRole)) activeRole = roles[0];
  $('summary').innerHTML = [
    metric('角色入口', roles.length, '门店 / 采购 / 供应商 / 运营', true),
    metric('主流程状态', run?.status || 'UNKNOWN', run?.generatedAt || ''),
    metric('角色证据', `${run?.roleEvidence?.length || 0}/4`, '来自 main-flow-demo-run.json'),
    metric('下一步', '真实页面拆分', '先页面骨架，后接操作 API'),
  ].join('');
  $('role-lanes-label').textContent = run?.status || 'UNKNOWN';
  $('role-lanes-label').classList.toggle('tag-ok', run?.status === 'PASSED');
  $('role-lanes').innerHTML = roles.map((role) => laneCard(role)).join('');
  $('role-tabs').innerHTML = roles.map((role) => `<button class="tab ${role === activeRole ? 'active' : ''}" data-role="${esc(role)}">${esc(roleDefinitions[role].title)}<span>${esc(statusFor(role))}</span></button>`).join('');
  $('role-tabs').querySelectorAll('[data-role]').forEach((button) => button.addEventListener('click', () => {
    activeRole = button.dataset.role;
    render();
  }));
  renderDetail();
  renderEvidenceMap();
}

function laneCard(role) {
  const definition = roleDefinitions[role];
  const evidence = evidenceFor(role);
  const account = evidence?.account || seedFor(role)?.username || '未生成';
  return `<article class="role-lane ${role === activeRole ? 'active' : ''}" data-role="${esc(role)}"><button data-lane="${esc(role)}"><strong>${esc(definition.title)}</strong><span>${esc(statusFor(role))}</span></button><small>${esc(account)} · ${esc(definition.entry)}</small><p>${esc(evidence?.surface || definition.scope)}</p></article>`;
}

function renderDetail() {
  const definition = roleDefinitions[activeRole];
  const evidence = evidenceFor(activeRole);
  const account = evidence?.account || seedFor(activeRole)?.username || '未生成';
  $('role-detail-label').textContent = statusFor(activeRole);
  $('role-detail-label').classList.toggle('tag-ok', statusFor(activeRole) === 'PASSED');
  $('role-detail').innerHTML = [
    panel('角色账号', account, definition.scope),
    panel('当前待办', definition.todos.join(' · '), evidence?.surface || '等待角色证据'),
    panel('可执行动作', definition.actions.join(' · '), '后续将接入真实 API 按钮'),
    panel('下一步页面边界', definition.next, evidence?.evidence || '等待 main-flow:check-demo'),
  ].join('');
  $('role-lanes').querySelectorAll('[data-lane]').forEach((button) => button.addEventListener('click', () => {
    activeRole = button.dataset.lane;
    render();
  }));
}

function renderEvidenceMap() {
  const steps = run?.steps || [];
  $('evidence-label').textContent = run?.status || 'UNKNOWN';
  $('evidence-label').classList.toggle('tag-ok', run?.status === 'PASSED');
  $('evidence-map').innerHTML = steps.map((step) => `<article><strong>${esc(step.title)}</strong><small>${esc(flatten(step.data))}</small></article>`).join('');
}

function panel(title, body, foot) {
  return `<article><strong>${esc(title)}</strong><p>${esc(body)}</p><small>${esc(foot)}</small></article>`;
}

function metric(label, value, foot, emphasis = false) {
  return `<div class="metric ${emphasis ? 'emphasis' : ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></div>`;
}

function flatten(data) {
  return Object.entries(data || {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' · ');
}

init();
