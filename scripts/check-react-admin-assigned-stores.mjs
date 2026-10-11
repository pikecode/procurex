import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchAcceptanceBrowser } from './acceptance-browser.mjs';
import { createServer } from '../apps/admin/node_modules/vite/dist/node/index.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { DatabaseService } from '../dist/apps/api/src/database/database.service.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

assertLocalFixtureDatabase(process.env.DATABASE_URL);
const prefix = `RXSCOPE${Date.now()}`;
const output = 'var/react-admin-assigned-stores-evidence';
await mkdir(output, { recursive: true });
const checks = [], errors = [];
let app, vite, browser, db;
try {
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1');
  db = app.get(DatabaseService).client;
  const api = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  vite = await createServer({ root: resolve('apps/admin'), server: { host: process.env.WORKSPACE_BROWSER_WS ? '0.0.0.0' : '127.0.0.1', allowedHosts: ['host.docker.internal'], port: 0, proxy: { '/api': { target: api } } } });
  await vite.listen();
  const base = `http://${process.env.WORKSPACE_BROWSER_WS ? 'host.docker.internal' : '127.0.0.1'}:${vite.httpServer.address().port}`;
  browser = await launchAcceptanceBrowser();
  const stores = [];
  for (const suffix of ['A', 'B', 'C']) stores.push(await db.store.create({ data: { code: `${prefix}${suffix}`, name: `授权验收门店${suffix}`, accounts: { create: {} } } }));
  const template = await db.orderTemplate.create({ data: { code: prefix, name: '授权验收模板' } });
  const purchase = await db.purchaseRequest.create({ data: { requestNo: `${prefix}PR`, storeId: stores[0].id, templateId: template.id, status: 'PENDING_PROCUREMENT' } });
  for (const roleCode of ['REGION_MANAGER', 'REGION_FINANCE', 'PURCHASE_FOLLOWER']) {
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const username = `${prefix}${roleCode}`;
    await db.user.create({ data: { username, displayName: `授权验收${role.name}`, passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } }, scopes: { create: { scopeType: 'MULTI_STORE', stores: { create: stores.slice(0, 2).map(store => ({ storeId: store.id })) } } } } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${roleCode}: ${error.message}`));
    await page.goto(`${base}/`);
    await page.getByLabel('用户名').fill(username);
    await page.getByLabel('密码', { exact: true }).fill('correct-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(`**/${roleCode === 'REGION_FINANCE' ? 'store-finance' : 'purchase-requests'}`);
    await page.goto(`${base}/purchase-requests?request=${purchase.id}`);
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').locator('.ant-descriptions').getByText('资金缺口', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '确认采购', exact: true }).count(), roleCode === 'PURCHASE_FOLLOWER' ? 1 : 0);
    assert.equal(await page.getByRole('button', { name: '修改明细', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '调整供应商', exact: true }).count(), 0);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${output}/${roleCode}-purchase.png`, fullPage: true });
    await page.goto(`${base}/store-finance`);
    await page.getByRole('heading', { name: '门店财务', exact: true }).waitFor();
    await page.getByText('授权验收门店A', { exact: true }).waitFor();
    assert.equal(await page.getByText('授权验收门店C', { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('门店充值', { exact: true }).count(), 0);
    await page.getByLabel('账户授权验收门店A', { exact: true }).click();
    await page.getByRole('tab', { name: '储值流水', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '充值', exact: true }).count(), 0);
    await page.goto(`${base}/reports`);
    await page.getByRole('heading', { name: '业务报表', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: '经营差额', exact: true }).count(), 0);
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.getByText('统计日期', { exact: true }).waitFor();
    await page.getByLabel('门店筛选').click();
    await page.locator('.ant-select-dropdown:visible').getByText('授权验收门店A', { exact: true }).waitFor();
    assert.equal(await page.locator('.ant-select-dropdown:visible').getByText('授权验收门店C', { exact: true }).count(), 0);
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: '业务报表', exact: true }).click();
    await page.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(350);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${output}/${roleCode}-reports-${width}.png`, fullPage: true });
    }
    checks.push({ role: roleCode, allowedStores: 2, readonlyFinance: true, procurementConfirm: roleCode === 'PURCHASE_FOLLOWER' });
    await context.close();
  }
  assert.deepEqual(errors, []);
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
  throw error;
} finally {
  await browser?.close();
  await vite?.close();
  if (db) {
    await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await db.purchaseRequest.deleteMany({ where: { requestNo: { startsWith: prefix } } });
    await db.orderTemplate.deleteMany({ where: { code: prefix } });
    const stores = await db.store.findMany({ where: { code: { startsWith: prefix } }, select: { id: true } });
    await db.storeAccount.deleteMany({ where: { storeId: { in: stores.map(store => store.id) } } });
    await db.store.deleteMany({ where: { code: { startsWith: prefix } } });
  }
  await app?.close();
  await writeFile(`${output}/manifest.json`, JSON.stringify({ status: errors.length || checks.length !== 3 ? 'failed' : 'passed', checks, errors }, null, 2));
}
console.log(JSON.stringify({ checks, errors }));
