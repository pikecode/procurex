import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/store-group-workspace-evidence'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const groups = [{ id: 'east', name: '华东区域', storeCount: 1, status: 'ACTIVE', version: 1 }, { id: 'west', name: '西区停用组', storeCount: 1, status: 'DISABLED', version: 1 }];
  let stores = [
    { id: 'a', name: '上海人民广场店', groupName: '华东区域', storeType: 'DIRECT', status: 'ACTIVE', version: 11 },
    { id: 'b', name: '杭州湖滨店', groupName: null, storeType: 'FRANCHISE', status: 'ACTIVE', version: 12 },
    { id: 'c', name: '西区门店', groupName: '西区停用组', storeType: 'JOINT', status: 'ACTIVE', version: 13 },
  ];
  await page.route('**/api/v1/stores', route => route.fulfill({ json: { data: stores } }));
  await page.route('**/api/v1/store-groups', route => route.fulfill({ json: { data: groups } }));
  await page.goto('http://127.0.0.1:4174/stores');
  await page.getByLabel('用户名').fill('pxflow_user'); await page.getByLabel('密码', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '门店管理', exact: true }).waitFor();
  await page.getByText('上海人民广场店', { exact: true }).waitFor();
  await page.locator('.store-group-panel').getByText('华东区域 (1)', { exact: true }).click();
  await page.getByText('杭州湖滨店', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByText('杭州湖滨店', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.ok(await page.getByRole('dialog').getByText('华东区域', { exact: true }).isVisible());
  await page.getByRole('button', { name: '取消', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.locator('.store-group-panel').getByText('西区停用组 (1) · 已停用', { exact: true }).click();
  await page.getByRole('button', { name: '新增', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: '新增', exact: true }).count(), 0);
  await page.getByText('西区门店', { exact: true }).waitFor();
  await page.locator('.store-group-panel').getByText('全部门店 (3)', { exact: true }).click();
  await page.locator('tr[data-row-key="a"]').getByRole('checkbox').check();
  await page.locator('tr[data-row-key="b"]').getByRole('checkbox').check();
  await page.getByRole('button', { name: '调整分组 (2)', exact: true }).click();
  const dialog = page.locator('.ant-modal').filter({ hasText: '调整分组 ·' });
  await dialog.getByLabel('目标分组', { exact: true }).click();
  assert.equal(await page.locator('.ant-select-dropdown').getByText('西区停用组', { exact: true }).count(), 0);
  await page.locator('.ant-select-dropdown').getByText('华东区域', { exact: true }).click();
  let payload; let fail = true;
  await page.route('**/api/v1/stores/group-memberships', route => {
    payload = route.request().postDataJSON();
    if (fail) return route.fulfill({ status: 409, json: { code: 'VERSION_CONFLICT', message: '门店资料已变化，请刷新后重新选择' } });
    stores = stores.map(store => payload.stores.some(item => item.id === store.id) ? { ...store, groupName: payload.groupName } : store);
    groups[0].storeCount = 2;
    return route.fulfill({ json: { data: { count: 2 } } });
  });
  await dialog.getByRole('button', { name: '确认调整', exact: true }).click();
  await dialog.locator('.ant-alert').waitFor();
  assert.ok(await dialog.isVisible());
  await dialog.locator('button.ant-btn-loading').waitFor({ state: 'hidden' });
  await dialog.locator('.ant-modal-title').click();
  await page.screenshot({ path: `${output}/batch-error.png` });
  fail = false;
  await dialog.locator('.ant-modal-footer button.ant-btn-primary').click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(payload, { groupName: '华东区域', stores: [{ id: 'a', expectedVersion: 11 }, { id: 'b', expectedVersion: 12 }] });
  await page.locator('.store-group-panel').getByText('华东区域 (2)', { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/desktop.png` });
  await page.goto('http://127.0.0.1:4174/store-groups'); await page.getByLabel('查看华东区域的门店').click();
  await page.getByRole('heading', { name: '门店管理', exact: true }).waitFor();
  assert.ok(page.url().endsWith('/stores?group=east'));
  await page.getByText('杭州湖滨店', { exact: true }).waitFor();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 960 }); await page.getByLabel('选择门店分组').click();
    await page.locator('.ant-select-dropdown').getByText('未分组 (0)', { exact: true }).click();
    await page.locator('.ant-empty-description').waitFor();
    await page.getByRole('heading', { name: '门店管理', exact: true }).click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${output}/mobile-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: group filtering/counts, scoped create, disabled group, batch versions/error retry, directory links, mobile filters; mocked writes only');
} finally { await browser.close(); }
