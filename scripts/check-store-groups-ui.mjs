import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';

const api = process.env.WORKSPACE_API_URL || 'http://127.0.0.1:3114/api/v1';
const web = process.env.WORKSPACE_WEB_URL || 'http://127.0.0.1:4173';
for (const url of [api, web, process.env.DATABASE_URL]) assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
const prefix = `UIGROUP${randomUUID().slice(0, 8)}`;
const directory = 'var/store-groups-evidence';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const report = { prefix, status: 'RUNNING', checks: [], screenshots: [], errors: [] };
const groupIds = [];
let storeId;
await mkdir(directory, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', error => report.errors.push(error.message));
  const field = name => page.locator(`.ws-dialog [name="${name}"]`);
  const save = async () => { await page.locator('.ws-dialog [type=submit]').click(); await page.locator('.ws-dialog').waitFor({ state: 'detached' }); };
  const shot = async name => { const path = `${directory}/${name}.png`; await page.screenshot({ path, fullPage: true }); report.screenshots.push(path); };
  await page.goto(`${web}/app.html?api=${encodeURIComponent(api)}#/stores`);
  await page.locator('[name=username]').fill('pxflow_user'); await page.locator('[name=password]').fill('correct-password');
  await page.locator('#ws-login-form button').click();
  await page.locator('#ws-groups').click();
  await page.locator('#ws-create').click(); await field('name').fill(prefix); await save();
  const group = await db.storeGroup.findUniqueOrThrow({ where: { name: prefix } }); groupIds.push(group.id);
  await page.locator('#ws-groups-back').click(); await page.locator('#ws-create').click();
  for (const [name, value] of Object.entries({ code: prefix, name: prefix, contactName: '验收联系人', contactPhone: '13800000000', address: '测试路1号' })) await field(name).fill(value);
  await field('storeType').selectOption('DIRECT'); await field('groupName').selectOption(prefix);
  for (const [name, value] of Object.entries({ province: '44', city: '4401', district: '440106' })) await field(`address_${name}`).selectOption(value);
  await shot('store-group-select-desktop'); await save();
  const store = await db.store.findUniqueOrThrow({ where: { code: prefix } }); storeId = store.id; assert.equal(store.groupName, prefix);
  report.checks.push('Create group from visible entry and persist store dropdown assignment');
  await page.locator('#ws-groups').click(); await page.locator('#ws-search').fill(prefix);
  assert.equal(await page.locator(`[data-group-delete="${group.id}"]`).isDisabled(), true);
  assert.match(await page.locator('#ws-rows').innerText(), /1/);
  await page.locator(`[data-edit="${group.id}"]`).click(); await field('name').fill(`${prefix}RENAMED`); await field('status').selectOption('DISABLED'); await save();
  assert.equal((await db.store.findUniqueOrThrow({ where: { id: store.id } })).groupName, `${prefix}RENAMED`);
  report.checks.push('Rename cascades membership, disable retains membership and referenced deletion is disabled');
  await page.locator('#ws-groups-back').click(); await page.locator('#ws-search').fill(prefix);
  await page.locator(`[data-edit="${store.id}"]`).click(); assert.equal(await field('groupName').inputValue(), `${prefix}RENAMED`);
  assert.match(await field('groupName').innerText(), /已停用/);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('#ws-create').click(); assert.equal(await field('groupName').locator(`option[value="${prefix}RENAMED"]`).count(), 0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  report.checks.push('Disabled group remains visible on existing store and is excluded from new assignments');
  await page.locator('#ws-groups').click(); await page.locator('#ws-search').fill(prefix);
  await page.setViewportSize({ width: 320, height: 960 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await shot('groups-mobile');
  await page.locator(`[data-edit="${group.id}"]`).click(); await shot('group-editor-mobile');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await field('status').selectOption('ACTIVE'); await save();
  await page.locator('#ws-create').click(); await field('name').fill(`${prefix}RENAMED`); await page.locator('.ws-dialog [type=submit]').click();
  await page.getByText('分组名称已存在，请使用其他名称。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  report.checks.push('Mobile list/editor fit, re-enable works and duplicate names show actionable validation');
  await db.store.delete({ where: { id: store.id } }); storeId = undefined;
  await page.locator('#ws-refresh').click(); await page.locator(`[data-group-delete="${group.id}"]:not([disabled])`).waitFor();
  await page.locator(`[data-group-delete="${group.id}"]`).click(); await save();
  assert.equal(await db.storeGroup.count({ where: { id: group.id } }), 0);
  assert.deepEqual(report.errors, []); report.checks.push('Unreferenced group deletes through UI'); report.status = 'PASSED';
} catch (error) { report.status = 'FAILED'; report.failure = error.message; process.exitCode = 1; }
finally {
  try {
    if (storeId) await db.store.deleteMany({ where: { id: storeId, code: prefix } });
    await db.storeGroup.deleteMany({ where: { id: { in: groupIds }, name: { startsWith: prefix } } });
    report.cleanup = 'PASSED';
  } catch (error) { report.cleanup = 'FAILED'; report.cleanupError = error.message; report.status = 'FAILED'; process.exitCode = 1; }
  await browser.close(); await db.$disconnect();
  await writeFile(`${directory}/manifest.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
