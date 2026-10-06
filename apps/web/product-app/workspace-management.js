import { esc } from './ui.js';
import { canEdit } from './workspace-session.js';
import { iconButton, icons, openEditor } from './workspace.js';
import { mountCrop, hydrateImages } from './workspace-media.js';
import { addressFields, composeAddress, mountAddress, splitAddress } from './workspace-address.js';

export const settlementModes = [['STORED_VALUE', '储值余额'], ['CREDIT', '挂账'], ['SUPPLIER_TERM', '供应商账期'], ['COMPANY_TERM', '公司账期']];
export const cycles = [['IMMEDIATE', '现结'], ['WEEKLY', '周结'], ['HALF_MONTHLY', '半月结'], ['MONTHLY', '月结']];
const storageConditions = [['', '未设置'], ['AMBIENT', '常温'], ['CHILLED', '冷藏'], ['FROZEN', '冷冻'], ['WARM', '保温']];
const statusChoices = [['ACTIVE', '启用'], ['DISABLED', '停用']];
const storeTypes = [['', '请选择'], ['DIRECT', '直营店'], ['FRANCHISE', '加盟店'], ['JOINT', '联营店']];
const supplierTypes = [['', '未设置'], ['HEADQUARTERS', '总部对接'], ['DIRECT', '直送门店']];
const findLabel = (choices, value) => choices.find(([key]) => key === value)?.[1] || value || '未设置';
const names = (items, id) => items.find(item => item.id === id)?.name || '未找到';
const text = value => esc(value || '-');
const selectOptions = (items, value) => items.map(([key, label]) => `<option value="${esc(key)}" ${key === value ? 'selected' : ''}>${esc(label)}</option>`).join('');
export function field(name, label, value = '', options = {}) {
  const attributes = `name="${name}" ${options.required ? 'required' : ''} ${options.disabled ? 'disabled' : ''} ${options.placeholder == null ? '' : `placeholder="${esc(options.placeholder)}"`}`;
  const control = options.choices ? `<select ${attributes}>${selectOptions(options.choices, value)}</select>`
    : options.textarea ? `<textarea ${attributes} maxlength="${options.max || 500}">${esc(value)}</textarea>`
    : `<input ${attributes} type="${options.type || 'text'}" value="${esc(value)}" ${options.type === 'number' ? `min="${options.min ?? 0}" step="${options.step || 'any'}"` : ''} maxlength="${options.max || 240}">`;
  return `<label class="${options.wide ? 'ws-wide' : ''}"><span class="ws-field-label">${esc(label)}${options.required ? '<span class="ws-required"> *</span>' : ''}</span>${control}</label>`;
}

export function renderTable(context, { title, rows, columns, cells, edit, create, actions, afterDraw, filters = [] }) {
  if (!context.active()) return;
  context.view.innerHTML = `<div class="ws-heading"><h1>${esc(title)}</h1><div class="ws-actions">${iconButton('refresh-cw', '刷新', 'id="ws-refresh"')}${create ? '<button id="ws-create" class="ws-primary"><i data-lucide="plus"></i>新增</button>' : ''}</div></div>
    <div class="ws-toolbar"><label class="ws-search"><i data-lucide="search"></i><input id="ws-search" type="search" aria-label="搜索${esc(title)}" placeholder="搜索关键词"></label>${filters.map(filter => `<label class="ws-filter"><span>${esc(filter.label)}</span><select data-filter="${esc(filter.key)}">${selectOptions([['', '全部'], ...filter.choices], '')}</select></label>`).join('')}${iconButton('rotate-ccw', '重置搜索和筛选', 'id="ws-reset-search"')}</div>
    <div class="ws-table-wrap"><table><thead><tr>${columns.map(label => `<th>${esc(label)}</th>`).join('')}${edit || actions ? '<th class="ws-action-col">操作</th>' : ''}</tr></thead><tbody id="ws-rows"></tbody></table></div>
    <div class="ws-pagination"><div class="ws-page-summary"><span id="ws-count" role="status"></span><label>每页<select id="ws-page-size" aria-label="每页条数">${[10, 20, 50, 100].map(size => `<option value="${size}">${size} 条</option>`).join('')}</select></label></div><div class="ws-page-controls">${iconButton('chevrons-left', '首页', 'id="ws-first"')}${iconButton('chevron-left', '上一页', 'id="ws-prev"')}<label class="ws-page-jump"><input id="ws-page-number" type="number" min="1" step="1" aria-label="页码"><span id="ws-page-label"></span></label>${iconButton('chevron-right', '下一页', 'id="ws-next"')}${iconButton('chevrons-right', '末页', 'id="ws-last"')}</div></div>`;
  let page = 0;
  let pageSize = 10;
  let filtered = rows;
  const draw = () => {
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.max(0, Math.min(page, pageCount - 1));
    document.getElementById('ws-rows').innerHTML = filtered.slice(page * pageSize, (page + 1) * pageSize).map(item => `<tr>${cells(item).map(cell => `<td>${cell}</td>`).join('')}
      ${edit || actions ? `<td class="ws-row-actions">${edit && !item.isArchived ? iconButton('pencil', '编辑', `data-edit="${esc(item.id)}"`) : ''}${actions ? actions(item) : ''}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${columns.length + (edit || actions ? 1 : 0)}" class="ws-empty">暂无匹配记录</td></tr>`;
    document.getElementById('ws-count').textContent = `${filtered.length} 条记录`;
    document.getElementById('ws-page-label').textContent = `/ ${pageCount} 页`;
    const pageNumber = document.getElementById('ws-page-number');
    pageNumber.value = String(page + 1); pageNumber.max = String(pageCount);
    pageNumber.disabled = filtered.length === 0;
    document.getElementById('ws-prev').disabled = page === 0;
    document.getElementById('ws-first').disabled = page === 0;
    document.getElementById('ws-next').disabled = page >= pageCount - 1;
    document.getElementById('ws-last').disabled = page >= pageCount - 1;
    context.view.querySelectorAll('[data-edit]').forEach(button => { button.onclick = () => edit(rows.find(item => item.id === button.dataset.edit)); });
    icons();
    afterDraw?.();
  };
  const filterRows = () => {
    const query = document.getElementById('ws-search').value.toLocaleLowerCase().trim();
    filtered = rows.filter(item => [item.name, item.code, item.sku, item.requestNo, item.supplierOrderNo, item.contactName, item.contactPhone, item.groupName, item.searchText].some(value => String(value || '').toLocaleLowerCase().includes(query))
      && [...context.view.querySelectorAll('[data-filter]')].every(select => !select.value || item[select.dataset.filter] === select.value));
    page = 0; draw();
  };
  document.getElementById('ws-search').oninput = filterRows;
  context.view.querySelectorAll('[data-filter]').forEach(select => { select.onchange = filterRows; });
  document.getElementById('ws-reset-search').onclick = () => {
    document.getElementById('ws-search').value = '';
    context.view.querySelectorAll('[data-filter]').forEach(select => { select.value = ''; });
    filterRows();
  };
  document.getElementById('ws-page-size').onchange = event => {
    const size = Number(event.target.value);
    if (![10, 20, 50, 100].includes(size)) return;
    pageSize = size; page = 0; draw();
  };
  document.getElementById('ws-page-number').onchange = event => {
    const value = Number(event.target.value);
    if (Number.isInteger(value) && value >= 1) page = value - 1;
    draw();
  };
  document.getElementById('ws-page-number').onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
  };
  document.getElementById('ws-refresh').onclick = context.refresh;
  document.getElementById('ws-create')?.addEventListener('click', () => create());
  document.getElementById('ws-prev').onclick = () => { page -= 1; draw(); };
  document.getElementById('ws-next').onclick = () => { page += 1; draw(); };
  document.getElementById('ws-first').onclick = () => { page = 0; draw(); };
  document.getElementById('ws-last').onclick = () => { page = Math.ceil(filtered.length / pageSize) - 1; draw(); };
  draw();
}

