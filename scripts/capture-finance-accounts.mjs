import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import sharp from 'sharp';
import { resolve, join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const api = process.env.WORKSPACE_API_URL || 'http://127.0.0.1:3113/api/v1';
const web = process.env.WORKSPACE_WEB_URL || 'http://127.0.0.1:4173';
for (const url of [api, web]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const prefix = `PXFIN${Date.now()}`; const password = randomUUID();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL || 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
const directory = resolve('var/finance-account-evidence'); await mkdir(directory, { recursive: true });
const manifest = { status: 'RUNNING', prefix, screenshots: [], errors: [], scope: 'Isolated local Finance UI: seeded historical credit opening25; real recharge/credit-limit/clearing commands. Not procurement funding or real funds acceptance.' };
let browser; let store;
try {
  store = await db.store.create({ data: { code: prefix, name: '财务账户验收门店' } });
  const collection = await db.collectionAccount.create({ data: { name: prefix, bankName: '验收银行', accountName: '验收公司', accountNo: prefix } });
  const account = await db.storeAccount.create({ data: { storeId: store.id, creditLimit: '100.00', creditUsed: '25.00' } });
  const allocation = await db.fundingAllocation.create({ data: { storeId: store.id, method: 'CREDIT', targetAmount: '25.00', creditOutstanding: '25.00' } });
  const users = [];
  for (const code of ['HQ_FINANCE', 'STORE_FINANCE']) {
    const role = await db.role.upsert({ where: { code }, update: {}, create: { code, name: code } });
    const user = await db.user.create({ data: { username: `${prefix}${code}`, displayName: code === 'HQ_FINANCE' ? '财务验收' : '门店财务验收', passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } } } });
    if (code === 'STORE_FINANCE') await db.userScope.create({ data: { userId: user.id, scopeType: 'STORE', storeId: store.id } });
    users.push(user);
  }
  browser = await chromium.connect(process.env.WORKSPACE_BROWSER_WS);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const page = await context.newPage();
  page.on('pageerror', error => manifest.errors.push(error.message));
  const url = `${web}/app.html?api=${encodeURIComponent(api)}#/finance`;
  const login = async user => {
    await page.goto(url); await page.locator('[name="username"]').fill(user.username); await page.locator('[name="password"]').fill(password);
    await page.locator('#ws-login-form button').click(); await page.locator('[name="accountStore"]').waitFor();
  };
  const capture = async name => { await page.screenshot({ path: join(directory, name), fullPage: true }); manifest.screenshots.push(name); };
  const save = async () => {
    await page.locator('.ws-dialog [type="submit"]').click();
    try { await page.locator('.ws-dialog').waitFor({ state: 'detached', timeout: 10000 }); }
    catch (error) { throw new Error(`${error.message}: ${await page.locator('.ws-dialog').innerText()}`); }
  };
  const proofBytes = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#248b72' } }).png().toBuffer();
  const proof = async name => {
    assert.equal(await page.locator('.ws-dialog [type="submit"]').isDisabled(), true);
    await page.locator('[name="accountProofFile"]').setInputFiles({ name, mimeType: 'image/png', buffer: proofBytes });
    await page.getByText(`${name} · 已上传`).waitFor();
  };
  await login(users[0]); await page.locator('[name="accountStore"]').selectOption(store.id);
  await page.locator('[data-recharge]').click(); await page.locator('.ws-dialog [name="amount"]').fill('100.00');
  await page.locator('.ws-dialog [name="collectionAccountId"]').selectOption(collection.id);
  await proof('recharge-proof.png'); await capture('recharge-proof-mobile.png'); await save();
  const recharge = await db.rechargeDocument.findFirstOrThrow({ where: { storeId: store.id }, include: { evidenceFiles: true } });
  assert.equal(recharge.evidenceFiles.length, 1); assert.equal(recharge.evidenceFiles[0].ownerId, users[0].id);
  assert.equal((await db.storeAccount.findUniqueOrThrow({ where: { id: account.id } })).balance.toFixed(2), '100.00');
  await page.locator('[data-credit]').click(); await page.locator('.ws-dialog [name="limit"]').fill('200.00');
  await page.locator('.ws-dialog [name="reason"]').fill('本地额度审批验收'); await save();
  await page.locator('[data-credit-item]').check(); await page.locator('[data-clearing]').click();
  await page.getByText('清账金额 25.00 · 1 笔').waitFor(); await capture('clearing-preview-desktop.png');
  await proof('stale-clearing-proof.png');
  await page.setViewportSize({ width: 390, height: 844 }); await capture('clearing-preview-mobile.png');
  // A competing update invalidates the approved preview; no financial command should be sent.
  await db.fundingAllocation.update({ where: { id: allocation.id }, data: { version: { increment: 1 } } });
  await page.locator('.ws-dialog [type="submit"]').click(); await page.getByText('挂账明细已变化，请关闭后重新预览。').waitFor();
  assert.equal(await db.clearingDocument.count({ where: { storeId: store.id } }), 0);
  await page.locator('.ws-dialog [data-close]').click(); await page.locator('[data-clearing]').click();
  await proof('clearing-proof.png');
  let lost = false;
  await page.route(`**/stores/${store.id}/clearings`, async route => {
    if (route.request().method() !== 'POST' || lost) return route.continue();
    const response = await route.fetch(); assert.equal(response.status(), 201); lost = true; await route.abort('failed');
  });
  await page.locator('.ws-dialog [type="submit"]').click(); await page.locator('.ws-form-error:not([hidden])').waitFor(); assert.equal(lost, true);
  await page.reload(); await page.locator('[data-finance-recover]').click(); await page.locator('[name="accountStore"]').waitFor();
  await page.locator('[name="accountStore"]').selectOption(store.id); await page.getByText('暂无未清挂账').waitFor();
  const final = await db.storeAccount.findUniqueOrThrow({ where: { id: account.id } });
  assert.equal(final.balance.toFixed(2), '100.00'); assert.equal(final.creditLimit.toFixed(2), '200.00'); assert.equal(final.creditUsed.toFixed(2), '0.00');
  assert.equal(await db.clearingDocument.count({ where: { storeId: store.id } }), 1);
  const clearing = await db.clearingDocument.findFirstOrThrow({ where: { storeId: store.id }, include: { evidenceFiles: true } });
  assert.equal(clearing.evidenceFiles.length, 1); assert.equal(clearing.evidenceFiles[0].filename, 'clearing-proof.png');
  assert.equal((await db.fileObject.findFirstOrThrow({ where: { ownerId: users[0].id, filename: 'stale-clearing-proof.png' } })).clearingId, null);
  assert.equal(await db.accountLedger.count({ where: { accountId: account.id } }), 2);
  await capture('account-final-mobile.png'); await page.setViewportSize({ width: 1440, height: 1000 }); await capture('account-final-desktop.png');
  await page.locator('#ws-logout').click(); await login(users[1]); await page.getByText('暂无未清挂账').waitFor();
  assert.equal(await page.locator('[data-recharge], [data-credit], [data-clearing]').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 }); await capture('store-finance-readonly-mobile.png');
  await page.locator(`[data-account-document="${clearing.id}"]`).click();
  await capture('store-finance-clearing-proof-mobile.png');
  const download = page.waitForEvent('download'); await page.locator('[data-account-evidence]').click();
  assert.equal((await download).suggestedFilename(), 'clearing-proof.png');
  await page.locator('.ws-dialog [data-close]').click();
  await page.locator(`[data-account-document="${recharge.id}"]`).click();
  const rechargeDownload = page.waitForEvent('download'); await page.locator('[data-account-evidence]').click();
  assert.equal((await rechargeDownload).suggestedFilename(), 'recharge-proof.png');
  assert.deepEqual(manifest.errors, []); manifest.status = 'PASS'; manifest.final = { balance: '100.00', limit: '200.00', used: '0.00', clearingCount: 1, ledgerCount: 2, stalePreviewBlocked: true, lostResponseRecoveredOnce: true, rechargeEvidence: 'LINKED', clearingEvidence: 'LINKED_ONCE', ownStoreFinanceDownloads: 'PASS' };
} catch (error) { manifest.status = 'FAILED'; manifest.failure = error.stack; process.exitCode = 1; }
finally {
  await browser?.close();
  const users = await db.user.findMany({ where: { username: { startsWith: prefix } } }); const ids = users.map(user => user.id);
  const files = await db.fileObject.findMany({ where: { ownerId: { in: ids } } });
  await db.fileObject.deleteMany({ where: { ownerId: { in: ids } } });
  for (const file of files) await unlink(join(resolve(process.env.PRIVATE_FILE_DIR || 'var/private-files'), file.objectKey)).catch(() => {});
  await db.commandRecord.deleteMany({ where: { actorUserId: { in: ids } } });
  await db.userScope.deleteMany({ where: { userId: { in: ids } } });
  if (store) {
    await db.accountLedger.deleteMany({ where: { account: { storeId: store.id } } });
    await db.clearingItem.deleteMany({ where: { clearing: { storeId: store.id } } });
    await db.clearingDocument.deleteMany({ where: { storeId: store.id } });
    await db.rechargeDocument.deleteMany({ where: { storeId: store.id } });
    await db.fundingAllocation.deleteMany({ where: { storeId: store.id } });
    await db.storeAccount.deleteMany({ where: { storeId: store.id } }); await db.store.delete({ where: { id: store.id } });
  }
  await db.collectionAccount.deleteMany({ where: { name: prefix } });
  await db.user.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect(); manifest.cleanup = 'PASS';
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest));
}
