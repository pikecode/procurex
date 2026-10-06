import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const directory = 'var/store-finance-evidence';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const report = { status: 'RUNNING', errors: [], screenshots: [], checks: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/app.html#/store-finance');
  await page.locator('[name=username]').fill('pxflow_user');
  await page.locator('[name=password]').fill('correct-password');
  await page.locator('#ws-login-form button').click();
  await page.locator('[data-finance-action=clearing]').first().waitFor();
  await page.locator('#ws-search').fill('PXFLOW');
  assert.equal(await page.locator('#ws-page-size').inputValue(), '10');
  const credits = [
    { fundingAllocationId: 'fixture-one', supplierOrderNo: '测试订单一', supplierId: 'one', supplierName: '测试供应商一', occurredAt: '2026-10-01T12:00:00Z', creditOutstanding: '12.34', version: 1 },
    { fundingAllocationId: 'fixture-two', supplierOrderNo: '测试订单二', supplierId: 'two', supplierName: '测试供应商二', occurredAt: '2026-10-02T12:00:00Z', creditOutstanding: '20.01', version: 1 },
  ];
  // UI-only fixtures; no orders, bank accounts or financial writes are persisted.
  await page.route('**/stores/*/credit-items', route => route.fulfill({ json: { data: credits } }));
  await page.route('**/collection-accounts', route => {
    assert.equal(route.request().method(), 'GET');
    return route.fulfill({ json: { data: [{ id: 'collection-fixture', name: '测试收款账户', bankName: '测试银行', accountName: '测试户名', accountNo: '12345678', status: 'ACTIVE', version: 1 }] } });
  });
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.locator('[data-finance-action=clearing]').first().click();
    const dialog = page.locator('.ws-finance-dialog');
    await dialog.locator('[data-credit-item]').first().waitFor();
    await dialog.locator('[name=creditFrom]').fill('2026-10-02');
    await dialog.locator('[name=creditTo]').fill('2026-10-02');
    await dialog.locator('[name=creditSupplier]').selectOption('two');
    assert.equal(await dialog.locator('[data-credit-item]').count(), 1);
    await dialog.locator('[data-credit-all]').check();
    assert.match(await dialog.locator('[data-credit-total]').innerText(), /1 笔.*20\.01/);
    assert.equal(await dialog.locator('[data-clearing]').isEnabled(), true);
    await dialog.locator('[name=creditSupplier]').selectOption('one');
    assert.equal(await dialog.locator('[data-credit-item]:checked').count(), 0);
    assert.equal(await dialog.locator('[data-clearing]').isDisabled(), true);
    await dialog.locator('[name=creditSupplier]').selectOption('');
    assert.ok(await dialog.evaluate(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && node.scrollWidth <= node.clientWidth; }));
    const clearingPath = `${directory}/clearing-${width}.png`;
    await page.screenshot({ path: clearingPath }); report.screenshots.push(clearingPath);
    await dialog.locator('.ws-dialog-head .ws-icon').click();
    await page.locator('[data-finance-action=recharge]').first().click();
    const recharge = page.locator('.ws-dialog').last();
    await recharge.locator('select[name=collectionAccountId]').waitFor();
    await recharge.locator('[name=collectionAccountId]').selectOption('collection-fixture');
    assert.ok(await recharge.locator('[name=businessDate]').inputValue());
    assert.ok(await recharge.evaluate(node => node.scrollWidth <= node.clientWidth));
    const rechargePath = `${directory}/recharge-${width}.png`;
    await page.screenshot({ path: rechargePath }); report.screenshots.push(rechargePath);
    await recharge.locator('.ws-dialog-head .ws-icon').click();
    await page.locator('.ws-finance-dialog .ws-dialog-head .ws-icon').click();
    const overviewPath = `${directory}/overview-${width}.png`;
    await page.screenshot({ path: overviewPath }); report.screenshots.push(overviewPath);
  }
  await page.evaluate(() => { location.hash = '#/collection-accounts'; });
  await page.locator('#ws-create').waitFor();
  await page.locator('#ws-create').click();
  for (const name of ['name', 'bankName', 'accountName', 'accountNo']) assert.ok(await page.locator(`.ws-dialog [name=${name}]`).isVisible());
  await page.locator('.ws-dialog .ws-dialog-head .ws-icon').click();
  report.checks.push('Real overview pagination; fixture-only date/supplier filters, batch selection resets, recharge account select; desktop/mobile fit; account maintenance form. No financial writes.');
  assert.deepEqual(report.errors, []); report.status = 'PASSED';
} catch (error) { report.status = 'FAILED'; report.errors.push(error.stack); throw error; }
finally { await writeFile(`${directory}/manifest.json`, JSON.stringify(report, null, 2)); await browser.close(); }
