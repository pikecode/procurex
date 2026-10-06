import { esc } from './ui.js';
import { field, renderTable } from './workspace-management.js';
import { icons, iconButton, openEditor } from './workspace.js';
import { openAccountEvidenceEditor, openAccountDocument } from './workspace-account-evidence.js';

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const selectedStores = new Map();
export function clearingSignature(preview) {
  return JSON.stringify([preview.storeId, preview.totalAmount, preview.items.map(item =>
    [item.fundingAllocationId, item.version, item.clearableAmount]).sort((a, b) => a[0].localeCompare(b[0]))]);
}

export async function renderCollectionAccounts(context) {
  const rows = await context.get('/collection-accounts');
  const edit = item => openEditor(context, item ? '编辑收款账户' : '新增收款账户',
    field('name', '账户名称', item?.name, { required: true, max: 120 })
    + field('bankName', '开户银行', item?.bankName, { required: true, max: 120 })
    + field('accountName', '开户户名', item?.accountName, { required: true, max: 120 })
    + field('accountNo', '账号', item?.accountNo, { required: true, max: 80 })
    + field('status', '状态', item?.status || 'ACTIVE', { choices: [['ACTIVE', '启用'], ['DISABLED', '停用']] }), async (data, form) => {
      await context.save(`/collection-accounts${item ? `/${item.id}` : ''}`, item ? 'PATCH' : 'POST',
        { ...Object.fromEntries(data), ...(item ? { expectedVersion: item.version } : {}) }, form);
      await context.refresh();
    });
  renderTable(context, { title: '收款账户', rows, columns: ['账户名称', '开户银行', '开户户名', '账号', '状态'],
    cells: item => [item.name, item.bankName, item.accountName, item.accountNo, item.status === 'ACTIVE' ? '启用' : '停用'].map(esc),
    edit, create: () => edit(), filters: [{ key: 'status', label: '状态', choices: [['ACTIVE', '启用'], ['DISABLED', '停用']] }] });
}

export async function renderStoreFinance(context) {
  const rows = await context.get('/stores/finance-overview');
  renderTable(context, { title: '门店财务', rows,
    columns: ['门店名称', '分组', '挂账额度', '挂账未清金额', '累计挂账金额', '挂账剩余额度', '储值余额', '冻结金额', '可用储值'],
    cells: item => [item.name, item.groupName || '-', item.account.creditLimit, item.account.creditUsed,
      item.account.creditCumulative ?? '历史未核定', item.account.creditAvailable, item.account.balance, item.account.reservedBalance ?? '0.00', item.account.availableBalance ?? item.account.balance].map(esc),
    filters: [{ key: 'groupName', label: '分组', choices: [...new Set(rows.map(row => row.groupName).filter(Boolean))].map(name => [name, name]) }],
    actions: item => iconButton('wallet', '充值', `data-finance-store="${esc(item.id)}" data-finance-action="recharge"`)
      + iconButton('check', '清账', `data-finance-store="${esc(item.id)}" data-finance-action="clearing"`)
      + iconButton('pencil', '调整挂账额度', `data-finance-store="${esc(item.id)}" data-finance-action="credit"`)
      + iconButton('eye', '查看账户流水', `data-finance-store="${esc(item.id)}" data-finance-action="view"`),
    afterDraw: () => context.view.querySelectorAll('[data-finance-store]').forEach(button => { button.onclick = async () => {
      button.disabled = true;
      try {
        const row = rows.find(item => item.id === button.dataset.financeStore);
        const editor = openEditor(context, `${row.name} · 门店账户`, '<div class="ws-wide" data-store-account></div>');
        editor.dialog.classList.remove('ws-dialog-compact');
        editor.dialog.classList.add('ws-finance-dialog');
        await mountFinanceAccounts(context, [row], editor.form.querySelector('[data-store-account]'), button.dataset.financeAction);
      } catch (error) { context.notice(error.message, true); } finally { button.disabled = false; }
    }; }) });
}

export function filterCreditItems(rows, { from = '', to = '', supplierId = '' } = {}) {
  return rows.filter(row => { const date = new Date(row.occurredAt).toLocaleDateString('sv-SE');
    return (!from || date >= from) && (!to || date <= to) && (!supplierId || (row.supplierId || 'unassigned') === supplierId);
  });
}

