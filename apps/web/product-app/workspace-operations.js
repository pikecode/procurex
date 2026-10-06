import { esc } from './ui.js';
import { renderTable, field } from './workspace-management.js';
import { icons, openEditor, iconButton } from './workspace.js';
import { openPurchaseDraft, openBatchAssignment } from './workspace-purchasing.js';
import { renderSupplier } from './workspace-supplier.js';
import { renderStore } from './workspace-store.js';
import { mountFinanceAccounts } from './workspace-finance.js';
import { mountPaymentRecords, openPaymentRegistration } from './workspace-payments.js';
import { mountDifferences } from './workspace-differences.js';

const statuses = { PENDING_FUNDS: '待补足资金', PENDING_PROCUREMENT: '待采购确认', CONFIRMED: '已确认', COMPLETED: '已完成',
  CANCELED: '已取消', REJECTED: '已拒绝', PENDING: '待处理', PARTIAL_SHIPPED: '部分发货', SHIPPED: '已发货',
  PARTIAL_RECEIVED: '部分收货', RECEIVED: '已收货', OPEN: '未结清', SETTLED: '已结清', PAID: '已付款', UNPAID: '未付款' };
const status = value => esc(statuses[value] || value || '-');
const text = value => esc(value ?? '-');
const named = (items, id) => items.find(item => item.id === id)?.name || '未找到';
const quantityText = item => `${text(item.quantity)} ${text(item.unitName || '历史单位未记录')}`
  + (item.unitSnapshot?.inputUnitId === item.unitSnapshot?.purchaseUnitId && item.unitSnapshot?.purchaseUnitId ? `<small>${text(item.unitSnapshot.inputQuantity)} ${text(item.unitSnapshot.purchaseUnitName)}</small>` : '');

