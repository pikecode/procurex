import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/category-tree-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/categories');
  await page.getByLabel('用户名').fill('pxflow_user');
  await page.getByLabel('密码', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '商品分类', exact: true }).waitFor();
  await page.route('**/api/v1/categories', route => route.fulfill({ json: { data: [
    { id: 'root', name: '食品原料', parentId: null, sortOrder: 1, version: 1 },
    { id: 'child', name: '米面粮油', parentId: 'root', sortOrder: 1, version: 1 },
    { id: 'other', name: '清洁用品', parentId: null, sortOrder: 2, version: 1 },
  ] } }));
  await page.getByRole('button', { name: '刷新列表', exact: true }).click();
  await page.getByText('米面粮油', { exact: true }).waitFor();
  assert.equal(await page.getByRole('columnheader', { name: '排序', exact: true }).count(), 0);
  await page.getByRole('button', { name: '编辑食品原料', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('dialog').getByLabel('编码', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '全部收起', exact: true }).click();
  await page.getByText('米面粮油', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '全部展开', exact: true }).click();
  await page.getByText('米面粮油', { exact: true }).waitFor();
  await page.getByLabel('搜索商品分类').fill('米面');
  await page.getByText('食品原料', { exact: true }).waitFor();
  assert.equal(await page.getByText('清洁用品', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '新增子分类食品原料', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.ok(await page.getByRole('dialog').getByText('食品原料', { exact: true }).isVisible());
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByLabel('搜索商品分类').fill('不存在的分类');
  await page.locator('.ant-empty-description').waitFor();
  await page.getByLabel('搜索商品分类').fill('');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.screenshot({ path: `${output}/categories-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: category hierarchy, collapse, search ancestors, child creation defaults, empty state and responsive bounds');
} finally { await browser.close(); }
