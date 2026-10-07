import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/react-admin-r2-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const report = { status: 'RUNNING', checks: [], screenshots: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/templates');
  await page.getByLabel('用户名').fill('pxflow_user');
  await page.getByLabel('密码', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '订货模板', exact: true }).waitFor();
  const rows = await page.evaluate(async () => {
    const session = JSON.parse(sessionStorage.getItem('procurex-react-admin-session-v1'));
    const get = async path => (await (await fetch(`/api/v1${path}`, { headers: { Authorization: `Bearer ${session.accessToken}` } })).json()).data;
    return { templates: await get('/templates'), products: await get('/products'), suppliers: await get('/suppliers'), stores: await get('/stores') };
  });
  const template = rows.templates.find(row => !row.isArchived); const product = rows.products[0]; const supplier = rows.suppliers.find(row => !row.isArchived);
  assert.ok(template && product && supplier);
  const detail = { ...template, tag: template.tag || '响应验收', items: [{ productId: product.id, sortOrder: 7, isEnabled: true, minOrderQty: null, orderMultiple: '2', initialSalesPrice: '10.5', suppliers: [{ supplierId: supplier.id, priority: 20 }] }],
    settings: [{ supplierId: supplier.id, settlementMode: 'COMPANY_TERM', settlementCycle: 'MONTHLY' }] };
  const writes = [];
  await page.route('**/api/v1/templates/**', async route => {
    const req = route.request();
    if (req.method() === 'GET' && new URL(req.url()).pathname === `/api/v1/templates/${template.id}`) return route.fulfill({ json: { data: detail } });
    if (req.method() !== 'GET') { writes.push({ path: new URL(req.url()).pathname, method: req.method(), body: req.postDataJSON() }); return route.fulfill({ json: { data: detail } }); }
    return route.continue();
  });
  await page.route('**/api/v1/templates', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    writes.push({ path: '/api/v1/templates', method: 'POST', body: route.request().postDataJSON() }); return route.fulfill({ json: { data: detail } });
  });
  const select = async (label, text) => {
    await page.getByLabel(label, { exact: true }).click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: text }).first().click();
  };
  const screenshot = async name => { await page.waitForTimeout(350); await page.screenshot({ path: `${output}/${name}.png` }); report.screenshots.push(`${name}.png`); };
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('http://127.0.0.1:4174/templates');
    await page.getByRole('heading', { name: '订货模板', exact: true }).waitFor();
    await page.locator('.ant-spin-spinning').waitFor({ state: 'hidden' });
    await screenshot(`templates-${width}`);
    await page.getByLabel('搜索订货模板').fill(template.name);
    await page.getByRole('button', { name: `商品及供货优先级${template.name}`, exact: true }).click();
    await page.getByLabel('商品', { exact: true }).waitFor();
    await screenshot(`template-items-${width}`);
    assert.ok(await page.getByRole('dialog').evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }));
    await page.getByRole('button', { name: '添加商品', exact: true }).click();
    const picker = page.getByRole('dialog', { name: '添加商品', exact: true });
    await picker.waitFor(); await picker.getByLabel('搜索商品').fill('不存在的商品验收查询');
    await picker.locator('.ant-empty-description').filter({ hasText: '暂无数据' }).waitFor();
    await picker.getByLabel('搜索商品').fill('');
    assert.ok(await picker.evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }));
    await screenshot(`template-picker-${width}`);
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await picker.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  const batchProduct = rows.products.find(row => row.isActive && row.id !== product.id);
  assert.ok(batchProduct);
  await page.getByRole('button', { name: `商品及供货优先级${template.name}`, exact: true }).click();
  await page.getByLabel('商品', { exact: true }).waitFor();
  await page.getByRole('button', { name: '添加商品', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加商品', exact: true });
  await picker.getByLabel('搜索商品').fill(batchProduct.name);
  await picker.getByRole('row').filter({ hasText: batchProduct.name }).first().getByRole('checkbox').check();
  await picker.getByRole('button', { name: '添加已选商品 (1)', exact: true }).click();
  await picker.waitFor({ state: 'hidden' });
  assert.equal(await page.getByLabel('商品', { exact: true }).count(), 2);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  assert.equal(await page.getByLabel('模板编号').count(), 0); await page.getByLabel('模板名称').fill('React模板响应验收'); await page.getByLabel('模板标签').fill('测试');
  await page.getByRole('button', { name: '保存', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(Object.hasOwn(writes.at(-1).body, 'code'), false);
  for (const [action, suffix, method] of [['编辑模板', '', 'PATCH'], ['复制模板', '/copy', 'POST'], ['绑定门店', '/stores', 'PUT'], ['商品及供货优先级', '/items', 'PUT'], ['结算覆盖', `/supplier-settings/${supplier.id}`, 'DELETE'], ['归档模板', '/archive', 'POST']]) {
    console.log('Checking', action);
    await page.getByRole('button', { name: `${action}${template.name}`, exact: true }).click();
    await page.getByRole('dialog').waitFor(); await page.locator('.ant-spin-spinning').waitFor({ state: 'hidden' });
    if (action === '复制模板') assert.equal(await page.getByLabel('模板编号').count(), 0);
    if (action === '结算覆盖') {
      await select('供应商', supplier.name);
      await page.getByRole('switch', { name: '使用供应商默认结算' }).click();
    }
    await page.getByRole('button', { name: action === '归档模板' ? '确认归档' : '保存', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const write = writes.at(-1); assert.equal(write.path, `/api/v1/templates/${template.id}${suffix}`); assert.equal(write.method, method); assert.equal(write.body.expectedVersion, template.version);
    if (action === '商品及供货优先级') {
      assert.equal(write.body.items[0].minOrderQty, null); assert.equal(write.body.items[0].orderMultiple, '2');
      assert.deepEqual(write.body.items[0].suppliers, [{ supplierId: supplier.id, priority: 20 }]); assert.equal(Object.hasOwn(write.body.items[0], 'initialSalesPrice'), false);
    }
  }
  report.checks.push('Template real reference lists and mocked create/edit/copy/stores/items/default-settlement/archive with original versions and nullable quantity rules. No template writes.');
  const scopeId = '77777777-7777-4777-8777-777777777777'; const jobId = '88888888-8888-4888-8888-888888888888';
  const quote = { scopeId, versionId: '99999999-9999-4999-8999-999999999999', templateId: null, productId: product.id, supplierId: supplier.id, salesPrice: '10', supplyPrice: '8', revision: 1, reason: '响应验收', effectiveAt: new Date().toISOString() };
  const impact = { scopeId, affectedOrderCount: 1, salesDelta: '2', supplyDelta: '0', orders: [{ supplierOrderId: jobId, supplierOrderNo: '价格响应验收订单', salesDelta: '2', supplyDelta: '0' }] };
  let jobStatus = 'PENDING'; let failPublish = true; const publishes = []; const processes = [];
  await page.route('**/api/v1/prices/quote', route => route.fulfill({ json: { data: quote } }));
  await page.route('**/api/v1/prices/impact-preview', route => route.fulfill({ json: { data: impact } }));
  await page.route(`**/api/v1/price-scopes/${scopeId}/versions`, route => route.fulfill({ json: { data: [quote] } }));
  await page.route('**/api/v1/price-changes', async route => {
    publishes.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() });
    if (failPublish) { failPublish = false; return route.abort('failed'); }
    return route.fulfill({ json: { data: { ...quote, runId: jobId } } });
  });
  await page.route(`**/api/v1/jobs/${jobId}`, route => route.fulfill({ json: { data: { id: jobId, status: jobStatus, affectedOrderCount: 1, salesDelta: '2', supplyDelta: '0', orders: [] } } }));
  await page.route(`**/api/v1/jobs/${jobId}/adjustments`, route => route.fulfill({ json: { data: [] } }));
  await page.route(`**/api/v1/jobs/${jobId}/process`, route => {
    processes.push(route.request().headers()['idempotency-key']); jobStatus = 'SUCCEEDED';
    return route.fulfill({ json: { data: { id: jobId, status: jobStatus } } });
  });
  await page.goto('http://127.0.0.1:4174/prices'); await page.getByRole('heading', { name: '价格管理', exact: true }).waitFor();
  await select('商品', product.name); await select('供应商', supplier.name);
  await page.getByRole('button', { name: '读取当前价格', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#salesPrice')?.value?.startsWith('10'));
  await page.getByLabel('销售单价').fill('12.500001'); await page.getByLabel('改价原因').fill('价格响应验收，不写业务数据');
  await page.getByRole('button', { name: '预览影响', exact: true }).click(); await page.getByRole('heading', { name: '影响预览', exact: true }).waitFor();
  await page.getByLabel('改价原因').fill('重新预览验收'); assert.equal(await page.getByRole('button', { name: '确认发布', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '预览影响', exact: true }).click(); await page.getByRole('heading', { name: '影响预览', exact: true }).waitFor();
  for (const width of [1440, 320]) { await page.setViewportSize({ width, height: 960 }); await screenshot(`prices-preview-${width}`); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: '确认发布', exact: true }).click(); await page.getByRole('button', { name: '确定', exact: true }).click();
  await page.getByText('存在待确认的价格提交', { exact: true }).waitFor();
  await page.reload(); await page.getByRole('button', { name: '恢复原提交', exact: true }).waitFor();
  await page.getByRole('button', { name: '恢复原提交', exact: true }).click(); await page.getByText('价格已发布', { exact: true }).waitFor();
  assert.equal(publishes.length, 2); assert.ok(publishes[0].key); assert.equal(publishes[0].key, publishes[1].key); assert.deepEqual(publishes[0].body, publishes[1].body); assert.equal(publishes[0].body.salesPrice, '12.500001');
  await page.getByRole('button', { name: '执行订单重算', exact: true }).click(); await page.getByRole('button', { name: '确定', exact: true }).click(); await page.getByText('订单重算已完成', { exact: true }).waitFor(); assert.ok(processes[0]);
  report.checks.push('Price preview invalidation, decimal body, failure/reload/original-key replay and job processing mocked. No price, order or financial writes.');
  await page.goto('http://127.0.0.1:4174/prices');
  const templateResponse = page.waitForResponse(response => response.url().endsWith(`/templates/${template.id}`));
  await select('价格范围', template.name); await templateResponse;
  assert.equal(await page.getByLabel('供货单价').getAttribute('readonly'), '');
  report.checks.push('Template supplier cost is read-only.');
  await page.route('**/api/v1/me', async route => {
    const response = await route.fetch(); const body = await response.json(); body.data.user.roles = ['HQ_FINANCE']; await route.fulfill({ response, json: body });
  });
  for (const path of ['prices', 'templates']) { await page.goto(`http://127.0.0.1:4174/${path}`); await page.getByText('无权访问此页面', { exact: true }).waitFor(); }
  assert.deepEqual(report.errors, []); report.checks.push('HQ finance direct routes denied; no page errors.'); report.status = 'PASSED'; console.log(report.status, report.checks);
} catch (failure) { report.status = 'FAILED'; report.errors.push(failure.stack); throw failure; }
finally { await writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2)); await browser.close(); }
