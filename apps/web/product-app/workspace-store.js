import { esc } from './ui.js';
import { field, renderTable } from './workspace-management.js';
import { hydrateImages } from './workspace-media.js';
import { openPurchaseDraft } from './workspace-purchasing.js';
import { icons, iconButton, openEditor } from './workspace.js';

const states = { PENDING_PROCUREMENT: '待采购', PENDING_FUNDS: '待补款', CONFIRMED: '已确认', COMPLETED: '已完成', CANCELED: '已取消', PARTIAL_SHIPPED: '部分发货', SHIPPED: '已发货', REJECTED: '已拒单', PUSHED: '待发货', ACCEPTED: '已接单' };
const status = value => esc(states[value] || value || '-');
function quantity(value) {
  if (!/^\d+(\.\d{1,6})?$/.test(String(value))) throw new Error('数量须为非负数，最多六位小数。');
  const [integer, fraction = ''] = String(value).split('.'); const decimal = fraction.replace(/0+$/, '');
  return `${integer.replace(/^0+(?=\d)/, '')}${decimal ? `.${decimal}` : ''}`;
}
export function receiptChanged(detail, items) {
  return detail.currentReceiptRevision === 0 || items.some(item => {
    const original = detail.items.find(row => row.id === item.shipmentItemId);
    return !original.receiptLocked && quantity(item.receivedQuantity) !== quantity(original.currentReceivedQuantity);
  });
}
function openReceipt(context, detail) {
  const writable = context.user.roles.includes('STORE') && detail.items.some(item => !item.receiptLocked) && !context.client.pendingCommand;
  let uploading = false; let files = []; const urls = [];
  const currentEvidence = (detail.evidenceFiles || []).map(file => `<figure><img data-image="${esc(file.id)}" alt="${esc(file.filename)}" hidden><figcaption>${esc(file.filename)}</figcaption></figure>`).join('');
  const content = `<div class="ws-wide ws-existing">${esc(detail.shipmentNo)} · ${esc(detail.trackingNo || '无物流单号')} · 收货版本 ${esc(detail.currentReceiptRevision)}</div>`
    + '<div class="ws-wide">' + detail.items.map(item => `<section class="ws-shipment-line"><strong>${esc(item.productName)} · ${esc(item.unitName || '历史单位未记录')}</strong><small>发货 ${esc(item.shippedQuantity)}${item.receiptLocked ? ' · 已锁定' : ''}</small>`
      + field(`received:${item.id}`, '实收数量', item.currentReceivedQuantity ?? item.shippedQuantity, { type: 'number', min: 0, max: item.shippedQuantity, step: '0.000001', required: true, disabled: !writable || item.receiptLocked }) + '</section>').join('') + '</div>'
    + (currentEvidence ? `<section class="ws-wide"><h3>当前收货凭证</h3><div class="ws-receipt-images">${currentEvidence}</div></section>` : '')
    + (writable ? '<section class="ws-wide"><h3>本次收货凭证</h3><div data-receipt-picker class="ws-actions"><input name="receiptPictures" type="file" accept="image/jpeg,image/png" multiple hidden><button id="ws-receipt-add" type="button" class="ws-secondary"><i data-lucide="image-plus"></i>添加图片</button></div><div id="ws-receipt-files" class="ws-receipt-images"></div></section>' : '');
  const editor = openEditor(context, `${detail.shipmentNo} · 收货`, content, writable ? async (_data, form) => {
    if (uploading || !files.length || files.some(file => file.state !== 'READY')) throw new Error('请先完成本次收货凭证上传。');
    const items = readItems(); if (!receiptChanged(detail, items)) throw new Error('实收数量未变化，无需重复提交。');
    form.querySelector('fieldset').disabled = true;
    try { await context.command(`/shipments/${detail.id}/receipts`, { expectedOrderVersion: detail.supplierOrderVersion,
      expectedReceiptRevision: detail.currentReceiptRevision, items, evidenceFileIds: files.map(file => file.id) }); await context.refresh(); }
    finally { form.querySelector('fieldset').disabled = false; if (context.client.pendingCommand) form.querySelector('[type="submit"]').disabled = true; }
  } : null);
  const form = editor.form; const alive = () => editor.dialog.isConnected && context.active();
  detail.items.forEach(item => { form.elements[`received:${item.id}`].max = item.shippedQuantity; });
  const submit = form.querySelector('[type="submit"]'); if (submit) { submit.textContent = '确认收货'; submit.disabled = true; }
  function readItems() { return detail.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: quantity(form.elements[`received:${item.id}`].value) })); }
  function update() {
    if (!submit) return;
    let changed = false;
    try { changed = receiptChanged(detail, readItems()); } catch { /* Invalid quantities cannot be submitted. */ }
    submit.disabled = uploading || Boolean(context.client.pendingCommand) || !files.length || files.some(file => file.state !== 'READY') || !changed;
    const input = form.elements.receiptPictures; if (input) { input.disabled = uploading || !changed; input.parentElement.hidden = !changed; form.querySelector('#ws-receipt-add').disabled = uploading; }
  }
  function draw() {
    form.querySelector('#ws-receipt-files').innerHTML = files.map((file, index) => `<figure><img src="${esc(file.url)}" alt="${esc(file.blob.name)}"><figcaption>${esc(file.blob.name)} · ${file.state === 'READY' ? '已上传' : file.state === 'FAILED' ? '上传失败' : '上传中'}</figcaption><div class="ws-actions">${file.state === 'FAILED' ? iconButton('rotate-cw', '重试上传', `data-upload-retry="${index}"`) : ''}${uploading ? '' : iconButton('trash-2', '移除图片', `data-upload-remove="${index}"`)}</div></figure>`).join(''); icons(); update();
  }
  async function upload(file) {
    uploading = true; file.state = 'UPLOADING'; const error = form.querySelector('.ws-form-error'); error.hidden = true; error.textContent = ''; draw();
    try { file.id = await context.uploadFile(file.blob, 'RECEIPT', file.blob.name); file.state = 'READY'; }
    catch (failure) { file.state = 'FAILED'; if (alive()) { const error = form.querySelector('.ws-form-error'); error.hidden = false; error.textContent = failure.message; } }
    finally { uploading = false; if (alive()) draw(); }
  }
  if (writable) {
    form.querySelector('#ws-receipt-add').onclick = () => form.elements.receiptPictures.click();
    form.elements.receiptPictures.onchange = async event => {
      const selected = [...event.target.files]; event.target.value = '';
      if (selected.length + files.length > 6 || selected.some(file => !['image/jpeg', 'image/png'].includes(file.type) || file.size === 0 || file.size > 10 * 1024 * 1024)) {
        const error = form.querySelector('.ws-form-error'); error.hidden = false; error.textContent = '最多六张 JPEG/PNG 图片，每张不超过 10 MB。'; return;
      }
      for (const blob of selected) { if (!alive()) break; const url = URL.createObjectURL(blob); urls.push(url); const file = { blob, url, state: 'UPLOADING' }; files.push(file); await upload(file); }
    };
    form.addEventListener('input', update);
    form.addEventListener('click', event => {
      if (uploading) return;
      const retry = event.target.closest('[data-upload-retry]'); if (retry) void upload(files[Number(retry.dataset.uploadRetry)]);
      const remove = event.target.closest('[data-upload-remove]'); if (remove) { files.splice(Number(remove.dataset.uploadRemove), 1); draw(); }
    });
  }
  editor.dialog.addEventListener('close', () => urls.forEach(url => URL.revokeObjectURL(url)));
  void hydrateImages(context, form); update();
}

