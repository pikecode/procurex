import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/app.html#/store-finance');
  await page.locator('[name=username]').fill('pxflow_user');
  await page.locator('[name=password]').fill('correct-password');
  await page.locator('#ws-login-form button').click();
  await page.locator('[data-finance-action=recharge]').first().waitFor();
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.evaluate(async () => {
      const { openAccountDocument } = await import('/product-app/workspace-account-evidence.js');
      window.proofCleanups = [];
      const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 120;
      const painter = canvas.getContext('2d'); painter.fillStyle = '#168a64'; painter.fillRect(0, 0, 240, 120);
      const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      await openAccountDocument({ active: () => true, cleanup: fn => window.proofCleanups.push(fn),
        get: async () => ({ documentNo: 'TEST-PREVIEW', amount: '10.00', businessDate: '2026-10-06',
          evidenceFiles: [{ id: 'preview-only', filename: '测试凭证.png' }] }),
        client: { request: async () => image } }, '/fixture');
    });
    const thumbnail = page.locator('.ws-proof-thumbnail img');
    await thumbnail.waitFor();
    await page.waitForFunction(() => document.querySelector('.ws-proof-thumbnail img').naturalWidth === 240);
    assert.ok(await page.locator('.ws-dialog').evaluate(node => node.scrollWidth <= node.clientWidth));
    await page.locator('.ws-proof-thumbnail').click();
    await page.waitForFunction(() => document.querySelector('.ws-proof-full').naturalWidth === 240);
    assert.ok(await page.locator('.ws-dialog').last().evaluate(node => node.scrollWidth <= node.clientWidth));
    await page.screenshot({ path: `/tmp/procurex-proof-preview-${width}.png` });
    await page.locator('.ws-dialog').last().locator('[data-close]').click();
    const download = page.waitForEvent('download');
    await page.locator('[data-proof-download]').click();
    assert.equal((await download).suggestedFilename(), '测试凭证.png');
    await page.locator('.ws-dialog [data-close]').click();
    await page.evaluate(() => window.proofCleanups.forEach(fn => fn()));
  }
  await page.evaluate(async () => {
    const { openAccountDocument } = await import('/product-app/workspace-account-evidence.js');
    await openAccountDocument({ active: () => true, cleanup() {},
      get: async () => ({ evidenceFiles: [{ id: 'denied', filename: '凭证.png' }] }),
      client: { request: async () => { throw new Error('无权读取凭证'); } } }, '/fixture');
  });
  assert.equal(await page.locator('.ws-proof-item [role=alert]').innerText(), '无权读取凭证');
  await page.locator('[data-proof-retry]').click();
  await page.locator('.ws-proof-item [role=alert]').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: thumbnail, full preview, download, cleanup and error/retry; desktop/mobile; no financial or OSS writes.');
} finally { await browser.close(); }