async function purchaser(context) {
  const [rows, stores, suppliers, products, todos, categories] = await Promise.all([context.get('/purchase-requests'), context.get('/stores'), context.get('/suppliers'), context.get('/products'), context.get('/purchase-requests/rejection-todos'), context.get('/categories')]);
  const productRows = products.map(product => ({ ...product, categoryName: categories.find(category => category.id === product.categoryId)?.name }));
  renderTable(context, { title: '采购处理', rows: rows.map(item => ({ ...item, searchText: named(stores, item.storeId) })), columns: ['申请单号', '门店', '状态', '销售货款', '待补金额'],
    cells: item => [text(item.requestNo), text(named(stores, item.storeId)), status(item.status), text(item.salesGoodsAmount), text(item.shortfallAmount)],
    actions: item => iconButton('arrow-up-right', '打开申请', `data-request="${esc(item.id)}"`),
    create: context.client.pendingCommand ? null : () => openPurchaseDraft(context, stores).catch(error => context.notice(error.message, true)) });
  const create = document.getElementById('ws-create');
  if (create) create.innerHTML = '<i data-lucide="plus"></i>代门店下单';
  if (!context.active()) return;
  const pending = context.client.pendingCommand;
  if (pending) {
    context.view.querySelector('.ws-heading').insertAdjacentHTML('afterend', '<div class="ws-command"><span>有一笔提交尚未确认</span><button id="ws-recover" class="ws-secondary">查询提交结果</button></div>');
    document.getElementById('ws-recover').onclick = async event => {
      event.currentTarget.disabled = true;
      try { await context.command(null, null, true); await context.refresh(); }
      catch (error) { context.notice(error.message, true); if (context.active()) event.target.disabled = false; }
    };
  }
  if (todos.length) context.view.querySelector('.ws-toolbar').insertAdjacentHTML('beforebegin', '<div class="ws-todos">'
    + todos.map(todo => `<article class="ws-todo"><div><strong>${text(todo.storeName)} · ${text(todo.supplierName)}</strong><small>${text(todo.supplierOrderNo)} · ${text(todo.reason)}</small></div><button class="ws-secondary" data-reallocate="${esc(todo.purchaseRequestId)}" data-rejected="${esc(todo.supplierOrderId)}" ${pending ? 'disabled' : ''}>处理拒单</button></article>`).join('') + '</div>');
  context.view.insertAdjacentHTML('beforeend', '<section id="ws-request-detail" class="ws-detail"></section>');
  let detailSequence = 0;
  context.view.addEventListener('click', async event => {
    const openButton = event.target.closest('[data-request]');
    const reallocateButton = event.target.closest('[data-reallocate]');
    if (!openButton && !reallocateButton) return;
    const button = openButton || reallocateButton;
    const sequence = ++detailSequence;
    button.disabled = true;
    try {
      const detail = await context.get(`/purchase-requests/${button.dataset.request || button.dataset.reallocate}`);
      if (!context.active() || sequence !== detailSequence) return;
      if (reallocateButton) await reallocate(detail, button.dataset.rejected);
      else showRequest(detail);
    } catch (error) { context.notice(error.message, true); } finally { button.disabled = false; }
  });

  function showRequest(detail) {
    const editable = ['PENDING_PROCUREMENT', 'PENDING_FUNDS'].includes(detail.status) && !detail.supplierOrders.length && !context.client.pendingCommand;
    document.getElementById('ws-request-detail').innerHTML = `<div class="ws-detail-top"><h2>${text(detail.requestNo)}</h2>${editable ? '<div class="ws-actions"><button id="ws-edit-request" class="ws-secondary"><i data-lucide="pencil"></i>编辑商品</button><button id="ws-assign-request" class="ws-secondary"><i data-lucide="git-branch"></i>分配供应商</button><button id="ws-reject-request" class="ws-secondary"><i data-lucide="x-circle"></i>采购拒单</button><button id="ws-confirm" class="ws-primary">确认采购</button></div>' : ''}</div>
      <dl><dt>门店</dt><dd>${text(named(stores, detail.storeId))}</dd><dt>状态</dt><dd>${status(detail.status)}</dd><dt>销售货款</dt><dd>${text(detail.salesGoodsAmount)}</dd><dt>待补金额</dt><dd>${text(detail.shortfallAmount)}</dd></dl>
      <div class="ws-table-wrap"><table><thead><tr><th>商品</th><th>供应商</th><th>数量</th><th>销售单价</th><th>销售额</th></tr></thead><tbody>${detail.items.map(item => `<tr><td>${text(item.productName || named(products, item.productId))}</td><td>${text(named(suppliers, item.supplierId))}</td><td>${quantityText(item)}</td><td>${text(item.salesUnitPrice)}</td><td>${text(item.salesLineAmount)}</td></tr>`).join('')}</tbody></table></div>`;
    icons();
    document.getElementById('ws-edit-request')?.addEventListener('click', () => openPurchaseDraft(context, stores, detail).catch(error => context.notice(error.message, true)));
    document.getElementById('ws-assign-request')?.addEventListener('click', () => openBatchAssignment(context, detail, suppliers, productRows));
    document.getElementById('ws-reject-request')?.addEventListener('click', () => {
      const editor = openEditor(context, `${detail.requestNo} · 采购拒单`, field('reason', '拒单原因', '', { required: true, max: 500 }), async (data, form) => {
        form.querySelector('fieldset').disabled = true;
        try { await context.command(`/purchase-requests/${detail.id}/reject`, { expectedVersion: detail.version, reason: String(data.get('reason')).trim() }); await context.refresh(); }
        finally { form.querySelector('fieldset').disabled = false; if (context.client.pendingCommand) form.querySelector('[type="submit"]').disabled = true; }
      });
      editor.form.querySelector('[type="submit"]').textContent = '确认拒单';
    });
    document.getElementById('ws-confirm')?.addEventListener('click', () => {
      const editor = openEditor(context, '确认采购', `<div class="ws-wide ws-existing">${text(detail.requestNo)} · ${text(named(stores, detail.storeId))}<br>销售货款 ${text(detail.salesGoodsAmount)}</div>`, async (_, form) => {
        form.querySelector('fieldset').disabled = true;
        try { await context.command(`/purchase-requests/${detail.id}/confirm`, { expectedVersion: detail.version }); await context.refresh(); }
        catch (error) {
          form.querySelector('fieldset').disabled = false;
          if (context.client.pendingCommand) form.querySelector('[type="submit"]').disabled = true;
          throw error;
        }
      });
      editor.form.querySelector('[type="submit"]').textContent = '确认采购';
    });
  }

  async function reallocate(detail, rejectedId) {
    const rejected = await context.get(`/supplier-orders/${rejectedId}`);
    const productIds = new Set(rejected.items.map(item => item.productId));
    const requestItems = detail.items.filter(item => productIds.has(item.productId));
    const candidates = suppliers.filter(item => item.status === 'ACTIVE' && !item.isArchived && item.id !== rejected.supplierId
      && !detail.supplierOrders.some(order => order.supplierId === item.id && order.status !== 'REJECTED' && order.shipments?.length));
    const relations = await Promise.all(candidates.map(item => context.get(`/suppliers/${item.id}/products`)));
    const template = await context.get(`/templates/${detail.templateId}`);
    if (!context.active()) return;
    const content = requestItems.map(item => {
      const configuration = template.items.find(row => row.productId === item.productId && row.isEnabled);
      const choices = candidates.filter(supplier => configuration?.suppliers.some(row => row.supplierId === supplier.id)
        && products.find(product => product.id === item.productId)?.isActive
        && relations.find(row => row.supplierId === supplier.id)?.productIds.includes(item.productId));
      return `<div class="ws-wide"><strong>${text(item.productName || named(products, item.productId))} · ${text(item.quantity)}</strong>`
        + field(`supplier:${item.id}`, '目标供应商', '', { required: true, choices: [['', choices.length ? '请选择' : '暂无可供货的备用供应商'], ...choices.map(supplier => [supplier.id, supplier.name])] })
        + `<label><input type="checkbox" name="cancel:${esc(item.id)}">取消该商品</label></div>`;
    }).join('')
      + field('reason', '改派原因', '', { required: true, max: 500 });
    const editor = openEditor(context, `${detail.requestNo} · 拒单改派`, content, async (data, form) => {
      const body = { expectedVersion: detail.version, rejectedOrderId: rejected.id, reason: String(data.get('reason')).trim(), assignments: requestItems.map(item => data.has(`cancel:${item.id}`)
        ? { requestItemId: item.id, cancel: true } : { requestItemId: item.id, supplierId: data.get(`supplier:${item.id}`) }) };
      form.querySelector('fieldset').disabled = true;
      try { await context.command(`/purchase-requests/${detail.id}/reallocate`, body); await context.refresh(); }
      catch (error) { form.querySelector('fieldset').disabled = false; if (context.client.pendingCommand) form.querySelector('[type="submit"]').disabled = true; throw error; }
    });
    editor.form.querySelector('[type="submit"]').textContent = '确认改派';
    for (const item of requestItems) editor.form.elements[`cancel:${item.id}`].onchange = event => {
      const select = editor.form.elements[`supplier:${item.id}`]; select.disabled = event.target.checked; select.required = !event.target.checked;
    };
  }
}

