import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/react-admin-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const report = { status: 'RUNNING', errors: [], checks: [], screenshots: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/stores');
  await page.getByLabel('用户名').fill('pxflow_user');
  await page.getByLabel('密码', { exact: true }).fill('incorrect');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByText('账号或密码不正确').waitFor();
  await page.locator('button.ant-btn-loading').waitFor({ state: 'hidden' });
  await page.getByLabel('密码', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '门店管理' }).waitFor();
  await page.getByText('主流程演示门店', { exact: true }).waitFor();
  await page.getByRole('button', { name: '收起菜单', exact: true }).click();
  await page.getByRole('button', { name: '展开菜单', exact: true }).click();
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 960 });
    for (const [route, title] of [['stores', '门店管理'], ['store-groups', '门店分组'], ['collection-accounts', '收款账户'], ['categories', '商品分类'], ['brands', '品牌管理'], ['units', '单位管理'], ['products', '商品管理'], ['suppliers', '供应商管理']]) {
      await page.goto(`http://127.0.0.1:4174/${route}`);
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      await page.locator('.ant-spin-spinning').waitFor({ state: 'hidden' });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole('button', { name: '新增', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(350);
      assert.ok(await page.getByRole('dialog').evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }));
      await page.screenshot({ path: `${output}/${route}-form-${width}.png` });
      report.screenshots.push(`${route}-form-${width}.png`);
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.screenshot({ path: `${output}/${route}-${width}.png` }); report.screenshots.push(`${route}-${width}.png`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('http://127.0.0.1:4174/products');
  await page.locator('.ant-spin-spinning').waitFor({ state: 'hidden' });
  const productRows = await page.evaluate(async () => {
    const token = JSON.parse(sessionStorage.getItem('procurex-react-admin-session-v1')).accessToken;
    return (await (await fetch('/api/v1/products', { headers: { Authorization: `Bearer ${token}` } })).json()).data;
  });
  assert.ok(productRows.length);
  const product = productRows[0];
  await page.getByLabel('搜索商品管理').fill(product.name);
  await page.getByRole('button', { name: `编辑${product.name}`, exact: true }).click();
  await page.getByRole('dialog').waitFor();
  let productBody;
  await page.route(`**/api/v1/products/${product.id}`, async route => {
    assert.equal(route.request().method(), 'PATCH'); productBody = route.request().postDataJSON();
    await route.fulfill({ json: { data: { ...product, ...productBody } } });
  });
  await page.getByLabel('商品名称', { exact: true }).fill(product.name);
  await page.getByLabel('默认售价', { exact: true }).fill('12.500001');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(productBody.expectedVersion, product.version);
  assert.equal(productBody.defaultSalesPrice, '12.500001');
  assert.equal(productBody.imageFileId, product.imageFileId);
  await page.unroute(`**/api/v1/products/${product.id}`);
  await page.getByRole('button', { name: `采购单位换算${product.name}`, exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.goto('http://127.0.0.1:4174/suppliers');
  await page.locator('.ant-spin-spinning').waitFor({ state: 'hidden' });
  const supplierButton = page.locator('button[aria-label^="关联商品"]:not([disabled])').first();
  const associationResponse = page.waitForResponse(response => /\/suppliers\/[^/]+\/products$/.test(response.url()) && response.request().method() === 'GET');
  await supplierButton.click();
  const association = await associationResponse; const associationData = (await association.json()).data;
  await page.getByRole('heading', { name: /供应商品配置/ }).waitFor();
  await page.getByRole('button', { name: '保存', exact: true }).waitFor();
  await page.getByRole('button', { name: '保存', exact: true }).isEnabled();
  let associationBody;
  const associationPath = new URL(association.url()).pathname;
  await page.route(`**${associationPath}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    associationBody = route.request().postDataJSON(); await route.fulfill({ json: { data: associationData } });
  });
  const associationSaved = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === associationPath);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await associationSaved;
  assert.equal(associationBody.expectedVersion, associationData.version);
  assert.deepEqual(associationBody.productIds, associationData.productIds);
  await page.unroute(`**${associationPath}`);
  report.checks.push('Product edit decimal and version payload mocked; conversion dialog, real supplier association load and mocked versioned association save. No product/supplier mutations or OSS uploads.');
  await page.goto('http://127.0.0.1:4174/stores');
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('请选择门店类型').waitFor();
  assert.equal(await page.getByLabel('门店编号', { exact: true }).count(), 0);
  await page.getByLabel('门店名称', { exact: true }).fill('React表单验收门店');
  await page.getByLabel('联系人', { exact: true }).fill('测试联系人');
  await page.getByLabel('联系电话', { exact: true }).fill('13800000000');
  await page.getByRole('dialog').getByLabel('门店类型', { exact: true }).click();
  await page.getByText('直营店', { exact: true }).last().click();
  await page.getByLabel('门店省市区', { exact: true }).click();
  await page.getByText('广东省', { exact: true }).click();
  await page.getByText('广州市', { exact: true }).click();
  await page.getByText('天河区', { exact: true }).click();
  await page.getByLabel('门店详细地址', { exact: true }).fill('测试地址1号');
  await page.getByRole('checkbox', { name: '同门店信息', exact: true }).uncheck();
  await page.getByLabel('收货人', { exact: true }).waitFor();
  await page.getByRole('checkbox', { name: '同门店信息', exact: true }).check();
  let submitted = false;
  // Validate the real form payload without adding a persistent store.
  await page.route('**/api/v1/stores', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON();
    assert.equal(Object.hasOwn(body, 'code'), false);
    assert.equal(body.address, '广东省 / 广州市 / 天河区 / 测试地址1号');
    assert.equal(body.receiptAddress, null); assert.equal(body.storeType, 'DIRECT');
    submitted = true;
    await route.fulfill({ json: { data: { id: 'preview-only' } } });
  });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('门店资料已保存').waitFor(); assert.equal(submitted, true);
  await page.unroute('**/api/v1/stores');
  await page.getByRole('textbox', { name: '搜索门店管理' }).fill('主流程演示门店');
  await page.getByRole('button', { name: '查看主流程演示门店', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByRole('button', { name: '编辑主流程演示门店', exact: true }).click();
  assert.equal(await page.getByLabel('门店编号', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 960 });
  await page.getByRole('button', { name: '打开菜单', exact: true }).click();
  await page.getByRole('dialog').getByText('门店分组', { exact: true }).click();
  await page.getByRole('dialog', { name: 'ProcureX', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: '门店分组', exact: true }).waitFor();
  const groupName = `React本地验收分组-${Date.now()}`;
  let groupId;
  try {
    await page.getByRole('button', { name: '新增', exact: true }).click();
    await page.getByLabel('分组名称', { exact: true }).fill(groupName);
    const created = page.waitForResponse(response => response.url().endsWith('/api/v1/store-groups') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const response = await created; assert.equal(response.status(), 201);
    groupId = (await response.json()).data.id;
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('textbox', { name: '搜索门店分组' }).fill(groupName);
    await page.getByRole('button', { name: `编辑${groupName}`, exact: true }).click();
    await page.getByLabel('分组名称', { exact: true }).fill(`${groupName}-已编辑`);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: `删除${groupName}-已编辑`, exact: true }).click();
    const removed = page.waitForResponse(response => response.url().endsWith(`/store-groups/${groupId}`) && response.request().method() === 'DELETE');
    await page.getByRole('button', { name: '确定', exact: true }).click();
    assert.ok((await removed).ok()); groupId = undefined;
  } finally {
    if (groupId) await page.evaluate(async id => {
      const saved = JSON.parse(sessionStorage.getItem('procurex-react-admin-session-v1'));
      const headers = { Authorization: `Bearer ${saved.accessToken}`, 'Content-Type': 'application/json' };
      const rows = (await (await fetch('/api/v1/store-groups', { headers })).json()).data;
      const row = rows.find(item => item.id === id);
      if (row) {
        const response = await fetch(`/api/v1/store-groups/${id}`, { method: 'DELETE', headers, body: JSON.stringify({ expectedVersion: row.version }) });
        if (!response.ok) throw new Error('验收分组清理失败');
      }
    }, groupId);
  }
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByRole('heading', { name: '账号登录', exact: true }).waitFor();
  await page.getByLabel('用户名').fill('pxflow_user');
  await page.getByLabel('密码', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '门店分组', exact: true }).waitFor();
  // Frontend authorization fixture; backend authorization remains unchanged.
  await page.route('**/api/v1/me', async route => {
    const response = await route.fetch(); const json = await response.json();
    json.data.user.roles = ['PURCHASER']; await route.fulfill({ json });
  });
  await page.goto('http://127.0.0.1:4174/stores');
  await page.getByRole('heading', { name: '门店管理', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '新增', exact: true }).count(), 0);
  assert.equal(await page.locator('button[aria-label^="编辑"]').count(), 0);
  await page.goto('http://127.0.0.1:4174/collection-accounts');
  await page.getByText('无权访问此页面', { exact: true }).waitFor();
  await page.route('**/api/v1/stores', route => route.fulfill({ status: 401, json: { error: { code: 'SESSION_EXPIRED' } } }));
  await page.goto('http://127.0.0.1:4174/stores');
  await page.getByRole('heading', { name: '账号登录', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('procurex-react-admin-session-v1')), null);
  assert.deepEqual(report.errors, []);
  report.checks.push(`Real API login, invalid password, restore, eight real lists, desktop/mobile menu and ${report.screenshots.length} screenshots; store validation, three-level address and independent receipt toggle; mocked store create payload; detail and edit; real group create/edit/delete with cleanup; logout. No financial or OSS writes.`);
  report.checks.push('Frontend purchaser read-only and direct-route authorization; 401 returns to login and removes session (response fixtures).');
  report.status = 'PASSED';
  console.log(report.status, report.checks);
} catch (error) { report.status = 'FAILED'; report.errors.push(error.stack); throw error; }
finally { await writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2)); await browser.close(); }
