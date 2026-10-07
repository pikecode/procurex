import { esc } from './ui.js';
import { field } from './workspace-management.js';
import { icons, iconButton, openEditor } from './workspace.js';

const status = value => ({ PENDING: '待审核', CONFIRMED: '已确认', REJECTED: '已驳回', CANCELLED: '已撤销' }[value] || value);
const date = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
export function paymentSignature(preview) {
  return JSON.stringify([preview.direction, preview.channel, preview.storeId, preview.supplierId, preview.totalPayableAmount,
    preview.blockedItems.map(item => [item.settlementItemId, item.code]).sort(),
    preview.items.map(item => [item.settlementItemId, item.sourceVersion, item.payableAmount, item.pendingPaymentAmount, item.confirmedPaidAmount]).sort()]);
}
async function command(context, path, body, form) {
  form.querySelector('fieldset').disabled = true;
  try { await context.command(path, body); await context.refresh(); }
  finally { form.querySelector('fieldset').disabled = false; if (context.client.pendingCommand) form.querySelector('[type="submit"]').disabled = true; }
}

export async function openPaymentRegistration(context, ids, current = () => true) {
  const preview = await context.client.request('/payment-records/preview', { method: 'POST', body: { settlementItemIds: ids } });
  if (!context.active() || !current()) return;
  if (preview.blockedItems.length) throw new Error(preview.blockedItems.map(item => item.message).join('；'));
  if (!preview.items.length || !/[1-9]/.test(preview.totalPayableAmount)) throw new Error('所选明细已结清或已登记待审核付款。');
  let file; let uploading = false;
  const editor = openEditor(context, '登记付款', `<div class="ws-wide ws-existing">付款金额 ${esc(preview.totalPayableAmount)} · ${preview.items.length} 笔</div>`
    + '<div class="ws-wide ws-table-wrap"><table><thead><tr><th>订单</th><th>待付金额</th></tr></thead><tbody>' + preview.items.map(item => `<tr><td>${esc(item.supplierOrderNo)}</td><td>${esc(item.payableAmount)}</td></tr>`).join('') + '</tbody></table></div>'
    + field('businessDate', '付款日期', date(), { type: 'date', required: true }) + field('remark', '备注')
    + '<section class="ws-wide"><h3>付款凭证</h3><input name="paymentFile" type="file" accept="image/jpeg,image/png,application/pdf" hidden><div class="ws-actions"><button type="button" data-payment-add class="ws-secondary"><i data-lucide="paperclip"></i>添加凭证</button><span data-payment-file></span></div></section>', async (data, form) => {
    if (uploading || !file?.id) throw new Error('请先完成付款凭证上传。');
    form.querySelector('fieldset').disabled = true;
    try {
      const fresh = await context.client.request('/payment-records/preview', { method: 'POST', body: { settlementItemIds: ids } });
      if (paymentSignature(fresh) !== paymentSignature(preview)) throw new Error('结算明细已变化，请关闭后重新预览。');
      const remark = String(data.get('remark')).trim();
      await command(context, '/payment-records', { direction: preview.direction, businessDate: data.get('businessDate'), ...(remark ? { remark } : {}),
        items: preview.items.map(item => ({ settlementItemId: item.settlementItemId, expectedVersion: item.sourceVersion, expectedAmount: item.payableAmount })), evidenceFileIds: [file.id] }, form);
    } finally { form.querySelector('fieldset').disabled = false; update(); }
  });
  const form = editor.form; const alive = () => editor.dialog.isConnected && context.active();
  const submit = form.querySelector('[type="submit"]'); submit.textContent = '登记付款';
  function update() { submit.disabled = uploading || !file?.id || Boolean(context.client.pendingCommand); form.querySelector('[data-payment-add]').disabled = uploading || Boolean(context.client.pendingCommand); }
  async function upload() {
    uploading = true; file.id = undefined; form.querySelector('.ws-form-error').hidden = true;
    update(); form.querySelector('[data-payment-file]').textContent = `${file.blob.name} · 上传中`;
    try { file.id = await context.uploadFile(file.blob, 'PAYMENT', file.blob.name); }
    catch (error) { if (alive()) { const box = form.querySelector('.ws-form-error'); box.hidden = false; box.textContent = error.message; } }
    finally {
      uploading = false;
      if (alive()) { form.querySelector('[data-payment-file]').innerHTML = `${esc(file.blob.name)} · ${file.id ? '已上传' : '上传失败'} ${!file.id ? iconButton('rotate-cw', '重试上传', 'data-payment-retry') : ''}`;
        form.querySelector('[data-payment-retry]')?.addEventListener('click', upload); icons(); update(); }
    }
  }
  form.querySelector('[data-payment-add]').onclick = () => form.elements.paymentFile.click();
  form.elements.paymentFile.onchange = async event => {
    const blob = event.target.files[0]; event.target.value = ''; if (!blob) return;
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(blob.type) || !blob.size || blob.size > 10 * 1024 * 1024) {
      const box = form.querySelector('.ws-form-error'); box.hidden = false; box.textContent = '凭证须为JPEG、PNG或PDF，大小不超过10 MB。'; return;
    }
    file = { blob }; await upload();
  }; update();
}

