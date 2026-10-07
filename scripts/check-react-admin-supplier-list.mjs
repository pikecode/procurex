import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/react-admin-supplier-list-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const user = { id: '11111111-1111-4111-8111-111111111111', displayName: '测试管理员', roles: ['ADMIN'], scope: { type: 'ADMIN' } };
  await page.addInitScript(user => sessionStorage.setItem('procurex-react-admin-session-v1', JSON.stringify({ accessToken: 'fixture', expiresAt: new Date(Date.now() + 3600000).toISOString(), user })), user);
  await page.route('**/api/v1/**', route => {
    assert.equal(route.request().method(), 'GET');
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/me') ? { user, session: { expiresAt: new Date(Date.now() + 3600000).toISOString() } } : path.endsWith('/notifications') ? { unreadCount: 0, notifications: [] } : path.endsWith('/suppliers') ? [{ id: 's1', name: '广州粮油供应商', code: 'GYS_TEST', supplierType: 'HEADQUARTERS', defaultSettlementCycle: 'MONTHLY', status: 'ACTIVE', isArchived: false }] : [];
    return route.fulfill({ json: { data } });
  });
  await page.goto('http://127.0.0.1:4174/suppliers');
  await page.getByRole('cell', { name: '广州粮油供应商', exact: true }).waitFor();
  assert.deepEqual(await page.getByRole('columnheader').allTextContents(), ['供应商名称', '供应商类别', '结算周期', '操作']);
  await page.getByRole('cell', { name: '总部对接', exact: true }).waitFor();
  await page.getByRole('cell', { name: '月结', exact: true }).waitFor();
  assert.equal(await page.getByText('GYS_TEST', { exact: true }).count(), 0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${output}/list-${width}.png` });
  }
  await page.getByLabel('搜索供应商管理').fill('不存在');
  await page.getByRole('cell', { name: '广州粮油供应商', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '重置筛选', exact: true }).click();
  await page.getByRole('button', { name: '编辑广州粮油供应商', exact: true }).click();
  await page.getByRole('dialog', { name: '编辑供应商', exact: true }).waitFor();
  assert.equal(await page.getByLabel('编码', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增供应商', exact: true });
  for (const label of ['供应商名称', '联系人', '手机号', '配送方式', '结算方式', '结算周期', '是否需要运费', '地址', '开户行', '开户名', '银行账户', '纳税人识别号', '发票抬头', '备注', '供应商类型']) await dialog.getByLabel(label, { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel('是否需要运费', { exact: true }).getAttribute('aria-checked'), 'false');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${output}/form-${width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: supplier list columns, Chinese labels, search/reset, edit entry, desktop/mobile; fixture reads only');
} finally {
  await browser.close();
}
