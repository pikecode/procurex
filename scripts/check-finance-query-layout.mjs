import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/app.html#/finance');
  await page.locator('[name=username]').fill('pxflow_user');
  await page.locator('[name=password]').fill('correct-password');
  await page.locator('#ws-login-form button').click();
  await page.locator('.ws-finance-disclosure').first().waitFor();
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 960 });
    for (const mode of ['store', 'supplier', 'direct']) {
      await page.locator('[name=billMode]').selectOption(mode);
      await page.locator('.ws-finance-disclosure').first().waitFor();
      assert.equal(await page.locator('#ws-page-size').inputValue(), '10');
      assert.equal(await page.locator('.ws-finance-disclosure').count(), 3);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const account = page.locator('.ws-finance-disclosure').first();
      await account.locator('summary').click();
      await account.locator('[name=accountStore]').waitFor({ state: 'visible' });
      await account.locator('summary').click();
      const bill = page.locator('[data-bill]').first();
      if (await bill.count()) {
        await bill.waitFor(); await page.waitForFunction(() => !document.querySelector('[data-bill]').disabled);
        await bill.click(); await page.locator('#ws-bill-detail h2').waitFor();
        await page.getByRole('button', { name: '收起账单详情' }).click();
        assert.equal(await page.locator('#ws-bill-detail').isVisible(), false);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `/tmp/procurex-finance-${mode}-${width}.png` });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: three bill modes, default pagination, expandable accounts, bill detail and close, desktop/mobile overflow; no writes.');
} finally { await browser.close(); }
