import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium } from 'playwright';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

assertLocalFixtureDatabase(process.env.DATABASE_URL);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const output = 'var/react-admin-command-evidence'; await mkdir(output, { recursive: true });
const report = { status: 'RUNNING', screenshots: [], errors: [] }; let browser; const users = [];
try {
  const password = randomUUID(); const prefix = `RXCMD${Date.now()}`;
  for (const code of ['ADMIN', 'HQ_FINANCE']) {
    const role = await db.role.findUniqueOrThrow({ where: { code } });
    users.push(await db.user.create({ data: { username: `${prefix}${code}`, displayName: '命令验收账号', passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } } } }));
  }
  const targets = [];
  for (const mode of ['review', 'rollback', 'atomic', 'unproven']) targets.push(await db.commandRecord.create({ data: {
    actorUserId: users[0].id, action: mode === 'review' ? 'purchase.confirm' : 'price.process',
    idempotencyKey: randomUUID(), requestHash: 'synthetic-fixture', traceId: `${prefix}${mode}`, expiresAt: new Date(Date.now() - 60000),
    resourceType: 'PriceChangeRun', resourceId: randomUUID(), atomicPriceExecution: mode === 'atomic',
    ...(mode === 'rollback' ? { errorBody: { code: 'COMMAND_ROLLBACK_CONFIRMED', proof: 'PRICE_PROCESS_CALLBACK_REJECTED' } } : {}),
  } }));
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }); page.on('pageerror', error => report.errors.push(error.message));
  const login = async (p, user) => { await p.goto('http://127.0.0.1:4174/commands'); await p.getByLabel('用户名').fill(user.username); await p.getByLabel('密码', { exact: true }).fill(password); await p.getByRole('button', { name: '登录', exact: true }).click(); };
  await login(page, users[0]); await page.getByRole('heading', { name: '命令诊断', exact: true }).waitFor();
  await page.getByRole('textbox', { name: '搜索命令诊断' }).fill(targets[0].traceId);
  await page.getByRole('button', { name: '查看命令', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '命令详情', exact: true });
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 960 }); await page.waitForTimeout(300); const file = `commands-${width}.png`; await page.screenshot({ path: `${output}/${file}` }); report.screenshots.push(file); }
  await dialog.getByRole('button', { name: '记录人工复核', exact: true }).click();
  await dialog.getByRole('button', { name: '记录人工复核', exact: true }).click(); await dialog.getByText('请输入复核原因', { exact: true }).waitFor();
  await dialog.getByLabel('复核原因').fill('合成命令人工核对，不改变原状态');
  let dropped = false;
  await page.route('**/api/v1/commands/*/reviews', async route => { if (!dropped) { dropped = true; const response = await route.fetch(); assert.ok(response.ok()); await route.abort('failed'); } else await route.continue(); });
  await dialog.getByRole('button', { name: '记录人工复核', exact: true }).click();
  await page.getByRole('button', { name: '恢复原提交', exact: true }).waitFor(); await page.reload();
  await page.getByRole('button', { name: '恢复原提交', exact: true }).click(); await page.getByRole('button', { name: '恢复原提交', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await db.auditLog.count({ where: { actorUserId: users[0].id, action: 'command.review' } }), 1);
  assert.equal((await db.commandRecord.findUniqueOrThrow({ where: { id: targets[0].id } })).status, 'PROCESSING');
  for (const [index, label] of [[1, '关闭已回滚价格命令'], [2, '关闭未提交价格命令'], [3, '关闭未提交价格命令']]) {
    await page.getByRole('textbox', { name: '搜索命令诊断' }).fill(targets[index].traceId);
    await page.getByRole('button', { name: '查看命令', exact: true }).click(); await dialog.getByRole('button', { name: label, exact: true }).click();
    await dialog.getByLabel('复核原因').fill('仅关闭合成验收命令');
    const response = page.waitForResponse(r => r.url().includes(`/commands/${targets[index].id}/close-`));
    await dialog.getByRole('button', { name: label, exact: true }).click(); assert.equal((await response).status(), index === 3 ? 409 : 201);
    if (index !== 3) await dialog.waitFor({ state: 'hidden' });
    assert.equal((await db.commandRecord.findUniqueOrThrow({ where: { id: targets[index].id } })).status, index === 3 ? 'PROCESSING' : 'FAILED');
  }
  const other = await browser.newPage(); await login(other, users[1]); await other.getByText('无权访问此页面', { exact: true }).waitFor();
  assert.equal(await other.getByRole('menuitem', { name: '命令诊断' }).count(), 0);
  assert.deepEqual(report.errors, []); report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.errors.push(error.message); process.exitCode = 1; }
finally {
  await browser?.close();
  for (const user of users) { await db.auditLog.deleteMany({ where: { actorUserId: user.id } }); await db.commandRecord.deleteMany({ where: { actorUserId: user.id } }); await db.user.delete({ where: { id: user.id } }); }
  await db.$disconnect(); report.cleanup = 'PASS'; await writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
