import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/procurement-funding-layout';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const id = '11111111-1111-4111-8111-111111111111';
  const review = { id, requestNo: 'PR202610160001', storeId: 'layout-store', status: 'PENDING_FUNDS', version: 2, supplierOrders: [],
    salesGoodsAmount: '100.00', procurementConfirmedAt: '2026-10-16T01:00:00Z',
    funding: { canConfirm: false, stored: { required: '30.00', available: '20.00', shortfall: '10.00' }, credit: { required: '70.00', available: '100.00', shortfall: '0.00' } },
    items: [{ id: 'item', productName: '审核商品', quantity: '10', salesUnitPrice: '10.00', salesLineAmount: '100.00' }],
    settlementGroups: [{ supplierId: 'supplier', supplierName: '审核供应商', mode: 'STORED_VALUE', cycle: 'IMMEDIATE', amount: '100.00' }] };
  await page.route('**/api/v1/purchase-requests', route => route.fulfill({ json: { data: [review] } }));
  await page.route(`**/api/v1/purchase-requests/${id}`, route => route.fulfill({ json: { data: review } }));
  await page.route(`**/api/v1/purchase-requests/${id}/confirmation-preview`, route => route.fulfill({ json: { data: review } }));
  await page.route('**/api/v1/stores', route => route.fulfill({ json: { data: [{ id: 'layout-store', name: '审核门店' }] } }));
  await page.goto(`http://127.0.0.1:4174/purchase-requests?request=${id}`);
  await page.getByLabel('用户名').fill('buyer1');
  await page.getByLabel('密码', { exact: true }).fill('12345678');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByText(/资金不足：待充值/).waitFor();
  assert.ok(await page.getByRole('button', { name: '确认并生成订单', exact: true }).isDisabled());
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/review-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  review.funding.canConfirm = true; review.funding.stored.available = '30.00'; review.funding.stored.shortfall = '0.00';
  await page.getByRole('button', { name: '重新核验资金', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('确认并生成订单') && !button.disabled));
  assert.deepEqual(errors, []);
  console.log('PASS procurement funding layout, shortage gate and refresh; fixture reads only');
} finally { await browser.close(); }
