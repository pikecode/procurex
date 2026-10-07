import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { createServer } from '../apps/admin/node_modules/vite/dist/node/index.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { DatabaseService } from '../dist/apps/api/src/database/database.service.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

assertLocalFixtureDatabase(process.env.DATABASE_URL);
process.env.FILE_STORAGE = 'local'; const storage = await mkdtemp(join(tmpdir(), 'procurex-product-form-')); process.env.PRIVATE_FILE_DIR = storage;
const prefix = `RXP${Date.now()}`, output = 'var/react-admin-product-form-evidence'; await mkdir(output, { recursive: true });
const report = { status: 'RUNNING', checks: [], screenshots: [], errors: [], boundary: 'Real React/API/database with temporary fixtures and isolated local private file storage; not OSS acceptance.' };
let app, vite, browser, db, actor;
try {
  app = await NestFactory.create(AppModule, { logger: false }); app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor()); await app.listen(0, '127.0.0.1'); db = app.get(DatabaseService).client;
  vite = await createServer({ root: resolve('apps/admin'), configFile: resolve('apps/admin/vite.config.mjs'), server: { port: 0, host: '127.0.0.1', proxy: { '/api': { target: `http://127.0.0.1:${app.getHttpServer().address().port}`, changeOrigin: true } } } }); await vite.listen();
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`, password = randomUUID();
  const role = await db.role.findUniqueOrThrow({ where: { code: 'ADMIN' } }); actor = await db.user.create({ data: { username: prefix, displayName: '商品表单验收', passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } } } });
  const category = await db.category.create({ data: { code: prefix, name: `${prefix}分类` } });
  const units = await Promise.all(['袋', '包'].map((name, index) => db.unit.create({ data: { code: `${prefix}${index}`, name: `${prefix}${name}` } })));
  const suppliers = await Promise.all([0, 1].map(index => db.supplier.create({ data: { code: `${prefix}${index}`, name: `${prefix}供应商${index}`, deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY' } })));
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }); const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${base}/products`); await page.getByLabel('用户名').fill(prefix); await page.getByLabel('密码', { exact: true }).fill(password); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.getByRole('heading', { name: '商品管理', exact: true }).waitFor();
  await page.getByRole('button', { name: '新增', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '新增商品', exact: true });
  const select = async (label, name) => { const input = dialog.getByLabel(label, { exact: true }); await input.click(); await input.fill(name); await page.locator('.ant-select-dropdown:visible').getByText(name, { exact: true }).click(); };
  await dialog.getByLabel('商品名称', { exact: true }).fill(`${prefix}商品`); await select('商品分类', category.name); await select('销售单位', units[0].name);
  await dialog.getByRole('tab', { name: '供应与采购', exact: true }).click();
  for (const supplier of suppliers) await select('关联供应商', supplier.name);
  await dialog.getByRole('tab', { name: '供应与采购', exact: true }).click(); await page.keyboard.press('Escape'); assert.equal(await dialog.getByLabel('每采购单位对应销售单位数量').count(), 0);
  await select('采购单位', units[1].name); await dialog.getByLabel('每采购单位对应销售单位数量').fill('10');
  const bytes = await sharp(randomBytes(1500 * 1000 * 3), { raw: { width: 1500, height: 1000, channels: 3 } }).png().toBuffer(); assert.ok(bytes.length > 2 * 1024 * 1024);
  await dialog.getByRole('tab', { name: '基本信息', exact: true }).click();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'large-product.png', mimeType: 'image/png', buffer: bytes });
  const crop = page.getByRole('dialog', { name: '裁切商品图片', exact: true }); await crop.getByRole('slider').fill('1.25').catch(async () => { await crop.getByRole('slider').focus(); await page.keyboard.press('ArrowRight'); });
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1100 }); await page.waitForTimeout(400); await crop.getByRole('button', { name: '确认上传' }).scrollIntoViewIfNeeded(); const file = `crop-${width}.png`; await page.screenshot({ path: `${output}/${file}` }); report.screenshots.push(file); }
  await crop.getByRole('button', { name: '确认上传' }).click(); await crop.waitFor({ state: 'hidden' });
  const uploadedFile = await db.fileObject.findFirstOrThrow({ where: { ownerId: actor.id, purpose: 'PRODUCT', status: 'READY' } });
  const encoded = await page.evaluate(async id => { const token = JSON.parse(sessionStorage.getItem('procurex-react-admin-session-v1')).accessToken; const response = await fetch(`/api/v1/files/${id}/download`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error(`Download ${response.status}`); const bytes = new Uint8Array(await response.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }, uploadedFile.id);
  const uploadedBytes = Buffer.from(encoded, 'base64'); assert.ok(uploadedBytes.length < 2 * 1024 * 1024); const image = await sharp(uploadedBytes).metadata(); assert.equal(image.width, image.height); assert.equal(image.format, 'jpeg');
  const saved = page.waitForResponse(r => r.url().endsWith('/products') && r.request().method() === 'POST'); await dialog.getByRole('button', { name: '保存', exact: true }).click(); assert.equal((await saved).status(), 201); await dialog.waitFor({ state: 'hidden' });
  let product = await db.product.findFirstOrThrow({ where: { name: `${prefix}商品` }, include: { conversion: true, suppliers: true } }); assert.equal(product.suppliers.length, 2); assert.equal(product.conversion.ratio.toString(), '10'); assert.ok(product.imageFileId);
  await page.reload(); await page.getByLabel('搜索商品管理').fill(product.name); await page.getByRole('button', { name: `编辑${product.name}`, exact: true }).click(); const editing = page.getByRole('dialog', { name: '编辑商品', exact: true });
  await editing.getByRole('tab', { name: '供应与采购', exact: true }).click();
  assert.equal(Number(await editing.getByLabel('每采购单位对应销售单位数量').inputValue()), 10);
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1100 }); await editing.getByLabel('每采购单位对应销售单位数量').scrollIntoViewIfNeeded(); await page.waitForTimeout(400); const file = `product-form-${width}.png`; await page.screenshot({ path: `${output}/${file}` }); report.screenshots.push(file); }
  await editing.getByLabel('采购单位', { exact: true }).locator('..').locator('..').hover(); await editing.locator('.ant-select-clear').last().click();
  assert.equal(await editing.getByLabel('每采购单位对应销售单位数量').count(), 0);
  const updated = page.waitForResponse(r => r.url().endsWith(`/products/${product.id}`) && r.request().method() === 'PATCH'); await editing.getByRole('button', { name: '保存', exact: true }).click(); assert.equal((await updated).status(), 200); await editing.waitFor({ state: 'hidden' }); assert.equal(await db.productUnitConversion.count({ where: { productId: product.id } }), 0);
  await page.getByRole('button', { name: `编辑${product.name}`, exact: true }).click();
  const pricing = page.getByRole('dialog', { name: '编辑商品', exact: true });
  await pricing.waitFor();
  await pricing.getByRole('tab', { name: '供应与采购', exact: true }).click();
  for (const [index, supplier] of suppliers.entries()) await pricing.getByLabel(supplier.name, { exact: true }).fill(index ? '8' : '6');
  const priceSave = page.waitForResponse(r => r.url().endsWith(`/products/${product.id}`) && r.request().method() === 'PATCH');
  await pricing.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal((await priceSave).status(), 200); await pricing.waitFor({ state: 'hidden' });
  const scopes = await db.priceScope.findMany({ where: { productId: product.id, templateKey: '' }, include: { versions: true } });
  assert.equal(scopes.length, 2);
  for (const scope of scopes) { assert.equal(scope.versions.length, 1); assert.equal(scope.versions[0].supplyPrice.toString(), scope.supplierId === suppliers[0].id ? '6' : '8'); }
  await page.getByRole('button', { name: `编辑${product.name}`, exact: true }).click();
  await pricing.getByRole('tab', { name: '供应与采购', exact: true }).click();
  assert.equal(Number(await pricing.getByLabel(suppliers[0].name, { exact: true }).inputValue()), 6);
  const before = await db.product.findUniqueOrThrow({ where: { id: product.id } });
  await db.priceVersion.create({ data: { scopeId: scopes.find(row => row.supplierId === suppliers[0].id).id, salesPrice: '0', supplyPrice: '9', effectiveAt: new Date(), revision: 2 } });
  await pricing.getByRole('tab', { name: '基本信息', exact: true }).click();
  await pricing.getByLabel('商品名称', { exact: true }).fill(`${prefix}不应保存`);
  const stale = page.waitForResponse(r => r.url().endsWith(`/products/${product.id}`) && r.request().method() === 'PATCH');
  await pricing.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal((await stale).status(), 409);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).name, before.name);
  assert.equal(await db.priceVersion.count({ where: { scope: { productId: product.id } } }), 3);
  await pricing.getByRole('button', { name: '取消', exact: true }).click();
  await db.supplier.update({ where: { id: suppliers[0].id }, data: { defaultSettlementMode: 'SUPPLIER_TERM' } });
  await page.reload(); await page.getByLabel('搜索商品管理').fill(product.name);
  await page.getByRole('button', { name: `编辑${product.name}`, exact: true }).click();
  await pricing.getByRole('tab', { name: '供应与采购', exact: true }).click();
  await pricing.getByLabel(suppliers[0].name, { exact: true }).fill('12');
  const direct = page.waitForResponse(r => r.url().endsWith(`/products/${product.id}`) && r.request().method() === 'PATCH');
  await pricing.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal((await direct).status(), 200); await pricing.waitFor({ state: 'hidden' });
  const directPrice = await db.priceVersion.findFirstOrThrow({ where: { scope: { productId: product.id, supplierId: suppliers[0].id } }, orderBy: { revision: 'desc' } });
  assert.equal(directPrice.salesPrice.toString(), '12'); assert.equal(directPrice.supplyPrice.toString(), '12');
  report.checks = ['商品及供应商关联/换算原子保存', '采购价按供应商内联填写并一次保存', '采购价刷新回显', '并发价格冲突回滚商品修改', '供应商直接账期销售供货价一致', '图片裁切压缩与桌面手机截图'];
  assert.deepEqual(report.errors, []); report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.errors.push(error.stack); process.exitCode = 1; }
