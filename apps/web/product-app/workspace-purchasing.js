import { esc } from './ui.js';
import { field } from './workspace-management.js';
import { icons, iconButton, openEditor } from './workspace.js';
import { hydrateImages } from './workspace-media.js';

export function purchasingSignature(quote) {
  return JSON.stringify({ templateId: quote.templateId, items: quote.items.map(item => [item.productId, item.requestItemId, item.supplierId,
    item.targetSupplierId, item.eligible, item.quantity, item.salesUnitPrice, item.supplyUnitPrice,
    item.salesLineAmount, item.supplyLineAmount, item.priceVersionId, item.supplyPriceVersionId, item.unitSnapshot]),
  totals: quote.totals, funding: quote.funding });
}

const label = item => `${item.product.name}${item.product.sku ? ` / ${item.product.sku}` : ''}`;
const options = choices => choices.map(([value, name]) => `<option value="${esc(value)}">${esc(name)}</option>`).join('');

export function repairDraftLines(detail, catalog) {
  return detail.items.map(item => {
    const entry = catalog.items.find(row => row.product.id === item.productId);
    const snapshot = item.unitSnapshot;
    const inputUnit = snapshot?.inputUnitId || entry?.product.baseUnitId || '';
    const product = entry?.product;
    const unitChanged = product && ((snapshot?.salesUnitId && snapshot.salesUnitId !== product.baseUnitId)
      || (inputUnit !== product.baseUnitId && (inputUnit !== product.purchaseUnitConversion?.purchaseUnitId
        || snapshot?.salesUnitsPerPurchaseUnit !== product.purchaseUnitConversion?.salesUnitsPerPurchaseUnit)));
    return { productId: item.productId, productName: item.productName || '-',
      unavailable: !entry, supplierId: entry?.suppliers.some(supplier => supplier.supplierId === item.supplierId) ? item.supplierId : '',
      quantity: snapshot?.inputQuantity || item.quantity, unitId: unitChanged ? '' : inputUnit };
  });
}
function quoteMarkup(quote, names, storeOrder = false) {
  return `<div class="ws-table-wrap"><table><thead><tr><th>商品</th><th>销售数量</th><th>销售单价</th>${storeOrder ? '' : '<th>供货单价</th>'}<th>销售额</th></tr></thead><tbody>`
    + quote.items.map(item => `<tr><td>${esc(names.get(item.productId) || '-')}</td><td>${esc(item.quantity)}</td><td>${esc(item.salesUnitPrice)}</td>${storeOrder ? '' : `<td>${esc(item.supplyUnitPrice)}</td>`}<td>${esc(item.salesLineAmount)}</td></tr>`).join('') + '</tbody></table></div>'
    + `<p>销售货款 ${esc(quote.totals.salesGoodsAmount)}${storeOrder ? '' : ` · 供货货款 ${esc(quote.totals.supplyGoodsAmount)}`}</p>`
    + (quote.funding ? `<p>储值预冻结 ${esc(quote.funding.stored.required)} · 可用储值 ${esc(quote.funding.stored.available)} · 储值待补 ${esc(quote.funding.stored.shortfall)} · 挂账待补 ${esc(quote.funding.credit?.shortfall || '0.00')}</p>` : '');
}

