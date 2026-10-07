import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';

const base = process.env.PROCUREX_API_BASE || 'http://127.0.0.1:3113/api/v1';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const project = resolve('apps/miniprogram');
const output = resolve('var/unit-conversion-native-evidence');
const cli = process.env.WECHATIDE_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide';
const prefix = `PXUNIT${Date.now()}`;
const password = randomUUID();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const manifest = { generatedAt: new Date().toISOString(), fixturePrefix: prefix, status: 'RUNNING', runtime: 'WeChat Developer Tools', realDevice: false,
  scope: 'Isolated company-term fixture; native unit choice and real HTTP preview, stale configuration rejected before creating any order; no payments or ledger writes', screenshots: [] };
await mkdir(output, { recursive: true });
let fixtureStoreId;

function tool(name, options = {}) {
  const args = ['-c', 'Codex', name, '--project', project];
  for (const [key, value] of Object.entries(options)) args.push(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
  const result = spawnSync(cli, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  const start = result.stdout?.indexOf('{') ?? -1;
  if (start < 0) throw new Error(`${name}: no result`);
  const body = JSON.parse(result.stdout.slice(start));
  if (result.status !== 0 || !body.ok || body.result?.success === false || body.result?.status === 'pending') throw new Error(`${name}: ${body.message || body.result?.error || 'failed'}`);
  return body.result;
}
const data = path => tool('automation_page_action', { action: 'getData', dataPath: path }).data;
const patch = value => tool('automation_page_action', { action: 'setData', patch: value });
async function method(name, event) {
  const path = resolve(output, 'method-args.json'); await writeFile(path, JSON.stringify(event ? [event] : []));
  return tool('automation_page_action', { action: 'callMethod', method: name, argsFile: path });
}
function wait(path, predicate) {
  for (let attempt = 0; attempt < 25; attempt++) { const value = data(path); if (predicate(value)) return value; }
  throw new Error(`Missing native state: ${path}`);
}
function screenshot(name) {
  tool('simulator_screenshot', { path: resolve(output, `${name}.jpg`) }); manifest.screenshots.push(`${name}.jpg`);
  console.log(`Unit conversion: ${name}`);
}

try {
  const role = await db.role.upsert({ where: { code: 'STORE' }, update: {}, create: { code: 'STORE', name: 'Store' } });
  const category = await db.category.create({ data: { code: prefix, name: '饮用水' } });
  const bottle = await db.unit.create({ data: { code: `${prefix}B`, name: '瓶' } });
  const pack = await db.unit.create({ data: { code: `${prefix}P`, name: '箱' } });
  const store = await db.store.create({ data: { code: prefix, name: '单位换算验收门店' } });
  fixtureStoreId = store.id;
  const supplier = await db.supplier.create({ data: { code: prefix, name: '饮用水供应商', deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY' } });
  const template = await db.orderTemplate.create({ data: { code: prefix, name: prefix, tag: '单位换算验收' } });
  const product = await db.product.create({ data: { sku: prefix, name: '饮用水 500 mL', specification: '500 mL / 瓶', categoryId: category.id, baseUnitId: bottle.id, minOrderQty: '2', orderMultiple: '2',
    conversion: { create: { fromUnitId: pack.id, toUnitId: bottle.id, ratio: '12' } } } });
  await db.templateItem.create({ data: { templateId: template.id, productId: product.id, suppliers: { create: { supplierId: supplier.id, priority: 1 } } } });
  await db.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } });
  const scope = await db.priceScope.create({ data: { productId: product.id, supplierId: supplier.id } });
  await db.priceVersion.create({ data: { scopeId: scope.id, salesPrice: '1.234567', supplyPrice: '1', effectiveAt: new Date('2026-01-01') } });
  const user = await db.user.create({ data: { username: prefix, displayName: '单位换算验收', passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } },
    scopes: { create: { scopeType: 'STORE', storeId: store.id } } } });
  tool('simulator_open_page', { page: 'pages/login/index' });
  wait('loading', value => value === false);
  patch({ username: user.username, password, apiBase: base });
  tool('automation_element_action', { action: 'tap', selector: '.primary', waitForSelector: '.primary' });
  wait('storeId', value => value === store.id); wait('products', value => value?.length === 1);
  await method('chooseProductUnit', { currentTarget: { dataset: { id: product.id } }, detail: { value: '1' } });
  await method('setProductQuantity', { currentTarget: { dataset: { id: product.id } }, detail: { value: '2.5' } });
  assert.equal(data('cart')[0].unitId, pack.id); assert.equal(data('estimatedAmount'), '37.04');
  assert.equal(data('visibleProducts')[0].displayPrice, '14.814804'); screenshot('purchase-unit-catalog');
  await method('toggleCart'); screenshot('purchase-unit-cart'); await method('toggleCart');
  await method('previewOrder');
  const preview = wait('preview', value => value?.items?.length === 1);
  assert.equal(preview.items[0].quantity, '30'); assert.equal(preview.items[0].unitSnapshot.inputQuantity, '2.5');
  assert.equal(preview.items[0].purchaseSalesUnitPrice, '14.814804'); assert.equal(preview.totals.salesGoodsAmount, '37.04');
  screenshot('purchase-unit-checkout');
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.catalog-registry'))`;
    await tx.productUnitConversion.update({ where: { productId: product.id }, data: { ratio: '24' } });
    await tx.product.update({ where: { id: product.id }, data: { updatedAt: new Date(Math.max(Date.now(), product.updatedAt.getTime() + 1)) } });
  });
  await method('submitOrder'); wait('error', value => Boolean(value));
  assert.equal(await db.purchaseRequest.count({ where: { storeId: store.id } }), 0); assert.equal(data('pendingOrder'), null);
  screenshot('stale-unit-configuration');
  await method('backToCatalog'); await method('loadCatalog');
  await method('chooseProductUnit', { currentTarget: { dataset: { id: product.id } }, detail: { value: '0' } });
  assert.equal(data('cart').length, 0);
  await method('stepProduct', { currentTarget: { dataset: { id: product.id, direction: 1 } } });
  assert.equal(data('cart')[0].quantity, '2'); assert.equal(data('visibleProducts')[0].displayUnitName, '瓶');
  screenshot('sales-unit-reset');
  manifest.pageSize = tool('automation_page_action', { action: 'size' });
  manifest.status = 'PASSED';
} catch (error) { manifest.status = 'FAILED'; manifest.error = error.message; throw error; }
finally {
  try {
    if (fixtureStoreId && data('storeId') === fixtureStoreId) await method('logout');
    else tool('simulator_open_page', { page: 'pages/login/index' });
  } catch (error) { manifest.uiResetError = error.message; }
  try {
    assert.equal(await db.purchaseRequest.count({ where: { store: { code: prefix } } }), 0);
    assert.equal(await db.accountLedger.count({ where: { account: { store: { code: prefix } } } }), 0);
    const productIds = (await db.product.findMany({ where: { sku: prefix }, select: { id: true } })).map(item => item.id);
    await db.priceVersion.deleteMany({ where: { scope: { productId: { in: productIds } } } }); await db.priceScope.deleteMany({ where: { productId: { in: productIds } } });
    await db.templateItemSupplier.deleteMany({ where: { templateItem: { template: { code: prefix } } } }); await db.templateItem.deleteMany({ where: { template: { code: prefix } } });
    await db.storeTemplateBinding.deleteMany({ where: { template: { code: prefix } } }); await db.product.deleteMany({ where: { sku: prefix } }); await db.orderTemplate.deleteMany({ where: { code: prefix } });
    await db.user.deleteMany({ where: { username: prefix } }); await db.storeAccount.deleteMany({ where: { store: { code: prefix } } }); await db.store.deleteMany({ where: { code: prefix } });
    await db.supplier.deleteMany({ where: { code: prefix } }); await db.category.deleteMany({ where: { code: prefix } }); await db.unit.deleteMany({ where: { code: { in: [`${prefix}B`, `${prefix}P`] } } });
    manifest.fixtureCleanup = 'PASSED';
  } catch (error) { manifest.fixtureCleanup = 'FAILED'; manifest.cleanupError = error.message; if (manifest.status === 'PASSED') manifest.status = 'FAILED'; }
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'); await db.$disconnect();
}
assert.equal(manifest.status, 'PASSED'); assert.equal(manifest.fixtureCleanup, 'PASSED');
console.log(`Native unit evidence PASSED; ${manifest.screenshots.length} screenshots; fixture cleanup PASSED.`);
