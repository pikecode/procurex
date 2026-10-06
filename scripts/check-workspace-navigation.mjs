import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { allowedRoutes } from '../apps/web/product-app/workspace-session.js';
import { navigationGroups } from '../apps/web/product-app/workspace-navigation.js';

const api = 'http://127.0.0.1:3114/api/v1';
const directory = 'var/navigation-evidence';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const report = { checks: [], screenshots: [], errors: [] };
try {
  for (const [username, role, route] of [['pxflow_user', 'ADMIN', 'stores'], ['pxflow_store', 'STORE', 'store'], ['pxflow_supplier', 'SUPPLIER', 'supplier']]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(`http://127.0.0.1:4173/app.html?api=${encodeURIComponent(api)}#/${route}`);
    await page.locator('[name=username]').fill(username);
    await page.locator('[name=password]').fill('correct-password');
    await page.locator('#ws-login-form button').click();
    await page.locator('.ws-nav-full [aria-current=page]').waitFor();
    assert.equal(new URL(page.url()).searchParams.has('api'), false);
    const user = await page.evaluate(() => {
      const key = Object.keys(sessionStorage).find(key => key.startsWith('procurex-web-session-v1:'));
      return JSON.parse(sessionStorage.getItem(key)).user;
    });
    const groups = navigationGroups(allowedRoutes(user));
    assert.deepEqual(await page.locator('[data-nav-group]').evaluateAll(nodes => nodes.map(node => node.dataset.navGroup)), groups.map(group => group.id));
    assert.equal(await page.locator('.ws-nav-full a').count(), groups.flatMap(group => group.routes).length);
    assert.equal(await page.locator('.ws-nav-rail a').count(), groups.flatMap(group => group.routes).length);
    const active = page.locator('details').filter({ has: page.locator('[aria-current=page]') });
    assert.equal(await active.evaluate(node => node.open), true);
    await active.locator('summary').focus(); await page.keyboard.press('Enter');
    assert.equal(await active.evaluate(node => node.open), false);
    await page.keyboard.press('Enter');
    assert.equal(await active.evaluate(node => node.open), true);
    if (role === 'ADMIN') {
      const catalog = page.locator('[data-nav-group=catalog]');
      await catalog.locator('summary').click();
      await page.locator('.ws-nav-full a[href="#/products"]').click();
      await page.locator('.ws-nav-full a[href="#/products"][aria-current=page]').waitFor();
      assert.equal(await catalog.evaluate(node => node.open), true);
      assert.equal(await page.locator('[data-nav-group=directory]').evaluate(node => node.open), true);
      await catalog.locator('summary').click();
      await page.evaluate(() => { location.hash = '#/categories'; });
      await page.locator('.ws-nav-full a[href="#/categories"][aria-current=page]').waitFor();
      assert.equal(await catalog.evaluate(node => node.open), true);
      report.checks.push('Route changes reopen current group and preserve other expanded groups');
    }
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 960 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await page.locator('.ws-nav-full [aria-current=page]').isVisible(), true);
      if (width === 320) assert.ok(await page.locator('.ws-nav-full').evaluate(node => node.getBoundingClientRect().height <= 230));
      const path = `${directory}/${role}-${width}.png`;
      await page.screenshot({ path }); report.screenshots.push(path);
      const toggle = page.locator('#ws-sidebar-toggle');
      const before = await page.locator('.ws-main').evaluate(node => node.getBoundingClientRect().width);
      await toggle.focus(); await page.keyboard.press('Enter');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('.ws-nav-full').isVisible(), false);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width === 1440) {
        assert.equal(await page.locator('.ws-nav-rail').isVisible(), true);
        assert.ok(await page.locator('.ws-main').evaluate(node => node.getBoundingClientRect().width) > before);
        await page.locator('.ws-nav-rail [aria-current=page]').click();
      } else assert.equal(await page.locator('#ws-sidebar').isVisible(), false);
      const collapsedPath = `${directory}/${role}-${width}-collapsed.png`;
      await page.screenshot({ path: collapsedPath }); report.screenshots.push(collapsedPath);
      await page.reload(); await page.locator('#ws-sidebar-toggle').waitFor();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('.ws-nav-full [aria-current=page]').isVisible(), true);
    }
    report.checks.push(`${role}: permission filtering, group/whole-sidebar keyboard collapse, reload persistence and desktop/mobile layout`);
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'PASSED';
} finally {
  await browser.close();
  await writeFile(`${directory}/manifest.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
