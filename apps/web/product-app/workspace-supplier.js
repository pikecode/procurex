import { esc } from './ui.js';
import { renderTable, field } from './workspace-management.js';
import { icons, iconButton, openEditor } from './workspace.js';

const states = { PUSHED: '待发货', ACCEPTED: '已接单', PARTIAL_SHIPPED: '部分发货', SHIPPED: '已发货', COMPLETED: '已完成', REJECTED: '已拒单', CANCELED: '已取消', PENDING: '待审核', CONFIRMED: '已确认', OPEN: '待处理', RESOLVED: '已处理', REPLENISH_PENDING: '待补发', RETURNED: '已退回', SUPERSEDED: '已被新收货记录替代' };
const status = value => esc(states[value] || value || '-');
export function shipmentSignature(preview) {
  return JSON.stringify({ version: preview.version, items: preview.items.map(item => [item.orderItemId, item.shipQuantity,
    item.permanentlyReduceQuantity, item.remainingQuantityBefore, item.remainingQuantityAfter, item.supplyLineAmount, item.gapAllocations]),
  supplyGoodsAmount: preview.totals.supplyGoodsAmount, freight: preview.totals.freight, freightConfirmationId: preview.freightConfirmationId });
}
async function submitCommand(context, path, body, form) {
  form.querySelector('fieldset').disabled = true;
  try { const result = await context.command(path, body); await context.refresh(); return result; }
  finally { form.querySelector('fieldset').disabled = false; if (context.client.pendingCommand) form.querySelector('[type="submit"]').disabled = true; }
}
function openReason(context, title, path, version) {
  openEditor(context, title, field('reason', '处理原因', '', { required: true, textarea: true, wide: true, max: 300 }),
    async (data, form) => submitCommand(context, path, { expectedVersion: version, reason: String(data.get('reason')).trim() }, form));
}
function openShipment(context, order) {
  let quote = null; let revision = 0;
  const confirmations = (order.freightConfirmations || []).filter(item => item.status === 'CONFIRMED' && !item.usedAt);
  const content = `<div class="ws-existing ws-wide">${esc(order.destination?.name || '')} · ${esc(order.destination?.address || '')}<br>${esc(order.destination?.contactName || '')} / ${esc(order.destination?.contactPhone || '')}</div>`
    + field('shipmentMode', '发货类型', 'NORMAL', { choices: [['NORMAL', '普通发货'], ['REPLENISH', '补发']] }) + field('trackingNo', '物流单号', '', { max: 100 })
    + '<div class="ws-wide">' + order.items.map(item => `<section class="ws-shipment-line"><strong>${esc(item.productName)} · ${esc(item.unitName || '历史单位未记录')}</strong><small>待发 ${esc(item.remainingToShipQuantity ?? '-')} · 已发 ${esc(item.shippedQuantity)} · 已收 ${esc(item.receivedQuantity)}</small><div class="ws-product-config">`
      + field(`ship:${item.id}`, '本次发货', item.remainingToShipQuantity ?? '0', { type: 'number', min: 0, step: '0.000001', required: true })
      + field(`reduce:${item.id}`, '永久减少', '0', { type: 'number', min: 0, step: '0.000001', required: true })
      + (item.replenishmentGaps || []).filter(gap => ['PENDING', 'PARTIAL_FILLED'].includes(gap.status)).map((gap, index) => `<div class="ws-wide" data-gap-field hidden>${field(`gap:${gap.id}`, `补发缺口 ${index + 1} · 剩余 ${gap.remainingQuantity}`, '0', { type: 'number', min: 0, step: '0.000001', required: true })}</div>`).join('') + '</div></section>').join('') + '</div>'
    + field('freightConfirmationId', '运费确认', '', { choices: [['', '零运费'], ...confirmations.map(item => [item.id, `${item.amount} · ${item.reason}`])] })
    + '<div class="ws-wide ws-actions"><button type="button" id="ws-shipment-preview" class="ws-secondary"><i data-lucide="calculator"></i>预览发货</button></div><div id="ws-shipment-quote" class="ws-wide"></div>';
  const editor = openEditor(context, `${order.supplierOrderNo} · 发货`, content, async (_data, form) => {
    if (!quote) throw new Error('请先预览发货。');
    const current = revision; const approved = quote; const body = readBody(); const fresh = await preview(body);
    if (!editor.dialog.isConnected || !context.active() || revision !== current) throw new Error('发货内容已变化，请重新预览。');
    if (shipmentSignature(fresh) !== shipmentSignature(approved)) { showQuote(fresh); throw new Error('发货报价已变化，请核对后再提交。'); }
    await submitCommand(context, `/supplier-orders/${order.id}/shipments`, body, form);
  });
  const form = editor.form; const submit = form.querySelector('[type="submit"]'); submit.textContent = '确认发货'; submit.disabled = true;
  const zero = value => /^0*(\.0*)?$/.test(value);
  function readBody() {
    const replenishing = form.elements.shipmentMode.value === 'REPLENISH';
    const items = order.items.map(item => ({ orderItemId: item.id, shipQuantity: form.elements[`ship:${item.id}`].value,
      permanentlyReduceQuantity: replenishing ? '0' : form.elements[`reduce:${item.id}`].value,
      ...(replenishing ? { gapAllocations: (item.replenishmentGaps || []).filter(gap => form.elements[`gap:${gap.id}`] && !zero(form.elements[`gap:${gap.id}`].value)).map(gap => ({ gapId: gap.id, quantity: form.elements[`gap:${gap.id}`].value })) } : {}) }))
      .filter(item => !zero(item.shipQuantity) || !zero(item.permanentlyReduceQuantity));
    if (!items.length) throw new Error('请填写本次发货或永久减少数量。');
    if (replenishing && items.some(item => !item.gapAllocations?.length)) throw new Error('补发商品需填写对应缺口数量。');
    const confirmation = confirmations.find(item => item.id === form.elements.freightConfirmationId.value); const trackingNo = form.elements.trackingNo.value.trim();
    return { expectedVersion: order.version, items, freight: confirmation?.amount || '0.00', ...(confirmation ? { freightConfirmationId: confirmation.id } : {}), ...(trackingNo ? { trackingNo } : {}) };
  }
  function preview(body) { return context.client.request(`/supplier-orders/${order.id}/shipment-preview`, { method: 'POST', body }); }
  function showQuote(result) {
    quote = result;
    form.querySelector('#ws-shipment-quote').innerHTML = `<p>本次发货 ${esc(result.totals.shipQuantity)} · 永久减少 ${esc(result.totals.permanentlyReduceQuantity)} · 仍待发 ${esc(result.totals.remainingQuantity)}</p><p>供货货款 ${esc(result.totals.supplyGoodsAmount)} · 运费 ${esc(result.totals.freight)}</p>`;
    form.querySelector('#ws-shipment-quote').scrollIntoView({ block: 'nearest' }); submit.disabled = Boolean(context.client.pendingCommand);
  }
  const invalidate = () => { revision += 1; quote = null; submit.disabled = true; form.querySelector('#ws-shipment-quote').innerHTML = ''; };
  form.addEventListener('input', invalidate); form.addEventListener('change', invalidate);
  form.elements.shipmentMode.addEventListener('change', () => {
    const replenish = form.elements.shipmentMode.value === 'REPLENISH';
    form.querySelectorAll('[data-gap-field]').forEach(element => { element.hidden = !replenish; });
    order.items.forEach(item => { form.elements[`ship:${item.id}`].value = replenish ? '0' : item.remainingToShipQuantity ?? '0'; form.elements[`reduce:${item.id}`].value = '0'; form.elements[`reduce:${item.id}`].disabled = replenish; });
  });
  form.querySelector('#ws-shipment-preview').onclick = async event => {
    if (!form.reportValidity()) return;
    const current = revision; const button = event.currentTarget; button.disabled = true;
    try { const result = await preview(readBody()); if (editor.dialog.isConnected && context.active() && revision === current) showQuote(result); }
    catch (failure) { if (editor.dialog.isConnected && context.active() && revision === current) { const box = form.querySelector('.ws-form-error'); box.hidden = false; box.textContent = failure.message; } }
    finally { button.disabled = false; }
  };
}
function attachDownloads(context, editor) {
  editor.form.querySelectorAll('[data-download]').forEach(button => { button.onclick = async () => {
    button.disabled = true;
    try { const blob = await context.client.request(`/files/${button.dataset.download}/download`, { binary: true }); if (!context.active() || !button.isConnected) return;
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = button.dataset.filename; link.click(); URL.revokeObjectURL(url);
    } catch (failure) { context.notice(failure.message, true); } finally { button.disabled = false; }
  }; });
}
const evidenceButtons = files => '<div class="ws-wide ws-actions">' + (files || []).map(file => `<button type="button" class="ws-secondary" data-download="${esc(file.id)}" data-filename="${esc(file.filename)}"><i data-lucide="paperclip"></i>${esc(file.filename)}</button>`).join('') + '</div>';
async function openDiscrepancy(context, id, current = () => true) {
  const detail = await context.get(`/discrepancies/${id}`); if (!context.active() || !current()) return;
  const content = `<div class="ws-wide ws-existing">${esc(detail.productName || '')} · ${esc(detail.supplierOrderNo || '')}<br>发货 ${esc(detail.shippedQuantity)} · 收货 ${esc(detail.receivedQuantity)} · 差异 ${esc(detail.missingQuantity)}<br>${status(detail.status)}</div>`
    + (detail.status === 'OPEN' ? field('action', '处理方式', 'ACCEPT', { choices: [['ACCEPT', '接受差异'], ['REPLENISH', '补发'], ['RETURN', '退回收货']] }) + field('reason', '处理说明', '', { textarea: true, wide: true, max: 300 }) : '') + evidenceButtons(detail.evidenceFiles);
  const editor = openEditor(context, '收货差异', content, detail.status === 'OPEN' ? async (data, form) => { const reason = String(data.get('reason')).trim();
    await submitCommand(context, `/discrepancies/${detail.id}/resolve`, { expectedVersion: detail.version, action: data.get('action'), ...(reason ? { reason } : {}) }, form);
  } : null); attachDownloads(context, editor);
  if (context.client.pendingCommand) editor.form.querySelector('[type="submit"]')?.setAttribute('disabled', '');
}
async function openPayment(context, id, current = () => true) {
  const detail = await context.get(`/payment-records/${id}`); if (!context.active() || !current()) return;
  const content = `<div class="ws-wide ws-existing">${esc(detail.paymentNo)} · ${status(detail.status)}<br>金额 ${esc(detail.amount)} · ${esc(detail.businessDate)}<br>${esc(detail.remark || '')}</div>` + evidenceButtons(detail.evidenceFiles)
    + (detail.status === 'PENDING' ? field('decision', '审核结果', 'confirm', { choices: [['confirm', '确认收款'], ['reject', '驳回付款']] }) + field('reason', '驳回原因', '', { textarea: true, wide: true, max: 300 }) : '');
  const editor = openEditor(context, '付款审核', content, detail.status === 'PENDING' ? async (data, form) => { const decision = data.get('decision'); const reason = String(data.get('reason')).trim(); if (decision === 'reject' && !reason) throw new Error('请填写驳回原因。');
    await submitCommand(context, `/payment-records/${id}/${decision}`, { expectedVersion: detail.version, ...(decision === 'reject' ? { reason } : {}) }, form);
  } : null); attachDownloads(context, editor);
  if (context.client.pendingCommand) editor.form.querySelector('[type="submit"]')?.setAttribute('disabled', '');
}
export async function renderSupplier(context) {
  if (context.user.roles.includes('SUPPLIER') && !context.user.roles.includes('ADMIN') && !context.user.scope?.supplierId) throw new Error('账号尚未配置所属供应商。');
  const writable = context.user.roles.some(role => ['ADMIN', 'SUPPLIER'].includes(role)); const rows = await context.get('/supplier-orders');
  renderTable(context, { title: '供应商订单', rows: rows.map(item => ({ ...item, searchText: item.storeName })), columns: ['订单号', '门店', '状态', '供货货款', '日期'],
    cells: item => [esc(item.supplierOrderNo), esc(item.storeName || '-'), status(item.status), esc(item.supplyGoodsAmount), esc(new Date(item.createdAt).toLocaleDateString('zh-CN'))], actions: item => iconButton('arrow-up-right', '打开订单', `data-supplier-order="${esc(item.id)}"`) });
  if (!context.active()) return;
  context.view.insertAdjacentHTML('beforeend', '<section id="ws-supplier-detail" class="ws-detail"></section><section id="ws-supplier-tasks" class="ws-detail"></section>');
  if (context.client.pendingCommand) { context.view.querySelector('.ws-heading').insertAdjacentHTML('afterend', '<div class="ws-command"><span>有一笔提交尚未确认</span><button id="ws-recover" class="ws-secondary">查询提交结果</button></div>');
    document.getElementById('ws-recover').onclick = async event => { event.currentTarget.disabled = true; try { await context.command(null, null, true); await context.refresh(); } catch (failure) { context.notice(failure.message, true); if (context.active()) event.target.disabled = false; } }; }
  let sequence = 0;
  context.view.addEventListener('click', async event => { const button = event.target.closest('[data-supplier-order]'); if (!button) return; const current = ++sequence; button.disabled = true;
    try { const detail = await context.get(`/supplier-orders/${button.dataset.supplierOrder}`); if (!context.active() || current !== sequence) return;
      const canAct = writable && !context.client.pendingCommand; const shippable = ['PUSHED', 'ACCEPTED', 'PARTIAL_SHIPPED', 'SHIPPED'].includes(detail.status);
      document.getElementById('ws-supplier-detail').innerHTML = `<div class="ws-detail-top"><h2>${esc(detail.supplierOrderNo)}</h2><div class="ws-actions">`
        + (canAct && shippable ? '<button class="ws-primary" id="ws-open-shipment"><i data-lucide="truck"></i>发货</button>' : '')
        + (canAct && ['PUSHED', 'ACCEPTED'].includes(detail.status) && !detail.firstShippedAt ? '<button class="ws-secondary" id="ws-reject-order">拒单</button>' : '')
        + (canAct && shippable && detail.requiresFreightSnapshot !== false ? '<button class="ws-secondary" id="ws-request-freight">申请运费</button>' : '') + '</div></div>'
        + `<p>${esc(detail.destination?.name || '')} · ${esc(detail.destination?.address || '')}<br>${esc(detail.destination?.contactName || '')} / ${esc(detail.destination?.contactPhone || '')}</p>`
        + '<div class="ws-table-wrap"><table><thead><tr><th>商品</th><th>单位</th><th>待发</th><th>已发 / 已收</th><th>供货单价</th></tr></thead><tbody>' + detail.items.map(item => `<tr><td>${esc(item.productName)}</td><td>${esc(item.unitName || '历史单位未记录')}</td><td>${esc(item.remainingToShipQuantity ?? '-')}</td><td>${esc(item.shippedQuantity)} / ${esc(item.receivedQuantity)}</td><td>${esc(item.supplyUnitPrice)}</td></tr>`).join('') + '</tbody></table></div>'
        + (detail.freightConfirmations?.length ? '<h3>运费申请</h3>' + detail.freightConfirmations.map(item => `<p>${esc(item.amount)} · ${status(item.status)} · ${esc(item.reason)}${item.usedAt ? ' · 已使用' : ''}</p>`).join('') : '');
      document.getElementById('ws-open-shipment')?.addEventListener('click', () => openShipment(context, detail));
      document.getElementById('ws-reject-order')?.addEventListener('click', () => openReason(context, '拒绝订单', `/supplier-orders/${detail.id}/reject`, detail.version));
      document.getElementById('ws-request-freight')?.addEventListener('click', () => openEditor(context, '申请运费', field('amount', '运费金额', '', { required: true, type: 'number', min: '0.01', step: '0.01' }) + field('reason', '申请原因', '', { required: true, textarea: true, wide: true, max: 300 }), async (data, form) => submitCommand(context, `/supplier-orders/${detail.id}/freight-confirmations`, { expectedVersion: detail.version, amount: data.get('amount'), reason: String(data.get('reason')).trim() }, form))); icons();
    } catch (failure) { context.notice(failure.message, true); } finally { button.disabled = false; }
  });
  if (!writable) return;
  const taskView = document.getElementById('ws-supplier-tasks');
  let taskSequence = 0; let taskLoad = 0;
  const openTask = async (button, opener, id) => {
    const current = ++taskSequence; button.disabled = true;
    try { await opener(context, id, () => current === taskSequence && button.isConnected); }
    catch (failure) { if (context.active() && current === taskSequence) context.notice(failure.message, true); }
    finally { button.disabled = false; }
  };
  const loadTasks = async () => { const current = ++taskLoad; const results = await Promise.allSettled([context.get('/discrepancies'), context.get('/payment-records?direction=COMPANY_TO_SUPPLIER')]); if (!context.active() || current !== taskLoad) return;
    const differences = results[0].status === 'fulfilled' ? results[0].value : []; const payments = results[1].status === 'fulfilled' ? results[1].value : [];
    taskView.innerHTML = '<h2>收货差异</h2>' + differences.map(item => `<div class="ws-todo"><div><strong>${esc(item.productName)}</strong><small>${esc(item.supplierOrderNo)} · 差异 ${esc(item.missingQuantity)} · ${status(item.status)}</small></div>${iconButton('clipboard-list', '处理差异', `data-discrepancy="${esc(item.id)}"`)}</div>`).join('') + (differences.length ? '' : '<p class="ws-existing">暂无待处理差异</p>') + '<h2>付款审核</h2>' + payments.map(item => `<div class="ws-todo"><div><strong>${esc(item.paymentNo)}</strong><small>${esc(item.amount)} · ${status(item.status)}</small></div>${iconButton('arrow-up-right', '打开付款', `data-payment="${esc(item.id)}"`)}</div>`).join('') + (payments.length ? '' : '<p class="ws-existing">暂无付款记录</p>') + (results.some(result => result.status === 'rejected') ? '<button type="button" class="ws-secondary" id="ws-task-retry">重新加载待办</button>' : '');
    taskView.querySelectorAll('[data-discrepancy]').forEach(button => { button.onclick = () => openTask(button, openDiscrepancy, button.dataset.discrepancy); }); taskView.querySelectorAll('[data-payment]').forEach(button => { button.onclick = () => openTask(button, openPayment, button.dataset.payment); }); taskView.querySelector('#ws-task-retry')?.addEventListener('click', loadTasks); icons();
  }; await loadTasks();
}
