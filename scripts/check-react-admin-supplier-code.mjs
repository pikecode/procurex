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
const output = 'var/react-admin-supplier-code-evidence'; await mkdir(output, { recursive: true });
const prefix = `RXSC${Date.now()}`, name = `${prefix}供应商编码验收`;
const report = { status: 'RUNNING', screenshots: [], errors: [] }; let browser, user;
try {
  const password = randomUUID(), role = await db.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  user = await db.user.create({ data: { username: prefix, displayName: '编码验收账号', passwordHash: await hashPassword(password), roles: { create: { roleId: role.id } } } });
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/suppliers'); await page.getByLabel('用户名').fill(prefix);
  await page.getByLabel('密码', { exact: true }).fill(password); await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '供应商管理', exact: true }).waitFor(); await page.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增供应商', exact: true });
  assert.equal(await dialog.getByLabel('编码', { exact: true }).count(), 0);
  for (const [label, value] of [['供应商名称', name], ['联系人', '合成测试联系人'], ['手机号', '13900000000'], ['地址', '合成测试地址'], ['开户行', '合成测试银行'], ['开户名', '合成测试户名'], ['银行账户', '000000'], ['纳税人识别号', 'TESTONLY'], ['发票抬头', '合成测试发票']]) await dialog.getByLabel(label, { exact: true }).fill(value);
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(300); const file = `supplier-create-${width}.png`; await page.screenshot({ path: `${output}/${file}` }); report.screenshots.push(file); }
  const saved = page.waitForResponse(r => r.url().endsWith('/api/v1/suppliers') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); const response = await saved;
  assert.equal(Object.hasOwn(response.request().postDataJSON(), 'code'), false); assert.equal(response.status(), 201);
  await dialog.waitFor({ state: 'hidden' });
  const supplier = await db.supplier.findFirstOrThrow({ where: { name } }); assert.match(supplier.code, /^GYS[A-F0-9]{32}$/);
  await page.reload(); await page.getByRole('textbox', { name: '搜索供应商管理' }).fill(name);
  await page.getByRole('button', { name: `编辑${name}`, exact: true }).click();
  const editing = page.getByRole('dialog', { name: '编辑供应商', exact: true }); assert.equal(await editing.getByLabel('编码', { exact: true }).count(), 0);
  await editing.getByLabel('联系人', { exact: true }).fill('合成测试编辑联系人');
  const updated = page.waitForResponse(r => r.url().endsWith(`/api/v1/suppliers/${supplier.id}`) && r.request().method() === 'PATCH');
  await editing.getByRole('button', { name: '保存', exact: true }).click(); assert.equal((await updated).status(), 200);
  assert.equal((await db.supplier.findUniqueOrThrow({ where: { id: supplier.id } })).code, supplier.code);
  await editing.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: `关联商品${name}`, exact: true }).click();
  await page.getByRole('dialog', { name: `管理商品 · ${name}`, exact: true }).waitFor();
  await page.getByRole('tab', { name: /^待添加商品/ }).click();
  const picker = page.getByRole('dialog', { name: `管理商品 · ${name}`, exact: true });
  await picker.getByText('商品分类', { exact: true }).waitFor();
  await picker.getByLabel('搜索供应商品').waitFor();
  const available = await db.product.findFirstOrThrow({ where: { isActive: true }, orderBy: { name: 'asc' } });
  await page.getByRole('textbox', { name: '搜索供应商品', exact: true }).fill(available.name);
  await picker.getByRole('row').filter({ has: page.getByRole('cell', { name: available.name, exact: true }) }).getByRole('checkbox').check();
  await picker.getByRole('tab', { name: /^已供商品/ }).click();
  await page.getByRole('dialog', { name: `管理商品 · ${name}`, exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  const discard = page.getByRole('dialog').filter({ hasText: '放弃未保存的商品配置？' });
  await discard.getByRole('button', { name: '继续编辑', exact: true }).click();
  const saveProducts = async status => {
    const pending = page.waitForResponse(r => r.url().endsWith(`/suppliers/${supplier.id}/products`) && r.request().method() === 'PUT');
    await page.getByRole('button', { name: '保存修改', exact: true }).click(); assert.equal((await pending).status(), status);
  };
  await saveProducts(200);
  assert.equal(await db.supplierProduct.count({ where: { supplierId: supplier.id, productId: available.id } }), 1);
  await page.getByRole('dialog', { name: `管理商品 · ${name}`, exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索供应商管理' }).fill(name);
  await page.getByRole('button', { name: `关联商品${name}`, exact: true }).click();
  await page.getByRole('button', { name: `移除${available.name}`, exact: true }).waitFor();
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(300); const file = `supplier-products-${width}.png`; await page.screenshot({ path: `${output}/${file}` }); report.screenshots.push(file); }
  await db.supplier.update({ where: { id: supplier.id }, data: { updatedAt: new Date(Date.now() + 1000) } });
  await page.getByRole('button', { name: `移除${available.name}`, exact: true }).click();
  await saveProducts(409);
  assert.equal(await db.supplierProduct.count({ where: { supplierId: supplier.id } }), 1);
  await page.getByRole('dialog', { name: `管理商品 · ${name}`, exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '放弃', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索供应商管理' }).fill(name);
  await page.getByRole('button', { name: `关联商品${name}`, exact: true }).click();
  await page.getByRole('button', { name: `移除${available.name}`, exact: true }).click();
  await saveProducts(200); assert.equal(await db.supplierProduct.count({ where: { supplierId: supplier.id } }), 0);
  report.checks = ['自动编号及编辑保留', '真实商品添加/保存/重新进入/移除', '版本冲突409不覆盖关联', '1440/390截图'];
  assert.deepEqual(report.errors, []); report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.errors.push(error.message); process.exitCode = 1; }
finally {
  await browser?.close(); await db.supplierProduct.deleteMany({ where: { supplier: { name } } }); await db.supplier.deleteMany({ where: { name } });
  if (user) { await db.auditLog.deleteMany({ where: { actorUserId: user.id } }); await db.user.delete({ where: { id: user.id } }); }
  assert.equal(await db.supplier.count({ where: { name } }), 0); await db.$disconnect(); report.cleanup = 'PASS';
  await writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