export async function openPurchaseDraft(context, stores, detail = null) {
  let catalog;
  let lines = [];
  let revision = 0;
  let quote = null;
  const editing = Boolean(detail);
  const storeOrder = context.route === 'store' && !editing;
  const content = field('storeId', '门店', detail?.storeId || (storeOrder ? context.user.scope.storeId : ''), { required: true, disabled: editing || storeOrder,
    choices: [['', '请选择门店'], ...stores.filter(store => store.status === 'ACTIVE' || store.id === detail?.storeId).map(store => [store.id, store.name])] })
    + (editing ? field('reason', '修改原因', '', { required: true, max: 300 }) : '')
    + '<div class="ws-wide ws-draft"><div class="ws-draft-picker"><label>商品搜索<input id="ws-draft-search" type="search"></label><label>分类<select id="ws-draft-category"><option value="">全部</option></select></label><label>商品<select id="ws-draft-product"></select></label>'
    + iconButton('plus', '添加商品', 'id="ws-draft-add"') + '</div><div id="ws-draft-lines"></div><div class="ws-actions"><button type="button" class="ws-secondary" id="ws-draft-preview"><i data-lucide="calculator"></i>预览金额</button></div><div id="ws-draft-quote" class="ws-draft-quote"></div></div>';
  const editor = openEditor(context, editing ? `${detail.requestNo} · 编辑商品` : storeOrder ? '门店下单' : '代门店下单', content, async (_data, form) => {
    if (!quote) throw new Error('请先预览金额。');
    const approved = quote; const current = revision;
    const body = readBody();
    const fresh = await preview(body);
    if (!alive() || revision !== current) throw new Error('商品已变化，请重新预览。');
    if (purchasingSignature(fresh) !== purchasingSignature(approved)) {
      showQuote(fresh); throw new Error('价格或资金信息已变化，请核对新预览后再次提交。');
    }
    body.items = body.items.map(item => {
      const price = fresh.items.find(row => row.productId === item.productId);
      return { ...item, expectedPriceVersionId: price.priceVersionId, expectedSupplyPriceVersionId: price.supplyPriceVersionId };
    });
    if (!editing) body.expectedTemplateId = fresh.templateId;
    form.querySelector('fieldset').disabled = true;
    try {
      await context.command(editing ? `/purchase-requests/${detail.id}/items` : '/purchase-requests', body, false, editing ? 'PATCH' : 'POST');
      await context.refresh();
    } finally {
      form.querySelector('fieldset').disabled = false;
      if (context.client.pendingCommand) form.querySelector('[type="submit"]').disabled = true;
    }
  });
  const form = editor.form;
  const submit = form.querySelector('[type="submit"]');
  submit.textContent = editing ? '保存商品' : '提交申请'; submit.disabled = true;
  const error = message => { const box = form.querySelector('.ws-form-error'); box.hidden = false; box.textContent = message; };
  const alive = () => editor.dialog.isConnected && context.active();
  const invalidate = () => { revision += 1; quote = null; submit.disabled = true; form.querySelector('#ws-draft-quote').innerHTML = ''; };
  function drawPicker() {
    const query = form.querySelector('#ws-draft-search').value.trim().toLocaleLowerCase();
    const category = form.querySelector('#ws-draft-category').value;
    const choices = (catalog?.items || []).filter(item => !lines.some(line => line.productId === item.product.id)
      && (!category || category === item.product.categoryId) && label(item).toLocaleLowerCase().includes(query));
    form.querySelector('#ws-draft-product').innerHTML = options(choices.length ? choices.map(item => [item.product.id, label(item)]) : [['', '暂无可选商品']]);
    form.querySelector('#ws-draft-add').disabled = !choices.length;
  }
  function drawLines() {
    form.querySelector('#ws-draft-lines').innerHTML = lines.map(line => {
      const item = catalog.items.find(row => row.product.id === line.productId);
      if (!item) return `<div class="ws-draft-line" data-draft-line="${esc(line.productId)}"><div class="ws-draft-name"><strong>${esc(line.productName)}</strong><small>商品已失效 · 原数量 ${esc(line.quantity)}</small></div>`
        + iconButton('trash-2', '移除失效商品', `data-draft-remove="${esc(line.productId)}"`) + '</div>';
      const product = item.product;
      const units = [...(!line.unitId ? [['', '重新选择单位']] : []), [product.baseUnitId, product.unitName], ...(product.purchaseUnitConversion ? [[product.purchaseUnitConversion.purchaseUnitId, product.purchaseUnitName]] : [])];
      return `<div class="ws-draft-line" data-draft-line="${esc(product.id)}"><div class="ws-draft-name">${storeOrder && product.imageFileId ? `<img data-image="${esc(product.imageFileId)}" alt="${esc(product.name)}" hidden>` : ''}<strong>${esc(product.name)}</strong><small>${esc(product.specification || '')}</small></div>`
        + field(`quantity:${product.id}`, '数量', line.quantity, { type: 'number', min: '0.000001', step: '0.000001', required: true })
        + field(`unit:${product.id}`, '单位', line.unitId, { required: true, choices: units })
        + (editing ? field(`supplier:${product.id}`, '供应商', line.supplierId, { required: true, choices: [['', '请选择有效供应商'], ...item.suppliers.map(supplier => [supplier.supplierId, supplier.supplierName])] }) : '')
        + iconButton('trash-2', '移除商品', `data-draft-remove="${esc(product.id)}"`) + '</div>';
    }).join('') || '<p class="ws-existing">暂无商品</p>';
    drawPicker(); icons(); if (storeOrder) void hydrateImages(context, form.querySelector('#ws-draft-lines'));
  }
  function readBody() {
    if (!catalog || !lines.length) throw new Error('请选择门店并添加商品。');
    if (lines.some(line => line.unavailable)) throw new Error('请移除失效商品，并核对替代商品及数量。');
    const items = lines.map(line => {
      const product = catalog.items.find(row => row.product.id === line.productId).product;
      return { productId: product.id, quantity: form.elements[`quantity:${product.id}`].value,
        unitId: form.elements[`unit:${product.id}`].value, expectedProductVersion: product.version,
        ...(editing ? { supplierId: form.elements[`supplier:${product.id}`].value } : {}) };
    });
    return editing ? { expectedVersion: detail.version, reason: form.elements.reason.value.trim(), items } : { storeId: catalog.storeId, items };
  }
  function preview(body) {
    return context.client.request(editing ? `/purchase-requests/${detail.id}/items-preview` : '/purchase-requests/preview', { method: 'POST', body });
  }
  function showQuote(result) {
    quote = result;
    const box = form.querySelector('.ws-form-error'); box.hidden = true; box.textContent = '';
    const names = new Map(catalog.items.map(item => [item.product.id, item.product.name]));
    form.querySelector('#ws-draft-quote').innerHTML = quoteMarkup(result, names, storeOrder);
    form.querySelector('#ws-draft-quote').scrollIntoView({ block: 'nearest' });
    submit.disabled = Boolean(context.client.pendingCommand);
  }
  async function loadCatalog() {
    invalidate(); const current = revision;
    catalog = null; lines = []; drawPicker(); form.querySelector('#ws-draft-lines').innerHTML = '';
    const id = form.elements.storeId.value;
    if (!id) return;
    try {
      const result = await context.get(editing ? `/purchase-requests/${detail.id}/edit-catalog` : `/stores/${id}/catalog`);
      if (!alive() || current !== revision) return;
      if (editing && result.templateId !== detail.templateId) throw new Error('门店模板已变化，请核对原申请模板后再编辑。');
      catalog = result;
      if (editing) lines = repairDraftLines(detail, catalog);
      const categories = new Map(catalog.items.map(item => [item.product.categoryId, item.product.categoryName]));
      form.querySelector('#ws-draft-category').innerHTML = options([['', '全部'], ...categories]);
      drawLines();
    } catch (failure) { if (alive() && current === revision) { catalog = null; lines = []; error(failure.message); } }
  }
  form.elements.storeId.onchange = loadCatalog;
  form.querySelector('#ws-draft-search').oninput = drawPicker;
  form.querySelector('#ws-draft-category').onchange = drawPicker;
  form.querySelector('#ws-draft-add').onclick = () => {
    const id = form.querySelector('#ws-draft-product').value;
    const item = catalog?.items.find(row => row.product.id === id); if (!item || lines.some(line => line.productId === id)) return;
    lines.push({ productId: id, quantity: item.product.minOrderQty, unitId: item.product.baseUnitId, supplierId: item.suppliers[0]?.supplierId || '' });
    invalidate(); drawLines();
  };
  form.addEventListener('click', event => {
    const remove = event.target.closest('[data-draft-remove]'); if (!remove) return;
    lines = lines.filter(line => line.productId !== remove.dataset.draftRemove); invalidate(); drawLines();
  });
  form.addEventListener('input', event => {
    if (!event.target.closest('[data-draft-line]')) return;
    const id = event.target.closest('[data-draft-line]').dataset.draftLine;
    const line = lines.find(row => row.productId === id);
    if (line.unavailable) return;
    line.quantity = form.elements[`quantity:${id}`].value; line.unitId = form.elements[`unit:${id}`].value;
    if (editing) line.supplierId = form.elements[`supplier:${id}`].value;
    invalidate();
  });
  form.elements.reason?.addEventListener('input', invalidate);
  form.querySelector('#ws-draft-preview').onclick = async event => {
    if (!form.reportValidity()) return;
    const current = revision; const button = event.currentTarget; button.disabled = true;
    try { const result = await preview(readBody()); if (alive() && revision === current) showQuote(result); }
    catch (failure) { if (alive() && revision === current) { invalidate(); error(failure.message); } }
    finally { button.disabled = false; }
  };
  drawPicker(); if (editing || storeOrder) await loadCatalog();
}