export async function mountFinanceAccounts(context, stores, target, initialAction) {
  const central = context.user.roles.some(role => ['ADMIN', 'HQ_FINANCE'].includes(role));
  if (!central && !context.user.roles.some(role => ['STORE', 'STORE_FINANCE'].includes(role))) return;
  if (!central) stores = [await context.get(`/stores/${context.user.scope.storeId}`)];
  if (!context.active()) return;
  const section = document.createElement('section'); section.className = 'ws-detail ws-finance-account';
  section.innerHTML = '<h2>门店账户</h2>' + field('accountStore', '门店', '', { choices: [['', '请选择'], ...stores.map(store => [store.id, store.name])] })
    + '<p data-account-error role="alert" hidden></p><div data-account-content></div>';
  if (target) target.append(section); else context.view.querySelector('.ws-heading').after(section);
  const select = section.querySelector('select'); const content = section.querySelector('[data-account-content]');
  let generation = 0;
  const pending = context.client.pendingCommand;
  if (pending) {
    section.insertAdjacentHTML('beforeend', '<div class="ws-command"><span>有一笔提交尚未确认</span><button type="button" data-finance-recover class="ws-secondary">查询提交结果</button></div>');
    section.querySelector('[data-finance-recover]').onclick = async event => {
      event.currentTarget.disabled = true;
      try { await context.command(null, null, true); await context.refresh(); }
      catch (error) { context.notice(error.message, true); if (context.active()) event.target.disabled = false; }
    };
  }
  async function submit(path, body, form, method = 'POST') {
    form.querySelector('fieldset').disabled = true;
    try { await context.command(path, body, false, method); await context.refresh(); }
    finally { form.querySelector('fieldset').disabled = false; if (context.client.pendingCommand) form.querySelector('[type="submit"]').disabled = true; }
  }
  select.onchange = async () => {
    const current = ++generation; const storeId = select.value; content.innerHTML = '';
    selectedStores.set(context.user.id, storeId);
    if (!storeId) return;
    content.textContent = '加载中...';
    try {
      const [account, ledgers, credit, movements] = await Promise.all([context.get(`/stores/${storeId}/account`), context.get(`/stores/${storeId}/ledgers`), context.get(`/stores/${storeId}/credit-items`), context.get(`/stores/${storeId}/credit-movements`)]);
      if (!context.active() || current !== generation || (target && !target.isConnected)) return;
      const writable = central && !context.client.pendingCommand;
      content.innerHTML = `<dl><dt>储值余额</dt><dd>${esc(account.balance)}</dd><dt>冻结金额</dt><dd>${esc(account.reservedBalance ?? '0.00')}</dd><dt>可用储值</dt><dd>${esc(account.availableBalance ?? account.balance)}</dd><dt>挂账额度</dt><dd>${esc(account.creditLimit)}</dd><dt>累计挂账</dt><dd>${esc(account.creditCumulative ?? '历史未核定')}</dd><dt>未清挂账</dt><dd>${esc(account.creditUsed)}</dd><dt>挂账剩余额度</dt><dd>${esc(account.creditAvailable)}</dd></dl>`
        + (writable ? '<div class="ws-actions"><button class="ws-secondary" data-recharge><i data-lucide="wallet"></i>充值</button><button class="ws-secondary" data-credit><i data-lucide="pencil"></i>调整额度</button></div>' : '')
        + '<h3>未清挂账</h3><div class="ws-grid">' + field('creditFrom', '挂账开始日期', '', { type: 'date' })
        + field('creditTo', '挂账结束日期', '', { type: 'date' })
        + field('creditSupplier', '供应商', '', { choices: [['', '全部'], ...[...new Map(credit.map(item => [item.supplierId || 'unassigned', item.supplierName || '未分配供应商'])).entries()]] })
        + (writable ? '<label class="ws-checkbox"><input type="checkbox" data-credit-all>全选筛选结果</label>' : '') + '</div>'
        + '<div class="ws-table-wrap"><table><thead><tr>' + (writable ? '<th>选择</th>' : '') + '<th>挂账日期</th><th>供应商</th><th>来源订单 / 申请</th><th>未清金额</th></tr></thead><tbody data-credit-rows></tbody></table></div><p data-credit-total role="status"></p>'
        + (writable ? '<button class="ws-primary" data-clearing disabled><i data-lucide="check"></i>清账预览</button>' : '')
        + '<h3>账户流水</h3><div class="ws-table-wrap"><table><thead><tr><th>时间</th><th>方向</th><th>金额</th><th>余额</th><th>备注</th></tr></thead><tbody>'
        + ledgers.map(item => `<tr><td>${esc(new Date(item.occurredAt).toLocaleString('zh-CN'))}</td><td>${esc({ CREDIT: '增加', DEBIT: '扣减' }[item.direction] || item.direction)}</td><td>${esc(item.amount)}</td><td>${esc(item.balanceAfter)}</td><td>${esc(item.note || '-')}${['RECHARGE', 'CLEARING'].includes(item.sourceType) ? `<button type="button" class="ws-icon-button" title="查看账户单据" aria-label="查看账户单据" data-account-document="${esc(item.sourceId)}" data-kind="${item.sourceType}"><i data-lucide="file-text"></i></button>` : ''}</td></tr>`).join('') + '</tbody></table></div>'
        + '<h3>最近挂账流水</h3><div class="ws-table-wrap"><table><thead><tr><th>时间</th><th>来源订单 / 申请</th><th>类型</th><th>金额</th><th>来源未清</th></tr></thead><tbody>'
        + movements.map(item => `<tr><td>${esc(new Date(item.occurredAt).toLocaleString('zh-CN'))}</td><td>${esc(item.supplierOrderNo || item.requestId || '历史账户挂账')}</td><td>${esc({ BOOKING: '挂账发生', RELEASE: '挂账释放', CLEARING: '清账' }[item.kind] || item.kind)}</td><td>${esc(item.amount)}</td><td>${esc(item.outstandingAfter)}</td></tr>`).join('')
        + (movements.length ? '' : '<tr><td colspan="5">暂无挂账流水</td></tr>') + '</tbody></table></div>';
      icons();
      const creditRows = content.querySelector('[data-credit-rows]');
      const drawCredit = () => {
        const filtered = filterCreditItems(credit, { from: content.querySelector('[name="creditFrom"]').value,
          to: content.querySelector('[name="creditTo"]').value, supplierId: content.querySelector('[name="creditSupplier"]').value });
        creditRows.innerHTML = filtered.map(item => `<tr>${writable ? `<td><input type="checkbox" data-credit-item="${esc(item.fundingAllocationId)}" aria-label="选择挂账明细"></td>` : ''}<td>${esc(new Date(item.occurredAt).toLocaleDateString('zh-CN'))}</td><td>${esc(item.supplierName || '未分配供应商')}</td><td>${esc(item.supplierOrderNo || item.requestId || '历史账户挂账')}</td><td>${esc(item.creditOutstanding)}</td></tr>`).join('') || `<tr><td colspan="${writable ? 5 : 4}">暂无未清挂账</td></tr>`;
        const all = content.querySelector('[data-credit-all]'); if (all) all.checked = false;
        syncCredit();
      };
      const syncCredit = () => {
        const selected = [...creditRows.querySelectorAll('[data-credit-item]:checked')];
        const all = content.querySelector('[data-credit-all]');
        if (all) {
          const count = creditRows.querySelectorAll('[data-credit-item]').length;
          all.disabled = !count; all.checked = count > 0 && selected.length === count;
          all.indeterminate = selected.length > 0 && selected.length < count;
        }
        const cents = selected.reduce((sum, input) => {
          const amount = credit.find(item => item.fundingAllocationId === input.dataset.creditItem).creditOutstanding;
          const [whole, fraction = ''] = amount.split('.'); return sum + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
        }, 0n);
        content.querySelector('[data-credit-total]').textContent = `已选 ${selected.length} 笔 · 金额 ${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
        const clearing = content.querySelector('[data-clearing]'); if (clearing) clearing.disabled = !selected.length;
      };
      content.querySelectorAll('[name="creditFrom"], [name="creditTo"], [name="creditSupplier"]').forEach(input => { input.onchange = drawCredit; });
      creditRows.onchange = syncCredit;
      const all = content.querySelector('[data-credit-all]'); if (all) all.onchange = () => {
        creditRows.querySelectorAll('[data-credit-item]').forEach(input => { input.checked = all.checked; }); syncCredit();
      };
      drawCredit();
      content.querySelectorAll('[data-account-document]').forEach(button => { button.onclick = async () => {
        button.disabled = true;
        try { await openAccountDocument(context, `/stores/${storeId}/${button.dataset.kind === 'RECHARGE' ? 'recharges' : 'clearings'}/${button.dataset.accountDocument}`); }
        catch (error) { context.notice(error.message, true); } finally { button.disabled = false; }
      }; });
      if (!writable) return;
      content.querySelector('[data-recharge]').onclick = async () => {
        try {
        const accounts = (await context.get('/collection-accounts')).filter(item => item.status === 'ACTIVE');
        if (!context.active() || !content.isConnected) return;
        if (!accounts.length) throw new Error('请先在收款账户中新增并启用账户。');
        openAccountEvidenceEditor(context, '门店充值',
        field('amount', '充值金额', '', { type: 'number', min: '0.01', step: '0.01', required: true }) + field('businessDate', '业务日期', today(), { type: 'date', required: true })
        + field('collectionAccountId', '收款账户', '', { required: true, choices: [['', '请选择'], ...accounts.map(item => [item.id, `${item.name} · ${item.bankName} · 尾号${item.accountNo.slice(-4)}`])] }) + field('remark', '备注'),
        'RECHARGE', (data, form, evidenceFileIds) => {
          const body = { ...Object.fromEntries(data), evidenceFileIds }; body.collectionAccountId = body.collectionAccountId.trim();
          if (!body.remark.trim()) delete body.remark;
          return submit(`/stores/${storeId}/recharges`, body, form);
        });
        } catch (error) {
          const notice = section.querySelector('[data-account-error]');
          notice.hidden = false; notice.textContent = error.message;
        }
      };
      content.querySelector('[data-credit]').onclick = () => openEditor(context, '调整挂账额度',
        field('limit', '挂账额度', account.creditLimit, { type: 'number', step: '0.01', required: true }) + field('reason', '调整原因', '', { required: true, max: 300 }),
        (data, form) => submit(`/stores/${storeId}/credit-limit`, { expectedVersion: account.version, limit: String(data.get('limit')), reason: String(data.get('reason')).trim() }, form, 'PATCH'));
      const clearing = content.querySelector('[data-clearing]');
      clearing.onclick = async () => {
        clearing.disabled = true;
        const ids = [...content.querySelectorAll('[data-credit-item]:checked')].map(input => input.dataset.creditItem);
        try {
          const preview = await context.client.request(`/stores/${storeId}/clearings/preview`, { method: 'POST', body: { fundingAllocationIds: ids } });
          if (!context.active() || current !== generation) return;
          const editor = openAccountEvidenceEditor(context, '确认清账', `<div class="ws-wide ws-existing">清账金额 ${esc(preview.totalAmount)} · ${preview.items.length} 笔</div>`
            + field('businessDate', '业务日期', today(), { type: 'date', required: true }) + field('remark', '备注'), 'CLEARING', async (data, form, evidenceFileIds) => {
            const fresh = await context.client.request(`/stores/${storeId}/clearings/preview`, { method: 'POST', body: { fundingAllocationIds: ids } });
            if (clearingSignature(fresh) !== clearingSignature(preview)) throw new Error('挂账明细已变化，请关闭后重新预览。');
            await submit(`/stores/${storeId}/clearings`, { evidenceFileIds, businessDate: data.get('businessDate'), ...(String(data.get('remark')).trim() ? { remark: String(data.get('remark')).trim() } : {}), items: preview.items.map(item => ({ fundingAllocationId: item.fundingAllocationId, expectedVersion: item.version, expectedAmount: item.clearableAmount })) }, form);
          }); editor.form.querySelector('[type="submit"]').textContent = '确认清账';
        } catch (error) { if (context.active()) context.notice(error.message, true); }
        finally { if (context.active() && current === generation) clearing.disabled = false; }
      };
      if (initialAction === 'recharge') await content.querySelector('[data-recharge]').onclick();
      if (initialAction === 'credit') content.querySelector('[data-credit]').onclick();
      initialAction = undefined;
    } catch (error) { if (context.active() && current === generation) { content.textContent = error.message; } }
  };
  const selected = selectedStores.get(context.user.id);
  if (stores.some(store => store.id === selected) || stores.length === 1) { select.value = stores.some(store => store.id === selected) ? selected : stores[0].id; await select.onchange(); }
}
