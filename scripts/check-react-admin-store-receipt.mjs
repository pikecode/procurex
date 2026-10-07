import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/store-receipt-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/stores');
  await page.getByLabel('用户名').fill('pxflow_user');
  await page.getByLabel('密码', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '门店管理', exact: true }).waitFor();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  let dialog = page.getByRole('dialog');
  assert.equal(await dialog.getByLabel('门店编号', { exact: true }).count(), 0);
  const same = dialog.getByRole('checkbox', { name: '同门店信息', exact: true });
  assert.ok(await same.isChecked());
  await dialog.getByLabel('联系人', { exact: true }).fill('张经理');
  await dialog.getByLabel('联系电话', { exact: true }).fill('13800000000');
  await dialog.getByLabel('门店详细地址', { exact: true }).fill('门店一号');
  assert.ok(await dialog.getByText('门店一号', { exact: true }).isVisible());
  assert.ok(await dialog.getByText('张经理', { exact: true }).isVisible());
  await same.uncheck();
  await dialog.getByLabel('收货人', { exact: true }).fill('李收货');
  await same.check(); await same.uncheck();
  assert.equal(await dialog.getByLabel('收货人', { exact: true }).inputValue(), '李收货');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const store = { id: 'receipt-preview', code: 'PREVIEW', name: '收货交互验证门店', storeType: 'DIRECT', contactName: '张经理', contactPhone: '13800000000',
    address: '广东省 / 广州市 / 天河区 / 门店一号', receiptAddress: '广东省 / 广州市 / 天河区 / 仓库二号', receiptContactName: '李收货', receiptContactPhone: '13900000000', status: 'ACTIVE', version: 3 };
  await page.route('**/api/v1/stores', route => route.fulfill({ json: { data: [store] } }));
  await page.getByRole('button', { name: '刷新列表', exact: true }).click();
  await page.getByRole('button', { name: `编辑${store.name}`, exact: true }).click();
  dialog = page.getByRole('dialog');
  assert.equal(await dialog.getByLabel('门店编号', { exact: true }).count(), 0);
  assert.equal(await dialog.getByRole('checkbox', { name: '同门店信息', exact: true }).isChecked(), false);
  assert.equal(await dialog.getByLabel('收货人', { exact: true }).inputValue(), store.receiptContactName);
  let body;
  await page.route('**/api/v1/stores/receipt-preview', route => {
    body = route.request().postDataJSON();
    return route.fulfill({ json: { data: { ...store, ...body } } });
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 }); await page.waitForTimeout(350);
    await page.screenshot({ path: `${output}/independent-${width}.png` });
    assert.ok(await dialog.evaluate(node => node.getBoundingClientRect().right <= innerWidth));
  }
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(body.receiptAddress, store.receiptAddress);
  assert.equal(body.receiptContactName, store.receiptContactName);
  assert.equal(body.expectedVersion, 3);
  await page.getByRole('button', { name: `编辑${store.name}`, exact: true }).click();
  await dialog.getByRole('checkbox', { name: '同门店信息', exact: true }).check();
  await dialog.getByText(store.address, { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/same-390.png` });
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(body.receiptAddress, null); assert.equal(body.receiptContactName, null); assert.equal(body.receiptContactPhone, null);
  assert.deepEqual(errors, []);
  console.log('PASS: default same-store preview, toggle preserves draft, existing receipt restoration, independent/same-store payloads, responsive form; no database writes');
} finally { await browser.close(); }