export function openBatchAssignment(context, detail, suppliers, products) {
  let quote = null;
  let revision = 0;
  const categories = [...new Set(detail.items.map(item => products.find(product => product.id === item.productId)?.categoryId).filter(Boolean))];
  const editor = openEditor(context, `${detail.requestNo} · 分配供应商`,
    field('supplierId', '目标供应商', '', { required: true, choices: [['', '请选择'], ...suppliers.filter(item => item.status === 'ACTIVE' && !item.isArchived).map(item => [item.id, item.name])] })
    + '<div class="ws-wide ws-check-list">' + detail.items.map(item => `<label><input type="checkbox" name="itemIds" value="${esc(item.id)}">${esc(item.productName || products.find(product => product.id === item.productId)?.name || '-')}<small>${esc(item.quantity)}</small></label>`).join('') + '</div>'
    + '<div class="ws-wide ws-actions"><button type="button" id="ws-assign-all" class="ws-secondary">全选</button><button type="button" id="ws-assign-preview" class="ws-secondary"><i data-lucide="calculator"></i>预览分配</button></div><div id="ws-assign-quote" class="ws-wide"></div>',
    async (_data, form) => {
      if (!quote || quote.items.some(item => !item.eligible)) throw new Error('请先预览并选择全部可分配的商品。');
      const approved = quote; const current = revision;
      const body = readBody();
      const fresh = await preview(body);
      if (!editor.dialog.isConnected || !context.active() || revision !== current) throw new Error('所选商品已变化，请重新预览。');
      if (purchasingSignature(fresh) !== purchasingSignature(approved)) { showQuote(fresh); throw new Error('分配报价已变化，请核对后再次提交。'); }
      body.expectedPrices = fresh.items.map(item => ({ requestItemId: item.requestItemId, priceVersionId: item.priceVersionId, supplyPriceVersionId: item.supplyPriceVersionId }));
      form.querySelector('fieldset').disabled = true;
      try { await context.command(`/purchase-requests/${detail.id}/assign`, body); await context.refresh(); }
      finally { form.querySelector('fieldset').disabled = false; if (context.client.pendingCommand) form.querySelector('[type="submit"]').disabled = true; }
    });
  const form = editor.form; const submit = form.querySelector('[type="submit"]'); submit.textContent = '确认分配'; submit.disabled = true;
  function readBody() {
    const data = new FormData(form); const itemIds = data.getAll('itemIds');
    if (!itemIds.length) throw new Error('请选择需要分配的商品。');
    return { expectedVersion: detail.version, supplierId: data.get('supplierId'), itemIds };
  }
  function preview(body) { return context.client.request(`/purchase-requests/${detail.id}/reassign-preview`, { method: 'POST', body }); }
  function showQuote(result) {
    quote = result;
    form.querySelector('#ws-assign-quote').innerHTML = result.items.map(item => `<p>${esc(products.find(product => product.id === item.productId)?.name || '-')} · ${item.eligible ? `销售 ${esc(item.salesLineAmount)} / 供货 ${esc(item.supplyLineAmount)}` : esc(item.reason === 'PRICE_NOT_AVAILABLE' ? '未发布有效价格' : '该供应商不能供货')}</p>`).join('');
    submit.disabled = result.items.some(item => !item.eligible) || Boolean(context.client.pendingCommand);
  }
  const invalidate = () => { revision += 1; quote = null; submit.disabled = true; form.querySelector('#ws-assign-quote').innerHTML = ''; };
  form.addEventListener('change', invalidate);
  form.querySelector('#ws-assign-all').onclick = () => { form.querySelectorAll('[name="itemIds"]').forEach(input => { input.checked = true; }); invalidate(); };
  form.querySelector('#ws-assign-preview').onclick = async event => {
    if (!form.reportValidity()) return;
    const current = revision; const button = event.currentTarget; button.disabled = true;
    try { const result = await preview(readBody()); if (editor.dialog.isConnected && context.active() && revision === current) showQuote(result); }
    catch (failure) { if (editor.dialog.isConnected && context.active() && revision === current) { const box = form.querySelector('.ws-form-error'); box.hidden = false; box.textContent = failure.message; } }
    finally { button.disabled = false; }
  };
  if (categories.length) {
    const choices = categories.map(id => [id, products.find(product => product.categoryId === id)?.categoryName || `分类 ${categories.indexOf(id) + 1}`]);
    form.querySelector('.ws-check-list').insertAdjacentHTML('beforebegin', field('assignmentCategory', '商品分类', '', { choices: [['', '全部'], ...choices], wide: true }));
    form.elements.assignmentCategory.onchange = () => {
      form.querySelectorAll('[name="itemIds"]').forEach(input => { const item = detail.items.find(row => row.id === input.value); input.checked = !form.elements.assignmentCategory.value || products.find(product => product.id === item.productId)?.categoryId === form.elements.assignmentCategory.value; }); invalidate();
    };
  }
  icons();
}
