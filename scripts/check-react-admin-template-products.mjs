import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

await mkdir('var/template-products-evidence', { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; const writes = []; let failProductSave = true;
  page.on('pageerror', error => errors.push(error.message));
  const user = { id: 'admin', displayName: '测试管理员', roles: ['ADMIN'], scope: { type: 'ADMIN' } };
  const products = ['原有大米', '新增面粉'].map((name, index) => ({ id: `p${index + 1}`, name, categoryId: 'c1', baseUnitId: 'u1', supplierIds: ['s1', 's2'], supplierPurchasePrices: [{ supplierId: 's1', supplyPrice: '6' }, { supplierId: 's2', supplyPrice: '8' }], isActive: true, defaultSalesPrice: '10', minOrderQty: '1', orderMultiple: '1' }));
  const detail = { id: 't1', name: '测试模板', code: 'MB1', tag: '测试', version: 1, storeIds: ['store1'], isArchived: false, settings: [], cycleOverrides: [{ storeId: 'store1', supplierId: 's1', settlementCycle: 'WEEKLY' }], items: [{ productId: 'p1', sortOrder: 0, isEnabled: true, minOrderQty: null, orderMultiple: null, suppliers: [{ supplierId: 's1', priority: 0, salesPrice: '10' }] }] };
  const occupied = { ...detail, id: 't2', name: '其他模板', code: 'MB2', storeIds: ['store2'], cycleOverrides: [], items: [] };
  await page.addInitScript(user => sessionStorage.setItem('procurex-react-admin-session-v1', JSON.stringify({ accessToken: 'fixture', expiresAt: new Date(Date.now() + 3600000).toISOString(), user })), user);
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const fulfill = data => route.fulfill({ json: { data } });
    if (route.request().method() === 'PUT') {
      writes.push({ path, body: route.request().postDataJSON() });
      if (path.endsWith('/items') && failProductSave) { failProductSave = false; return route.fulfill({ status: 409, json: { error: { message: '测试保存失败' } } }); }
      return fulfill({ version: 2 });
    }
    if (path.endsWith('/templates/t1')) return fulfill(detail);
    if (path.endsWith('/templates/t2')) return fulfill(occupied);
    if (path.endsWith('/templates')) return fulfill([detail, occupied]);
    if (path.endsWith('/stores')) return fulfill([{ id: 'store1', name: '测试门店' }, { id: 'store2', name: '已占用门店' }]);
    if (path.endsWith('/products')) return fulfill(products);
    if (path.endsWith('/categories')) return fulfill([{ id: 'c1', name: '粮油', parentId: null }]);
    if (path.endsWith('/suppliers')) return fulfill([{ id: 's1', name: '测试供应商', status: 'ACTIVE', isArchived: false, defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY' }, { id: 's2', name: '备用供应商', status: 'ACTIVE', isArchived: false, defaultSettlementMode: 'CREDIT', defaultSettlementCycle: 'IMMEDIATE' }]);
    if (path.endsWith('/units')) return fulfill([{ id: 'u1', name: '袋' }]);
    if (path.endsWith('/me')) return fulfill({ user, session: { expiresAt: new Date(Date.now() + 3600000).toISOString() } });
    if (path.endsWith('/notifications')) return fulfill({ unreadCount: 0, notifications: [] });
    return fulfill([]);
  });
  await page.goto('http://127.0.0.1:4174/templates');
  await page.getByRole('button', { name: '编辑模板测试模板', exact: true }).click();
  let dialog = page.getByRole('dialog').first();
  await dialog.getByLabel('模板名称', { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel('模板编号').count(), 0);
  assert.equal(await dialog.getByRole('tab').count(), 0);
  await dialog.getByLabel('适用门店', { exact: true }).click();
  const occupiedOption = page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '已占用门店（已用于：其他模板）' });
  await occupiedOption.waitFor();
  assert.ok((await occupiedOption.getAttribute('class')).includes('ant-select-item-option-disabled'));
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  await page.getByRole('button', { name: '配置商品测试模板', exact: true }).click();
  dialog = page.getByRole('dialog').first();
  await dialog.getByRole('tab', { name: '已选商品 (1)', exact: true }).waitFor();
  await dialog.getByRole('row').filter({ hasText: '原有大米' }).locator('.ant-table-row-expand-icon').click();
  assert.equal(await dialog.getByRole('combobox', { name: '供货供应商原有大米', exact: true }).count(), 0);
  await dialog.getByText('供应商价格与首选配置', { exact: true }).waitFor();
  assert.equal(await dialog.getByText('备用供应商', { exact: true }).count(), 2);
  await dialog.getByRole('radio', { name: '默认供应商s2', exact: true }).click();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.getByText('测试保存失败', { exact: true }).waitFor();
  assert.ok(writes[0].path.endsWith('/templates/t1/items'));
  assert.equal(writes[0].body.items[0].suppliers.find(link => link.supplierId === 's2').priority, 0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: `var/template-products-evidence/settings-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(writes[1], writes[0]);

  await page.getByRole('button', { name: '结算配置测试模板', exact: true }).click();
  dialog = page.getByRole('dialog').first();
  await dialog.getByRole('combobox').click();
  await page.locator('.ant-select-dropdown:visible').getByText('使用供应商默认', { exact: true }).click();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(writes[2].path.endsWith('/templates/t1/settlement-cycles'));
  assert.deepEqual(writes[2].body.rows, []);
  assert.deepEqual(errors, []);
  console.log('PASS: occupied stores disabled, list-level product/settlement configuration, isolated requests, failed save retains draft; fixture API only');
} finally { await browser.close(); }
