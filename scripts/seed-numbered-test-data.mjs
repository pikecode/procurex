import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { DatabaseService } from '../dist/apps/api/src/database/database.service.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

const url = new URL(process.env.DATABASE_URL);
const serverSeed = process.env.CONFIRM_SERVER_NUMBERED_SEED === 'replace-with-numbered-test-baseline' &&
  process.env.NODE_ENV === 'production' && url.hostname === 'postgres' && url.pathname === '/procurex';
if (!serverSeed) {
  assertLocalFixtureDatabase(process.env.DATABASE_URL);
  assert.equal(url.port, '55438'); assert.equal(url.pathname, '/procurex');
}
const verifyOnly = process.argv.includes('--verify-only');
assert.ok(verifyOnly || process.argv.includes('--apply'), 'Use --apply to seed an empty local database, or --verify-only');
// Local fixtures keep their documented disposable password. A server seed must
// receive a separate strong password and stores it only in the private volume.
const password = serverSeed ? process.env.NUMBERED_TEST_PASSWORD : '12345678';
assert.ok(typeof password === 'string' && (!serverSeed || password.length >= 20), 'A strong NUMBERED_TEST_PASSWORD is required for a server seed');
process.env.FILE_STORAGE = 'local';
const manifestPath = resolve(process.env.NUMBERED_TEST_MANIFEST || 'var/private-files/numbered-test-data.json');
const accessPath = serverSeed ? resolve(process.env.NUMBERED_TEST_ACCESS || '/app/data/files/numbered-test-access.json') : '';
const app = await NestFactory.create(AppModule, { logger: false });
app.setGlobalPrefix('api/v1');
app.useGlobalFilters(new ApiExceptionFilter());
app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
await app.listen(0, '127.0.0.1');
const db = app.get(DatabaseService).client;
const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
const tokens = new Map();
let manifest;
async function call(path, who, body, expectedStatus) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(tokens.has(who) ? { authorization: `Bearer ${tokens.get(who)}` } : {}), 'content-type': 'application/json', 'idempotency-key': randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (expectedStatus) { assert.equal(response.status, expectedStatus, `${path}: ${JSON.stringify(result)}`); return result; }
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(result)}`);
  return result.data;
}
async function login(account) {
  const result = await call('/auth/login', '', { username: account.username, password, client: 'LOCAL_NUMBERED_SEED' });
  tokens.set(account.username, result.accessToken);
  assert.deepEqual(result.user.roles, [account.role]);
  return result.user;
}
try {
  if (verifyOnly) manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  else {
    for (const model of ['product', 'category', 'unit', 'supplier', 'store', 'orderTemplate', 'purchaseRequest', 'supplierOrder', 'rechargeDocument']) assert.equal(await db[model].count(), 0, `${model} must be empty; refusing to overwrite existing data`);
    assert.equal(await db.user.count(), 1, 'Only the existing admin account may exist');
    const passwordHash = await hashPassword(password);
    manifest = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.catalog-registry'))`;
      const effectiveAt = new Date(Date.now() - 60000);
      const roles = Object.fromEntries((await tx.role.findMany()).map(role => [role.code, role.id]));
      const accounts = [], stores = {}, suppliers = {}, products = {}, templates = {};
      const unit = await tx.unit.create({ data: { code: 'NUM_UNIT_1', name: '件' } });
      const box = await tx.unit.create({ data: { code: 'NUM_UNIT_2', name: '箱' } });
      const groups = [];
      for (let n = 1; n <= 2; n++) groups.push(await tx.storeGroup.create({ data: { name: `分组${n}` } }));
      const categories = {};
      for (let n = 1; n <= 3; n++) {
        const parent = await tx.category.create({ data: { code: `NUM_CATEGORY_ROOT_${n}`, name: `分类分组${n}`, sortOrder: n } });
        for (const leaf of n === 1 ? [1, 2] : n === 2 ? [3, 4] : [5]) categories[leaf] = await tx.category.create({ data: { code: `NUM_CATEGORY_${leaf}`, name: `分类${leaf}`, parentId: parent.id, sortOrder: leaf } });
      }
      const modes = ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM', 'STORED_VALUE'];
      for (let n = 1; n <= 5; n++) suppliers[n] = await tx.supplier.create({ data: { code: `NUM_SUPPLIER_${n}`, name: `供应商${n}`,
        deliveryMode: n === 2 || n === 4 ? 'LOGISTICS' : 'SELF', defaultSettlementMode: modes[n - 1],
        defaultSettlementCycle: n === 3 ? 'MONTHLY' : n === 4 ? 'HALF_MONTHLY' : 'IMMEDIATE',
        contactName: `联系人${n}`, contactPhone: `1390000000${n}`, deliveryContactPhone: `1370000000${n}`,
        address: `广东省深圳市南山区供应商路${n}号`, supplierType: n === 4 ? 'DIRECT' : 'HEADQUARTERS', requiresFreight: false,
        remark: '本地编号测试数据，不代表真实交易主体' } });
      for (let n = 1; n <= 15; n++) products[n] = await tx.product.create({ data: { sku: `NUM_PRODUCT_${n}`, name: `商品${n}`,
        categoryId: categories[Math.min(5, Math.ceil(n / 3))].id, baseUnitId: unit.id,
        defaultSalesPrice: String(n * 10), specification: '1件', storageCondition: 'AMBIENT',
        minOrderQty: n === 5 ? '2' : '1', orderMultiple: n === 6 ? '3' : '1', isActive: n !== 14 } });
      await tx.productUnitConversion.create({ data: { productId: products[3].id, fromUnitId: box.id, toUnitId: unit.id, ratio: '10' } });
      const sharedPrices = new Map();
      const links = [...Array.from({ length: 12 }, (_, index) => [index + 1, Math.ceil((index + 1) / 3), (index + 1) * 10]),
        [2, 5, 30], [3, 5, 40], [13, 5, 130], [14, 1, 140], [15, 1, 150]];
      for (const [product, supplier, price] of links) {
        await tx.supplierProduct.create({ data: { productId: products[product].id, supplierId: suppliers[supplier].id, supplyEnabled: product !== 13 } });
        const scope = await tx.priceScope.create({ data: { productId: products[product].id, supplierId: suppliers[supplier].id, templateKey: '', versions: { create: { salesPrice: String(product * 10), supplyPrice: String(price), effectiveAt, revision: 1, reason: '本地编号测试初始供应商价格' } } }, include: { versions: true } });
        sharedPrices.set(`${product}:${supplier}`, scope.versions[0]);
      }
      const definitions = {
        1: [[1, [[1, 10]]], [2, [[1, 20]]], [3, [[1, 30]]], [14, [[1, 140]]]],
        2: [[4, [[2, 40]]], [5, [[2, 50]]], [6, [[2, 60]]]],
        3: [[7, [[3, 80]]], [8, [[3, 90]]], [9, [[3, 100]]]],
        4: [[10, [[4, 110]]], [11, [[4, 120]]], [12, [[4, 130]]]],
        5: [[1, [[1, 10]]], [4, [[2, 40]]], [7, [[3, 90]]], [10, [[4, 120]]]],
        6: [[2, [[1, 20], [5, 40]]], [3, [[1, 30], [5, 60]]], [13, [[5, 130]]]],
      };
      for (let n = 1; n <= 6; n++) {
        templates[n] = await tx.orderTemplate.create({ data: { code: `NUM_TEMPLATE_${n}`, name: `模板${n}`, tag: `标签${n}`, remark: `本地编号测试模板${n}` } });
        for (const [index, [product, options]] of definitions[n].entries()) {
          const item = await tx.templateItem.create({ data: { templateId: templates[n].id, productId: products[product].id, sortOrder: index, initialSalesPrice: String(options[0][1]) } });
          for (const [priority, [supplier, salesPrice]] of options.entries()) {
            await tx.templateItemSupplier.create({ data: { templateItemId: item.id, supplierId: suppliers[supplier].id, priority } });
            const source = sharedPrices.get(`${product}:${supplier}`);
            await tx.priceScope.create({ data: { productId: products[product].id, supplierId: suppliers[supplier].id, templateKey: templates[n].id,
              versions: { create: { salesPrice: String(salesPrice), supplyPrice: source.supplyPrice, supplySourceVersionId: source.id, effectiveAt, revision: 1, reason: '本地编号测试模板销售价格' } } } });
          }
        }
      }
      const bindings = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 9: 1, 10: 2 };
      for (let n = 1; n <= 10; n++) {
        stores[n] = await tx.store.create({ data: { code: `NUM_STORE_${n}`, name: `门店${n}`, groupName: groups[n <= 5 ? 0 : 1].name,
          storeType: n === 2 ? 'FRANCHISE' : 'DIRECT', contactName: `店长${n}`, contactPhone: `138000000${String(n).padStart(2, '0')}`,
          address: `广东省 / 深圳市 / 南山区 / 门店路${n}号` } });
        await tx.storeAccount.create({ data: { storeId: stores[n].id, creditLimit: n === 3 || n === 6 ? '1000' : n === 10 ? '50' : '0', creditCumulative: '0' } });
        if (bindings[n]) await tx.storeTemplateBinding.create({ data: { storeId: stores[n].id, templateId: templates[bindings[n]].id, effectiveAt } });
      }
      await tx.templateStoreSupplierCycle.create({ data: { templateId: templates[3].id, storeId: stores[4].id, supplierId: suppliers[3].id, settlementCycle: 'WEEKLY' } });
      async function user(username, displayName, role, scope = { scopeType: 'COMPANY' }) {
        assert.ok(roles[role], `Missing role ${role}`);
        await tx.user.create({ data: { username, displayName, passwordHash, roles: { create: { roleId: roles[role] } }, scopes: { create: scope } } });
        accounts.push({ username, displayName, role });
      }
      for (let n = 1; n <= 10; n++) {
        await user(`store${n}`, `门店用户${n}`, 'STORE', { scopeType: 'STORE', storeId: stores[n].id });
        await user(`storefin${n}`, `门店财务${n}`, 'STORE_FINANCE', { scopeType: 'STORE', storeId: stores[n].id });
      }
      for (let n = 1; n <= 5; n++) await user(`supplier${n}`, `供应商用户${n}`, 'SUPPLIER', { scopeType: 'SUPPLIER', supplierId: suppliers[n].id });
      await user('buyer1', '采购用户1', 'PURCHASER');
      await user('buyer2', '采购用户2', 'PURCHASE_FOLLOWER', { scopeType: 'MULTI_STORE', stores: { create: [1, 2, 3].map(n => ({ storeId: stores[n].id })) } });
      await user('fin1', '财务用户1', 'HQ_FINANCE');
      await user('fin2', '财务用户2', 'REGION_FINANCE', { scopeType: 'MULTI_STORE', stores: { create: [1, 2, 3].map(n => ({ storeId: stores[n].id })) } });
      await user('region1', '区域用户1', 'REGION_MANAGER', { scopeType: 'MULTI_STORE', stores: { create: [1, 2, 3].map(n => ({ storeId: stores[n].id })) } });
      const collection = await tx.collectionAccount.create({ data: { name: '收款账户1', bankName: '测试银行1', accountName: '测试公司1', accountNo: 'TEST-ACCOUNT-1' } });
      return { createdAt: new Date().toISOString(), stores, suppliers, products, templates, accounts, unitId: unit.id, boxId: box.id, collectionAccountId: collection.id, recharges: {} };
    }, { timeout: 30000 });
    await mkdir(dirname(manifestPath), { recursive: true, mode: 0o700 });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    if (serverSeed) await writeFile(accessPath, JSON.stringify({ createdAt: new Date().toISOString(), password,
      accounts: manifest.accounts.map(({ username, displayName, role }) => ({ username, displayName, role })) }, null, 2), { mode: 0o600, flag: 'wx' });
  }
  for (const account of manifest.accounts) {
    const user = await login(account);
    if (account.username.startsWith('store')) assert.equal(user.scope.storeId, manifest.stores[Number(account.username.replace(/^storefin|^store/, ''))].id);
    if (account.username.startsWith('supplier')) assert.equal(user.scope.supplierId, manifest.suppliers[Number(account.username.slice(8))].id);
    if (['buyer2', 'fin2', 'region1'].includes(account.username)) assert.deepEqual([...user.scope.storeIds].sort(), [1, 2, 3].map(n => manifest.stores[n].id).sort());
  }
  if (!verifyOnly) for (const [n, amount] of [[1, 1000], [2, 1000], [6, 1000], [7, 1000], [9, 20]]) {
    const bytes = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="white"/><text x="30" y="70" font-size="28">LOCAL TEST ONLY</text><text x="30" y="150" font-size="26">Store ${n} - Recharge ${amount}</text><text x="30" y="240" font-size="22">NOT A REAL BANK RECEIPT</text></svg>`)).png().toBuffer();
    const file = await call('/files/upload-sessions', 'fin1', { purpose: 'RECHARGE', filename: `充值凭证${n}.png`, mimeType: 'image/png', sizeBytes: bytes.length });
    const upload = await fetch(`${base}/files/${file.id}/content`, { method: 'POST', headers: { authorization: `Bearer ${tokens.get('fin1')}`, 'x-upload-token': file.uploadToken, 'content-type': 'application/octet-stream' }, body: bytes });
    assert.ok(upload.ok); await call(`/files/${file.id}/complete`, 'fin1', {});
    const recharge = await call(`/stores/${manifest.stores[n].id}/recharges`, 'fin1', { amount: String(amount), businessDate: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }), collectionAccountId: manifest.collectionAccountId, remark: `门店${n}测试初始充值，不代表实际转账`, evidenceFileIds: [file.id] });
    manifest.recharges[n] = recharge.id;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  }
  const cases = [[1, [[1, 1], [2, 1], [3, 1]], 60], [3, [[4, 1], [5, 2], [6, 3]], 320], [4, [[7, 1], [8, 1], [9, 1]], 270],
    [5, [[10, 1], [11, 1], [12, 1]], 360], [6, [[1, 1], [4, 1], [7, 1], [10, 1]], 260], [7, [[2, 1], [3, 1]], 50]];
  for (const [store, lines, amount] of cases) {
    const preview = await call('/purchase-requests/preview', `store${store}`, { storeId: manifest.stores[store].id, items: lines.map(([n, quantity]) => ({ productId: manifest.products[n].id, quantity: String(quantity) })) });
    assert.equal(Number(preview.totals.salesGoodsAmount), amount); assert.equal(preview.funding.canConfirm, true);
    if (store === 6) assert.equal(new Set(preview.items.map(item => item.supplierId)).size, 4);
  }
  const converted = await call('/purchase-requests/preview', 'store1', { storeId: manifest.stores[1].id, items: [{ productId: manifest.products[3].id, quantity: '1', unitId: manifest.boxId }] });
  assert.equal(Number(converted.totals.salesGoodsAmount), 300);
  for (const [product, quantity] of [[5, '1'], [6, '2']]) {
    const error = await call('/purchase-requests/preview', 'store3', { storeId: manifest.stores[3].id, items: [{ productId: manifest.products[product].id, quantity }] }, 409);
    assert.equal(error.code ?? error.error?.code, 'INVALID_ITEM_QUANTITY');
  }
  const catalog = await call(`/stores/${manifest.stores[7].id}/catalog`, 'store7');
  assert.deepEqual(catalog.items.find(row => row.product.id === manifest.products[2].id).suppliers.map(row => [row.supplierId, Number(row.salesPrice)]), [[manifest.suppliers[1].id, 20], [manifest.suppliers[5].id, 40]]);
  for (const [who, store, product, status, code] of [['store8', 8, 1, 404, 'STORE_TEMPLATE_NOT_FOUND'], ['store1', 1, 15, 409, 'PRODUCT_NOT_IN_CATALOG'], ['store1', 1, 14, 404, 'PRODUCT_NOT_IN_CATALOG'], ['store7', 7, 13, 409, 'PRICE_NOT_AVAILABLE']]) {
    const error = await call('/purchase-requests/preview', who, { storeId: manifest.stores[store].id, items: [{ productId: manifest.products[product].id, quantity: '1' }] }, status);
    assert.equal(error.code ?? error.error?.code, code);
  }
  for (const [store, lines, shortfall] of [[9, [[1, 1], [2, 1], [3, 1]], 40], [10, [[4, 1], [5, 2], [6, 3]], 270]]) {
    const preview = await call('/purchase-requests/preview', `store${store}`, { storeId: manifest.stores[store].id, items: lines.map(([n, q]) => ({ productId: manifest.products[n].id, quantity: String(q) })) });
    assert.equal(preview.funding.canConfirm, false);
    assert.equal(Number(store === 9 ? preview.funding.stored.shortfall : preview.funding.credit.shortfall), shortfall);
  }
  assert.equal(await db.purchaseRequest.count(), 0); assert.equal(await db.supplierOrder.count(), 0);
  assert.equal(await db.rechargeDocument.count(), 5); assert.equal(await db.accountLedger.count(), 5);
  for (let n = 1; n <= 10; n++) {
    const account = await db.storeAccount.findUniqueOrThrow({ where: { storeId: manifest.stores[n].id } });
    assert.equal(Number(account.balance), [1, 2, 6, 7].includes(n) ? 1000 : n === 9 ? 20 : 0);
    assert.equal(Number(account.creditLimit), n === 3 || n === 6 ? 1000 : n === 10 ? 50 : 0);
    assert.equal(Number(account.reservedBalance), 0); assert.equal(Number(account.creditUsed), 0);
  }
  for (const who of tokens.keys()) await call('/auth/logout', who, {});
  await db.userSession.updateMany({ where: { client: 'LOCAL_NUMBERED_SEED', revokedAt: null }, data: { revokedAt: new Date() } });
  manifest.verifiedAt = new Date().toISOString();
  manifest.checks = ['30个真实账号登录及范围', '6种模板报价金额', '4供应商混合拆单预览', '采购单位换算及起订量/倍数', '备用供应商独立价格', '模板/上下架/停用限制', '资金及挂账不足', '5笔实际充值与账户流水及余额', '零预置订单'];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'PASS', stores: await db.store.count(), suppliers: await db.supplier.count(), products: await db.product.count(), templates: await db.orderTemplate.count(), users: await db.user.count(), recharges: 5, orders: 0, checks: manifest.checks, manifestPath }));
} finally { await app.close(); }