export async function renderStore(context) {
  const storeId = context.user.scope?.storeId;
  if (!storeId || !['STORE', 'STORE_FINANCE'].includes(context.user.scope.type)) throw new Error('账号尚未配置所属门店。');
  const rows = await context.get('/purchase-requests');
  const writable = context.user.roles.includes('STORE') && !context.client.pendingCommand;
  renderTable(context, { title: '门店订单', rows, columns: ['单号', '状态', '货款', '日期'], create: writable ? async () => {
    try { const store = await context.get(`/stores/${storeId}`); if (context.active()) await openPurchaseDraft(context, [store]); }
    catch (failure) { context.notice(failure.message, true); }
  } : null, cells: item => [esc(item.requestNo), status(item.status), esc(item.salesGoodsAmount), esc(new Date(item.submittedAt).toLocaleDateString('zh-CN'))],
  actions: item => iconButton('arrow-up-right', '打开订单', `data-store-order="${esc(item.id)}"`) });
  if (!context.active()) return;
  const create = context.view.querySelector('#ws-create'); if (create) create.textContent = '下单';
  context.view.insertAdjacentHTML('beforeend', '<section id="ws-store-detail" class="ws-detail"></section>');
  if (context.client.pendingCommand) {
    context.view.querySelector('.ws-heading').insertAdjacentHTML('afterend', '<div class="ws-command"><span>有一笔提交尚未确认</span><button id="ws-recover" class="ws-secondary">查询提交结果</button></div>');
    document.getElementById('ws-recover').onclick = async event => { event.currentTarget.disabled = true; try { await context.command(null, null, true); await context.refresh(); } catch (failure) { context.notice(failure.message, true); if (context.active()) event.target.disabled = false; } };
  }
  let sequence = 0;
  context.view.addEventListener('click', async event => {
    const order = event.target.closest('[data-store-order]'); const shipment = event.target.closest('[data-store-shipment]'); if (!order && !shipment) return;
    const button = order || shipment; const current = ++sequence; button.disabled = true;
    try {
      if (shipment) { const detail = await context.get(`/shipments/${shipment.dataset.storeShipment}`); if (context.active() && current === sequence) openReceipt(context, detail); return; }
      const detail = await context.get(`/purchase-requests/${order.dataset.storeOrder}`); if (!context.active() || current !== sequence) return;
      document.getElementById('ws-store-detail').innerHTML = `<h2>${esc(detail.requestNo)}</h2><p>${status(detail.status)} · 货款 ${esc(detail.salesGoodsAmount)}</p><dl><dt>已支付</dt><dd>${esc(detail.paidAmount)}</dd><dt>储值冻结</dt><dd>${esc(detail.storedReservedAmount ?? '0.00')}</dd><dt>待补资金</dt><dd>${esc(detail.shortfallAmount)}</dd></dl>`
        + '<div class="ws-table-wrap"><table><thead><tr><th>商品</th><th>数量</th><th>销售单价</th><th>金额</th></tr></thead><tbody>'
        + detail.items.map(item => `<tr><td>${esc(item.productName)}</td><td>${esc(item.quantity)} ${esc(item.unitName || '历史单位未记录')}</td><td>${esc(item.salesUnitPrice)}</td><td>${esc(item.salesLineAmount)}</td></tr>`).join('') + '</tbody></table></div>'
        + (detail.supplierOrders || []).map(supplierOrder => `<h3>${esc(supplierOrder.supplierName)} · ${status(supplierOrder.status)}</h3>` + supplierOrder.shipments.map(sent => `<div class="ws-todo"><div><strong>${esc(sent.shipmentNo)}</strong><small>${esc(sent.trackingNo || '无物流单号')} · ${sent.receiptRevision ? `已收货 · 版本 ${esc(sent.receiptRevision)}` : '待收货'}</small></div>${iconButton('package-check', sent.receiptRevision ? '查看收货' : '收货', `data-store-shipment="${esc(sent.id)}"`)}</div>`).join('')).join(''); icons();
    } catch (failure) { if (context.active() && current === sequence) context.notice(failure.message, true); }
    finally { button.disabled = false; }
  });
}
