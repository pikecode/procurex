import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { allowedRoutes } from '../apps/web/product-app/workspace-session.js';

const playwright = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const api = process.env.WORKSPACE_API_URL ?? 'http://127.0.0.1:3114/api/v1';
const web = process.env.WORKSPACE_WEB_URL ?? 'http://127.0.0.1:4173';
for (const address of [api, web]) assert.ok(['127.0.0.1', 'localhost'].includes(new URL(address).hostname), 'Local servers only');
const directory = resolve('var/web-compatibility-evidence');
await mkdir(directory, { recursive: true });
const manifest = { generatedAt: new Date().toISOString(), status: 'RUNNING',
  scope: 'Read-only formal Web routes; demo-account login/logout only; no orders, attachments or funds written; browser engines are not physical-device evidence', cases: [], errors: [] };
const engines = (process.env.COMPAT_ENGINES ?? 'chromium,firefox,webkit').split(',');
const widths = [320, 390, 1440];
const accounts = ['pxflow_user', 'pxflow_store', 'pxflow_supplier'];
for (const engine of engines) {
  assert.ok(['chromium', 'firefox', 'webkit'].includes(engine));
  let browser;
  try {
    browser = await playwright[engine].launch(engine === 'chromium'
      ? { executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true } : { headless: true });
    for (const account of accounts) {
      for (const width of widths) {
        const context = await browser.newContext({ viewport: { width, height: 960 } });
        const page = await context.newPage();
        const runtimeErrors = [];
        page.on('pageerror', error => runtimeErrors.push(error.message));
        page.on('response', response => {
          if (response.url().startsWith(api) && response.status() >= 400) runtimeErrors.push(`API ${response.status()} ${new URL(response.url()).pathname}`);
        });
        try {
          await page.goto(`${web}/app.html?api=${encodeURIComponent(api)}`, { waitUntil: 'networkidle' });
          await page.locator('#ws-login-form [name=username]').fill(account);
          await page.locator('#ws-login-form [name=password]').fill(process.env.COMPAT_PASSWORD ?? 'correct-password');
          const loggedIn = page.waitForResponse(response => response.url() === `${api}/auth/login` && response.status() === 201);
          await page.locator('#ws-login-form button').click();
          const user = (await (await loggedIn).json()).data.user;
          await page.locator('.ws-heading h1').waitFor();
          for (const route of allowedRoutes(user)) {
            const record = { engine, version: browser.version(), account, viewport: { width, height: 960 }, route, status: 'FAILED' };
            manifest.cases.push(record);
            try {
              await page.goto(`${web}/app.html?api=${encodeURIComponent(api)}#/${route}`, { waitUntil: 'networkidle' });
              await page.waitForFunction(() => !document.querySelector('#ws-view .ws-empty')?.textContent.includes('加载中'));
              const missingScope = route === 'store' && !user.scope?.storeId
                || route === 'profile' && !user.scope?.storeId && !user.scope?.supplierId
                || route === 'supplier-products' && !user.scope?.supplierId;
              if (missingScope) {
                await page.locator('#ws-retry').waitFor();
                assert.match(await page.locator('#ws-view').innerText(), /账号尚未配置所属/);
                record.expectedOutcome = 'Unbound scope explicitly rejected; not a bound-role workflow';
              } else {
                await page.locator('.ws-heading h1').waitFor();
                assert.equal(await page.locator('#ws-retry').count(), 0, 'Route must not show load failure');
              }
              await page.waitForLoadState('networkidle');
              record.layout = await page.evaluate(() => {
                const heading = document.querySelector('.ws-heading h1')?.getBoundingClientRect();
                const columns = [...document.querySelectorAll('.ws-table-wrap th')].map(cell => cell.getBoundingClientRect().width);
                return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
                  headingFits: !heading || heading.left >= -1 && heading.right <= innerWidth + 1,
                  readableColumns: columns.every(column => column >= 109),
                  visibleIcons: document.querySelectorAll('.ws-main button svg').length };
              });
              const filename = `${engine}-${account}-${route}-${width}.png`;
              await page.screenshot({ path: join(directory, filename), fullPage: true });
              record.screenshot = filename;
              assert.ok(record.layout.documentWidth <= width + 1, `Page overflow ${record.layout.documentWidth}/${width}`);
              assert.ok(record.layout.headingFits, 'Heading must fit viewport');
              assert.ok(record.layout.readableColumns, 'Table columns must remain readable inside their scroll container');
              assert.deepEqual(runtimeErrors, []);
              record.status = 'PASSED';
            } catch (error) { record.error = error.message; }
          }
          await page.locator('#ws-logout').click();
          await page.locator('#ws-login-form').waitFor();
        } catch (error) { manifest.errors.push({ engine, account, width, message: error.message }); }
        finally { await context.close(); }
      }
    }
  } catch (error) { manifest.errors.push({ engine, message: error.message }); }
  finally { await browser?.close(); }
}
manifest.status = manifest.errors.length || manifest.cases.some(record => record.status !== 'PASSED') ? 'FAILED' : 'PASSED';
await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ status: manifest.status, cases: manifest.cases.length, failures: manifest.cases.filter(record => record.status !== 'PASSED'), errors: manifest.errors }));
if (manifest.status !== 'PASSED') process.exitCode = 1;
