import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { DatabaseService } from '../dist/apps/api/src/database/database.service.js';
import { PricingService } from '../dist/apps/api/src/pricing/pricing.service.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';
import { captureCrossRoleJourney } from './capture-cross-role-journey.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const api = process.env.WORKSPACE_API_URL || 'http://127.0.0.1:3114/api/v1', web = process.env.WORKSPACE_WEB_URL || 'http://127.0.0.1:4173';
for (const url of [api, web]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const directory = resolve('var/settlement-mode-journeys'); await mkdir(directory, { recursive: true });
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const db = app.get(DatabaseService).client;
const manifest = { status: 'RUNNING', modes: [], screenshots: [], errors: [], scope: 'Isolated local master data only; all procurement, funding, fulfillment, payment, historical price publication and execution through formal UI. Synthetic private images, not bank/device/OSS acceptance.' };
let browser;
const cleanupPrefix = process.argv.find(value => value.startsWith('--cleanup-prefix='))?.split('=')[1];
if (cleanupPrefix) assert.match(cleanupPrefix, /^SMJ\d+[SC]$/);
async function cleanup(prefix) {
  const own = { store: { code: prefix } };
  const storeIds = (await db.store.findMany({ where: { code: prefix }, select: { id: true } })).map(row => row.id);
  const files = await db.fileObject.findMany({ where: { owner: { username: { startsWith: prefix } } } });
  await db.fileObject.deleteMany({ where: { id: { in: files.map(file => file.id) } } });
  for (const file of files) await unlink(join(resolve(process.env.PRIVATE_FILE_DIR || 'var/private-files'), file.objectKey)).catch(() => {});
  await db.auditLog.deleteMany({ where: { actor: { username: { startsWith: prefix } } } }); await db.commandRecord.deleteMany({ where: { actor: { username: { startsWith: prefix } } } });
  await db.paymentRecord.deleteMany({ where: { allocations: { some: { supplierOrder: own } } } });
  await db.clearingDocument.deleteMany({ where: own }); await db.rechargeDocument.deleteMany({ where: own }); await db.accountLedger.deleteMany({ where: { account: own } });
  await db.adjustmentDocument.deleteMany({ where: { storeId: { in: storeIds } } });
  await db.priceChangeRun.deleteMany({ where: { versions: { some: { priceVersion: { scope: { supplier: { code: prefix } } } } } } });
  await db.fundingAllocation.deleteMany({ where: { store: own } }); await db.receipt.deleteMany({ where: { shipment: { supplierOrder: own } } });
  await db.shipment.deleteMany({ where: { supplierOrder: own } }); await db.supplierOrder.deleteMany({ where: own }); await db.purchaseRequest.deleteMany({ where: own });
  await db.storeTemplateBinding.deleteMany({ where: { template: { code: prefix } } }); await db.orderTemplate.deleteMany({ where: { code: prefix } });
  await db.priceScope.deleteMany({ where: { supplier: { code: prefix } } }); await db.supplierProduct.deleteMany({ where: { supplier: { code: prefix } } });
  await db.product.deleteMany({ where: { sku: prefix } }); await db.supplier.deleteMany({ where: { code: prefix } });
  await db.storeAccount.deleteMany({ where: own }); await db.store.deleteMany({ where: { code: prefix } }); await db.category.deleteMany({ where: { code: prefix } }); await db.unit.deleteMany({ where: { code: prefix } });
  await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
  await db.collectionAccount.deleteMany({ where: { name: prefix } });
}
try {
  if (cleanupPrefix) await cleanup(cleanupPrefix);
  else browser = await chromium.connect(process.env.WORKSPACE_BROWSER_WS);
  for (const mode of cleanupPrefix ? [] : ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM']) {
    const prefix = `SMJ${Date.now()}${mode[0]}`, password = randomUUID();
    const result = { mode, prefix, status: 'RUNNING', steps: [] }; manifest.modes.push(result);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const category = await db.category.create({ data: { code: prefix, name: prefix } });
      const unit = await db.unit.create({ data: { code: prefix, name: 'piece' } });
      const product = await db.product.create({ data: { sku: prefix, name: `${mode}验收商品`, categoryId: category.id, baseUnitId: unit.id } });
      const supplier = await db.supplier.create({ data: { code: prefix, name: `${mode}验收供应商`, deliveryMode: 'SELF', defaultSettlementMode: mode, defaultSettlementCycle: 'MONTHLY' } });
      await db.supplierProduct.create({ data: { productId: product.id, supplierId: supplier.id } });
      const store = await db.store.create({ data: { code: prefix, name: `${mode}验收门店` } });
      const collection = await db.collectionAccount.create({ data: { name: prefix, bankName: '验收银行', accountName: '验收公司', accountNo: prefix } });
      await db.storeAccount.create({ data: { storeId: store.id } });
      await db.orderTemplate.create({ data: { code: prefix, name: prefix, bindings: { create: { storeId: store.id } }, items: { create: { productId: product.id, suppliers: { create: { supplierId: supplier.id } } } } } });
      await app.get(PricingService).publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: mode === 'SUPPLIER_TERM' ? '9' : '12', supplyPrice: '9', effectiveAt: new Date('2000-01-01'), reason: prefix });
      const users = {};
      for (const code of ['ADMIN', 'STORE', 'SUPPLIER', 'STORE_FINANCE', 'HQ_FINANCE', 'PURCHASER']) {
        const role = await db.role.upsert({ where: { code }, update: {}, create: { code, name: code } });
        const user = await db.user.create({ data: { username: prefix + code, displayName: code, passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } } } });
        if (code === 'STORE' || code === 'STORE_FINANCE') await db.userScope.create({ data: { userId: user.id, scopeType: 'STORE', storeId: store.id } });
        if (code === 'SUPPLIER') await db.userScope.create({ data: { userId: user.id, scopeType: 'SUPPLIER', supplierId: supplier.id } });
        users[code] = user;
      }
      const page = await context.newPage(); page.on('pageerror', error => manifest.errors.push(error.message));
      const url = `${web}/app.html?api=${encodeURIComponent(api)}`;
      const route = async key => { const target = `${url}#/${key}`; if (page.url() === target) await page.goto('about:blank'); await page.goto(target, { waitUntil: 'domcontentloaded' }); await page.locator('.ws-heading h1').waitFor(); };
      const login = async user => { await page.locator('[name="username"]').fill(user.username); await page.locator('[name="password"]').fill(password); await page.locator('#ws-login-form button').click(); await page.locator('.ws-heading h1').waitFor(); };
      const save = async () => { await page.locator('.ws-dialog [type="submit"]').click(); try { await page.locator('.ws-dialog').waitFor({ state: 'detached', timeout: 15000 }); } catch (error) { throw new Error(`${error.message}: ${await page.locator('.ws-dialog').innerText()}`); } };
      const capture = async name => { const file = `${mode}-${name}.png`; await page.screenshot({ path: join(directory, file), fullPage: true }); manifest.screenshots.push(file); };
      await page.goto(url, { waitUntil: 'domcontentloaded' }); await login(users.HQ_FINANCE);
      if (mode === 'STORED_VALUE' || mode === 'CREDIT') {
        await route('finance'); await page.locator('[name="accountStore"]').selectOption(store.id);
        if (mode === 'STORED_VALUE') {
          await page.locator('[data-recharge]').click(); await page.locator('.ws-dialog [name="amount"]').fill('1000'); await page.locator('.ws-dialog [name="collectionAccountId"]').selectOption(collection.id);
          const buffer = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#248b72' } }).png().toBuffer();
          await page.locator('[name="accountProofFile"]').setInputFiles({ name: 'opening-recharge.png', mimeType: 'image/png', buffer }); await page.getByText('opening-recharge.png · 已上传').waitFor();
        } else {
          await page.locator('[data-credit]').click(); await page.locator('.ws-dialog [name="limit"]').fill('2000'); await page.locator('.ws-dialog [name="reason"]').fill('隔离验收额度审批');
        }
        await capture('funding-opening-desktop'); await save(); result.steps.push('FORMAL_UI_ACCOUNT_OPENING');
      }
      result.journey = await captureCrossRoleJourney({ page, db, api, store, supplier, product, storeUser: users.STORE, supplierUser: users.SUPPLIER,
        storeFinance: users.STORE_FINANCE, finance: users.HQ_FINANCE, purchaser: users.PURCHASER, admin: users.ADMIN,
        login, route, search: async value => page.locator('#ws-search').fill(value), save, capture, step: name => result.steps.push(name), mode, verifyRepricing: true });
      const account = await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
      if (mode === 'STORED_VALUE') assert.equal(account.balance.toFixed(2), '924.00');
      if (mode === 'CREDIT') assert.deepEqual([account.creditUsed.toFixed(2), account.creditCumulative.toFixed(2)], ['52.00', '76.00']);
      if (mode === 'COMPANY_TERM' || mode === 'SUPPLIER_TERM') assert.deepEqual([account.balance.toFixed(2), account.creditUsed.toFixed(2), account.creditCumulative.toFixed(2)], ['0.00', '0.00', '0.00']);
      result.account = { balance: account.balance.toFixed(2), creditUsed: account.creditUsed.toFixed(2), cumulative: account.creditCumulative.toFixed(2) }; result.status = 'PASSED';
    } finally {
      await context.close(); await cleanup(prefix); result.cleanup = 'PASSED';
      await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    }
  }
  assert.deepEqual(manifest.errors, []); manifest.status = 'PASSED';
} catch (error) { manifest.status = 'FAILED'; manifest.failure = error.stack; process.exitCode = 1; }
finally { await browser?.close(); await db.$disconnect(); await app.close(); await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2)); console.log(JSON.stringify(manifest)); }
