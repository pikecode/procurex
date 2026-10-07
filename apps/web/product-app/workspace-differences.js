import { esc } from './ui.js';
import { field } from './workspace-management.js';
import { icons, iconButton, openEditor } from './workspace.js';

const directions = { STORE_RECEIVABLE_DECREASE: '退还门店', SUPPLIER_PAYABLE_DECREASE: '供应商退还', STORE_RECEIVABLE_INCREASE: '门店补款', SUPPLIER_PAYABLE_INCREASE: '补付供应商' };
export function differenceSignature(detail) {
  return JSON.stringify([detail.id, detail.storeId, detail.supplierId, detail.direction, detail.disposalCreditItemId,
    detail.pendingReturnOrOffsetAmount, detail.sourceRevision, detail.processingStatus, detail.disposal?.disposalId, detail.disposal?.version]);
}
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
async function command(context, path, body, form) {
  form.querySelector('fieldset').disabled = true;
  try { await context.command(path, body); await context.refresh(); }
  finally { form.querySelector('fieldset').disabled = false; if (context.client.pendingCommand) form.querySelector('[type="submit"]').disabled = true; }
}
export async function mountDifferences(context) {
  const central = context.user.roles.some(role => ['ADMIN', 'HQ_FINANCE'].includes(role));
  const supplier = !central && context.user.roles.includes('SUPPLIER');
  const rows = (await context.get('/adjustments')).filter(row => central || row.direction.startsWith(supplier ? 'SUPPLIER_' : 'STORE_'));
  if (!context.active()) return;
  const section = document.createElement('section'); section.className = 'ws-detail';
  section.innerHTML = '<h2>结算差异</h2>' + rows.map(row => `<div class="ws-todo"><div><strong>${esc(row.supplierOrderNo)} · ${esc(directions[row.direction])}</strong><small>调整 ${esc(row.adjustmentAmount)} · 待处理 ${esc(row.pendingReturnOrOffsetAmount)}</small></div>${iconButton('arrow-up-right', '打开结算差异', `data-adjustment="${esc(row.id)}"`)}</div>`).join('') + (rows.length ? '' : '<p>暂无结算差异</p>');
  context.view.append(section); let generation = 0;
  section.onclick = async event => {
    const button = event.target.closest('[data-adjustment]'); if (!button) return;
    const current = ++generation; button.disabled = true;
    try {
      const detail = await context.get(`/adjustments/${button.dataset.adjustment}`); if (!context.active() || current !== generation) return;
      const summary = `<div class="ws-wide ws-existing">${esc(detail.supplierOrderNo)} · ${esc(directions[detail.direction])}<br>调整 ${esc(detail.adjustmentAmount)} · 待处理 ${esc(detail.pendingReturnOrOffsetAmount)}</div>`;
      if (detail.disposal) {
        const disposal = await context.get(`/difference-disposals/${detail.disposal.disposalId}`); if (!context.active() || current !== generation) return;
        const editor = openEditor(context, '差异处理记录', summary + `<div class="ws-wide ws-existing">${esc(disposal.disposalNo)} · ${disposal.method === 'OFFSET' ? '抵扣' : '线下退回'}<br>金额 ${esc(disposal.amount)} · ${disposal.status === 'PENDING' ? '待确认' : '已确认'}<br>${esc(disposal.reason || '')}</div>`
          + (disposal.method === 'OFFSET' ? '<div class="ws-wide ws-table-wrap"><table><thead><tr><th>抵扣目标订单</th><th>金额</th></tr></thead><tbody>' + disposal.items.map(item => `<tr><td>${esc(item.targetSupplierOrderNo || '历史订单未找到')}</td><td>${esc(item.amount)}</td></tr>`).join('') + '</tbody></table></div>' : ''),
          disposal.status === 'PENDING' && !context.client.pendingCommand ? (_data, form) => command(context, `/difference-disposals/${disposal.id}/confirm`, { expectedVersion: disposal.version }, form) : null);
        editor.form.querySelector('[type="submit"]')?.replaceChildren(document.createTextNode('确认处理')); return;
      }
      const writable = central && !context.client.pendingCommand && detail.disposalCreditItemId && /[1-9]/.test(detail.pendingReturnOrOffsetAmount);
      if (!writable) { openEditor(context, '结算差异', summary, null); return; }
      const endpoint = detail.direction.startsWith('STORE_') ? '/store-statements' : '/supplier-statements';
      const bills = (await context.get(endpoint)).filter(bill => bill.supplierId === detail.supplierId && (!detail.direction.startsWith('STORE_') || bill.storeId === detail.storeId) && /[1-9]/.test(bill.payableAmount));
      const targets = (await Promise.all(bills.map(bill => context.get(`${endpoint}/${bill.id}`)))).flatMap(bill => [
        ...bill.lines.filter(line => /[1-9]/.test(line.totalAmount)).map(line => [line.settlementItemId, line.supplierOrderNo]),
        ...(bill.adjustmentItems || []).filter(item => !String(item.amount).startsWith('-') && /[1-9]/.test(item.amount)).map(item => [item.settlementItemId, `正调整 ${item.amount}`]),
      ]);
      if (!context.active() || current !== generation) return;
      const editor = openEditor(context, '登记差异处理', summary + field('method', '处理方式', 'OFFLINE_RETURN', { choices: [['OFFLINE_RETURN', '线下退回'], ['OFFSET', '抵扣账单']] })
        + field('target', '抵扣目标', '', { choices: [['', targets.length ? '请选择来源订单或调整' : '暂无候选账单'], ...targets] })
        + field('businessDate', '业务日期', today(), { type: 'date', required: true }) + field('reason', '处理说明', '', { max: 300 }), async (data, form) => {
          form.querySelector('fieldset').disabled = true;
          try {
            const fresh = await context.get(`/adjustments/${detail.id}`);
            if (differenceSignature(fresh) !== differenceSignature(detail)) throw new Error('差异明细已变化，请关闭后重新打开。');
            const reason = String(data.get('reason')).trim(); const method = data.get('method');
            await command(context, '/difference-disposals', { method, creditItemIds: [detail.disposalCreditItemId], amount: detail.pendingReturnOrOffsetAmount,
              ...(method === 'OFFSET' ? { targetDebitItemIds: [data.get('target')] } : {}), businessDate: data.get('businessDate'), ...(reason ? { reason } : {}) }, form);
          } finally { form.querySelector('fieldset').disabled = false; if (context.client.pendingCommand) form.querySelector('[type="submit"]').disabled = true; }
        });
      const target = editor.form.elements.target;
      const update = () => { const offset = editor.form.elements.method.value === 'OFFSET'; target.disabled = !offset; target.required = offset; target.parentElement.hidden = !offset; };
      editor.form.elements.method.onchange = update; update(); editor.form.querySelector('[type="submit"]').textContent = '登记处理';
    } catch (error) { if (context.active() && current === generation) context.notice(error.message, true); } finally { button.disabled = false; }
  }; icons();
}
