import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const directory = 'var/list-layout-evidence';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const report = { status: 'RUNNING', checks: [], screenshots: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/app.html#/stores');
  await page.locator('[name=username]').fill('pxflow_user');
  await page.locator('[name=password]').fill('correct-password');
  await page.locator('#ws-login-form button').click();
  await page.locator('#ws-page-size').waitFor();
  assert.equal(await page.locator('#ws-page-size').inputValue(), '10');
  assert.ok(await page.locator('#ws-page-size').evaluate(node => {
    const style = getComputedStyle(node);
    return style.appearance === 'none' && style.paddingRight === '34px'
      && style.backgroundImage.includes('data:image/svg+xml') && style.backgroundPosition.includes('10px');
  }));
  for (const route of ['stores', 'products', 'finance']) {
    await page.evaluate(route => { location.hash = `#/${route}`; }, route);
    await page.locator(`.ws-nav-full a[href="#/${route}"][aria-current=page]`).waitFor();
    await page.locator('#ws-page-size').waitFor();
    assert.equal(await page.locator('#ws-page-size').inputValue(), '10');
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 960 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await page.locator('.ws-toolbar select').evaluateAll(nodes => nodes.every(node => {
        const bounds = node.getBoundingClientRect();
        return bounds.width >= 90 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.height >= 34;
      })));
      const path = `${directory}/${route}-${width}.png`;
      await page.screenshot({ path }); report.screenshots.push(path);
    }
    if (route === 'stores') {
      await page.locator('#ws-create').click();
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 960 });
        assert.ok(await page.locator('.ws-dialog select').evaluateAll(nodes => nodes.every(node => {
          const bounds = node.getBoundingClientRect();
          if (!node.getClientRects().length) return true;
          return bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.height === (innerWidth <= 640 ? 38 : 36);
        })));
        assert.equal(await page.locator('.ws-dialog [name=receiptAddress_province]').isDisabled(), true);
        const path = `${directory}/store-selects-${width}.png`;
        await page.screenshot({ path }); report.screenshots.push(path);
      }
      await page.getByRole('button', { name: '取消', exact: true }).click();
      report.checks.push('Store editor native selects and region cascade fit desktop/mobile with disabled receipt controls');
    }
  }
  report.checks.push('Real store/product/finance lists default to 10 and fit desktop/mobile');
  await page.evaluate(async () => {
    const { renderTable } = await import('/product-app/workspace-management.js');
    const rows = Array.from({ length: 35 }, (_, index) => ({ id: String(index), name: `Fixture ${String(index + 1).padStart(2, '0')}`, code: `LIST${index}`, status: index < 12 ? 'ACTIVE' : 'DISABLED' }));
    renderTable({ view: document.getElementById('ws-view'), active: () => true, refresh: () => {} }, {
      title: '分页验收', rows, columns: ['名称', '编号', '状态'], cells: item => [item.name, item.code, item.status],
      filters: [{ key: 'status', label: '状态', choices: [['ACTIVE', '启用'], ['DISABLED', '停用']] }],
      edit: item => { window.listEdited = item.id; }, afterDraw: () => { window.listDraws = (window.listDraws || 0) + 1; },
    });
  });
  const count = () => page.locator('#ws-rows tr').count();
  assert.equal(await count(), 10);
  assert.equal(await page.locator('#ws-prev').isDisabled(), true);
  await page.locator('#ws-next').click(); assert.equal(await page.locator('#ws-page-number').inputValue(), '2');
  await page.locator('#ws-last').click(); assert.equal(await count(), 5);
  assert.equal(await page.locator('#ws-next').isDisabled(), true);
  await page.locator('#ws-page-number').fill('2'); await page.locator('#ws-page-number').press('Enter');
  assert.equal(await count(), 10);
  await page.locator('#ws-page-number').fill('999'); await page.locator('#ws-page-number').press('Tab');
  assert.equal(await page.locator('#ws-page-number').inputValue(), '4');
  await page.locator('#ws-page-size').selectOption('20'); assert.equal(await count(), 20);
  assert.equal(await page.locator('#ws-page-number').inputValue(), '1');
  await page.locator('#ws-page-size').selectOption('50'); assert.equal(await count(), 35);
  await page.locator('#ws-page-size').selectOption('100'); assert.equal(await count(), 35);
  await page.locator('#ws-page-size').selectOption('10');
  await page.locator('#ws-next').click();
  await page.locator('[data-filter=status]').selectOption('ACTIVE');
  assert.equal(await page.locator('#ws-page-number').inputValue(), '1'); assert.equal(await count(), 10);
  await page.locator('#ws-search').fill('Fixture 01'); assert.equal(await count(), 1);
  await page.locator('[data-edit="0"]').click(); assert.equal(await page.evaluate(() => window.listEdited), '0');
  await page.locator('#ws-search').fill('not-found'); assert.match(await page.locator('#ws-rows').innerText(), /暂无匹配记录/);
  assert.equal(await page.locator('#ws-page-number').isDisabled(), true);
  assert.equal(await page.locator('#ws-next').isDisabled(), true);
  await page.locator('#ws-reset-search').click(); assert.equal(await count(), 10);
  assert.equal(await page.locator('[data-filter=status]').inputValue(), '');
  assert.equal(await page.locator('#ws-search').inputValue(), '');
  assert.ok(await page.evaluate(() => window.listDraws > 10));
  report.checks.push('35 in-memory rows: all sizes, last page, jump clamp, filter/search reset, empty state and edit/afterDraw');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('.ws-pagination').scrollIntoViewIfNeeded();
  assert.ok(await page.locator('.ws-pagination').evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth;
  }));
  const path = `${directory}/pagination-320.png`; await page.screenshot({ path }); report.screenshots.push(path);
  assert.deepEqual(report.errors, []); report.status = 'PASSED';
} finally {
  await browser.close();
  await writeFile(`${directory}/manifest.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
