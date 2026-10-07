import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/store-finance-layout-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const storeId = '11111111-1111-4111-8111-111111111111';
  const account = { storeId, balance: '12345.60', availableBalance: '12000.00', reservedBalance: '345.60', creditLimit: '50000.00', creditUsed: '8000.00', creditAvailable: '42000.00', creditCumulative: null, version: 1 };
  await page.route('**/api/v1/stores/finance-overview', route => route.fulfill({ json: { data: [{ id: storeId, name: '广州天河直营门店', groupName: '华南区域', status: 'ACTIVE', account }] } }));
  await page.route(`**/api/v1/stores/${storeId}/recharges/*`, route => route.fulfill({ json: { data: { id: 'r1', storeId, kind: 'RECHARGE', evidenceFiles: [] } } }));
  await page.route(`**/api/v1/stores/${storeId}/clearings/*`, route => route.fulfill({ json: { data: { id: 'c1', storeId, kind: 'CLEARING', evidenceFiles: [] } } }));
  await page.route(`**/api/v1/stores/${storeId}/*`, route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/account') ? account : path.endsWith('/ledgers') ? [{ id: 'recharge1', occurredAt: '2026-10-07T01:00:00Z', amount: '2000.00', direction: 'CREDIT', balanceAfter: '12345.60', note: '银行转账充值', sourceType: 'RECHARGE', sourceId: 'r1' }] : path.endsWith('/credit-movements') ? [{ id: 'booking1', occurredAt: '2026-10-07T01:00:00Z', amount: '8000.00', kind: 'BOOKING', supplierOrderNo: '订货单001', outstandingAfter: '8000.00', sourceType: 'ORDER', sourceId: 'o1' }, ...['30.10', '20.20'].map((amount, index) => ({ id: `clearing${index}`, occurredAt: '2026-10-07T01:00:00Z', amount, kind: 'CLEARING', outstandingAfter: '0.00', sourceType: 'CLEARING', sourceId: 'c1' }))] : path.endsWith('/credit-items') ? [{ fundingAllocationId: 'a', supplierName: '广州粮油配送', supplierOrderNo: '订货单001', occurredAt: '2026-10-07T01:00:00Z', creditOutstanding: '8000.00', version: 1 }] : [];
    return route.fulfill({ json: { data } });
  });
  await page.goto('http://127.0.0.1:4174/store-finance');
  await page.getByLabel('用户名').fill('pxflow_user');
  await page.getByLabel('密码', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByText('广州天河直营门店', { exact: true }).waitFor();
  for (const label of ['门店名称', '挂账未销账金额', '累计挂账金额', '挂账剩余额度', '门店储值余额', '操作']) assert.ok(await page.getByRole('columnheader', { name: label, exact: true }).isVisible());
  assert.equal(await page.getByRole('columnheader').count(), 6);
  for (const label of ['挂账额度设置', '门店销账', '门店充值', '账户历史']) {
    const button = page.getByRole('button', { name: label, exact: true });
    assert.equal(await button.innerText(), '');
    await button.hover();
    await page.getByRole('tooltip', { name: label, exact: true }).waitFor();
  }
  await page.setViewportSize({ width: 320, height: 960 });
  await page.getByRole('button', { name: '账户历史', exact: true }).waitFor();
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${output}/list-mobile-icons.png` });
  await page.setViewportSize({ width: 1440, height: 960 });
  for (const label of ['挂账额度设置', '门店充值']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('dialog').waitFor();
    if (label === '挂账额度设置') await page.getByLabel('挂账额度', { exact: true }).waitFor();
    else await page.getByLabel('充值金额', { exact: true }).waitFor();
    assert.equal(await page.locator('.ant-modal:visible').count(), 1);
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await page.getByRole('button', { name: '门店销账', exact: true }).click();
  await page.getByText('订货单001', { exact: true }).waitFor();
  await page.getByRole('button', { name: '选择全部筛选结果', exact: true }).click();
  await page.getByText('销账金额：8,000.00', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: '储值流水', exact: true }).count(), 0);
  await page.locator('.ant-modal-close').click();
  await page.getByRole('button', { name: '账户历史', exact: true }).click();
  await page.getByRole('tab', { name: '充值历史', exact: true }).waitFor();
  await page.getByText('银行转账充值', { exact: true }).first().waitFor();
  await page.getByRole('tab', { name: '挂账历史', exact: true }).click();
  await page.getByText('新增挂账', { exact: true }).first().waitFor();
  await page.getByRole('tab', { name: '销账历史', exact: true }).click();
  await page.getByText('50.30', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tabpanel', { name: '销账历史', exact: true }).getByRole('button', { name: '单据与凭证', exact: true }).count(), 1);
  await page.waitForTimeout(300); await page.screenshot({ path: `${output}/clearing-history.png` });
  await page.locator('.ant-modal-close').click();
  await page.locator('.finance-group-panel').getByText('未分组 (0)', { exact: true }).click();
  await page.getByText('广州天河直营门店', { exact: true }).waitFor({ state: 'hidden' });
  await page.locator('.finance-group-panel').getByText('华南区域 (1)', { exact: true }).click();
  await page.getByText('广州天河直营门店', { exact: true }).waitFor();
  const groupQuery = new URL(page.url()).searchParams.get('group');
  assert.equal(groupQuery, 'name:华南区域');
  await page.screenshot({ path: `${output}/list-desktop.png` });
  await page.getByRole('button', { name: '广州天河直营门店', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('group'), groupQuery);
  await page.getByText('订货单001', { exact: true }).waitFor();
  assert.ok(await page.locator('.store-finance-balance').filter({ has: page.getByRole('heading', { name: '挂账账户', exact: true }) }).getByRole('button', { name: '调整额度', exact: true }).isVisible());
  assert.ok(await page.locator('.store-finance-balance').filter({ has: page.getByRole('heading', { name: '储值账户', exact: true }) }).getByRole('button', { name: '充值', exact: true }).isVisible());
  await page.getByRole('row', { name: /订货单001/ }).getByRole('checkbox').check();
  await page.getByText('销账金额：8,000.00', { exact: true }).waitFor();
  await page.getByText('共 1 笔 · 已选 1 笔', { exact: true }).waitFor();
  await page.getByRole('button', { name: '清空选择', exact: true }).click();
  assert.ok(await page.getByRole('button', { name: '销账核对（0）', exact: true }).isDisabled());
  await page.getByLabel('筛选挂账订单').fill('不存在');
  await page.getByText('共 0 笔 · 已选 0 笔', { exact: true }).waitFor();
  await page.locator('.store-finance-account').getByRole('button', { name: '重置筛选', exact: true }).click();
  await page.getByText('订货单001', { exact: true }).waitFor();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/account-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.getByRole('button', { name: '充值', exact: true }).isVisible());
  }
  await page.getByLabel('选择账户记录').click();
  await page.locator('.ant-select-dropdown').getByText('销账历史', { exact: true }).click();
  await page.getByText('50.30', { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/history-mobile.png` });
  await page.locator('.ant-modal-close').click();
  assert.equal(new URL(page.url()).searchParams.get('group'), groupQuery);
  await page.getByLabel('选择财务门店分组').click();
  await page.locator('.ant-select-dropdown').getByText('未分组 (0)', { exact: true }).click();
  await page.getByText('广州天河直营门店', { exact: true }).waitFor({ state: 'hidden' });
  await page.screenshot({ path: `${output}/groups-mobile.png` });
  assert.deepEqual(errors, []);
  console.log('PASS: finance layout, store entry, money formatting, selection reset, search reset, desktop/mobile; fixture reads only');
} finally { await browser.close(); }