async function orders(context) {
  const isStore = context.route === 'store';
  const endpoint = isStore ? '/purchase-requests' : '/supplier-orders';
  const rows = await context.get(endpoint);
  renderTable(context, { title: isStore ? '门店订单' : '供应商订单', rows, columns: ['单号', '状态', isStore ? '销售货款' : '供货货款', '日期'],
    cells: item => [text(item.requestNo || item.supplierOrderNo), status(item.status), text(isStore ? item.salesGoodsAmount : item.supplyGoodsAmount), text(new Date(item.submittedAt || item.createdAt).toLocaleDateString('zh-CN'))],
    actions: item => iconButton('arrow-up-right', '打开订单', `data-order="${esc(item.id)}"`) });
  if (!context.active()) return;
  context.view.insertAdjacentHTML('beforeend', '<section id="ws-order-detail" class="ws-detail"></section>');
  let sequence = 0;
  context.view.addEventListener('click', async event => {
    const button = event.target.closest('[data-order]'); if (!button) return;
    const current = ++sequence;
    try {
      const detail = await context.get(`${endpoint}/${button.dataset.order}`);
      if (!context.active() || current !== sequence) return;
      document.getElementById('ws-order-detail').innerHTML = `<h2>${text(detail.requestNo || detail.supplierOrderNo)}</h2>${detail.destination ? `<p>${text(detail.destination.name)} · ${text(detail.destination.address)} · ${text(detail.destination.contactName)} / ${text(detail.destination.contactPhone)}</p>` : ''}
        <div class="ws-table-wrap"><table><thead><tr><th>商品</th><th>数量</th><th>单价</th><th>金额</th></tr></thead><tbody>${detail.items.map(item => `<tr><td>${text(item.productName)}</td><td>${quantityText(item)}</td><td>${text(isStore ? item.salesUnitPrice : item.supplyUnitPrice)}</td><td>${text(isStore ? item.salesLineAmount : item.supplyLineAmount)}</td></tr>`).join('')}</tbody></table></div>`;
    } catch (error) { context.notice(error.message, true); }
  });
}

