import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const directory = 'var/form-layout-evidence';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const report = { status: 'RUNNING', checks: [], screenshots: [], errors: [] };
try {
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/app.html?api=http%3A%2F%2F127.0.0.1%3A3114%2Fapi%2Fv1#/stores');
  await page.locator('[name=username]').fill('pxflow_user');
  await page.locator('[name=password]').fill('correct-password');
  await page.locator('#ws-login-form button').click();
  for (const route of ['stores', 'products', 'suppliers', 'templates', 'categories', 'units']) {
    await page.evaluate(route => { location.hash = `#/${route}`; }, route);
    await page.locator(`.ws-nav-full a[href="#/${route}"][aria-current=page]`).waitFor();
    await page.locator('#ws-create').waitFor();
    for (const mode of ['create', 'edit']) {
      if (mode === 'create') await page.locator('#ws-create').click();
      else await page.locator(route === 'templates' ? '[data-template][data-section=metadata]' : '[data-edit]').first().click();
      const dialog = page.locator('.ws-dialog');
      await dialog.waitFor();
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 960 });
        await dialog.evaluate(node => { node.scrollTop = 0; });
        assert.ok(await dialog.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth && node.scrollWidth <= node.clientWidth;
        }));
        assert.ok(await dialog.locator('input:not([type=checkbox]),select').evaluateAll(nodes => nodes.every(node => {
          if (!node.getClientRects().length) return true;
          const rect = node.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth && rect.height >= 36 && rect.height <= 38;
        })));
        assert.ok(await dialog.locator('.ws-required').evaluateAll(nodes => nodes.every(node => node.parentElement.classList.contains('ws-field-label'))));
        const path = `${directory}/${route}-${mode}-${width}.png`;
        await page.screenshot({ path }); report.screenshots.push(path);
        await dialog.evaluate(node => { node.scrollTop = node.scrollHeight; });
        const cancel = dialog.getByRole('button', { name: '取消', exact: true });
        assert.ok(await cancel.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight;
        }));
      }
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
    }
    report.checks.push(`${route}: create/edit at 1440/320, field fit, inline required markers and footer reachable`);
  }
  assert.deepEqual(report.errors, []); report.status = 'PASSED';
} finally {
  await browser.close();
  await writeFile(`${directory}/manifest.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
