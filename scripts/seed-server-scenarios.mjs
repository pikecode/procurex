import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import sharp from 'sharp';

assert.equal(process.env.CONFIRM_ACCEPTANCE_SEED, 'real-server-test-workflows');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, 'postgres');
assert.equal(url.pathname, '/procurex');
const base = process.env.ACCEPTANCE_API_BASE || 'http://127.0.0.1:3100/api/v1';
const manifestPath = process.env.ACCEPTANCE_MANIFEST || '/app/data/files/acceptance-manifest.json';
const accessPath = process.env.ACCEPTANCE_ACCESS || '/app/data/files/acceptance-access.json';
let manifest;
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
catch { manifest = { prefix: 'ACCEPT20261012', createdAt: new Date(), objects: {}, cases: {}, checks: [] }; }
assert.equal(manifest.prefix, 'ACCEPT20261012');
let access;
try { access = JSON.parse(await readFile(accessPath, 'utf8')); }
catch { access = { password: `PxAccept-${randomBytes(12).toString('base64url')}`, accounts: [] }; }
const pool = new pg.Pool({ connectionString: url.toString() });
const tokens = new Map();
const bootstrapId = randomUUID();
async function save() {
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await writeFile(accessPath, JSON.stringify(access, null, 2), { mode: 0o600 });
}
async function call(path, who = 'admin', body, method = body === undefined ? 'GET' : 'POST', expect) {
  const response = await fetch(base + path, { method, headers: { ...(tokens.get(who) ? { authorization: `Bearer ${tokens.get(who)}` } : {}), 'content-type': 'application/json', 'idempotency-key': `acceptance-${randomUUID()}` }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (expect) { assert.equal(response.status, expect, `${path}: ${result.code || result.message}`); return result; }
  if (!response.ok) throw new Error(`${path}: ${response.status} ${result.code || ''} ${result.message || ''}`);
  return result.data ?? result;
}
async function memo(key, run) {
  if (Object.hasOwn(manifest.objects, key)) return manifest.objects[key];
  const value = await run(); manifest.objects[key] = value; await save(); return value;
}
const create = (path, key, body, who = 'admin') => memo(key, () => call(path, who, body));
async function login(username) {
  const result = await call('/auth/login', '', { username, password: access.password, client: 'ACCEPTANCE_SEED' });
  tokens.set(username, result.accessToken); return result.user;
}
async function user(username, displayName, role, scope = {}) {
  const row = await create('/users', `user:${username}`, { username, displayName, role, password: access.password, ...scope });
  if (!access.accounts.some(item => item.username === username)) access.accounts.push({ username, displayName, role, ...scope });
  await save(); if (username !== 'disabled_user') await login(username); return row;
}
async function evidence(who, purpose, label) {
  const escaped = label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const svg = `<svg width="800" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="500" fill="white"/><text x="40" y="90" font-size="30" fill="#ba2634">ACCEPTANCE ONLY - NOT A BANK RECEIPT</text><text x="40" y="170" font-size="24">${purpose}</text><text x="40" y="240" font-size="20">${escaped}</text><text x="40" y="330" font-size="20">${new Date().toISOString()}</text></svg>`;
  const bytes = await sharp(Buffer.from(svg)).resize(800, 800, { fit: 'contain', background: 'white' }).png().toBuffer();
  const file = await call('/files/upload-sessions', who, { purpose, filename: `验收专用-${purpose}-${Date.now()}.png`, mimeType: 'image/png', sizeBytes: bytes.length });
  const upload = await fetch(`${base}/files/${file.id}/content`, { method: 'POST', headers: { authorization: `Bearer ${tokens.get(who)}`, 'content-type': 'application/octet-stream', 'x-upload-token': file.uploadToken }, body: bytes });
  assert.ok(upload.ok, 'Evidence upload failed');
  await call(`/files/${file.id}/complete`, who, {});
  return file.id;
}
const modes = ['stored', 'credit', 'company', 'direct'];
const shops = {}, suppliers = {}, products = {}, templates = {}, units = {}, cats = {};
const chef = mode => `store${modes.indexOf(mode) + 1}`;
const supplierUser = id => Object.keys(suppliers).find(key => suppliers[key].id === id);
async function orderCase(code, label, mode, lines = [['tea', '5']], confirmed = true) {
  const request = await memo(`${code}:request`, () => call('/purchase-requests', chef(mode), { storeId: shops[mode].id, items: lines.map(([key, quantity]) => ({ productId: products[key].id, quantity })) }));
  manifest.cases[code] = { ...manifest.cases[code], code, label, mode, requestId: request.id, requestNo: request.requestNo }; await save();
  if (confirmed) await memo(`${code}:confirm`, async () => {
    const detail = await call(`/purchase-requests/${request.id}`, 'buyer');
    return call(`/purchase-requests/${request.id}/confirm`, 'buyer', { expectedVersion: detail.version });
  });
  const detail = await call(`/purchase-requests/${request.id}`, 'buyer');
  manifest.cases[code].orders = (detail.supplierOrders || []).map(row => ({ id: row.id, orderNo: row.supplierOrderNo, supplierId: row.supplierId, status: row.status })); await save();
  return { request, detail, order: detail.supplierOrders?.[0] };
}
async function ship(code, order, quantities, gap, freight) {
  return memo(`${code}:ship`, async () => {
    const who = supplierUser(order.supplierId); assert.ok(who);
    const detail = await call(`/supplier-orders/${order.id}`, who);
    return call(`/supplier-orders/${order.id}/shipments`, who, { expectedVersion: detail.version, deliveryMode: detail.deliveryModeSnapshot || suppliers[who].deliveryMode,
      freight: freight?.amount || '0.00', ...(freight ? { freightConfirmationId: freight.id } : {}), trackingNo: suppliers[who].deliveryMode === 'LOGISTICS' ? `ACCEPT-${code}-${Date.now()}` : undefined,
      items: detail.items.map((item, index) => ({ orderItemId: item.id, shipQuantity: quantities?.[index] || item.quantity, permanentlyReduceQuantity: '0',
        ...(gap ? { gapAllocations: [{ gapId: gap.id, quantity: quantities[index] }] } : {}) })) });
  });
}
async function receive(code, mode, shipment, shortage = 0) {
  return memo(`${code}:receipt`, async () => {
    const who = chef(mode); const detail = await call(`/shipments/${shipment.id}`, who);
    return call(`/shipments/${shipment.id}/receipts`, who, { expectedOrderVersion: detail.supplierOrderVersion, expectedReceiptRevision: detail.currentReceiptRevision,
      evidenceFileIds: [await evidence(who, 'RECEIPT', `${code} received with shortage ${shortage}`)],
      items: detail.items.map((item, index) => ({ shipmentItemId: item.id, receivedQuantity: String(Number(item.shippedQuantity) - (index === 0 ? shortage : 0)) })) });
  });
}
async function discrepancy(code, order, mode, action) {
  return memo(`${code}:difference:${action || 'open'}`, async () => {
    const rows = await call('/discrepancies', chef(mode));
    const row = rows.find(item => item.supplierOrderNo === order.supplierOrderNo && item.status === 'OPEN'); assert.ok(row, `Missing discrepancy ${code}`);
    if (!action) return call(`/discrepancies/${row.id}`, chef(mode));
    const who = action === 'RETURN' ? supplierUser(order.supplierId) : chef(mode);
    return call(`/discrepancies/${row.id}/resolve`, who, { expectedVersion: row.version, action, reason: action === 'RETURN' ? '请门店按送货单再次核对实收数量（验收）' : '门店清点后选择处理方式（验收）' });
  });
}
async function payment(code, order, mode, direction, status) {
  if (mode === 'direct') direction = 'STORE_TO_SUPPLIER';
  const who = direction === 'COMPANY_TO_SUPPLIER' ? 'fin' : chef(mode);
  const itemId = Buffer.from(JSON.stringify({ kind: mode === 'direct' ? 'DIRECT' : direction === 'STORE_TO_COMPANY' ? 'STORE_RECEIVABLE' : 'SUPPLIER_PAYABLE', supplierOrderId: order.id })).toString('base64url');
  const row = await memo(`${code}:payment:${direction}`, async () => {
    const preview = await call('/payment-records/preview', who, { settlementItemIds: [itemId] });
    assert.equal(preview.items.length, 1, `${code} payment preview`);
    return call('/payment-records', who, { direction, businessDate: new Date().toISOString().slice(0, 10), remark: `${code} 验收付款，无实际银行转账`, evidenceFileIds: [await evidence(who, 'PAYMENT', code)],
      items: preview.items.map(item => ({ settlementItemId: item.settlementItemId, expectedVersion: item.sourceVersion, expectedAmount: item.payableAmount })) });
  });
  if (status) await memo(`${code}:payment:${direction}:${status}`, () => call(`/payment-records/${row.id}/${status}`, direction === 'STORE_TO_COMPANY' && mode !== 'direct' ? 'fin' : supplierUser(order.supplierId), { expectedVersion: row.version, ...(status === 'reject' ? { reason: '凭证收款信息不一致，请重新提交（验收）' } : {}) }));
  manifest.cases[code].payments ||= [];
  if (!manifest.cases[code].payments.some(item => item.id === row.id)) manifest.cases[code].payments.push({ id: row.id, direction, status: status || 'pending' });
  await save(); return row;
}
try {
  // This temporary administrator session provisions fixtures only; scenario actors use real login.
  const { rows: [admin] } = await pool.query('SELECT id FROM "User" WHERE username=$1 AND status=$2', ['admin', 'ACTIVE']); assert.ok(admin);
  await pool.query('INSERT INTO "Role" (id,code,name,description,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW()) ON CONFLICT (code) DO NOTHING', [randomUUID(), 'STORE_FINANCE', '门店财务', '查看本门店订单与账单']);
  const token = randomBytes(32).toString('base64url'); tokens.set('admin', token);
  await pool.query('INSERT INTO "UserSession" (id,"userId","tokenHash",client,"expiresAt","createdAt") VALUES ($1,$2,$3,$4,NOW()+INTERVAL \'2 hours\',NOW())', [bootstrapId, admin.id, createHash('sha256').update(token).digest('hex'), 'ACCEPTANCE_PROVISION']);
  await save();
  await user('buyer', '陈经理｜公司采购', 'PURCHASER');
  await user('fin', '林会计｜总部财务', 'HQ_FINANCE');
  await memo('label-archived-test-accounts', async () => {
    const rows = (await call('/users')).filter(row => row.status === 'DISABLED' && /^(?:(?:store[12]|supplier[12]|buyer|fin)_old_|(?:mini_test_|pxserverflow_).+_old_)/.test(row.username) && !row.displayName.endsWith('（历史停用）'));
    for (const row of rows) await call(`/users/${row.id}`, 'admin', { expectedVersion: row.version, displayName: `${row.displayName.slice(0, 110)}（历史停用）` }, 'PATCH');
    return rows.map(row => row.username);
  });
  await memo('remove-old-empty-groups', async () => {
    const groups = (await call('/store-groups')).filter(row => row.name.startsWith('测试｜') && row.storeCount === 0);
    for (const row of groups) await call(`/store-groups/${row.id}`, 'admin', { expectedVersion: row.version }, 'DELETE');
    return groups.map(row => row.name);
  });
  const group = await memo('group', async () => (await call('/store-groups')).find(row => row.name === '验收｜深圳直营门店') || call('/store-groups', 'admin', { name: '验收｜深圳直营门店' }));
  for (const [key, name, mode, cycle, delivery, phone] of [
    ['supplier2', '绿禾生鲜配送（验收·储值）', 'STORED_VALUE', 'IMMEDIATE', 'SELF', '13800138002'],
    ['supplier3', '丰源农产品物流（验收·挂账）', 'CREDIT', 'IMMEDIATE', 'LOGISTICS', '13800138003'],
    ['supplier1', '海润粮油配送（验收·公司账期）', 'COMPANY_TERM', 'MONTHLY', 'SELF', '13800138001'],
    ['supplier4', '岭南冷链直供（验收·供应商账期）', 'SUPPLIER_TERM', 'HALF_MONTHLY', 'LOGISTICS', '13800138004'],
    ['supplier5', '青田生鲜备用（验收·储值）', 'STORED_VALUE', 'IMMEDIATE', 'SELF', '13800138005'],
  ]) {
    suppliers[key] = await create('/suppliers', key, { code: `${manifest.prefix}_${key}`, name, contactName: '配送联系人（验收）', contactPhone: phone, deliveryContactPhone: phone,
      address: '广东省深圳市龙岗区平湖街道配送中心（验收地址）', deliveryMode: delivery, defaultSettlementMode: mode, defaultSettlementCycle: cycle, requiresFreight: key === 'supplier3', supplierType: key === 'supplier4' ? 'DIRECT' : 'HEADQUARTERS', remark: '场景验收资料，不代表真实交易主体' });
    await user(key, name, 'SUPPLIER', { supplierId: suppliers[key].id });
  }
  for (const [key, name, address, type] of [
    ['stored', '南山科技园店（验收·储值）', '南山区科技南路18号', 'DIRECT'],
    ['credit', '福田中心店（验收·挂账）', '福田区福华路36号', 'DIRECT'],
    ['company', '宝安西乡店（验收·公司账期）', '宝安区西乡街道宝源路28号', 'FRANCHISE'],
    ['direct', '龙岗大运店（验收·供应商账期）', '龙岗区龙翔大道68号', 'JOINT'],
    ['empty', '光明筹备店（验收·未绑定模板）', '光明区公明街道88号', 'DIRECT'],
    ['low', '南山后海店（验收·储值不足）', '南山区后海大道12号', 'DIRECT'],
    ['limit', '福田梅林店（验收·额度不足）', '福田区梅林路22号', 'DIRECT'],
    ['disabled', '罗湖暂停营业店（验收）', '罗湖区东门中路16号', 'DIRECT'],
  ]) {
    shops[key] = await create('/stores', `shop:${key}`, { code: `${manifest.prefix}_${key}`, name, groupName: group.name, storeType: type, contactName: '门店店长（验收）', contactPhone: '13800138000', address: `广东省深圳市${address}` });
    if (modes.includes(key)) {
      const number = modes.indexOf(key) + 1;
      await user(`store${number}`, `${name}｜厨政经理`, 'STORE', { storeId: shops[key].id });
      await user(`store_fin${number}`, `${name}｜门店财务`, 'STORE_FINANCE', { storeId: shops[key].id });
    } else await user(`store_${key}`, `${name}｜厨政经理`, 'STORE', { storeId: shops[key].id });
  }
  for (const [username, name, role] of [['follower', '赵跟单｜南山福田片区', 'PURCHASE_FOLLOWER'], ['region', '黄经理｜南山福田片区', 'REGION_MANAGER'], ['region_fin', '吴会计｜南山福田片区', 'REGION_FINANCE']]) await user(username, name, role, { storeIds: [shops.stored.id, shops.credit.id] });
  const disabled = await user('disabled_user', '离职人员（验收·停用）', 'STORE', { storeId: shops.disabled.id });
  await memo('disabled-user', () => call(`/users/${disabled.id}`, 'admin', { expectedVersion: disabled.version, status: 'DISABLED' }, 'PATCH'));
  await memo('disabled-store', async () => { const row = await call(`/stores/${shops.disabled.id}`); return call(`/stores/${row.id}`, 'admin', { expectedVersion: row.version, status: 'DISABLED' }, 'PATCH'); });
  const existingUnits = await call('/units');
  for (const name of ['袋', '箱', '瓶', '包', '斤', '盒']) units[name] = existingUnits.find(row => row.name === name) || await create('/units', `unit:${name}`, { name });
  for (const [root, children] of [['生鲜食材', ['叶菜', '根茎', '肉类']], ['粮油调味', ['大米面粉', '食用油']], ['茶饮原料', ['茶叶', '粉圆']], ['包装耗材', ['杯具', '餐盒']]]) {
    const parent = await create('/categories', `category:${root}`, { code: `${manifest.prefix}_cat${Object.keys(cats).length}`, name: `${root}（验收）` }); cats[root] = parent;
    for (const name of children) cats[name] = await create('/categories', `category:${name}`, { code: `${manifest.prefix}_cat${Object.keys(cats).length}`, name, parentId: parent.id });
  }
  const definitions = [
    ['tea', '茉莉花茶', '茶叶', '袋', '25.00', '1', '1', 'AMBIENT'],
    ['pearl', '珍珠粉圆', '粉圆', '袋', '18.00', '1', '1', 'AMBIENT'],
    ['green', '上海青', '叶菜', '斤', '4.80', '1', '1', 'CHILLED'],
    ['lettuce', '生菜', '叶菜', '斤', '4.20', '1', '1', 'CHILLED'],
    ['potato', '土豆', '根茎', '斤', '3.00', '1', '1', 'AMBIENT'],
    ['carrot', '胡萝卜', '根茎', '斤', '3.60', '1', '1', 'AMBIENT'],
    ['pork', '五花肉', '肉类', '斤', '22.00', '1', '1', 'FROZEN'],
    ['rice', '东北大米', '大米面粉', '袋', '68.00', '3', '3', 'AMBIENT'],
    ['flour', '高筋面粉', '大米面粉', '袋', '45.00', '1', '1', 'AMBIENT'],
    ['oil', '大豆油', '食用油', '瓶', '45.00', '5', '1', 'AMBIENT'],
    ['cup', '打包杯500ml', '杯具', '包', '12.00', '1', '1', 'AMBIENT'],
    ['box', '打包餐盒750ml', '餐盒', '包', '15.00', '1', '1', 'AMBIENT'],
    ['off', '停用乌龙茶（验收）', '茶叶', '袋', '28.00', '1', '1', 'AMBIENT'],
    ['unbound', '未进模板的红茶（验收）', '茶叶', '袋', '22.00', '1', '1', 'AMBIENT'],
    ['shelf', '仅供货商已下架的龙井（验收）', '茶叶', '袋', '32.00', '1', '1', 'AMBIENT'],
  ];
  for (const [key, name, category, unit, sales, minimum, multiple, storageCondition] of definitions) {
    const supplierIds = key === 'shelf' ? [suppliers.supplier2.id] : Object.values(suppliers).map(row => row.id);
    products[key] = await create('/products', `product:${key}`, { sku: `${manifest.prefix}_${key}`, name, categoryId: cats[category].id, baseUnitId: units[unit].id, defaultSalesPrice: sales,
      minOrderQty: minimum, orderMultiple: multiple, specification: key === 'tea' ? '500g/袋' : key === 'rice' ? '25kg/袋' : '标准销售包装', storageCondition,
      ...(key === 'tea' ? { purchaseUnitConversion: { purchaseUnitId: units['箱'].id, salesUnitsPerPurchaseUnit: '10' } } : {}),
      ...(key === 'tea' ? { imageFileId: await memo('product-image', () => evidence('buyer', 'PRODUCT', 'Jasmine tea - acceptance image')) } : {}),
      supplierIds, supplierPurchasePrices: supplierIds.map((supplierId, index) => ({ supplierId, supplyPrice: (Number(sales) * (0.70 + index * 0.03)).toFixed(2), expectedVersionId: null })) }, 'buyer');
  }
  await memo('disable-product', async () => { const row = (await call('/products', 'buyer')).find(row => row.id === products.off.id); return call(`/products/${row.id}`, 'buyer', { expectedVersion: row.version, isActive: false }, 'PATCH'); });
  for (const [key, who] of [['shelf', 'supplier2'], ['tea', 'supplier5'], ['lettuce', 'supplier5']]) await memo(`unshelf:${key}:${who}`, async () => {
    const list = await call(`/suppliers/${suppliers[who].id}/managed-products`, who);
    const rows = Array.isArray(list) ? list : list.items || list.products;
    const row = rows.find(row => row.productId === products[key].id || row.id === products[key].id || row.product?.id === products[key].id); assert.ok(row, 'Missing managed product');
    return call(`/suppliers/${suppliers[who].id}/managed-products/${products[key].id}`, who, { expectedVersion: row.version, supplyEnabled: false }, 'PATCH');
  });
  for (const [mode, who] of [['stored', 'supplier2'], ['credit', 'supplier3'], ['company', 'supplier1'], ['direct', 'supplier4']]) {
    const label = { stored: '储值', credit: '挂账', company: '公司账期', direct: '供应商账期' }[mode];
    const name = `深圳门店订货模板（验收·${label}）`;
    templates[mode] = await create('/templates', `template:${mode}`, { code: `${manifest.prefix}_${mode}`, name, tag: '服务器场景验收', remark: '正常商品+停用/下架边界，价格以本模板为准' });
    await memo(`template-name:${mode}`, async () => { const row = await call(`/templates/${templates[mode].id}`, 'buyer'); return row.name === name ? row : call(`/templates/${row.id}`, 'buyer', { expectedVersion: row.version, name }, 'PATCH'); });
    await memo(`template-config-v2:${mode}`, async () => {
      const template = await call(`/templates/${templates[mode].id}`, 'buyer');
      return call(`/templates/${template.id}/items`, 'buyer', { expectedVersion: template.version,
        items: definitions.filter(([key]) => key !== 'unbound' && (key !== 'shelf' || mode === 'stored')).map(([key, , , , price], index) => ({ productId: products[key].id, sortOrder: index, isEnabled: true,
          suppliers: mode === 'stored' && ['tea', 'pearl', 'green', 'lettuce'].includes(key)
            ? [who, 'supplier5'].map((user, n) => ({ supplierId: suppliers[user].id, priority: ['green', 'lettuce'].includes(key) ? 1 - n : n, salesPrice: (Number(price) * (n ? 0.93 : 0.96)).toFixed(2) }))
            : [{ supplierId: suppliers[who].id, priority: 0, salesPrice: (Number(price) * 0.96).toFixed(2) }] })) }, 'PUT');
    });
    await memo(`template-bind:${mode}`, async () => { const template = await call(`/templates/${templates[mode].id}`, 'buyer'); return call(`/templates/${template.id}/stores`, 'buyer', { expectedVersion: template.version, storeIds: [shops[mode].id, ...(mode === 'stored' ? [shops.low.id, shops.disabled.id] : mode === 'credit' ? [shops.limit.id] : [])] }, 'PUT'); });
    if (['company', 'direct'].includes(mode)) await memo(`template-cycles:${mode}`, async () => { const template = await call(`/templates/${templates[mode].id}`, 'buyer'); return call(`/templates/${template.id}/settlement-cycles`, 'buyer', { expectedVersion: template.version, rows: [{ storeId: shops[mode].id, supplierId: suppliers[who].id, settlementCycle: mode === 'company' ? 'WEEKLY' : 'MONTHLY' }] }, 'PUT'); });
  }
  const collection = await create('/collection-accounts', 'collection', { name: '深圳运营收款账户（验收专用）', bankName: '验收银行（非真实收款账户）', accountName: '验收公司', accountNo: 'ACCEPTANCE-NOT-A-BANK-ACCOUNT' }, 'fin');
  await memo('recharge:1', async () => call(`/stores/${shops.stored.id}/recharges`, 'fin', { amount: '10000.00', businessDate: new Date().toISOString().slice(0, 10), collectionAccountId: collection.id, remark: '初始预充值验收，无真实转账', evidenceFileIds: [await evidence('fin', 'RECHARGE', 'Initial recharge 10000.00')] }));
  await memo('recharge:2', async () => call(`/stores/${shops.stored.id}/recharges`, 'fin', { amount: '500.00', businessDate: new Date().toISOString().slice(0, 10), collectionAccountId: collection.id, remark: '第二笔充值，验证多笔历史，无真实转账', evidenceFileIds: [await evidence('fin', 'RECHARGE', 'Second recharge 500.00')] }));
  for (const [key, limit] of [['credit', '5000.00'], ['limit', '10.00']]) await memo(`credit-limit:${key}`, async () => { const account = await call(`/stores/${shops[key].id}/account`, 'fin'); return call(`/stores/${shops[key].id}/credit-limit`, 'fin', { expectedVersion: account.version, limit, reason: '验收挂账额度配置' }, 'PATCH'); });
  console.log('Master data, all role accounts, catalog and genuine recharge/credit setup ready.');
  await orderCase('S01', '待采购确认', 'stored', [['tea', '1']], false);
  const split = await orderCase('S02', '多供应商拆单待发货', 'stored', [['pearl', '2'], ['green', '4']]); assert.equal(split.detail.supplierOrders.length, 2);
  await orderCase('S03', '采购可换供应商', 'stored', [['pearl', '3']], false);
  const rejected = await orderCase('S04', '采购拒绝，释放预占', 'stored', [['tea', '2']], false);
  await memo('S04:reject', async () => { const row = await call(`/purchase-requests/${rejected.request.id}`, 'buyer'); return call(`/purchase-requests/${row.id}/reject`, 'buyer', { expectedVersion: row.version, reason: '重复提交备货需求，门店请核对后重下（验收）' }); });
  const declined = await orderCase('S05', '供应商拒单待采购改派', 'stored', [['pearl', '4']]);
  await memo('S05:reject', async () => { const row = await call(`/supplier-orders/${declined.order.id}`, 'supplier2'); return call(`/supplier-orders/${row.id}/reject`, 'supplier2', { expectedVersion: row.version, reason: '该批粉圆临时缺货，请采购换备用供应商（验收）' }); });
  for (const [code, label] of [['S06', '全量已发货待收货'], ['S07', '少发待继续发货'], ['S08', '发货数量已更正待收货'], ['S09', '少收待门店决定'], ['S10', '待供应商补发'], ['S11', '补发已发出待收货'], ['S12', '少收按实收结算完成'], ['S13', '两批补发收货完成'], ['S14', '退回门店复核差异'], ['S15', '正常完整收货完成']]) {
    const current = await orderCase(code, label, 'stored', [['tea', String(Number(code.slice(1)) + 1)]]);
    const shipment = await ship(code, current.order);
    if (['S07', 'S08'].includes(code)) await memo(`${code}:revision`, async () => {
      const detail = await call(`/shipments/${shipment.id}`, 'supplier2');
      const order = await call(`/supplier-orders/${current.order.id}`, 'supplier2');
      const revision = await pool.query('SELECT MAX(revision) n FROM "ShipmentRevision" WHERE "shipmentId"=$1', [shipment.id]);
      return call(`/supplier-orders/${order.id}/shipments/${shipment.id}/revisions`, 'supplier2', { expectedOrderVersion: order.version, expectedRevision: Number(revision.rows[0].n), note: '分拣发现两袋外包装破损，本批减少2袋，后续补齐（验收）', evidenceFileIds: [await evidence('supplier2', 'SHIPMENT_ADJUSTMENT', `${code} packing damage`)],
        items: detail.items.map(item => ({ shipmentItemId: item.id, quantity: String(Number(item.shippedQuantity) - 2) })) });
    });
    if (['S09', 'S10', 'S11', 'S12', 'S13', 'S14'].includes(code)) {
      await receive(code, 'stored', shipment, 2);
      const action = code === 'S09' ? undefined : code === 'S12' ? 'ACCEPT' : code === 'S14' ? 'RETURN' : 'REPLENISH';
      const difference = await discrepancy(code, current.order, 'stored', action);
      manifest.cases[code].discrepancyId = difference.id; await save();
      if (['S11', 'S13'].includes(code)) {
        const extra = await ship(`${code}:extra`, current.order, ['2'], difference.replenishmentGap);
        manifest.cases[code].replenishmentShipmentId = extra.id; await save();
        if (code === 'S13') await receive(`${code}:extra`, 'stored', extra);
      }
    } else if (code === 'S15') await receive(code, 'stored', shipment);
    manifest.cases[code].shipmentId = shipment.id; await save();
  }
  for (const [code, label, mode] of [['C01', '挂账已收货未销账', 'credit'], ['C02', '挂账已销账', 'credit'], ['T01', '公司账期已收货未付款', 'company'], ['T02', '公司账期待财务确认付款', 'company'], ['T03', '公司账期已完成付款', 'company'], ['T04', '公司账期付款凭证退回', 'company'], ['D01', '供应商账期已收货未付款', 'direct'], ['D02', '供应商账期待供应商确认付款', 'direct'], ['D03', '供应商账期付款已确认', 'direct']]) {
    const current = await orderCase(code, label, mode, [['tea', String(Number(code.slice(1)) + 3)]]);
    const shipment = await ship(code, current.order); await receive(code, mode, shipment);
    manifest.cases[code].shipmentId = shipment.id; await save();
    if (code === 'C02') await memo('C02:clearing', async () => {
      const credit = await call(`/stores/${shops.credit.id}/credit-items`, 'fin');
      const row = credit.find(row => row.supplierOrderNo === current.order.supplierOrderNo); assert.ok(row, 'Missing credit item');
      const preview = await call(`/stores/${shops.credit.id}/clearings/preview`, 'fin', { fundingAllocationIds: [row.fundingAllocationId || row.id] });
      return call(`/stores/${shops.credit.id}/clearings`, 'fin', { businessDate: new Date().toISOString().slice(0, 10), remark: 'C02 挂账销账验收，无实际转账', evidenceFileIds: [await evidence('fin', 'CLEARING', 'C02 credit repayment')], items: preview.items.map(item => ({ fundingAllocationId: item.fundingAllocationId, expectedVersion: item.version, expectedAmount: item.clearableAmount })) });
    });
    if (['T02', 'T03', 'T04', 'D02', 'D03'].includes(code)) await payment(code, current.order, mode, 'STORE_TO_COMPANY', ['T03', 'D03'].includes(code) ? 'confirm' : code === 'T04' ? 'reject' : undefined);
    if (code === 'T03') await payment(code, current.order, mode, 'COMPANY_TO_SUPPLIER', 'confirm');
  }
  const reassigned = await orderCase('S16', '采购已换备用供应商待发货', 'stored', [['pearl', '6']], false);
  await memo('S16:assign', async () => {
    const detail = await call(`/purchase-requests/${reassigned.request.id}`, 'buyer');
    return call(`/purchase-requests/${detail.id}/assign`, 'buyer', { expectedVersion: detail.version, itemIds: detail.items.map(item => item.id), supplierId: suppliers.supplier5.id });
  });
  await memo('S16:confirm', async () => { const row = await call(`/purchase-requests/${reassigned.request.id}`, 'buyer'); return call(`/purchase-requests/${row.id}/confirm`, 'buyer', { expectedVersion: row.version }); });
  const reallocated = await orderCase('S17', '供应商拒单后已改派备用供应商', 'stored', [['pearl', '7']]);
  const originalOrderId = manifest.objects['S17:confirm'].supplierOrderIds[0];
  await memo('S17:reject', async () => { const row = await call(`/supplier-orders/${originalOrderId}`, 'supplier2'); return call(`/supplier-orders/${row.id}/reject`, 'supplier2', { expectedVersion: row.version, reason: '供货车辆故障，需备用供应商履约（验收）' }); });
  await memo('S17:reallocate', async () => { const row = await call(`/purchase-requests/${reallocated.request.id}`, 'buyer'); return call(`/purchase-requests/${row.id}/reallocate`, 'buyer', { expectedVersion: row.version, rejectedOrderId: originalOrderId, reason: '切换备用供应商保证门店备货（验收）', assignments: row.items.map(item => ({ requestItemId: item.id, supplierId: suppliers.supplier5.id })) }); });
  for (const [code, status] of [['C03', undefined], ['C04', 'reject'], ['C05', 'confirm']]) {
    const current = await orderCase(code, status === 'confirm' ? '运费审核通过并已收货' : status === 'reject' ? '运费审核已拒绝，等待供应商发货' : '运费待采购审核', 'credit', [['tea', '3']]);
    const freight = await memo(`${code}:freight`, async () => { const row = await call(`/supplier-orders/${current.order.id}`, 'supplier3'); return call(`/supplier-orders/${row.id}/freight-confirmations`, 'supplier3', { expectedVersion: row.version, amount: '5.00', reason: '跨区配送运费5元（验收）' }); });
    if (status) await memo(`${code}:freight:${status}`, () => call(`/freight-confirmations/${freight.id}/${status}`, 'buyer', { expectedVersion: freight.version, reason: status === 'reject' ? '应包含在原配送报价内（验收）' : '确认本次额外跨区配送（验收）' }));
    if (status === 'confirm') { const shipment = await ship(code, current.order, undefined, undefined, freight); await receive(code, 'credit', shipment); manifest.cases[code].shipmentId = shipment.id; }
    manifest.cases[code].freightId = freight.id; await save();
  }
  const payable = await orderCase('T05', '门店已付款，公司对供应商待确认付款', 'company', [['tea', '8']]);
  const payableShipment = await ship('T05', payable.order); await receive('T05', 'company', payableShipment);
  await payment('T05', payable.order, 'company', 'STORE_TO_COMPANY', 'confirm');
  await payment('T05', payable.order, 'company', 'COMPANY_TO_SUPPLIER');
  for (const [code, who, shop, label, mode] of [['U01', 'store_low', 'low', '储值下货单待补充资金', 'stored']]) {
    const request = await memo(`${code}:request`, () => call('/purchase-requests', who, { storeId: shops[shop].id, items: [{ productId: products.tea.id, quantity: '2' }] }));
    const detail = await call(`/purchase-requests/${request.id}`, 'buyer'); assert.equal(detail.status, 'PENDING_FUNDS'); assert.equal(detail.supplierOrders.length, 0);
    manifest.cases[code] = { code, label, mode, requestId: request.id, requestNo: request.requestNo }; await save();
  }
  const quotaFailure = await memo('U02:blocked', () => call('/purchase-requests', 'store_limit', { storeId: shops.limit.id, items: [{ productId: products.tea.id, quantity: '2' }] }, 'POST', 409));
  assert.equal(quotaFailure.code, 'CREDIT_LIMIT_EXCEEDED');
  manifest.cases.U02 = { code: 'U02', label: '挂账额度不足，创建下货单被拒绝', mode: 'credit', boundary: true, storeId: shops.limit.id, rejectedCode: quotaFailure.code };
  manifest.checks = [];
  for (const mode of modes) {
    const catalog = await call(`/stores/${shops[mode].id}/catalog`, chef(mode));
    assert.ok(catalog.items.length >= 10, `${mode} catalog`);
    assert.ok(!catalog.items.some(item => [products.off.id, products.unbound.id].includes(item.product.id)), 'Disabled or unbound product visible');
    const unsupplied = catalog.items.find(item => item.product.id === products.shelf.id);
    assert.ok(!unsupplied || unsupplied.suppliers.length === 0, 'Unlisted supplier remains orderable');
    manifest.checks.push({ case: `catalog-${mode}`, result: 'PASS', count: catalog.items.length });
  }
  await call('/users', 'supplier2', undefined, 'GET', 403);
  await call(`/stores/${shops.company.id}/account`, 'region', undefined, 'GET', 403);
  await call('/auth/login', '', { username: 'disabled_user', password: access.password, client: 'ACCEPTANCE' }, 'POST', 401);
  await call('/purchase-requests', 'store_fin1', { storeId: shops.stored.id, items: [{ productId: products.tea.id, quantity: '1' }] }, 'POST', 403);
  const low = await call('/purchase-requests/preview', 'store_low', { storeId: shops.low.id, items: [{ productId: products.tea.id, quantity: '1' }] }); assert.equal(low.funding.canConfirm, false);
  const limited = await call('/purchase-requests/preview', 'store_limit', { storeId: shops.limit.id, items: [{ productId: products.tea.id, quantity: '1' }] }); assert.equal(limited.funding.canConfirm, false);
  manifest.checks.push({ case: 'permissions-disabled-and-funding', result: 'PASS' });
  manifest.accounts = access.accounts.map(({ username, displayName, role }) => ({ username, displayName, role }));
  manifest.accountsSnapshot = {};
  for (const mode of modes) manifest.accountsSnapshot[mode] = await call(`/stores/${shops[mode].id}/account`, 'fin');
  for (const row of Object.values(manifest.cases)) {
    if (row.boundary) continue;
    const detail = await call(`/purchase-requests/${row.requestId}`, 'buyer');
    row.status = detail.status; row.paymentStatus = detail.paymentStatus; row.salesGoodsAmount = detail.salesGoodsAmount;
    row.orders = (detail.supplierOrders || []).map(order => ({ id: order.id, orderNo: order.supplierOrderNo, supplierId: order.supplierId, status: order.status, fulfillmentStatus: order.fulfillmentStatus }));
  }
  manifest.status = 'READY'; delete manifest.error; manifest.completedAt = new Date(); await save();
  console.log(JSON.stringify({ status: manifest.status, accounts: access.accounts.length, stores: Object.keys(shops).length, suppliers: Object.keys(suppliers).length, products: Object.keys(products).length, cases: Object.keys(manifest.cases).length, manifestPath, accessPath }));
} catch (error) {
  manifest.status = 'INCOMPLETE'; manifest.error = error.message; await save(); console.error(error.message); process.exitCode = 1;
} finally {
  for (const [who] of tokens) if (who !== 'admin') await call('/auth/logout', who, {}).catch(() => {});
  await pool.query('DELETE FROM "UserSession" WHERE id=$1', [bootstrapId]); await pool.end();
}
