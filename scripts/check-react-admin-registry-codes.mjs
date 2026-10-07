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
const output = 'var/react-admin-registry-code-evidence'; await mkdir(output, { recursive: true });
const prefix = `RXRC${Date.now()}`; const report = { status: 'RUNNING', screenshots: [], errors: [], checks: [] }; let browser, user;
const cases = [
  { path: 'categories', title: '商品分类', model: 'category', label: '名称', code: 'FL', limit: 80 },
  { path: 'units', title: '单位管理', model: 'unit', label: '名称', code: 'DW', limit: 40 },
  { path: 'templates', title: '订货模板', model: 'orderTemplate', label: '模板名称', code: 'MB', limit: 80 },
];
try {
  const password = randomUUID(), role = await db.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  user = await db.user.create({ data: { username: prefix, displayName: '自动编码验收账号', passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } } } });
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/categories'); await page.getByLabel('用户名').fill(prefix);
  await page.getByLabel('密码', { exact: true }).fill(password); await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '商品分类', exact: true }).waitFor();
  const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('procurex-react-admin-session-v1')).accessToken);
  const call = async (path, body) => { const response = await fetch(`http://127.0.0.1:3114/api/v1/${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  for (const item of cases) {
    const name = `${prefix}${item.title}`, editedName = `${name}编辑`;
    await page.goto(`http://127.0.0.1:4174/${item.path}`); await page.getByRole('heading', { name: item.title, exact: true }).waitFor();
    await page.getByRole('button', { name: '新增', exact: true }).click();
    const dialog = page.getByRole('dialog'); assert.equal(await dialog.getByLabel(/编码|模板编号/).count(), 0);
    await dialog.getByLabel(item.label, { exact: true }).fill(name);
    if (item.path === 'templates') await dialog.getByLabel('模板标签', { exact: true }).fill('合成测试');
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(300); const file = `${item.path}-create-${width}.png`; await page.screenshot({ path: `${output}/${file}` }); report.screenshots.push(file); }
    const saved = page.waitForResponse(r => r.url().endsWith(`/api/v1/${item.path}`) && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: '保存', exact: true }).click(); const response = await saved;
    assert.equal(response.status(), 201); assert.equal(Object.hasOwn(response.request().postDataJSON(), 'code'), false); await dialog.waitFor({ state: 'hidden' });
    const original = await db[item.model].findFirstOrThrow({ where: { name } }); assert.match(original.code, new RegExp(`^${item.code}[A-F0-9]{32}$`));
    await page.reload(); await page.getByRole('textbox', { name: `搜索${item.title}` }).fill(name);
    await page.getByRole('button', { name: `${item.path === 'templates' ? '编辑模板' : '编辑'}${name}`, exact: true }).click();
    const codeField = dialog.getByLabel(item.path === 'templates' ? '模板编号' : '编码', { exact: true }); await codeField.waitFor();
    assert.ok(await codeField.isDisabled()); assert.equal(await codeField.inputValue(), original.code);
    await dialog.getByLabel(item.label, { exact: true }).fill(editedName);
    const updated = page.waitForResponse(r => r.url().endsWith(`/api/v1/${item.path}/${original.id}`) && r.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: '保存', exact: true }).click(); assert.equal((await updated).status(), 200); await dialog.waitFor({ state: 'hidden' });
    assert.equal((await db[item.model].findUniqueOrThrow({ where: { id: original.id } })).code, original.code);
    if (item.path === 'templates') {
      await page.getByRole('button', { name: `复制模板${editedName}`, exact: true }).click(); await dialog.getByLabel('模板名称', { exact: true }).waitFor();
      assert.equal(await dialog.getByLabel('模板编号').count(), 0);
      const copiedName = `${prefix}模板副本`; await dialog.getByLabel('模板名称', { exact: true }).fill(copiedName);
      const copied = page.waitForResponse(r => r.url().endsWith(`/api/v1/templates/${original.id}/copy`));
      await dialog.getByRole('button', { name: '保存', exact: true }).click(); const result = await copied;
      assert.equal(result.status(), 201); assert.equal(Object.hasOwn(result.request().postDataJSON(), 'code'), false); await dialog.waitFor({ state: 'hidden' });
      const copy = await db.orderTemplate.findFirstOrThrow({ where: { name: copiedName } }); assert.match(copy.code, /^MB[A-F0-9]{32}$/); assert.notEqual(copy.code, original.code);
    }
    const body = index => ({ name: `${prefix}${item.path}并发${index}`, ...(item.path === 'templates' ? { tag: '合成测试' } : {}) });
    const concurrent = await Promise.all([call(item.path, body(1)), call(item.path, body(2))]);
    for (const result of concurrent) { assert.equal(result.status, 201); assert.match(result.body.data.code, new RegExp(`^${item.code}[A-F0-9]{32}$`)); }
    assert.notEqual(concurrent[0].body.data.code, concurrent[1].body.data.code);
    const custom = await call(item.path, { ...body('兼容'), code: `${prefix}${item.code}` }); assert.equal(custom.status, 201); assert.equal(custom.body.data.code, `${prefix}${item.code}`);
    for (const code of ['', ' ', null, 123, 'X'.repeat(item.limit + 1)]) assert.equal((await call(item.path, { ...body('无效'), code })).status, 400);
    report.checks.push(`${item.title}真实新增/刷新/编辑、并发唯一、旧显式编码及非法编码通过`);
  }
  assert.deepEqual(report.errors, []); report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.errors.push(error.message); process.exitCode = 1; }
finally {
  await browser?.close();
  for (const model of ['orderTemplate', 'category', 'unit']) { await db[model].deleteMany({ where: { name: { startsWith: prefix } } }); assert.equal(await db[model].count({ where: { name: { startsWith: prefix } } }), 0); }
  if (user) { await db.auditLog.deleteMany({ where: { actorUserId: user.id } }); await db.user.delete({ where: { id: user.id } }); }
  await db.$disconnect(); report.cleanup = 'PASS'; await writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
