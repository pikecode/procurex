import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import OSS from 'ali-oss';
import { chromium } from 'playwright';
import { createServer } from '../apps/admin/node_modules/vite/dist/node/index.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { DatabaseService } from '../dist/apps/api/src/database/database.service.js';
import { PricingService } from '../dist/apps/api/src/pricing/pricing.service.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

assertLocalFixtureDatabase(process.env.DATABASE_URL);
const ossMode = process.argv.includes('--oss');
const attachmentMode = process.argv.includes('--attachments');
const recoveryMode = process.argv.includes('--recovery');
assert.ok(!recoveryMode || (!ossMode && !attachmentMode), 'Recovery acceptance uses isolated local storage');
assert.ok(!attachmentMode || ossMode, 'Attachment acceptance requires real OSS');
let oss;
if (ossMode) {
  assert.equal(process.env.FILE_STORAGE, 'oss');
  assert.equal(process.env.OSS_BUCKET, 'moshuo-attachment-2026');
  assert.equal(process.env.OSS_PREFIX, 'procurex-test/');
  for (const name of ['OSS_REGION', 'OSS_ENDPOINT', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET']) assert.ok(process.env[name], `${name} must be configured`);
  oss = new OSS({ bucket: process.env.OSS_BUCKET, region: process.env.OSS_REGION, endpoint: process.env.OSS_ENDPOINT,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID, accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    secure: true, cname: process.env.OSS_CNAME === 'true', timeout: 15000 });
}
const output = recoveryMode ? 'var/react-admin-recovery-evidence' : attachmentMode ? 'var/react-admin-oss-attachments-evidence' : ossMode ? 'var/react-admin-oss-journey-evidence' : 'var/react-admin-real-journey-evidence'; await mkdir(output, { recursive: true });
const storage = await mkdtemp(join(tmpdir(), 'procurex-react-journey-'));
if (!ossMode) process.env.FILE_STORAGE = 'local';
process.env.PRIVATE_FILE_DIR = storage;
const report = { status: 'RUNNING', startedAt: new Date().toISOString(), storage: ossMode ? 'oss' : 'local', modes: [], errors: [],
  boundary: `Real React UI/API/database commands with temporary prefixed fixtures. Master data and initial prices seeded only. Synthetic proofs use ${ossMode ? 'real private OSS test-prefix storage' : 'isolated local private storage, not OSS'}, not real bank transfers or production acceptance.` };
const save = () => writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2));
await save();
let app, vite, browser, db;
async function cleanup(prefix) {
  assert.match(prefix, /^RXJ\d+[SC]$/);
  const own = { store: { code: prefix } };
  if (oss) {
    const files = await db.fileObject.findMany({ where: { owner: { username: { startsWith: prefix } } } });
    for (const file of files) {
      assert.match(file.objectKey, /^oss:procurex-test\/[a-f0-9-]{36}$/);
      const name = file.objectKey.slice(4);
      let versionId;
      try { versionId = (await oss.head(name)).res.headers['x-oss-version-id']; }
      catch (error) { if (error.code === 'NoSuchKey') continue; throw error; }
      if (versionId) {
        await oss.delete(name, { subres: { versionId } });
        await assert.rejects(oss.head(name, { subres: { versionId } }), error => ['NoSuchKey', 'NoSuchVersion'].includes(error.code));
      } else await oss.delete(name);
      await assert.rejects(oss.head(name), error => error.code === 'NoSuchKey');
    }
  }
  await db.fileObject.deleteMany({ where: { owner: { username: { startsWith: prefix } } } });
  await db.auditLog.deleteMany({ where: { actor: { username: { startsWith: prefix } } } });
  await db.commandRecord.deleteMany({ where: { actor: { username: { startsWith: prefix } } } });
  await db.paymentRecord.deleteMany({ where: { allocations: { some: { supplierOrder: own } } } });
  await db.clearingDocument.deleteMany({ where: own }); await db.rechargeDocument.deleteMany({ where: own });
  await db.accountLedger.deleteMany({ where: { account: own } });
  await db.fundingAllocation.deleteMany({ where: { store: own } });
  await db.receipt.deleteMany({ where: { shipment: { supplierOrder: own } } });
  await db.shipment.deleteMany({ where: { supplierOrder: own } }); await db.supplierOrder.deleteMany({ where: own });
  await db.purchaseRequest.deleteMany({ where: own });
  await db.storeTemplateBinding.deleteMany({ where: { template: { code: prefix } } });
  await db.orderTemplate.deleteMany({ where: { code: prefix } });
  await db.priceChangeRun.deleteMany({ where: { versions: { some: { priceVersion: { scope: { supplier: { code: prefix } } } } } } });
  await db.priceScope.deleteMany({ where: { supplier: { code: prefix } } });
  await db.supplierProduct.deleteMany({ where: { supplier: { code: prefix } } });
  await db.product.deleteMany({ where: { sku: prefix } }); await db.supplier.deleteMany({ where: { code: prefix } });
  await db.storeAccount.deleteMany({ where: own }); await db.store.deleteMany({ where: { code: prefix } });
  await db.category.deleteMany({ where: { code: prefix } }); await db.unit.deleteMany({ where: { code: prefix } });
  await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
  await db.collectionAccount.deleteMany({ where: { name: prefix } });
  assert.equal(await db.store.count({ where: { code: prefix } }), 0);
  assert.equal(await db.user.count({ where: { username: { startsWith: prefix } } }), 0);
}
try {
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1'); db = app.get(DatabaseService).client;
  const apiRoot = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  vite = await createServer({ root: resolve('apps/admin'), configFile: resolve('apps/admin/vite.config.mjs'),
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: apiRoot, changeOrigin: true } } } });
  await vite.listen(); const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const proof = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#248b72' } }).png().toBuffer();
  for (const mode of attachmentMode ? ['COMPANY_TERM', 'SUPPLIER_TERM'] : ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM']) {
    const prefix = `RXJ${Date.now()}${mode[0]}`, password = randomUUID();
    const result = { mode, prefix, status: 'RUNNING', steps: [], screenshots: [], recoveries: [] }; report.modes.push(result); await save();
    const context = await browser.newContext({ viewport: { width: 390, height: 1000 } }); const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    const shot = async name => { await page.waitForTimeout(250); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); let file = `${mode}-${name}.png`; let sequence = 1; while (result.screenshots.includes(file)) file = `${mode}-${name}-${++sequence}.png`; await page.screenshot({ path: `${output}/${file}` }); result.screenshots.push(file); };
    const step = name => { result.steps.push(name); console.log(`${mode}: ${name}`); };
    const expectedFiles = new Map();
    let productProof, pdfProof;
    const select = async (label, text) => { const input = page.getByLabel(label, { exact: true }); await input.click(); if (await input.evaluate(node => node instanceof HTMLInputElement && !node.readOnly)) await input.fill(text); await page.locator('.ant-select-dropdown:visible').getByText(text, { exact: true }).click(); };
    let dropNext = false, lost, replay;
    if (recoveryMode) await page.route('**/api/v1/**', async route => {
      const request = route.request(), key = request.headers()['idempotency-key'];
      if (!key) return route.continue();
      const snapshot = { key, path: new URL(request.url()).pathname, method: request.method(), body: request.postDataJSON() };
      if (dropNext) {
        dropNext = false;
        // Commit against the actual API, then simulate losing only the response.
        const response = await route.fetch(); assert.ok(response.ok(), `Original command failed: ${response.status()}`);
        await route.abort('failed'); lost = snapshot; return;
      }
      if (lost) { replay = snapshot; assert.deepEqual(replay, lost); }
      return route.continue();
    });
    const write = async action => {
      if (!recoveryMode) return action();
      lost = undefined; replay = undefined; dropNext = true;
      await action();
      for (let i = 0; i < 150 && !lost; i++) await page.waitForTimeout(100);
      assert.ok(lost, 'Expected a committed command with a dropped response');
      const original = await db.commandRecord.findMany({ where: { idempotencyKey: lost.key } });
      assert.equal(original.length, 1); assert.equal(original[0].status, 'SUCCEEDED');
      const storageKey = `procurex-admin-purchase-command-v1:${original[0].actorUserId}`;
      await page.waitForFunction(key => localStorage.getItem(key) !== null, storageKey);
      await page.reload();
      await page.getByRole('button', { name: /^(恢复原提交|查询提交结果)$/ }).locator('visible=true').last().click();
      await page.waitForFunction(key => localStorage.getItem(key) === null, storageKey);
      assert.deepEqual(replay, lost);
      const recovered = await db.commandRecord.findMany({ where: { idempotencyKey: lost.key } });
      assert.deepEqual(recovered, original);
      result.recoveries.push({ path: lost.path, commandId: original[0].id, status: 'PASS' });
      await shot(`recovery-${result.recoveries.length}`);
      step(`Committed-response loss recovered after reload: ${lost.path}`);
      lost = undefined;
    };
    const confirm = async label => write(async () => { await page.getByRole('button', { name: label, exact: true }).click(); await page.locator('.ant-popconfirm:visible').getByRole('button', { name: '确定', exact: true }).click(); });
    const upload = async (dialog, name) => {
      const pdf = name.endsWith('.pdf'); const bytes = pdf ? pdfProof : proof;
      expectedFiles.set(name, bytes);
      await dialog.locator('input[type=file]').setInputFiles({ name, mimeType: pdf ? 'application/pdf' : 'image/png', buffer: bytes });
      await dialog.getByLabel(`移除${name}`, { exact: true }).waitFor();
      if (pdf) {
        await dialog.getByLabel(`查看${name}`, { exact: true }).waitFor();
        const popupPromise = context.waitForEvent('page'); await dialog.getByLabel(`查看${name}`, { exact: true }).click();
        const popup = await popupPromise; await popup.waitForLoadState(); assert.ok(popup.url().startsWith('blob:')); await popup.close();
        const downloadPromise = page.waitForEvent('download'); await dialog.getByLabel(`下载${name}`, { exact: true }).click();
        const download = await downloadPromise; assert.equal(download.suggestedFilename(), name); assert.deepEqual(await readFile(await download.path()), bytes);
        await shot(`${name}-viewer-link`); return;
      }
      const thumbnail = dialog.getByRole('img', { name, exact: true });
      await thumbnail.waitFor();
      await page.waitForFunction(filename => [...document.images].some(img => img.alt === filename && img.complete && img.naturalWidth === 160), name);
      await thumbnail.click();
      await page.locator('.ant-image-preview:visible').waitFor();
      await shot(`${name}-preview`);
      await page.keyboard.press('Escape');
      await page.locator('.ant-image-preview:visible').waitFor({ state: 'hidden' });
    };
    try {
      const category = await db.category.create({ data: { code: prefix, name: '真链路验收分类' } });
      const unit = await db.unit.create({ data: { code: prefix, name: '袋' } });
      const product = await db.product.create({ data: { sku: prefix, name: '真链路验收大米', categoryId: category.id, baseUnitId: unit.id } });
      const supplier = await db.supplier.create({ data: { code: prefix, name: '真链路验收供应商', deliveryMode: 'SELF', defaultSettlementMode: mode, defaultSettlementCycle: 'MONTHLY' } });
      await db.supplierProduct.create({ data: { productId: product.id, supplierId: supplier.id } });
      const store = await db.store.create({ data: { code: prefix, name: '真链路验收门店' } });
      const collection = await db.collectionAccount.create({ data: { name: prefix, bankName: '验收银行', accountName: '验收公司', accountNo: prefix } });
      await db.storeAccount.create({ data: { storeId: store.id } });
      await db.orderTemplate.create({ data: { code: prefix, name: '真链路验收模板', bindings: { create: { storeId: store.id } }, items: { create: { productId: product.id, suppliers: { create: { supplierId: supplier.id } } } } } });
      await app.get(PricingService).publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: mode === 'SUPPLIER_TERM' ? '9' : '12', supplyPrice: '9', effectiveAt: new Date('2000-01-01'), reason: prefix });
      const users = {};
      for (const code of ['STORE', 'SUPPLIER', 'STORE_FINANCE', 'HQ_FINANCE', 'PURCHASER']) {
        const role = await db.role.findUniqueOrThrow({ where: { code } });
        users[code] = await db.user.create({ data: { username: prefix + code, displayName: '真链路验收账号', passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } } } });
        if (code.startsWith('STORE')) await db.userScope.create({ data: { userId: users[code].id, scopeType: 'STORE', storeId: store.id } });
        if (code === 'SUPPLIER') await db.userScope.create({ data: { userId: users[code].id, scopeType: 'SUPPLIER', supplierId: supplier.id } });
      }
      let loggedIn = false;
      const login = async (role, path) => { await page.goto(`${base}${path}`); if (loggedIn) await page.getByLabel('退出登录').click(); await page.getByLabel('用户名').fill(users[role].username); await page.getByLabel('密码', { exact: true }).fill(password); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.getByLabel('用户名').waitFor({ state: 'hidden' }); loggedIn = true; await page.getByRole('heading', { level: 1 }).first().waitFor(); await page.goto(`${base}${path}`); };
      if (attachmentMode) {
        const documentPage = await context.newPage();
        await documentPage.setContent('<!doctype html><html><body><h1>ProcureX synthetic payment proof</h1><p>Local acceptance only. No bank transfer.</p></body></html>');
        pdfProof = await documentPage.pdf({ format: 'A4' }); await documentPage.close();
        const productFilename = mode === 'COMPANY_TERM' ? 'product.png' : 'product.jpeg';
        const image = sharp({ create: { width: 160, height: 160, channels: 3, background: '#318a62' } });
        productProof = await (mode === 'COMPANY_TERM' ? image.png() : image.jpeg()).toBuffer();
        await login('PURCHASER', '/products'); await page.getByLabel('搜索商品管理', { exact: true }).fill(prefix);
        await page.getByLabel(`编辑${product.name}`, { exact: true }).click(); const dialog = page.getByRole('dialog', { name: '编辑商品', exact: true });
        await dialog.getByLabel('默认售价', { exact: true }).fill('12');
        await dialog.locator('input[type=file]').setInputFiles({ name: productFilename, mimeType: mode === 'COMPANY_TERM' ? 'image/png' : 'image/jpeg', buffer: productProof });
        const cropDialog = page.getByRole('dialog', { name: '裁切商品图片', exact: true });
        await cropDialog.getByRole('button', { name: '确认上传', exact: true }).click();
        await cropDialog.waitFor({ state: 'hidden' });
        const uploadedProductFile = await db.fileObject.findFirstOrThrow({ where: { ownerId: users.PURCHASER.id, filename: 'product.jpg', purpose: 'PRODUCT', status: 'READY' }, orderBy: { createdAt: 'desc' } });
        const encodedProduct = await page.evaluate(async id => { const token = JSON.parse(sessionStorage.getItem('procurex-react-admin-session-v1')).accessToken; const response = await fetch(`/api/v1/files/${id}/download`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('Product download failed'); let binary = ''; for (const byte of new Uint8Array(await response.arrayBuffer())) binary += String.fromCharCode(byte); return btoa(binary); }, uploadedProductFile.id);
        const processedImage = Buffer.from(encodedProduct, 'base64');
        const processedMetadata = await sharp(processedImage).metadata(); assert.equal(processedMetadata.width, processedMetadata.height); assert.ok(processedImage.length <= 2 * 1024 * 1024);
        expectedFiles.set('product.jpg', processedImage);
        await page.waitForFunction(() => [...document.querySelectorAll('.ant-modal img')].some(img => img.complete && img.naturalWidth === 160 && img.naturalHeight === 160));
        await shot('product-upload'); await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
        const savedProduct = await db.product.findUniqueOrThrow({ where: { id: product.id } }); assert.ok(savedProduct.imageFileId); result.productFileId = savedProduct.imageFileId;
        await page.reload(); await page.getByLabel('搜索商品管理', { exact: true }).fill(prefix);
        const row = page.getByRole('row').filter({ hasText: prefix }); await row.locator('img').waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll('tbody img')].some(img => img.complete && img.naturalWidth === 160 && img.naturalHeight === 160));
        await row.locator('img').click(); await page.locator('.ant-image-preview:visible').waitFor(); await shot('product-saved-preview'); await page.keyboard.press('Escape');
        step(`Product ${mode === 'COMPANY_TERM' ? 'PNG' : 'JPEG'} uploaded and saved through React; reload and enlarged image verified`);
      }
      const account = () => db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
      if (['STORED_VALUE', 'CREDIT'].includes(mode)) {
        await login('HQ_FINANCE', `/store-finance?store=${store.id}`);
        await page.getByRole('button', { name: mode === 'STORED_VALUE' ? '充值' : '调整额度', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: mode === 'STORED_VALUE' ? '门店充值' : '调整挂账额度', exact: true });
        if (mode === 'STORED_VALUE') { await page.getByLabel('充值金额', { exact: true }).fill('1000'); await page.getByLabel('收款账户', { exact: true }).click(); await page.locator('.ant-select-dropdown:visible').getByText(new RegExp(prefix)).click(); await upload(dialog, 'recharge.png'); }
        else { await page.getByLabel('挂账额度', { exact: true }).fill('1000'); await page.getByLabel('调整原因', { exact: true }).fill('临时验收额度'); }
        await dialog.getByRole('button', { name: '核对提交', exact: true }).click(); await shot('account-review'); await confirm('确认提交'); await dialog.waitFor({ state: 'hidden' });
        assert.equal((await account())[mode === 'STORED_VALUE' ? 'balance' : 'creditLimit'].toFixed(2), '1000.00'); step('Account setup through finance UI');
      }
      await login('STORE', '/store-orders'); await page.getByRole('button', { name: '门店订货', exact: true }).click();
      await select('订货商品1', product.name); await page.getByLabel('订货数量1', { exact: true }).fill('2');
      await page.getByRole('button', { name: '核对订单', exact: true }).click(); await page.getByRole('heading', { name: '订单核对', exact: true }).waitFor(); await shot('store-order'); await confirm('提交订单'); await page.getByRole('dialog', { name: '门店订货', exact: true }).waitFor({ state: 'hidden' });
      const requests = await db.purchaseRequest.findMany({ where: { storeId: store.id } }); assert.equal(requests.length, 1); const request = requests[0];
      assert.equal(request.status, 'PENDING_PROCUREMENT'); assert.equal(await db.supplierOrder.count({ where: { requestId: request.id } }), 0);
      if (mode === 'STORED_VALUE') { const a = await account(); assert.equal(a.balance.toFixed(2), '1000.00'); assert.equal(a.reservedBalance.toFixed(2), '24.00'); }
      if (mode === 'CREDIT') assert.equal((await account()).creditUsed.toFixed(2), '24.00');
      step('Store creates one pending request; stored value reserved, not debited');
      await login('PURCHASER', `/purchase-requests?request=${request.id}`); await page.getByRole('button', { name: '确认采购', exact: true }).waitFor(); await shot('purchase'); await confirm('确认采购');
      let order; for (let i = 0; i < 40; i++) { order = await db.supplierOrder.findFirst({ where: { requestId: request.id }, include: { items: true } }); if (order) break; await page.waitForTimeout(100); }
      assert.ok(order); assert.equal(order.settlementMode, mode); assert.equal(order.supplierId, supplier.id); assert.equal(await db.supplierOrder.count({ where: { requestId: request.id } }), 1); result.requestId = request.id; result.orderId = order.id; step('Purchaser confirms exact request into one supplier order');
      await login('SUPPLIER', '/supplier-orders'); await page.getByRole('row').filter({ hasText: order.supplierOrderNo }).getByRole('button', { name: '查看', exact: true }).click(); await page.getByRole('button', { name: '发货与补发', exact: true }).click();
      await page.getByLabel(`发货数量${order.items[0].id}`, { exact: true }).fill('2'); await page.getByRole('button', { name: '预览发货', exact: true }).click(); await page.getByRole('heading', { name: '发货预览', exact: true }).waitFor(); await shot('supplier-shipping'); await confirm('确认发货'); await page.getByRole('dialog', { name: '发货与补发', exact: true }).waitFor({ state: 'hidden' });
      const shipments = await db.shipment.findMany({ where: { supplierOrderId: order.id } }); assert.equal(shipments.length, 1); const shipment = shipments[0]; step('Bound supplier ships original order');
      await login('STORE', `/store-orders?order=${request.id}`); await page.getByRole('button', { name: shipment.shipmentNo, exact: true }).click(); await page.getByRole('button', { name: '登记收货', exact: true }).click();
      const receiptDialog = page.getByRole('dialog', { name: '登记收货', exact: true }); await receiptDialog.getByRole('button', { name: '全部到货', exact: true }).click(); await upload(receiptDialog, 'receipt.png'); await receiptDialog.getByRole('button', { name: '核对收货', exact: true }).click(); await shot('store-receipt'); await confirm('确认收货'); await receiptDialog.waitFor({ state: 'hidden' });
      assert.equal((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).status, 'COMPLETED');
      const receipt = await db.receipt.findFirstOrThrow({ where: { shipmentId: shipment.id }, include: { evidenceFiles: true } }); assert.equal(receipt.evidenceFiles.length, 1); assert.equal(receipt.evidenceFiles[0].ownerId, users.STORE.id);
      const a = await account(); assert.equal(a.reservedBalance.toFixed(2), '0.00'); assert.equal(a.balance.toFixed(2), mode === 'STORED_VALUE' ? '976.00' : '0.00'); assert.equal(a.creditUsed.toFixed(2), mode === 'CREDIT' ? '24.00' : '0.00');
      const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('procurex-react-admin-session-v1')).accessToken);
      const privateUrl = `${apiRoot}/api/v1/files/${receipt.evidenceFiles[0].id}/download`;
      const download = await fetch(privateUrl, { headers: { authorization: `Bearer ${token}` } }); assert.equal(download.status, 200);
      const metadata = await sharp(Buffer.from(await download.arrayBuffer())).metadata(); assert.equal(metadata.width, 160); assert.equal(metadata.height, 100);
      assert.equal((await fetch(privateUrl)).status, 401);
      step('Store completes receipt with real private upload; balances match settlement mode');
      if (mode === 'CREDIT') {
        await login('HQ_FINANCE', `/store-finance?store=${store.id}`); await page.getByRole('tab', { name: '未销账明细', exact: true }).click(); await page.getByRole('row').filter({ hasText: order.supplierOrderNo }).getByRole('checkbox').check(); await page.getByRole('button', { name: '销账核对（1）', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '门店销账', exact: true }); await upload(dialog, 'clearing.png'); await dialog.getByRole('button', { name: '核对提交', exact: true }).click(); await shot('credit-clearing'); await confirm('确认提交'); await dialog.waitFor({ state: 'hidden' });
        assert.equal((await account()).creditUsed.toFixed(2), '0.00'); assert.equal((await account()).balance.toFixed(2), '0.00'); assert.equal(await db.clearingDocument.count({ where: { storeId: store.id } }), 1); step('HQ clears debt through UI without stored-value debit');
      }
      const registerPayment = async (role, tab, endpoint, direction, expected, attempt = 1) => {
        await login(role, '/finance'); await page.getByRole('tab', { name: tab, exact: true }).click();
        const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('procurex-react-admin-session-v1')).accessToken);
        const response = await fetch(`${apiRoot}/api/v1${endpoint}?supplierId=${supplier.id}`, { headers: { authorization: `Bearer ${token}` } }); assert.equal(response.status, 200);
        const bills = (await response.json()).data; const bill = bills.find(row => row.supplierId === supplier.id && (endpoint === '/supplier-statements' || row.storeId === store.id)); assert.ok(bill);
        await page.getByLabel('搜索账单查询', { exact: true }).fill(bill.id); await page.locator(`tr[data-row-key=${JSON.stringify(bill.id)}]`).getByLabel('账单详情').click();
        await page.getByRole('dialog', { name: '账单明细', exact: true }).getByRole('row').filter({ hasText: order.supplierOrderNo }).getByRole('checkbox').check();
        await page.getByRole('button', { name: '登记付款（1）', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '付款登记', exact: true });
        await upload(dialog, `${direction}.${attachmentMode ? 'pdf' : 'png'}`); await shot(`${direction}-payment`); await write(() => dialog.getByRole('button', { name: '确认登记', exact: true }).click()); await dialog.waitFor({ state: 'hidden' });
        const payments = await db.paymentRecord.findMany({ where: { direction, allocations: { some: { supplierOrderId: order.id } } } }); assert.equal(payments.length, attempt); const pending = payments.filter(row => row.status === 'PENDING'); assert.equal(pending.length, 1); const payment = pending[0]; assert.equal(payment.amount.toFixed(2), expected);
        return payment;
      };
      const confirmPayment = async (role, payment, reject = false) => {
        await login(role, '/finance'); await page.getByRole('tab', { name: '付款记录', exact: true }).click(); await page.getByLabel('搜索付款记录', { exact: true }).fill(payment.paymentNo);
        await page.getByRole('row').filter({ hasText: payment.paymentNo }).getByLabel('付款详情').click(); await select('付款处理方式', reject ? '驳回付款' : '确认收款');
        if (reject) {
          await page.getByRole('button', { name: '确认处理', exact: true }).click(); await page.getByText('请填写原因', { exact: true }).waitFor();
          assert.equal((await db.paymentRecord.findUniqueOrThrow({ where: { id: payment.id } })).status, 'PENDING');
          await page.getByLabel('处理原因', { exact: true }).fill('合成验收凭证驳回后重新登记');
        }
        await shot(`${payment.direction}-${reject ? 'reject' : 'confirm'}`);
        await write(() => page.getByRole('button', { name: '确认处理', exact: true }).click()); await page.getByRole('dialog', { name: '付款详情', exact: true }).waitFor({ state: 'hidden' });
        assert.equal((await db.paymentRecord.findUniqueOrThrow({ where: { id: payment.id } })).status, reject ? 'REJECTED' : 'CONFIRMED');
        const allocations = await db.paymentAllocation.findMany({ where: { paymentId: payment.id } }); assert.equal(allocations.length, 1); assert.equal(allocations[0].state, reject ? 'RELEASED' : 'CONFIRMED'); assert.equal(allocations[0].supplierOrderId, order.id);
        if (attachmentMode) {
          await page.getByRole('row').filter({ hasText: payment.paymentNo }).getByLabel('付款详情').click();
          const terminal = page.getByRole('dialog', { name: '付款详情', exact: true });
          await terminal.locator('.ant-descriptions').getByText(reject ? '已驳回' : '已确认', { exact: true }).waitFor();
          assert.equal(await terminal.getByLabel('付款处理方式').count(), 0);
          await shot(`${payment.direction}-${reject ? 'rejected' : 'confirmed'}-readonly`);
        }
        step(`${payment.direction} ${reject ? 'reason-required rejection releases allocation' : 'registered and recipient-confirmed'} through UI`);
      };
      const settle = async (payer, recipient, tab, endpoint, direction, amount) => {
        if (attachmentMode) await confirmPayment(recipient, await registerPayment(payer, tab, endpoint, direction, amount), true);
        await confirmPayment(recipient, await registerPayment(payer, tab, endpoint, direction, amount, attachmentMode ? 2 : 1));
        assert.equal(await db.paymentAllocation.count({ where: { supplierOrderId: order.id, state: 'CONFIRMED', payment: { direction } } }), 1);
      };
      if (mode === 'COMPANY_TERM') await settle('STORE_FINANCE', 'HQ_FINANCE', '门店账单', '/store-statements', 'STORE_TO_COMPANY', '24.00');
      if (mode === 'SUPPLIER_TERM') await settle('STORE_FINANCE', 'SUPPLIER', '直付账单', '/direct-statements', 'STORE_TO_SUPPLIER', '18.00');
      else await settle('HQ_FINANCE', 'SUPPLIER', '供应商账单', '/supplier-statements', 'COMPANY_TO_SUPPLIER', '18.00');
      const finalAccount = await account(); assert.equal(finalAccount.balance.toFixed(2), mode === 'STORED_VALUE' ? '976.00' : '0.00'); assert.equal(finalAccount.creditUsed.toFixed(2), '0.00');
      const finalRequest = await db.purchaseRequest.findUniqueOrThrow({ where: { id: request.id } });
      assert.equal(finalRequest.paymentStatus, ['STORED_VALUE', 'CREDIT'].includes(mode) ? 'PAID' : 'UNPAID'); assert.equal(finalRequest.storedValueOnReceipt, true);
      // Monthly payments settle statement allocations; clearing debits are not stored-value deductions.
      const debits = await db.accountLedger.findMany({ where: { accountId: finalAccount.id, requestId: request.id, direction: 'DEBIT' } });
      assert.equal(debits.length, mode === 'STORED_VALUE' ? 1 : 0);
      if (mode === 'STORED_VALUE') assert.equal(debits[0].amount.toFixed(2), '24.00');
      result.paymentStatus = finalRequest.paymentStatus; result.storedDebitCount = debits.length;
      if (oss) {
        const outsiderLogin = await fetch(`${apiRoot}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: users.PURCHASER.username, password, client: 'WEB' }) });
        assert.equal(outsiderLogin.status, 201);
        const outsiderToken = (await outsiderLogin.json()).data.accessToken;
        const boundTokens = {};
        if (attachmentMode) for (const role of ['STORE', 'SUPPLIER']) {
          const response = await fetch(`${apiRoot}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: users[role].username, password, client: 'WEB' }) });
          assert.equal(response.status, 201); boundTokens[role] = (await response.json()).data.accessToken;
        }
        const files = await db.fileObject.findMany({ where: { owner: { username: { startsWith: prefix } } } });
        assert.equal(files.length, attachmentMode ? mode === 'COMPANY_TERM' ? 6 : 4 : ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM'].includes(mode) ? 3 : 2);
        result.ossFiles = [];
        for (const file of files) {
          assert.equal(file.status, 'READY');
          const expected = expectedFiles.get(file.filename); assert.ok(expected);
          assert.equal(file.checksum, createHash('sha256').update(expected).digest('hex'));
          assert.ok(file.receiptId || file.paymentId || file.rechargeId || file.clearingId || file.id === result.productFileId);
          assert.match(file.objectKey, /^oss:procurex-test\/[a-f0-9-]{36}$/);
          const name = file.objectKey.slice(4);
          assert.deepEqual(Buffer.from((await oss.get(name)).content), expected);
          const url = new URL(process.env.OSS_ENDPOINT);
          if (process.env.OSS_CNAME !== 'true') url.hostname = `${process.env.OSS_BUCKET}.${url.hostname}`;
          url.pathname = `/${name}`;
          assert.equal((await fetch(url, { signal: AbortSignal.timeout(15000) })).status, 403);
          assert.equal((await fetch(`${apiRoot}/api/v1/files/${file.id}/download`)).status, 401);
          const purchaserStatus = file.purpose === 'PRODUCT' ? 200 : 404;
          assert.equal((await fetch(`${apiRoot}/api/v1/files/${file.id}/download`, { headers: { authorization: `Bearer ${outsiderToken}` } })).status, purchaserStatus);
          const boundAccess = {};
          for (const [role, accessToken] of Object.entries(boundTokens)) {
            const payment = file.paymentId ? await db.paymentRecord.findUniqueOrThrow({ where: { id: file.paymentId } }) : null;
            const allowed = role === 'STORE' ? payment?.direction !== 'COMPANY_TO_SUPPLIER' : payment?.direction !== 'STORE_TO_COMPANY';
            const response = await fetch(`${apiRoot}/api/v1/files/${file.id}/download`, { headers: { authorization: `Bearer ${accessToken}` } });
            assert.equal(response.status, allowed ? 200 : 404); boundAccess[role] = response.status;
            if (allowed) assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
          }
          result.ossFiles.push({ id: file.id, purpose: file.purpose, mimeType: file.mimeType, objectKey: file.objectKey, checksum: file.checksum, linked: true, anonymousOssStatus: 403, anonymousApiStatus: 401, purchaserStatus, boundAccess });
        }
        step('Real OSS contents, checksums, document links and private access verified');
      }
      result.finalAccount = { balance: finalAccount.balance.toFixed(2), reserved: finalAccount.reservedBalance.toFixed(2), creditUsed: finalAccount.creditUsed.toFixed(2) };
      result.status = 'PASS';
    } catch (error) { result.status = 'FAIL'; result.error = error.message; report.errors.push(`${mode}: ${error.message}`); await page.screenshot({ path: `${output}/${mode}-failure.png` }).catch(() => {}); }
    finally { await context.close(); try { await cleanup(prefix); result.cleanup = 'PASS'; } catch (error) { result.cleanup = 'FAIL'; report.errors.push(`${prefix} cleanup: ${error.message}`); } await save(); }
  }
  report.status = report.errors.length === 0 && report.modes.every(mode => mode.status === 'PASS' && mode.cleanup === 'PASS') ? 'PASS' : 'FAIL';
} catch (error) { report.status = 'FAIL'; report.errors.push(error.message); }
finally { await browser?.close(); await vite?.close(); await app?.close(); await rm(storage, { recursive: true, force: true }); report.finishedAt = new Date().toISOString(); await save(); console.log(JSON.stringify(report, null, 2)); if (report.status !== 'PASS') process.exitCode = 1; }