const values = (data, fields) => Object.fromEntries(fields.map(key => [key, String(data.get(key) || '').trim()]));
const nullable = value => value || null;
const profileDetails = (context, title, entries) => openEditor(context, title, '<dl class="ws-profile-details ws-wide">' + entries.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${text(value)}</dd>`).join('') + '</dl>');

async function products(context) {
  const [rows, categories, units, brands] = await Promise.all([context.get('/products'), context.get('/categories'), context.get('/units'), context.get('/brands')]);
  const editable = canEdit(context.user, 'products');
  const conversionEditor = item => {
    const conversion = item.purchaseUnitConversion;
    const editor = openEditor(context, `${item.name} · 采购单位`,
      '<label class="ws-checkbox ws-wide"><input name="enabled" type="checkbox" ' + (conversion ? 'checked' : '') + '>启用采购单位</label>'
      + field('purchaseUnitId', '采购单位', conversion?.purchaseUnitId || '', { choices: [['', '请选择'], ...units.filter(unit => unit.id !== item.baseUnitId).map(unit => [unit.id, unit.name])] })
      + field('ratio', `每采购单位的${names(units, item.baseUnitId)}数`, conversion?.salesUnitsPerPurchaseUnit || '', { type: 'number', min: '0.00000001', step: '0.00000001' }), async (data, form) => {
      const body = { expectedVersion: item.version, conversion: data.has('enabled') ? { purchaseUnitId: data.get('purchaseUnitId'), salesUnitsPerPurchaseUnit: String(data.get('ratio')).trim() } : null };
      await context.save(`/products/${item.id}/purchase-unit`, 'PATCH', body, form); await context.refresh();
    });
    const toggle = editor.form.elements.enabled;
    const sync = () => { for (const name of ['purchaseUnitId', 'ratio']) { editor.form.elements[name].disabled = !toggle.checked; editor.form.elements[name].required = toggle.checked; } };
    toggle.onchange = sync; sync();
  };
  const edit = item => {
    if (!context.active()) return;
    const content = field('sku', '货号', item?.sku, { max: 100 })
      + field('name', '商品名称', item?.name, { required: true })
      + field('categoryId', '商品分类', item?.categoryId, { required: true, choices: [['', '请选择'], ...categories.map(category => [category.id, category.parentId ? `${names(categories, category.parentId)} / ${category.name}` : category.name])] })
      + field('baseUnitId', '销售单位', item?.baseUnitId, { required: true, choices: [['', '请选择'], ...units.map(unit => [unit.id, unit.name])] })
      + field('defaultSalesPrice', '默认销售价', item?.defaultSalesPrice ?? '', { required: !item || item.defaultSalesPrice != null, type: 'number', step: '0.000001' })
      + field('specification', '规格', item?.specification)
      + field('barcode', '条码', item?.barcode, { max: 100 })
      + field('brandId', '品牌', item?.brandId || (item?.brand ? `legacy:${item.brand}` : ''), { choices: [['', '未设置'], ...(item?.brand && !item.brandId ? [[`legacy:${item.brand}`, item.brand]] : []), ...brands.map(brand => [brand.id, brand.name])] })
      + field('storageCondition', '储存条件', item?.storageCondition || '', { choices: storageConditions })
      + field('minOrderQty', '起订量', item?.minOrderQty || '1', { required: true, type: 'number', min: '0.000001', step: '0.000001' })
      + field('orderMultiple', '订货倍数', item?.orderMultiple || '1', { required: true, type: 'number', min: '0.000001', step: '0.000001' })
      + (item ? '<label class="ws-checkbox ws-wide"><input name="isActive" type="checkbox" ' + (item.isActive ? 'checked' : '') + '>启用商品</label>' : '')
      + `<div class="ws-picture ws-wide">${item?.imageFileId ? `<img data-current-image data-image="${esc(item.imageFileId)}" alt="当前商品图片" hidden>` : ''}<label>商品图片<input name="picture" type="file" accept="image/jpeg,image/png"></label><canvas width="800" height="800" aria-label="商品图片裁切" hidden></canvas><label hidden>缩放<input name="pictureZoom" type="range" min="1" max="3" step="0.01" value="1"></label><button class="ws-secondary" type="button" data-remove-image>移除图片</button><span class="ws-image-error" role="alert"></span></div>`;
    let crop;
    const editor = openEditor(context, item ? '编辑商品' : '新增商品', content, async (data, form) => {
      const body = values(data, ['sku', 'name', 'categoryId', 'baseUnitId', 'defaultSalesPrice', 'minOrderQty', 'orderMultiple', 'specification', 'barcode', 'brandId', 'storageCondition']);
      body.sku = nullable(body.sku);
      if (!body.defaultSalesPrice && item?.defaultSalesPrice == null) delete body.defaultSalesPrice;
      for (const key of ['specification', 'barcode', 'storageCondition']) body[key] = nullable(body[key]);
      if (body.brandId.startsWith('legacy:')) { body.brand = item.brand; delete body.brandId; }
      else body.brandId = nullable(body.brandId);
      if (item) { body.expectedVersion = item.version; body.isActive = data.has('isActive'); }
      const imageFileId = await crop.imageFileId(context);
      if (imageFileId !== undefined) body.imageFileId = imageFileId;
      if (!context.active()) throw new Error('请重新打开商品资料。');
      await context.save(item ? `/products/${item.id}` : '/products', item ? 'PATCH' : 'POST', body, form);
      await context.refresh();
    });
    crop = mountCrop(editor);
    hydrateImages(context, editor.form);
  };
  renderTable(context, { title: '商品资料', rows: rows.map(item => ({ ...item, searchText: `${item.barcode || ''} ${item.brand || ''}` })), columns: ['商品 / 货号', '分类', '品牌 / 条码', '规格', '单位', '默认销售价', '起订量 / 倍数', '状态'],
    cells: item => [`<div class="ws-product">${item.imageFileId ? `<img data-image="${esc(item.imageFileId)}" alt="${esc(item.name)}" hidden>` : ''}<span><strong>${text(item.name)}</strong><small>${text(item.sku)}</small></span></div>`, text(names(categories, item.categoryId)), `<strong>${text(item.brand)}</strong><small>${text(item.barcode)}</small>`, text(item.specification), text(names(units, item.baseUnitId)) + (item.purchaseUnitConversion ? `<small>1 ${text(names(units, item.purchaseUnitConversion.purchaseUnitId))} = ${text(item.purchaseUnitConversion.salesUnitsPerPurchaseUnit)} ${text(names(units, item.baseUnitId))}</small>` : ''), item.defaultSalesPrice == null ? '未设置' : text(item.defaultSalesPrice), `${text(item.minOrderQty)} / ${text(item.orderMultiple)}`, item.isActive ? '启用' : '停用'],
    edit: editable ? edit : null, create: editable && categories.length && units.length ? () => edit() : null,
    actions: editable ? item => iconButton('arrow-left-right', '采购单位换算', `data-conversion="${esc(item.id)}"`) : null,
    afterDraw: () => hydrateImages(context, context.view) });
  if (editable) {
    context.view.addEventListener('click', event => { const button = event.target.closest('[data-conversion]'); if (button) conversionEditor(rows.find(item => item.id === button.dataset.conversion)); });
    const actions = context.view.querySelector('.ws-heading .ws-actions');
    actions.insertAdjacentHTML('afterbegin', '<button id="ws-category-create" class="ws-secondary">新增分类</button><button id="ws-unit-create" class="ws-secondary">新增单位</button>');
    document.getElementById('ws-category-create').onclick = () => openEditor(context, '新增分类', field('code', '分类编号', '', { required: true, max: 80 }) + field('name', '分类名称', '', { required: true, max: 160 })
      + field('parentId', '上级分类', '', { choices: [['', '一级分类'], ...categories.filter(category => !category.parentId).map(category => [category.id, category.name])] }), async (data, form) => {
      const body = values(data, ['code', 'name']); if (data.get('parentId')) body.parentId = data.get('parentId');
      await context.save('/categories', 'POST', body, form); await context.refresh();
    });
    document.getElementById('ws-unit-create').onclick = () => openEditor(context, '新增单位', field('code', '单位编号', '', { required: true, max: 40 }) + field('name', '单位名称', '', { required: true, max: 80 }), async (data, form) => {
      await context.save('/units', 'POST', values(data, ['code', 'name']), form); await context.refresh();
    });
  }
}

async function registry(context) {
  const resource = context.route;
  const [rows, products] = await Promise.all([context.get(`/${resource}`), context.get('/products')]);
  const title = { categories: '商品分类', brands: '商品品牌', units: '商品单位' }[resource];
  const editable = canEdit(context.user, resource);
  const edit = item => {
    let content = resource === 'brands' ? '' : field('code', '编号', item?.code, { required: true, disabled: Boolean(item), max: resource === 'units' ? 40 : 80 });
    content += field('name', '名称', item?.name, { required: true, max: resource === 'categories' ? 160 : resource === 'brands' ? 120 : 80 });
    if (resource === 'categories') content += field('parentId', '上级分类', item?.parentId || '', { choices: [['', '一级分类'], ...rows.filter(row => !row.parentId && row.id !== item?.id).map(row => [row.id, row.name])] }) + field('sortOrder', '排序', item?.sortOrder || '0', { type: 'number', step: '1' });
    openEditor(context, `${item ? '编辑' : '新增'}${title}`, content, async (data, form) => {
      const body = values(data, ['name']);
      if (item) body.expectedVersion = item.version;
      else if (resource !== 'brands') body.code = String(data.get('code')).trim();
      if (resource === 'categories') { body.sortOrder = Number(data.get('sortOrder')); if (data.get('parentId')) body.parentId = data.get('parentId'); else if (item) body.parentId = null; }
      await context.save(item ? `/${resource}/${item.id}` : `/${resource}`, item ? 'PATCH' : 'POST', body, form); await context.refresh();
    });
  };
  const count = item => products.filter(product => resource === 'categories' ? product.categoryId === item.id : resource === 'units' ? product.baseUnitId === item.id : product.brandId === item.id || (!product.brandId && product.brand === item.name)).length;
  renderTable(context, { title, rows, columns: resource === 'categories' ? ['名称 / 编号', '上级分类', '排序', '使用商品'] : ['名称 / 编号', '使用商品'],
    cells: item => resource === 'categories' ? [`<strong>${text(item.name)}</strong><small>${text(item.code)}</small>`, item.parentId ? text(names(rows, item.parentId)) : '一级分类', text(String(item.sortOrder)), String(count(item))] : [`<strong>${text(item.name)}</strong>${item.code ? `<small>${text(item.code)}</small>` : ''}`, String(count(item))],
    edit: editable ? edit : null, create: editable ? () => edit() : null,
    actions: editable ? item => iconButton('trash-2', '删除', `data-registry-delete="${esc(item.id)}"`) : null });
  context.view.addEventListener('click', event => {
    const button = event.target.closest('[data-registry-delete]'); if (!button) return;
    const item = rows.find(row => row.id === button.dataset.registryDelete);
    openEditor(context, `删除${title}`, `<div class="ws-existing ws-wide">${text(item.name)}</div>`, async (_data, form) => {
      await context.save(`/${resource}/${item.id}`, 'DELETE', { expectedVersion: item.version }, form); await context.refresh();
    });
  });
}

async function stores(context) {
  const rows = await context.get('/stores');
  const groups = await context.get('/store-groups');
  const editable = canEdit(context.user, 'stores');
  const edit = item => {
    const editor = openEditor(context, item ? '编辑门店' : '新增门店', field('code', '门店编号', item?.code, { required: true, disabled: Boolean(item), max: 80 })
    + field('name', '门店名称', item?.name, { required: true, max: 200 })
    + field('groupName', '所属分组', item?.groupName || '', { choices: [['', '未分组'], ...groups.filter(group => group.status === 'ACTIVE' || group.name === item?.groupName).map(group => [group.name, group.name + (group.status === 'DISABLED' ? '（已停用）' : '')])] })
    + field('storeType', '门店类型', item?.storeType || '', { required: true, choices: storeTypes })
    + field('contactName', '联系人', item?.contactName, { required: true, max: 120 })
    + field('contactPhone', '联系电话', item?.contactPhone, { required: true, max: 32 })
    + addressFields('address', '门店地址', item?.address)
    + field('receiptMode', '收货资料', item?.receiptAddress ? 'INDEPENDENT' : 'STORE', { choices: [['STORE', '使用门店地址及联系人'], ['INDEPENDENT', '独立收货信息']] })
    + `<div class="ws-wide" data-receipt-fields ${item?.receiptAddress ? '' : 'hidden'}>`
    + addressFields('receiptAddress', '收货地址', item?.receiptAddress)
    + field('receiptContactName', '收货人', item?.receiptContactName, { max: 120 })
    + field('receiptContactPhone', '收货电话', item?.receiptContactPhone, { max: 32 }) + '</div>'
    + (item ? field('status', '状态', item.status, { choices: statusChoices }) : ''), async (data, form) => {
      const body = values(data, ['name', 'contactName', 'contactPhone', 'address', 'groupName', 'storeType']);
      body.address = composeAddress(data, 'address');
      body.groupName = nullable(body.groupName);
      for (const key of ['receiptAddress', 'receiptContactName', 'receiptContactPhone']) body[key] = data.get('receiptMode') === 'INDEPENDENT' ? String(data.get(key) || '').trim() : null;
      if (data.get('receiptMode') === 'INDEPENDENT') body.receiptAddress = composeAddress(data, 'receiptAddress');
      if (item) { body.expectedVersion = item.version; body.status = data.get('status'); }
      else body.code = String(data.get('code')).trim();
      await context.save(item ? `/stores/${item.id}` : '/stores', item ? 'PATCH' : 'POST', body, form); await context.refresh();
    });
    const mode = editor.form.elements.receiptMode;
    mountAddress(editor.form, 'address', { legacy: Boolean(item?.address) && !splitAddress(item.address).province });
    const receiptAddress = mountAddress(editor.form, 'receiptAddress', { legacy: Boolean(item?.receiptAddress) && !splitAddress(item.receiptAddress).province });
    const syncReceipt = () => {
      const independent = mode.value === 'INDEPENDENT';
      const section = editor.form.querySelector('[data-receipt-fields]');
      section.hidden = !independent;
      section.querySelectorAll('input, textarea').forEach(input => { input.required = independent; input.disabled = !independent; });
      receiptAddress.setEnabled(independent);
    };
    mode.onchange = syncReceipt;
    syncReceipt();
  };
  renderTable(context, { title: '门店管理', rows, columns: ['门店 / 编号', '分组 / 类型', '联系人', '电话', '收货地址', '状态'],
    filters: [{ key: 'storeType', label: '类型', choices: storeTypes.slice(1) }, { key: 'groupName', label: '分组', choices: [...new Set(rows.map(item => item.groupName).filter(Boolean))].sort().map(value => [value, value]) }, { key: 'status', label: '状态', choices: statusChoices }],
    cells: item => [`<strong>${text(item.name)}</strong><small>${text(item.code)}</small>`, `${text(item.groupName)}<small>${findLabel(storeTypes, item.storeType)}</small>`, text(item.contactName), text(item.contactPhone), `${text(item.receiptAddress || item.address)}<small>${text(item.receiptContactName || item.contactName)} · ${text(item.receiptContactPhone || item.contactPhone)}</small>`, findLabel(statusChoices, item.status)],
    edit: editable ? edit : null, create: editable ? () => edit() : null,
    actions: item => iconButton('eye', '查看资料', `data-profile="${esc(item.id)}"`) });
  if (editable) {
    context.view.querySelector('.ws-heading .ws-actions').insertAdjacentHTML('afterbegin', '<button id="ws-groups" class="ws-secondary"><i data-lucide="folders"></i>分组管理</button>');
    document.getElementById('ws-groups').onclick = () => storeGroups(context).catch(error => profileDetails(context, '分组管理', [['错误', error.message]]));
    icons();
  }
  context.view.addEventListener('click', event => {
    const button = event.target.closest('[data-profile]'); if (!button) return;
    const item = rows.find(row => row.id === button.dataset.profile);
    profileDetails(context, item.name, [['门店编号', item.code], ['分组', item.groupName], ['类型', findLabel(storeTypes, item.storeType)], ['联系人', item.contactName], ['电话', item.contactPhone], ['门店地址', item.address], ['收货地址', item.receiptAddress || item.address], ['收货人', item.receiptContactName || item.contactName], ['收货电话', item.receiptContactPhone || item.contactPhone], ['状态', findLabel(statusChoices, item.status)]]);
  });
}

async function storeGroups(context) {
  const rows = await context.get('/store-groups');
  const groupContext = { ...context, refresh: () => storeGroups(context) };
  const edit = item => openEditor(context, item ? '编辑分组' : '新增分组',
    field('name', '分组名称', item?.name, { required: true, max: 120, wide: true })
      + (item ? field('status', '状态', item.status, { choices: statusChoices, wide: true }) : ''), async (data, form) => {
    const body = { name: String(data.get('name') || '').trim(), ...(item ? { expectedVersion: item.version, status: data.get('status') } : {}) };
    await context.save(item ? `/store-groups/${item.id}` : '/store-groups', item ? 'PATCH' : 'POST', body, form);
    await storeGroups(context);
  });
  renderTable(groupContext, { title: '门店分组', rows, columns: ['分组名称', '门店数量', '状态'],
    cells: item => [text(item.name), String(item.storeCount), findLabel(statusChoices, item.status)],
    create: () => edit(), edit,
    actions: item => iconButton('trash-2', '删除分组', `data-group-delete="${esc(item.id)}" ${item.storeCount ? 'disabled' : ''}`) });
  context.view.querySelector('.ws-heading .ws-actions').insertAdjacentHTML('afterbegin', '<button id="ws-groups-back" class="ws-secondary"><i data-lucide="arrow-left"></i>返回门店</button>');
  document.getElementById('ws-groups-back').onclick = context.refresh;
  context.view.onclick = event => {
    const button = event.target.closest('[data-group-delete]'); if (!button) return;
    const item = rows.find(row => row.id === button.dataset.groupDelete);
    openEditor(context, '删除分组', `<div class="ws-wide ws-existing">${text(item.name)}</div>`, async (_data, form) => {
      await context.save(`/store-groups/${item.id}`, 'DELETE', { expectedVersion: item.version }, form);
      await storeGroups(context);
    });
  };
  icons();
}

async function suppliers(context) {
  const rows = await context.get('/suppliers');
  const editable = canEdit(context.user, 'suppliers');
  const edit = item => openEditor(context, item ? '编辑供应商' : '新增供应商', field('code', '供应商编号', item?.code, { required: true, disabled: Boolean(item), max: 80 })
    + field('name', '供应商名称', item?.name, { required: true, max: 200 })
    + field('contactName', '联系人', item?.contactName, { required: true, max: 120 })
    + field('contactPhone', '联系电话', item?.contactPhone, { required: true, max: 32 })
    + field('supplierType', '供应商类型', item?.supplierType || '', { choices: supplierTypes })
    + field('address', '供应商地址', item?.address, { required: true, textarea: true, wide: true, max: 300 })
    + field('bankName', '开户银行', item?.bankName, { required: true, max: 200 })
    + field('bankAccountName', '银行户名', item?.bankAccountName, { required: true, max: 200 })
    + field('bankAccount', '银行账号', item?.bankAccount, { required: true, max: 80 })
    + field('taxpayerId', '纳税人识别号', item?.taxpayerId, { required: true, max: 80 })
    + field('invoiceTitle', '开票抬头', item?.invoiceTitle, { required: true, max: 200 })
    + field('deliveryMode', '配送方式', item?.deliveryMode || 'SELF', { choices: [['SELF', '自配送'], ['LOGISTICS', '物流']] })
    + field('defaultSettlementMode', '默认结算方式', item?.defaultSettlementMode || 'COMPANY_TERM', { choices: settlementModes })
    + field('defaultSettlementCycle', '结算周期', item?.defaultSettlementCycle || 'HALF_MONTHLY', { choices: cycles })
    + field('settlementCycleDescription', '周期说明', item?.settlementCycleDescription, { textarea: true, max: 500 })
    + `<label class="ws-checkbox"><input name="requiresFreight" type="checkbox" ${item?.requiresFreight === true ? 'checked' : ''}>需要运费</label>`
    + field('remark', '备注', item?.remark, { textarea: true, wide: true, max: 500 })
    + (item ? field('status', '状态', item.status, { choices: statusChoices }) : ''), async (data, form) => {
      const body = values(data, ['name', 'contactName', 'contactPhone', 'deliveryMode', 'defaultSettlementMode', 'defaultSettlementCycle', 'supplierType', 'address', 'bankName', 'bankAccountName', 'bankAccount', 'taxpayerId', 'invoiceTitle', 'settlementCycleDescription', 'remark']);
      for (const key of ['supplierType', 'settlementCycleDescription', 'remark']) body[key] = nullable(body[key]);
      body.requiresFreight = data.has('requiresFreight');
      if (item) { body.expectedVersion = item.version; body.status = data.get('status'); }
      else body.code = String(data.get('code')).trim();
      await context.save(item ? `/suppliers/${item.id}` : '/suppliers', item ? 'PATCH' : 'POST', body, form); await context.refresh();
    });
  renderTable(context, { title: '供应商管理', rows, columns: ['供应商 / 编号', '类型', '联系人', '电话', '配送 / 运费', '结算方式 / 周期', '状态'],
    filters: [{ key: 'supplierType', label: '类型', choices: supplierTypes.slice(1) }, { key: 'status', label: '状态', choices: statusChoices }],
    cells: item => [`<strong>${text(item.name)}</strong><small>${text(item.code)}</small>`, findLabel(supplierTypes, item.supplierType), text(item.contactName), text(item.contactPhone), `${item.deliveryMode === 'SELF' ? '自配送' : '物流'}<small>${item.requiresFreight === null ? '运费未设置' : item.requiresFreight ? '需要运费' : '无运费'}</small>`, `${findLabel(settlementModes, item.defaultSettlementMode)} / ${findLabel(cycles, item.defaultSettlementCycle)}`, item.isArchived ? '已归档' : findLabel(statusChoices, item.status)],
    edit: editable ? item => { if (!item.isArchived) edit(item); else context.notice('供应商已归档。', true); } : null, create: editable ? () => edit() : null,
    actions: item => iconButton('eye', '查看资料', `data-profile="${esc(item.id)}"`) + (editable && !item.isArchived ? iconButton('package', '关联商品', `data-products="${esc(item.id)}"`) + iconButton('archive', '归档供应商', `data-supplier-archive="${esc(item.id)}"`) : '') });
  context.view.addEventListener('click', async event => {
    const archive = event.target.closest('[data-supplier-archive]');
    if (archive) {
      const item = rows.find(row => row.id === archive.dataset.supplierArchive);
      openEditor(context, '归档供应商', `<p class="ws-wide">${text(item.name)}：解除当前商品和模板供货关联，保留历史订单及未完成业务记录。</p>`, async (_data, form) => {
        await context.save(`/suppliers/${item.id}/archive`, 'POST', { expectedVersion: item.version }, form); await context.refresh();
      });
      return;
    }
    const detail = event.target.closest('[data-profile]');
    if (detail) {
      const item = rows.find(row => row.id === detail.dataset.profile);
      profileDetails(context, item.name, [['供应商编号', item.code], ['类型', findLabel(supplierTypes, item.supplierType)], ['联系人', item.contactName], ['电话', item.contactPhone], ['地址', item.address], ['开户银行', item.bankName], ['银行户名', item.bankAccountName], ['银行账号', item.bankAccount], ['纳税人识别号', item.taxpayerId], ['开票抬头', item.invoiceTitle], ['配送方式', item.deliveryMode === 'SELF' ? '自配送' : '物流'], ['运费', item.requiresFreight === null ? '未设置' : item.requiresFreight ? '需要运费' : '无运费'], ['结算方式', findLabel(settlementModes, item.defaultSettlementMode)], ['结算周期', findLabel(cycles, item.defaultSettlementCycle)], ['周期说明', item.settlementCycleDescription], ['备注', item.remark], ['状态', findLabel(statusChoices, item.status)]]);
      return;
    }
    const button = event.target.closest('[data-products]'); if (!button) return;
    button.disabled = true;
    try {
      const [products, relation] = await Promise.all([context.get('/products'), context.get(`/suppliers/${button.dataset.products}/products`)]);
      if (!context.active()) return;
      const content = '<div class="ws-check-list ws-wide">' + products.map(product => `<label><input type="checkbox" name="productIds" value="${esc(product.id)}" ${relation.productIds.includes(product.id) ? 'checked' : ''}>${text(product.name)}<small>${text(product.sku)}</small></label>`).join('') + '</div>';
      openEditor(context, `${names(rows, button.dataset.products)} · 关联商品`, content, async (data, form) => {
        await context.save(`/suppliers/${relation.supplierId}/products`, 'PUT', { expectedVersion: relation.version, productIds: data.getAll('productIds') }, form); await context.refresh();
      });
    } catch (error) { context.notice(error.message, true); } finally { button.disabled = false; }
  });
}

async function templates(context) {
  const [rows, stores, products, suppliers, categories] = await Promise.all([context.get('/templates'), context.get('/stores'), context.get('/products'), context.get('/suppliers'), context.get('/categories')]);
  renderTable(context, { title: '订货模板', rows, columns: ['模板名称', '编号 / 标签', '备注', '状态'], cells: item => [text(item.name), `${text(item.code)}<small>${text(item.tag)}</small>`, text(item.remark), item.isArchived ? '已归档' : '有效'],
    create: () => openEditor(context, '新增模板', field('code', '模板编号', '', { required: true, max: 80 }) + field('name', '模板名称', '', { required: true, max: 200 }) + field('tag', '模板标签', '', { required: true, max: 120 }) + field('remark', '备注', '', { textarea: true, wide: true, max: 500 }), async (data, form) => {
      const body = values(data, ['code', 'name', 'tag', 'remark']); body.remark = nullable(body.remark);
      await context.save('/templates', 'POST', body, form); await context.refresh();
    }), actions: item => item.isArchived ? '' : `${iconButton('pencil', '编辑模板', `data-template="${esc(item.id)}" data-section="metadata"`)}${iconButton('copy', '复制模板', `data-template="${esc(item.id)}" data-section="copy"`)}${iconButton('store', '绑定门店', `data-template="${esc(item.id)}" data-section="stores"`)}${iconButton('list-ordered', '商品及供货优先级', `data-template="${esc(item.id)}" data-section="items"`)}${iconButton('settings-2', '结算覆盖', `data-template="${esc(item.id)}" data-section="settings"`)}${iconButton('archive', '删除模板', `data-template="${esc(item.id)}" data-section="archive"`)}` });
  context.view.addEventListener('click', async event => {
    const button = event.target.closest('[data-template]'); if (!button) return;
    button.disabled = true;
    try {
      const detail = await context.get(`/templates/${button.dataset.template}`);
      if (!context.active()) return;
      const section = button.dataset.section;
      if (section === 'metadata' || section === 'copy') {
        const copying = section === 'copy';
        openEditor(context, copying ? '复制模板' : '编辑模板',
          (copying ? field('code', '模板编号', `${detail.code.slice(0, 45)}-copy-${crypto.randomUUID().slice(0, 8)}`, { required: true, max: 80 }) : '')
          + field('name', '模板名称', copying ? `${detail.name.slice(0, 196)}副本` : detail.name, { required: true, max: 200 })
          + field('tag', '模板标签', detail.tag, { required: true, max: 120 })
          + field('remark', '备注', detail.remark, { textarea: true, wide: true, max: 500 }), async (data, form) => {
            const body = values(data, copying ? ['code', 'name', 'tag', 'remark'] : ['name', 'tag', 'remark']);
            body.remark = nullable(body.remark); body.expectedVersion = detail.version;
            await context.save(copying ? `/templates/${detail.id}/copy` : `/templates/${detail.id}`, copying ? 'POST' : 'PATCH', body, form); await context.refresh();
          });
      } else if (section === 'archive') {
        openEditor(context, '删除模板', `<div class="ws-existing ws-wide">${text(detail.name)} · 取消门店、商品及结算关联，历史订单保留。</div>`, async (_data, form) => {
          await context.save(`/templates/${detail.id}/archive`, 'POST', { expectedVersion: detail.version }, form); await context.refresh();
        });
      } else if (section === 'stores') {
        const occupied = new Set(rows.filter(row => row.id !== detail.id && !row.isArchived).flatMap(row => row.storeIds || []));
        const content = '<div class="ws-check-list ws-wide">' + stores.filter(store => !occupied.has(store.id) || detail.storeIds.includes(store.id)).map(store => `<label><input type="checkbox" name="storeIds" value="${esc(store.id)}" ${detail.storeIds.includes(store.id) ? 'checked' : ''}>${text(store.name)}<small>${text(store.code)}</small></label>`).join('') + '</div>';
        openEditor(context, `${detail.name} · 绑定门店`, content, async (data, form) => {
          await context.save(`/templates/${detail.id}/stores`, 'PUT', { expectedVersion: detail.version, storeIds: data.getAll('storeIds') }, form); await context.refresh();
        });
      } else if (section === 'items') {
        const content = '<label>搜索商品<input type="search" data-template-search placeholder="商品名称或货号"></label>' + field('categoryFilter', '商品分类', '', { choices: [['', '全部分类'], ...categories.map(item => [item.id, item.name])] }) + '<div class="ws-template-list ws-wide">' + products.map(product => {
          const item = detail.items.find(item => item.productId === product.id);
          return `<section data-product="${esc(product.id)}" data-category="${esc(product.categoryId)}" data-search="${esc(`${product.name} ${product.sku || ''}`.toLowerCase())}"><label class="ws-checkbox"><input type="checkbox" name="productIds" value="${esc(product.id)}" ${item ? 'checked' : ''}><strong>${text(product.name)}</strong><small>${text(product.sku)}</small></label>
            <div class="ws-product-config" ${item ? '' : 'hidden'}><p class="ws-template-initial-price ws-wide">初始销售价：${item ? item.initialSalesPrice == null ? '未设置' : text(item.initialSalesPrice) : product.defaultSalesPrice == null ? '未设置' : text(product.defaultSalesPrice)}</p>
            <label class="ws-checkbox"><input type="checkbox" name="enabled:${product.id}" ${item?.isEnabled === false ? '' : 'checked'}>启用</label>${field(`sort:${product.id}`, '排序', item?.sortOrder || '0', { type: 'number', step: '1' })}
            ${field(`min:${product.id}`, '起订量', item?.minOrderQty ?? '', { type: 'number', step: '0.000001', placeholder: product.minOrderQty })}${field(`multiple:${product.id}`, '订货倍数', item?.orderMultiple ?? '', { type: 'number', step: '0.000001', placeholder: product.orderMultiple })}<div class="ws-supplier-options">${suppliers.map(supplier => {
            const setting = item?.suppliers.find(setting => setting.supplierId === supplier.id);
            return `<label><input type="checkbox" name="supplier:${product.id}" value="${esc(supplier.id)}" ${setting ? 'checked' : ''}><span>${text(supplier.name)}${setting ? `<small>销售 ${setting.salesPrice == null ? '未设置' : text(setting.salesPrice)} / 供货 ${setting.supplyPrice == null ? '未设置' : text(setting.supplyPrice)}</small>` : ''}</span><input type="number" aria-label="${esc(product.name)} / ${esc(supplier.name)} 优先级" name="priority:${product.id}:${supplier.id}" min="0" step="1" value="${setting?.priority ?? 100}"></label>`;
          }).join('')}</div></div></section>`;
        }).join('') + '</div>';
        const editor = openEditor(context, `${detail.name} · 商品及供货优先级`, content, async (data, form) => {
          const items = data.getAll('productIds').map(productId => ({ productId, sortOrder: Number(data.get(`sort:${productId}`)),
            isEnabled: data.has(`enabled:${productId}`), minOrderQty: data.get(`min:${productId}`) || null, orderMultiple: data.get(`multiple:${productId}`) || null,
            suppliers: data.getAll(`supplier:${productId}`).map(supplierId => ({ supplierId, priority: Number(data.get(`priority:${productId}:${supplierId}`)) })) }));
          if (items.some(item => !item.suppliers.length)) throw new Error('每个已选商品至少需要一个供货方。');
          await context.save(`/templates/${detail.id}/items`, 'PUT', { expectedVersion: detail.version, items }, form); await context.refresh();
        });
        const filterProducts = () => {
          const query = editor.form.querySelector('[data-template-search]').value.trim().toLowerCase();
          const category = editor.form.elements.categoryFilter.value;
          editor.form.querySelectorAll('[data-product]').forEach(section => { section.hidden = !section.dataset.search.includes(query) || !!category && section.dataset.category !== category; });
        };
        editor.form.querySelector('[data-template-search]').oninput = filterProducts;
        editor.form.elements.categoryFilter.onchange = filterProducts;
        editor.form.querySelectorAll('[name="productIds"]').forEach(checkbox => {
          const config = checkbox.closest('section').querySelector('.ws-product-config');
          const toggle = () => { config.hidden = !checkbox.checked; config.querySelectorAll('input').forEach(input => { input.disabled = !checkbox.checked; }); };
          checkbox.onchange = toggle; toggle();
        });
      } else {
        const linkedIds = new Set(detail.items.flatMap(item => item.suppliers.map(supplier => supplier.supplierId)));
        const content = field('supplierId', '供应商', '', { required: true, choices: [['', '请选择'], ...suppliers.filter(item => linkedIds.has(item.id) || detail.settings.some(setting => setting.supplierId === item.id)).map(item => [item.id, item.name])] })
          + '<label class="ws-checkbox"><input type="checkbox" name="usesDefault">使用供应商默认结算</label>'
          + field('settlementMode', '结算方式', 'COMPANY_TERM', { choices: settlementModes }) + field('settlementCycle', '结算周期', 'HALF_MONTHLY', { choices: cycles })
          + '<div class="ws-existing ws-wide">' + (detail.settings.map(setting => `<p>${text(names(suppliers, setting.supplierId))} · ${text(findLabel(settlementModes, setting.settlementMode))} / ${text(findLabel(cycles, setting.settlementCycle))}</p>`).join('') || '尚未设置覆盖') + '</div>';
        const editor = openEditor(context, `${detail.name} · 结算覆盖`, content, async (data, form) => {
          const usesDefault = data.has('usesDefault');
          await context.save(`/templates/${detail.id}/supplier-settings/${data.get('supplierId')}`, usesDefault ? 'DELETE' : 'PUT', usesDefault ? { expectedVersion: detail.version } : { expectedVersion: detail.version, settlementMode: data.get('settlementMode'), settlementCycle: data.get('settlementCycle') }, form); await context.refresh();
        });
        editor.form.elements.supplierId.onchange = () => {
          const supplierId = editor.form.elements.supplierId.value;
          const setting = detail.settings.find(setting => setting.supplierId === supplierId);
          const supplier = suppliers.find(supplier => supplier.id === supplierId);
          editor.form.elements.settlementMode.value = setting?.settlementMode || supplier?.defaultSettlementMode || 'COMPANY_TERM';
          editor.form.elements.settlementCycle.value = setting?.settlementCycle || supplier?.defaultSettlementCycle || 'HALF_MONTHLY';
          editor.form.elements.usesDefault.checked = !setting;
          editor.form.elements.usesDefault.onchange();
        };
        editor.form.elements.usesDefault.onchange = () => {
          const usesDefault = editor.form.elements.usesDefault.checked;
          if (usesDefault) {
            const supplier = suppliers.find(item => item.id === editor.form.elements.supplierId.value);
            editor.form.elements.settlementMode.value = supplier?.defaultSettlementMode || 'COMPANY_TERM';
            editor.form.elements.settlementCycle.value = supplier?.defaultSettlementCycle || 'HALF_MONTHLY';
          }
          editor.form.elements.settlementMode.disabled = usesDefault;
          editor.form.elements.settlementCycle.disabled = usesDefault;
        };
      }
    } catch (error) { context.notice(error.message, true); } finally { button.disabled = false; }
  });
}

async function prices(context) {
  const [products, suppliers, templates] = await Promise.all([context.get('/products'), context.get('/suppliers'), context.get('/templates')]);
  if (!context.active()) return;
  context.view.innerHTML = `<div class="ws-heading"><h1>价格管理</h1>${iconButton('refresh-cw', '刷新', 'id="ws-refresh"')}</div><form id="ws-price-form" class="ws-price-form"><fieldset><div class="ws-form-grid">
    ${field('templateId', '价格范围', '', { choices: [['', '共享价格'], ...templates.filter(item => !item.isArchived).map(item => [item.id, item.name])] })}
    ${field('productId', '商品', '', { required: true, choices: [['', '请选择'], ...products.map(item => [item.id, item.sku ? `${item.name} / ${item.sku}` : item.name])] })}
    ${field('supplierId', '供应商', '', { required: true, choices: [['', '请选择'], ...suppliers.map(item => [item.id, item.name])] })}
    ${field('salesPrice', '销售单价', '', { type: 'number', required: true, step: '0.000001' })}${field('supplyPrice', '供货单价', '', { type: 'number', required: true, step: '0.000001' })}
    ${field('effectiveAt', '生效时间', '', { type: 'datetime-local', required: true })}${field('reason', '改价原因', '', { required: true, max: 500 })}
    </div><div class="ws-dialog-actions"><button id="ws-price-preview" class="ws-secondary" type="button">预览影响</button><button class="ws-primary" type="submit" disabled>确认发布</button></div></fieldset></form>
    <section id="ws-price-impact" class="ws-price-impact" aria-live="polite"></section><section id="ws-price-job" class="ws-price-impact"></section><section id="ws-price-versions"></section>`;
  document.getElementById('ws-refresh').onclick = context.refresh;
  const form = document.getElementById('ws-price-form');
  let previewBody = null;
  let choiceSequence = 0;
  const initializePriceDraft = async () => {
    const sequence = ++choiceSequence;
    const { templateId, productId, supplierId } = form.elements;
    form.elements.supplyPrice.readOnly = !!templateId.value;
    if (!productId.value) return;
    try {
      const detail = templateId.value ? await context.get(`/templates/${templateId.value}`) : null;
      if (!context.active() || sequence !== choiceSequence) return;
      const item = detail?.items.find(item => item.productId === productId.value);
      const supplier = item?.suppliers.find(supplier => supplier.supplierId === supplierId.value);
      const quote = supplierId.value ? await context.client.request('/prices/quote', { method: 'POST', body: { productId: productId.value, supplierId: supplierId.value,
        ...(templateId.value ? { templateId: templateId.value } : {}), ...(form.elements.effectiveAt.value ? { effectiveAt: new Date(form.elements.effectiveAt.value).toISOString() } : {}) } }).catch(error => {
        if (error.code === 'PRICE_VERSION_NOT_FOUND') return null;
        throw error;
      }) : null;
      if (!context.active() || sequence !== choiceSequence) return;
      const price = quote?.templateId ? quote.salesPrice : item?.initialSalesPrice ?? supplier?.salesPrice ?? quote?.salesPrice ?? products.find(product => product.id === productId.value)?.defaultSalesPrice;
      if (!form.elements.salesPrice.value && price != null) form.elements.salesPrice.value = price;
      if (templateId.value) form.elements.supplyPrice.value = quote?.supplyPrice ?? '';
      else if (!form.elements.supplyPrice.value && quote) form.elements.supplyPrice.value = quote.supplyPrice;
    } catch (error) { if (sequence === choiceSequence && context.active()) context.notice(error.message, true); }
  };
  for (const name of ['templateId', 'productId', 'supplierId', 'effectiveAt']) form.elements[name].onchange = initializePriceDraft;
  const body = () => {
    const input = values(new FormData(form), ['templateId', 'productId', 'supplierId', 'salesPrice', 'supplyPrice', 'effectiveAt', 'reason']);
    if (!input.templateId) delete input.templateId;
    input.effectiveAt = new Date(input.effectiveAt).toISOString();
    return input;
  };
  form.oninput = () => { previewBody = null; form.querySelector('[type="submit"]').disabled = true; document.getElementById('ws-price-impact').textContent = ''; };
  const previewButton = document.getElementById('ws-price-preview');
  previewButton.onclick = async () => {
    if (!form.reportValidity() || previewButton.disabled || form.dataset.uncertain) return;
    previewButton.disabled = true;
    const draft = body(); const fingerprint = JSON.stringify(draft);
    try {
      const impact = await context.client.request('/prices/impact-preview', { method: 'POST', body: draft });
      impact.initial = !impact.scopeId;
      if (!context.active() || JSON.stringify(body()) !== fingerprint) return;
      document.getElementById('ws-price-impact').innerHTML = `<h2>${impact.initial ? '首次设置价格' : '影响预览'}</h2><p>影响订单 ${impact.affectedOrderCount} 笔 · 销售额差额 ${text(impact.salesDelta)} · 供货额差额 ${text(impact.supplyDelta)}</p>
        ${impact.orders.map(order => `<p>${text(order.supplierOrderNo)} · ${text(order.salesDelta)} / ${text(order.supplyDelta)}</p>`).join('')}`;
      previewBody = fingerprint; form.querySelector('[type="submit"]').disabled = false;
      if (impact.scopeId) {
        const versions = await context.get(`/price-scopes/${impact.scopeId}/versions`);
        if (context.active() && JSON.stringify(body()) === fingerprint) showVersions(versions);
      } else document.getElementById('ws-price-versions').innerHTML = '';
    } catch (error) { context.notice(error.message, true); } finally { previewButton.disabled = false; }
  };
  form.onsubmit = async event => {
    event.preventDefault(); if (form.dataset.uncertain || !previewBody || previewBody !== JSON.stringify(body())) return;
    try {
      const quote = await context.save('/price-changes', 'POST', body(), form);
      if (!context.active()) return;
      previewBody = null; form.querySelector('[type="submit"]').disabled = true;
      context.notice(`价格已发布${quote.runId ? '，关联订单重算任务已创建。' : '。'}`);
      const versions = await context.get(`/price-scopes/${quote.scopeId}/versions`);
      if (context.active()) showVersions(versions);
      if (quote.runId) await showRun(quote.runId);
    } catch (error) { context.notice(error.message, true); }
  };
  function showVersions(versions) {
    document.getElementById('ws-price-versions').innerHTML = '<h2>价格版本</h2><div class="ws-table-wrap"><table><thead><tr><th>销售单价</th><th>供货单价</th><th>生效时间</th><th>原因</th></tr></thead><tbody>'
      + versions.map(version => `<tr><td>${text(version.salesPrice)}</td><td>${text(version.supplyPrice)}</td><td>${text(new Date(version.effectiveAt).toLocaleString('zh-CN'))}</td><td>${text(version.reason)}</td></tr>`).join('') + '</tbody></table></div>';
  }
  async function showRun(id) {
    const run = await context.get(`/jobs/${id}`);
    if (!context.active()) return;
    document.getElementById('ws-price-job').innerHTML = `<h2>订单重算任务</h2><p>${run.status === 'PENDING' ? '待执行' : run.status === 'SUCCEEDED' ? '已完成' : '执行失败'} · 影响 ${run.affectedOrderCount} 笔 · 销售额差额 ${text(run.salesDelta)} · 供货额差额 ${text(run.supplyDelta)}</p><div class="ws-actions">${run.status === 'PENDING' ? '<button id="ws-process-price" class="ws-secondary">执行订单重算</button>' : ''}${iconButton('refresh-cw', '刷新任务', 'id="ws-refresh-price-job"')}</div>`;
    icons();
    document.getElementById('ws-refresh-price-job').onclick = () => showRun(id).catch(error => context.notice(error.message, true));
    document.getElementById('ws-process-price')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      try { await context.save(`/jobs/${id}/process`, 'POST'); await showRun(id); }
      catch (error) { context.notice(error.message, true); }
    });
  }
}

async function ownProfile(context) {
  const scope = context.user.scope;
  const supplier = context.user.roles.includes('SUPPLIER') && scope?.supplierId;
  const id = supplier || scope?.storeId;
  if (!id) throw new Error('账号尚未配置所属门店或供应商。');
  const item = await context.get(`/${supplier ? 'suppliers' : 'stores'}/${id}`);
  if (!context.active()) return;
  const entries = [['编号', item.code], ['名称', item.name], ['联系人', item.contactName], ['电话', item.contactPhone], ['地址', item.address]];
  if (supplier) entries.push(['开户银行', item.bankName], ['银行户名', item.bankAccountName], ['银行账号', item.bankAccount], ['纳税人识别号', item.taxpayerId], ['开票抬头', item.invoiceTitle], ['结算方式', findLabel(settlementModes, item.defaultSettlementMode)], ['结算周期', findLabel(cycles, item.defaultSettlementCycle)], ['周期说明', item.settlementCycleDescription], ['配送方式', item.deliveryMode === 'SELF' ? '自配送' : '物流'], ['运费', item.requiresFreight === null ? '未设置' : item.requiresFreight ? '需要运费' : '无运费'], ['备注', item.remark]);
  else entries.push(['分组', item.groupName], ['类型', findLabel(storeTypes, item.storeType)], ['收货地址', item.receiptAddress || item.address], ['收货人', item.receiptContactName || item.contactName], ['收货电话', item.receiptContactPhone || item.contactPhone]);
  entries.push(['状态', item.isArchived ? '已归档' : findLabel(statusChoices, item.status)]);
  context.view.innerHTML = `<div class="ws-heading"><h1>${text(item.name)}</h1>${iconButton('refresh-cw', '刷新', 'id="ws-refresh"')}</div><dl class="ws-profile-details">${entries.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${text(value)}</dd>`).join('')}</dl>`;
  document.getElementById('ws-refresh').onclick = context.refresh;
}

async function supplierProducts(context) {
  const id = context.user.scope?.supplierId;
  if (!id) throw new Error('账号尚未配置所属供应商。');
  const result = await context.get(`/suppliers/${id}/catalog`);
  renderTable(context, { title: '供货商品', rows: result.items, columns: ['商品 / 货号', '规格', '单位', '供货单价', '状态'],
    cells: item => [`<strong>${text(item.name)}</strong><small>${text(item.sku)}</small>`, text(item.specification), text(item.unitName), item.supplyPrice === null ? '未发布' : esc(item.supplyPrice), item.isActive ? '启用' : '停用'] });
}

export async function renderManagement(context) {
  return { products, categories: registry, brands: registry, units: registry, stores, suppliers, templates, prices, profile: ownProfile, 'supplier-products': supplierProducts }[context.route](context);
}