export async function mountPaymentRecords(context) {
  const rows = await context.get('/payment-records'); if (!context.active()) return;
  const section = document.createElement('section'); section.className = 'ws-detail';
  section.innerHTML = '<h2>付款记录</h2>' + rows.map(item => `<div class="ws-todo"><div><strong>${esc(item.paymentNo)}</strong><small>${esc(item.amount)} · ${esc(status(item.status))} · ${esc(item.businessDate)}</small></div>${iconButton('arrow-up-right', '打开付款记录', `data-finance-payment="${esc(item.id)}"`)}</div>`).join('') + (rows.length ? '' : '<p>暂无付款记录</p>');
  context.view.append(section); let sequence = 0;
  if (context.client.pendingCommand && context.user.roles.includes('SUPPLIER') && !context.user.roles.some(role => ['ADMIN', 'HQ_FINANCE'].includes(role))) {
    section.insertAdjacentHTML('afterbegin', '<div class="ws-command"><span>有一笔提交尚未确认</span><button type="button" class="ws-secondary" data-payment-recover>查询提交结果</button></div>');
    section.querySelector('[data-payment-recover]').onclick = async event => {
      event.currentTarget.disabled = true;
      try { await context.command(null, null, true); await context.refresh(); }
      catch (error) { context.notice(error.message, true); if (context.active()) event.target.disabled = false; }
    };
  }
  section.onclick = async event => {
    const button = event.target.closest('[data-finance-payment]'); if (!button) return;
    const current = ++sequence; button.disabled = true;
    try {
      const detail = await context.get(`/payment-records/${button.dataset.financePayment}`); if (!context.active() || current !== sequence) return;
      const central = context.user.roles.some(role => ['ADMIN', 'HQ_FINANCE'].includes(role));
      const decisions = central ? [['confirm', '确认收款'], ['reject', '驳回付款'], ['cancel', '撤销登记']] : context.user.roles.includes('SUPPLIER') ? [['confirm', '确认收款'], ['reject', '驳回付款']] : [['cancel', '撤销登记']];
      const recipient = !context.user.roles.includes('SUPPLIER') || central || detail.direction === 'COMPANY_TO_SUPPLIER' || detail.channel === 'DIRECT';
      const writable = recipient && detail.status === 'PENDING' && !context.client.pendingCommand;
      const editor = openEditor(context, '付款记录', `<div class="ws-wide ws-existing">${esc(detail.paymentNo)} · ${esc(status(detail.status))}<br>金额 ${esc(detail.amount)} · ${esc(detail.businessDate)}<br>${esc(detail.rejectedReason || detail.cancelledReason || detail.remark || '')}</div>`
        + '<div class="ws-wide ws-actions">' + (detail.evidenceFiles || []).map(file => `<button type="button" class="ws-secondary" data-evidence="${esc(file.id)}" data-filename="${esc(file.filename)}"><i data-lucide="download"></i>${esc(file.filename)}</button>`).join('') + '</div>'
        + '<div class="ws-wide ws-table-wrap"><table><thead><tr><th>来源订单</th><th>登记金额</th></tr></thead><tbody>' + detail.allocations.map(item => `<tr><td>${esc(item.supplierOrderNo || item.supplierOrderId)}</td><td>${esc(item.amount)}</td></tr>`).join('') + '</tbody></table></div>'
        + (writable ? field('decision', '处理方式', decisions[0][0], { choices: decisions }) + field('reason', '驳回 / 撤销原因', '', { max: 300 }) : ''), writable ? async (data, form) => {
          const decision = data.get('decision'); const reason = String(data.get('reason')).trim();
          if (decision !== 'confirm' && !reason) throw new Error('请填写驳回或撤销原因。');
          await command(context, `/payment-records/${detail.id}/${decision}`, { expectedVersion: detail.version, ...(decision !== 'confirm' ? { reason } : {}) }, form);
        } : null);
      editor.form.querySelectorAll('[data-evidence]').forEach(link => { link.onclick = async () => {
        link.disabled = true;
        try { const blob = await context.client.request(`/files/${link.dataset.evidence}/download`, { binary: true }); if (!editor.dialog.isConnected || !context.active()) return;
          const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = link.dataset.filename; anchor.click(); URL.revokeObjectURL(url);
        } catch (error) { context.notice(error.message, true); } finally { link.disabled = false; }
      }; });
    } catch (error) { if (context.active()) context.notice(error.message, true); } finally { button.disabled = false; }
  }; icons();
}