const financeModes = new Map();
async function finance(context) {
  const supplier = context.user.roles.includes('SUPPLIER');
  const headquarters = context.user.roles.some(role => ['ADMIN', 'HQ_FINANCE'].includes(role));
  const modes = headquarters ? [['store', '门店账单'], ['supplier', '供应商账单'], ['direct', '直结账单']] : supplier ? [['supplier', '供应商账单'], ['direct', '直结账单']] : [['store', '门店账单'], ['direct', '直结账单']];
  const mode = financeModes.get(context.user.id) || modes[0][0];
  const endpoint = { store: '/store-statements', supplier: '/supplier-statements', direct: '/direct-statements' }[mode];
  const [rows, stores, suppliers] = await Promise.all([context.get(endpoint), headquarters ? context.get('/stores') : [], headquarters ? context.get('/suppliers') : []]);
  const billName = item => headquarters ? [item.storeId ? named(stores, item.storeId) : '', item.supplierId ? named(suppliers, item.supplierId) : ''].filter(Boolean).join(' / ') || '-' : supplier ? '供应商结算账单' : '门店结算账单';
  let ready = false;
  renderTable(context, { title: '账单查询', rows: rows.map(item => ({ ...item, searchText: `${billName(item)} ${item.periodStart}` })), columns: ['结算对象', '周期', '货款', '运费', '调整', '已付', '待付'],
    cells: item => [text(billName(item)), `${text(item.periodStart)} / ${text(item.periodEndExclusive)}`, text(item.goodsAmount), text(item.freightAmount), text(item.adjustmentAmount), text(item.confirmedPaidAmount), text(item.payableAmount)],
    actions: item => iconButton('arrow-up-right', '打开账单', `data-bill="${esc(item.id)}"`),
    afterDraw: () => context.view.querySelectorAll('[data-bill]').forEach(button => { button.disabled = !ready; }) });
  if (!context.active()) return;
  context.view.querySelector('.ws-toolbar').insertAdjacentHTML('beforeend', field('billMode', '账单类型', mode, { choices: modes }));
  context.view.querySelector('[name="billMode"]').onchange = async event => { financeModes.set(context.user.id, event.target.value); await context.refresh(); };
  await mountFinanceAccounts(context, stores);
  if (!context.active()) return;
  context.view.insertAdjacentHTML('beforeend', '<section id="ws-bill-detail" class="ws-detail" hidden></section>');
  try { await mountPaymentRecords(context); } catch (error) { context.notice(error.message, true); }
  try { await mountDifferences(context); } catch (error) { context.notice(error.message, true); }
  if (!context.active()) return;
  context.view.querySelectorAll(':scope > section.ws-detail:not(#ws-bill-detail)').forEach(section => {
    const heading = section.querySelector('h2');
    const disclosure = document.createElement('details'); disclosure.className = 'ws-finance-disclosure';
    const summary = document.createElement('summary'); summary.textContent = heading?.textContent || '账户';
    disclosure.append(summary); section.before(disclosure); disclosure.append(section); heading?.remove();
    context.view.append(disclosure);
    if (section.querySelector('.ws-command')) disclosure.open = true;
  });
  let sequence = 0;
  context.view.addEventListener('click', async event => {
    const button = event.target.closest('[data-bill]'); if (!button) return;
    const current = ++sequence;
    try {
      const detail = await context.get(`${endpoint}/${button.dataset.bill}`);
      if (!context.active() || current !== sequence) return;
      document.getElementById('ws-bill-detail').innerHTML = `<h2>${text(billName(detail))} · ${text(detail.periodStart)}</h2><p>货款 ${text(detail.goodsAmount)} · 运费 ${text(detail.freightAmount)} · 调整 ${text(detail.adjustmentAmount)} · 已付 ${text(detail.confirmedPaidAmount)} · 待付 ${text(detail.payableAmount)}</p>
        <div class="ws-table-wrap"><table><thead><tr><th>来源订单</th><th>货款</th><th>运费</th><th>合计</th></tr></thead><tbody>${(detail.lines || []).map(line => `<tr><td>${text(line.supplierOrderNo)}</td><td>${text(line.goodsAmount)}</td><td>${text(line.freightAmount)}</td><td>${text(line.totalAmount)}</td></tr>`).join('')}</tbody></table></div>`;
      const container = document.getElementById('ws-bill-detail');
      container.hidden = false;
      const close = document.createElement('button'); close.type = 'button'; close.className = 'ws-icon-button';
      close.title = '收起账单详情'; close.setAttribute('aria-label', '收起账单详情'); close.innerHTML = '<i data-lucide="x"></i>';
      close.onclick = () => { container.hidden = true; button.focus(); };
      container.querySelector('h2').append(close);
      const writable = (headquarters || !supplier) && !context.client.pendingCommand;
      if (writable) {
        const items = [...(detail.lines || []).map(line => ({ id: line.settlementItemId, label: line.supplierOrderNo })), ...(detail.adjustmentItems || []).filter(item => !String(item.amount).startsWith('-')).map(item => ({ id: item.settlementItemId, label: `调整 ${item.amount}` }))].filter(item => item.id);
        container.insertAdjacentHTML('beforeend', '<div class="ws-check-list">' + items.map(item => `<label><input type="checkbox" data-settlement="${esc(item.id)}">${text(item.label)}</label>`).join('') + '</div><button type="button" class="ws-primary" data-register-payment disabled><i data-lucide="wallet"></i>付款预览</button>');
        const register = container.querySelector('[data-register-payment]');
        container.onchange = () => { register.disabled = !container.querySelector('[data-settlement]:checked'); };
        register.onclick = async () => {
          register.disabled = true;
          try { await openPaymentRegistration(context, [...container.querySelectorAll('[data-settlement]:checked')].map(input => input.dataset.settlement), () => current === sequence); }
          catch (error) { if (context.active() && current === sequence) context.notice(error.message, true); }
          finally { if (context.active() && current === sequence) register.disabled = !container.querySelector('[data-settlement]:checked'); }
        };
      } icons(); container.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (error) { context.notice(error.message, true); }
  });
  ready = true;
  context.view.querySelectorAll('[data-bill]').forEach(button => { button.disabled = false; });
}

export async function renderOperations(context) {
  context.view.classList.toggle('ws-finance-query', context.route === 'finance');
  const result = await (context.route === 'purchaser' ? purchaser(context) : context.route === 'supplier' ? renderSupplier(context) : context.route === 'store' ? renderStore(context) : context.route === 'finance' ? finance(context) : orders(context));
  if (context.active()) icons();
  return result;
}
