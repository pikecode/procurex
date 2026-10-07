import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/react-admin-supplier-list-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  const errors = [];
  let deleted = false;
  let productIds = ['p1']; let version = 1; let saves = 0; let failSave = true;
  page.on('pageerror', error => errors.push(error.message));
  const user = { id: '11111111-1111-4111-8111-111111111111', displayName: '测试管理员', roles: ['ADMIN'], scope: { type: 'ADMIN' } };
  await page.addInitScript(user => sessionStorage.setItem('procurex-react-admin-session-v1', JSON.stringify({ accessToken: 'fixture', expiresAt: new Date(Date.now() + 3600000).toISOString(), user })), user);
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/s1/products')) {
      if (route.request().method() === 'PUT') {
        saves++;
        if (failSave) { failSave = false; return route.fulfill({ status: 409, json: { message: '版本冲突' } }); }
        assert.equal(route.request().postDataJSON().expectedVersion, version);
        productIds = route.request().postDataJSON().productIds; version++;
      }
      return route.fulfill({ json: { data: { productIds, version } } });
    }
    if (path.endsWith('/products')) return route.fulfill({ json: { data: [1, 2, 3].map(n => ({ id: `p${n}`, name: `测试商品${n}`, isActive: true, categoryId: n === 3 ? 'c2' : 'c1', baseUnitId: 'u1' })) } });
    if (path.endsWith('/categories')) return route.fulfill({ json: { data: [{ id: 'root', name: '食品及日常餐饮原材料超长分类名称测试', parentId: null }, { id: 'c1', name: '粮油', parentId: 'root' }, { id: 'c2', name: '调味品', parentId: 'root' }] } });
    if (path.endsWith('/units')) return route.fulfill({ json: { data: [{ id: 'u1', name: '袋' }] } });
    if (route.request().method() === 'POST') {
      if (new URL(route.request().url()).pathname.endsWith('/s1/archive')) {
        deleted = true;
        return route.fulfill({ status: 201, json: { data: { id: 's1', isArchived: true } } });
      }
      const body = route.request().postDataJSON();
      assert.equal(body.name, '仅必填字段供应商');
      for (const key of ['contactName', 'contactPhone', 'address', 'bankName', 'bankAccountName', 'bankAccount', 'taxpayerId', 'invoiceTitle']) assert.equal(body[key], null);
      return route.fulfill({ status: 201, json: { data: { id: 'created' } } });
    }
    assert.equal(route.request().method(), 'GET');
    const data = path.endsWith('/me') ? { user, session: { expiresAt: new Date(Date.now() + 3600000).toISOString() } } : path.endsWith('/notifications') ? { unreadCount: 0, notifications: [] } : path.endsWith('/suppliers') ? [{ id: 's1', name: '广州粮油供应商', code: 'GYS_TEST', supplierType: 'HEADQUARTERS', defaultSettlementCycle: 'MONTHLY', status: 'ACTIVE', isArchived: deleted, version: 1 }] : [];
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
  await dialog.getByLabel('供应商名称', { exact: true }).fill('仅必填字段供应商');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: '关联商品广州粮油供应商', exact: true }).click();
  const manager = page.getByRole('dialog', { name: '管理商品 · 广州粮油供应商', exact: true });
  await manager.getByRole('cell', { name: '测试商品1', exact: true }).waitFor();
  assert.ok(await manager.getByRole('button', { name: '保存修改', exact: true }).isDisabled());
  await manager.getByRole('tab', { name: '待添加商品 (2)', exact: true }).click();
  assert.equal(await page.locator('.ant-modal:visible').count(), 1);
  await manager.getByText('粮油 (1)', { exact: true }).click();
  const product2 = manager.getByRole('row').filter({ has: page.getByRole('cell', { name: '测试商品2', exact: true }) }).getByRole('checkbox');
  await product2.check();
  await manager.getByText('待新增 1 件', { exact: false }).waitFor();
  await product2.uncheck();
  assert.ok(await manager.getByRole('button', { name: '保存修改', exact: true }).isDisabled());
  await product2.check();
  await manager.getByText('调味品 (1)', { exact: true }).click();
  await manager.getByRole('row').filter({ has: page.getByRole('cell', { name: '测试商品3', exact: true }) }).getByRole('checkbox').check();
  assert.equal(await manager.getByRole('button', { name: /添加所选/ }).count(), 0);
  await manager.getByRole('tab', { name: '已供商品 (3)', exact: true }).click();
  await manager.getByText('待新增 2 件', { exact: false }).waitFor();
  await manager.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(saves, 0);
  await manager.getByRole('button', { name: '保存修改', exact: true }).click();
  await manager.getByText('版本冲突', { exact: true }).waitFor();
  await manager.getByText('已供 3 件', { exact: false }).waitFor();
  await manager.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByText('商品关联已保存', { exact: true }).waitFor();
  assert.deepEqual(productIds, ['p1', 'p2', 'p3']);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 }); await page.waitForTimeout(350);
    assert.ok(await manager.locator('.supplier-category-label').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).whiteSpace === 'nowrap' && node.getBoundingClientRect().height <= 28)));
    assert.ok(await manager.getByRole('columnheader', { name: '操作', exact: true }).evaluate(node => getComputedStyle(node).position === 'sticky' && getComputedStyle(node).insetInlineEnd === '0px'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${output}/products-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  for (const n of [2, 3]) await manager.getByRole('row').filter({ has: page.getByRole('cell', { name: `测试商品${n}`, exact: true }) }).getByRole('checkbox').check();
  await manager.getByRole('button', { name: '移除所选 (2)', exact: true }).click();
  assert.deepEqual(productIds, ['p1', 'p2', 'p3']);
  await manager.getByRole('button', { name: '保存修改', exact: true }).click();
  await manager.getByRole('button', { name: '保存修改', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.supplier-products-footer .ant-btn-primary')?.disabled);
  assert.deepEqual(productIds, ['p1']);
  await manager.getByRole('button', { name: '取消', exact: true }).click();
  await manager.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '删除广州粮油供应商', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(deleted, false);
  await page.getByRole('button', { name: '删除广州粮油供应商', exact: true }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('cell', { name: '广州粮油供应商', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(deleted, true);
  assert.deepEqual(errors, []);
  console.log('PASS: supplier list/form, product modal, category selection, batch removal, failed-save draft retention, unsaved-close confirmation, desktop/mobile; fixture API only');
} finally {
  await browser.close();
}