finally {
  await browser?.close(); await vite?.close();
  if (db) {
    await db.priceVersion.deleteMany({ where: { scope: { productId: { in: (await db.product.findMany({ where: { name: `${prefix}商品` }, select: { id: true } })).map(row => row.id) } } } });
    await db.priceScope.deleteMany({ where: { supplierId: { in: (await db.supplier.findMany({ where: { code: { startsWith: prefix } }, select: { id: true } })).map(row => row.id) } } });
    await db.supplierProduct.deleteMany({ where: { product: { name: `${prefix}商品` } } }); await db.productUnitConversion.deleteMany({ where: { product: { name: `${prefix}商品` } } }); await db.product.deleteMany({ where: { name: `${prefix}商品` } });
    if (actor) { await db.fileObject.deleteMany({ where: { ownerId: actor.id } }); await db.auditLog.deleteMany({ where: { actorUserId: actor.id } }); await db.user.delete({ where: { id: actor.id } }); }
    await db.supplier.deleteMany({ where: { code: { startsWith: prefix } } }); await db.category.deleteMany({ where: { code: prefix } }); await db.unit.deleteMany({ where: { code: { startsWith: prefix } } }); report.cleanup = 'PASS';
  }
  await app?.close(); await rm(storage, { recursive: true, force: true }); await writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
