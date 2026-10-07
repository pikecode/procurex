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
const output = 'var/react-admin-notification-evidence'; await mkdir(output, { recursive: true });
const report = { status: 'RUNNING', screenshots: [], errors: [] }; let browser, user;
try {
  const prefix = `RXNOTICE${Date.now()}`, password = randomUUID();
  const role = await db.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  user = await db.user.create({ data: { username: prefix, displayName: '通知验收账号', passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } } } });
  const first = await db.notification.create({ data: { recipientId: user.id, eventKey: `${prefix}1`, title: '门店充值提醒', body: '合成验收通知，门店订货资金不足。', payload: {} } });
  await db.notification.create({ data: { recipientId: user.id, eventKey: `${prefix}2`, title: '供应商待发货提醒', body: '合成验收通知，请核对待发货订单。', payload: {} } });
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:4174'); await page.getByLabel('用户名').fill(user.username);
  await page.getByLabel('密码', { exact: true }).fill(password); await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '门店管理', exact: true }).waitFor();
  await page.getByRole('button', { name: '通知', exact: true }).click(); await page.getByRole('button', { name: first.title, exact: true }).click();
  const detail = page.getByRole('dialog', { name: first.title, exact: true }); await detail.getByText(first.body, { exact: true }).waitFor();
  await detail.getByRole('button', { name: '标为已读', exact: true }).click(); await detail.getByRole('button', { name: '标为已读', exact: true }).waitFor({ state: 'hidden' });
  assert.equal((await db.notification.findUniqueOrThrow({ where: { id: first.id } })).status, 'READ');
  await detail.locator('.ant-modal-close').click();
  const inbox = page.getByRole('dialog', { name: '通知', exact: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 }); await page.waitForTimeout(400);
    assert.ok(await inbox.evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }));
    const file = `notifications-${width}.png`; await page.screenshot({ path: `${output}/${file}` }); report.screenshots.push(file);
  }
  await page.getByRole('button', { name: '全部已读', exact: true }).click();
  await page.getByRole('button', { name: '全部已读', exact: true }).waitFor();
  for (let i = 0; i < 40 && await db.notification.count({ where: { recipientId: user.id, status: 'UNREAD' } }); i++) await page.waitForTimeout(100);
  assert.equal(await db.notification.count({ where: { recipientId: user.id, status: 'UNREAD' } }), 0);
  await page.reload(); await page.getByRole('button', { name: '通知', exact: true }).click();
  await page.getByRole('button', { name: first.title, exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /标为已读/ }).count(), 0);
  assert.deepEqual(report.errors, []); report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.errors.push(error.message); process.exitCode = 1; }
finally {
  await browser?.close();
  if (user) { await db.user.delete({ where: { id: user.id } }); assert.equal(await db.notification.count({ where: { recipientId: user.id } }), 0); }
  await db.$disconnect(); report.cleanup = 'PASS'; await writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
