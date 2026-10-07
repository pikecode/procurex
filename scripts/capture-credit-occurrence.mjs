import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { DatabaseService } from '../dist/apps/api/src/database/database.service.js';
import { PricingService } from '../dist/apps/api/src/pricing/pricing.service.js';
import { PurchaseRequestsService } from '../dist/apps/api/src/purchase-requests/purchase-requests.service.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const api = process.env.WORKSPACE_API_URL || 'http://127.0.0.1:3114/api/v1';
const web = process.env.WORKSPACE_WEB_URL || 'http://127.0.0.1:4173';
for (const url of [api, web]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const db = app.get(DatabaseService).client;
const prefix = `COB${Date.now()}`, password = randomUUID();
const directory = resolve('var/credit-occurrence-evidence'); await mkdir(directory, { recursive: true });
const manifest = { status: 'RUNNING', prefix, screenshots: [], errors: [], scope: 'Real procurement services create and confirm 300+700; formal finance UI clears selected300 with uploaded proof. Not an all-UI procurement/fulfillment chain, bank funds or device acceptance.' };
let browser;
try {
  const category = await db.category.create({ data: { code: prefix, name: prefix } });
  const unit = await db.unit.create({ data: { code: prefix, name: 'piece' } });
  const product = await db.product.create({ data: { sku: prefix, name: '挂账验收商品', categoryId: category.id, baseUnitId: unit.id } });
  const supplier = await db.supplier.create({ data: { code: prefix, name: prefix, deliveryMode: 'SELF', defaultSettlementMode: 'CREDIT', defaultSettlementCycle: 'MONTHLY' } });
  await db.supplierProduct.create({ data: { productId: product.id, supplierId: supplier.id } });
  const store = await db.store.create({ data: { code: prefix, name: '精确挂账验收门店' } });
  await db.storeAccount.create({ data: { storeId: store.id, creditLimit: '2000' } });
  await db.orderTemplate.create({ data: { code: prefix, name: prefix, bindings: { create: { storeId: store.id } }, items: { create: { productId: product.id, suppliers: { create: { supplierId: supplier.id } } } } } });
  await app.get(PricingService).publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '100', supplyPrice: '80', effectiveAt: new Date('2000-01-01'), reason: prefix });
  const requests = app.get(PurchaseRequestsService), created = [];
  for (const quantity of ['3', '7']) { const request = await requests.create({ storeId: store.id, items: [{ productId: product.id, quantity }] }); await requests.confirm(request.id, request.version); created.push(request); }
  const funding = await db.fundingAllocation.findFirstOrThrow({ where: { requestId: created[0].id } });
  const role = await db.role.upsert({ where: { code: 'HQ_FINANCE' }, update: {}, create: { code: 'HQ_FINANCE', name: 'HQ_FINANCE' } });
  const user = await db.user.create({ data: { username: prefix, displayName: '挂账验收财务', passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } } } });
  browser = await chromium.connect(process.env.WORKSPACE_BROWSER_WS);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
  page.on('pageerror', error => manifest.errors.push(error.message));
  await page.goto(`${web}/app.html?api=${encodeURIComponent(api)}#/finance`);
  await page.locator('[name="username"]').fill(user.username); await page.locator('[name="password"]').fill(password); await page.locator('#ws-login-form button').click();
  await page.locator('[name="accountStore"]').selectOption(store.id); await page.locator(`[data-credit-item="${funding.id}"]`).waitFor();
  const capture = async name => { await page.screenshot({ path: join(directory, name), fullPage: true }); manifest.screenshots.push(name); };
  const metrics = async (used, available) => {
    for (const [label, value] of [['累计挂账', '1000.00'], ['未清挂账', used], ['可用额度', available]])
      await page.locator('[data-account-content] dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]').getByText(value, { exact: true }).waitFor();
  };
  await metrics('1000.00', '1000.00'); await capture('before-desktop.png');
  await page.locator(`[data-credit-item="${funding.id}"]`).check(); await page.locator('[data-clearing]').click();
  await page.getByText('清账金额 300.00 · 1 笔').waitFor();
  const buffer = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#248b72' } }).png().toBuffer();
  await page.locator('[name="accountProofFile"]').setInputFiles({ name: 'clear-300.png', mimeType: 'image/png', buffer }); await page.getByText('clear-300.png · 已上传').waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); await capture('preview-mobile.png');
  await page.locator('.ws-dialog [type="submit"]').click(); await page.locator('.ws-dialog').waitFor({ state: 'detached' });
  await metrics('700.00', '1300.00'); await capture('after-mobile.png');
  await page.setViewportSize({ width: 1440, height: 1000 }); await capture('after-desktop.png');
  const account = await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
  assert.deepEqual([account.creditUsed.toFixed(2), account.creditCumulative.toFixed(2)], ['700.00', '1000.00']);
  const clearing = await db.clearingDocument.findFirstOrThrow({ where: { storeId: store.id }, include: { evidenceFiles: true } });
  assert.equal(clearing.amount.toFixed(2), '300.00'); assert.equal(clearing.evidenceFiles[0].filename, 'clear-300.png');
  await page.locator(`[data-account-document="${clearing.id}"]`).click(); await capture('proof-desktop.png');
  const download = page.waitForEvent('download'); await page.locator('[data-account-evidence]').click(); assert.equal((await download).suggestedFilename(), 'clear-300.png');
  const history = await db.creditMovement.findMany({ where: { accountId: account.id } });
  assert.equal(history.filter(row => row.kind === 'BOOKING').length, 2); assert.equal(history.filter(row => row.kind === 'CLEARING').length, 1);
  assert.deepEqual(manifest.errors, []); manifest.status = 'PASS'; manifest.final = { outstanding: '700.00', cumulative: '1000.00', available: '1300.00', proofDownload: 'PASS', bookingCount: 2, clearingCount: 1 };
} catch (error) { manifest.status = 'FAILED'; manifest.failure = error.stack; process.exitCode = 1; }
finally {
  await browser?.close(); const own = { store: { code: prefix } };
  const files = await db.fileObject.findMany({ where: { owner: { username: prefix } } });
  await db.fileObject.deleteMany({ where: { owner: { username: prefix } } });
  for (const file of files) await unlink(join(resolve(process.env.PRIVATE_FILE_DIR || 'var/private-files'), file.objectKey)).catch(() => {});
  await db.auditLog.deleteMany({ where: { actor: { username: prefix } } }); await db.commandRecord.deleteMany({ where: { actor: { username: prefix } } });
  await db.clearingDocument.deleteMany({ where: own }); await db.accountLedger.deleteMany({ where: { account: own } });
  await db.fundingAllocation.deleteMany({ where: { store: own } }); await db.supplierOrder.deleteMany({ where: own }); await db.purchaseRequest.deleteMany({ where: own });
  await db.storeTemplateBinding.deleteMany({ where: { template: { code: prefix } } }); await db.orderTemplate.deleteMany({ where: { code: prefix } });
  await db.priceScope.deleteMany({ where: { supplier: { code: prefix } } }); await db.supplierProduct.deleteMany({ where: { supplier: { code: prefix } } });
  await db.product.deleteMany({ where: { sku: prefix } }); await db.supplier.deleteMany({ where: { code: prefix } });
  await db.storeAccount.deleteMany({ where: own }); await db.store.deleteMany({ where: { code: prefix } });
  await db.category.deleteMany({ where: { code: prefix } }); await db.unit.deleteMany({ where: { code: prefix } }); await db.user.deleteMany({ where: { username: prefix } });
  await db.$disconnect(); await app.close(); manifest.cleanup = 'PASS';
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2)); console.log(JSON.stringify(manifest));
}
