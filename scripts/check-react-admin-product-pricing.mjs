import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/react-admin-product-pricing-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; let product = { id: 'p1', name: '测试大米', version: 1, categoryId: 'c1', baseUnitId: 'u1', supplierIds: ['s1'], defaultSalesPrice: '10', minOrderQty: '1', orderMultiple: '1', isActive: true, purchaseUnitConversion: null, imageFileId: null };
  let productWrites = 0;
  const user = { id: '11111111-1111-4111-8111-111111111111', displayName: '测试管理员', roles: ['ADMIN'], scope: { type: 'ADMIN' } };
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(user => sessionStorage.setItem('procurex-react-admin-session-v1', JSON.stringify({ accessToken: 'fixture', expiresAt: new Date(Date.now() + 3600000).toISOString(), user })), user);
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname; const method = route.request().method();
    const fulfill = data => route.fulfill({ json: { data } });
    if (method === 'PATCH' && path.endsWith('/products/p1')) { productWrites++; assert.equal(Number(route.request().postDataJSON().supplierPurchasePrices[0].supplyPrice), 7); assert.equal(route.request().postDataJSON().supplierPurchasePrices[0].supplierId, 's1'); product = { ...product, ...route.request().postDataJSON(), version: 2 }; return fulfill(product); }
    if (path.endsWith('/products')) return fulfill([product]);
    if (path.endsWith('/categories')) return fulfill([{ id: 'root', name: '食品', parentId: null }, { id: 'c1', name: '粮油', parentId: 'root' }]);
    if (path.endsWith('/units')) return fulfill([{ id: 'u1', name: '袋' }]);
    if (path.endsWith('/suppliers')) return fulfill([{ id: 's1', name: '关联供应商', status: 'ACTIVE', isArchived: false }, { id: 's2', name: '未关联供应商', status: 'ACTIVE', isArchived: false }]);
    if (path.endsWith('/brands') || path.endsWith('/templates') || path.endsWith('/commands') || path.endsWith('/versions')) return fulfill([]);
    if (path.endsWith('/me')) return fulfill({ user, session: { expiresAt: new Date(Date.now() + 3600000).toISOString() } });
    if (path.endsWith('/notifications')) return fulfill({ unreadCount: 0, notifications: [] });
    assert.ok(!path.includes('/price'), 'No separate price publication calls');
    return fulfill([]);
  });
  await page.goto('http://127.0.0.1:4174/products');
  await page.getByRole('button', { name: '编辑测试大米', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '供应商供货价测试大米', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '采购单位换算测试大米', exact: true }).count(), 0);
  await page.getByRole('button', { name: '编辑测试大米', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑商品', exact: true });
  await editor.getByLabel('商品分类', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible').getByText('食品', { exact: true }).waitFor();
  await page.locator('.ant-select-dropdown:visible').getByText('粮油', { exact: true }).click();
  assert.equal(await editor.getByRole('button', { name: '保存并维护采购价', exact: true }).count(), 0);
  assert.equal(await editor.getByLabel('生效时间', { exact: true }).count(), 0);
  assert.equal(Number(await editor.getByLabel('销售价格', { exact: true }).inputValue()), 10);
  await editor.getByRole('tab', { name: '供应与采购', exact: true }).click();
  await editor.getByRole('button', { name: '移除关联供应商关联供应商', exact: true }).click();
  await editor.getByText('暂无关联供应商', { exact: true }).waitFor();
  await editor.locator('#supplierIds').click();
  await page.locator('.ant-select-dropdown:visible').getByText('关联供应商', { exact: true }).click();
  await page.keyboard.press('Escape');
  await editor.locator('#purchasePrices_s1').fill('7');
  await editor.getByRole('tab', { name: '基本信息', exact: true }).click();
  await editor.getByLabel('商品名称', { exact: true }).fill('');
  await editor.getByRole('tab', { name: '订货规则', exact: true }).click();
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.getByLabel('商品名称', { exact: true }).waitFor({ state: 'visible' });
  await editor.getByLabel('基本信息有错误', { exact: true }).waitFor();
  assert.equal(productWrites, 0);
  await editor.getByLabel('商品名称', { exact: true }).fill('测试大米');
  await editor.getByRole('tab', { name: '供应与采购', exact: true }).click();
  assert.equal(Number(await editor.locator('#purchasePrices_s1').inputValue()), 7);
  await editor.locator('.product-price-unit').getByText('元/袋', { exact: true }).waitFor();
  assert.equal(await editor.locator('#purchasePrices_s2').count(), 0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(350);
    await editor.locator('#purchasePrices_s1').scrollIntoViewIfNeeded();
    const saveBounds = await editor.getByRole('button', { name: '保存', exact: true }).boundingBox();
    assert.ok(saveBounds && saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= 1000, 'Save stays inside the viewport');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${output}/pricing-${width}.png`, fullPage: true });
  }
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  assert.equal(productWrites, 1);
  assert.equal(new URL(page.url()).pathname, '/products');
  assert.deepEqual(errors, []);
  console.log('PASS: category tree, inline supplier purchase price, single atomic product save, desktop/mobile; fixture API only');
} finally { await browser.close(); }
