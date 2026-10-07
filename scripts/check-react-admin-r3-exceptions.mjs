import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'var/react-admin-r3-exceptions-evidence'; await mkdir(output, { recursive: true });
const report = { status: 'RUNNING', checks: [], screenshots: [], errors: [] };
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const uuid = value => `${String(value).padStart(8, '0')}-1111-4111-8111-111111111111`;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', failure => report.errors.push(failure.message));
  await page.goto('http://127.0.0.1:4174/purchase-requests');
  await page.getByLabel('用户名').fill('pxflow_user'); await page.getByLabel('密码', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: '登录', exact: true }).click(); await page.getByRole('heading', { name: '采购申请', exact: true }).waitFor();
  const real = await page.evaluate(async () => {
    const session = JSON.parse(sessionStorage.getItem('procurex-react-admin-session-v1'));
    const response = await fetch('/api/v1/purchase-requests/rejection-todos', { headers: { Authorization: `Bearer ${session.accessToken}` } });
    return { status: response.status, data: (await response.json()).data };
  });
  assert.equal(real.status, 200); assert.ok(Array.isArray(real.data));
  report.checks.push(`Real login and read-only rejection-todo API verified (${real.data.length} current todos); subsequent business writes use fixtures only.`);
  const store = { id: uuid(1), name: '广州采购门店', status: 'ACTIVE', templateId: uuid(99) };
  const suppliers = [{ id: uuid(2), name: '原拒单供应商', status: 'ACTIVE', isArchived: false }, { id: uuid(3), name: '替补供应商', status: 'ACTIVE', isArchived: false },
    { id: uuid(4), name: '已发货供应商', status: 'ACTIVE', isArchived: false }, { id: uuid(5), name: '停用供应商', status: 'DISABLED', isArchived: false }, { id: uuid(6), name: '归档供应商', status: 'ACTIVE', isArchived: true }];
  const products = [{ id: uuid(10), name: '东北大米', isActive: true }, { id: uuid(11), name: '食用油', isActive: true }, { id: uuid(12), name: '洗洁精', isActive: true }];
  const items = products.map((product, index) => ({ id: uuid(20 + index), productId: product.id, productName: product.name, supplierId: suppliers[0].id, quantity: '10', unitName: '袋', salesLineAmount: '100.00', supplyLineAmount: '80.00', salesUnitPrice: '10', supplyUnitPrice: '8' }));
  const template = { id: uuid(30), name: '原订货模板', isArchived: false, items: products.map(product => ({ productId: product.id, isEnabled: true, suppliers: suppliers.map(supplier => ({ supplierId: supplier.id, priority: 1 })) })) };
  const rejectedOrder = { id: uuid(40), requestId: uuid(50), supplierOrderNo: '拒单验收单', supplierId: suppliers[0].id, supplierName: suppliers[0].name, storeId: store.id, storeName: store.name, status: 'REJECTED', fulfillmentStatus: 'PENDING_SHIPMENT', version: 3, salesGoodsAmount: '200.00', supplyGoodsAmount: '160.00', items: items.slice(0, 2).map((item, index) => ({ ...item, id: uuid(60 + index) })) };
  const shippedOrder = { ...rejectedOrder, id: uuid(41), supplierOrderNo: '已发货验收单', supplierId: suppliers[2].id, status: 'SHIPPED', firstShippedAt: new Date().toISOString(), items: [items[2]] };
  const historicalOrder = { ...rejectedOrder, id: uuid(42), supplierOrderNo: '历史拒单验收单', rejectionHandled: true };
  const originalPurchase = { id: uuid(50), requestNo: '拒单采购验收单', storeId: store.id, templateId: template.id, status: 'PARTIAL_PUSHED', paymentStatus: 'PARTIAL', version: 7, submittedAt: new Date().toISOString(), salesGoodsAmount: '300.00', supplyGoodsAmount: '240.00', shortfallAmount: '0.00', paidAmount: '0.00', items, supplierOrders: [rejectedOrder, shippedOrder, historicalOrder] };
  let purchase = structuredClone(originalPurchase); let todoReads = 0; let failNext = ''; const writes = []; const templateReads = [];
  const todo = { id: rejectedOrder.id, supplierOrderId: rejectedOrder.id, supplierOrderNo: rejectedOrder.supplierOrderNo, purchaseRequestId: purchase.id, requestNo: purchase.requestNo, storeName: store.name, supplierName: suppliers[0].name, reason: '库存不足', createdAt: new Date().toISOString() };
  await page.route('**/api/v1/purchase-requests**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (req.method() === 'GET') {
      if (path.endsWith('/rejection-todos')) { todoReads += 1; return route.fulfill({ json: { data: purchase.status === 'PARTIAL_PUSHED' ? [todo] : [] } }); }
      return route.fulfill({ json: { data: path === '/api/v1/purchase-requests' ? [purchase] : purchase } });
    }
    assert.ok(path.endsWith('/reallocate'), `Unexpected business write: ${path}`);
    writes.push({ path, key: req.headers()['idempotency-key'], body: req.postDataJSON() });
    const failure = failNext; failNext = '';
    if (failure === 'abort') return route.abort('failed');
    if (failure === 'version') return route.fulfill({ status: 409, json: { error: { code: 'VERSION_CONFLICT' } } });
    purchase = { ...purchase, status: 'CONFIRMED', version: purchase.version + 1, supplierOrders: purchase.supplierOrders.map(order => order.id === rejectedOrder.id ? { ...order, rejectionHandled: true } : order) };
    return route.fulfill({ json: { data: purchase } });
  });
  await page.route('**/api/v1/supplier-orders**', route => {
    assert.equal(route.request().method(), 'GET'); const path = new URL(route.request().url()).pathname;
    const orders = [rejectedOrder, shippedOrder, historicalOrder];
    return route.fulfill({ json: { data: path.endsWith('/supplier-orders') ? orders : orders.find(order => path.endsWith(order.id)) } });
  });
  await page.route('**/api/v1/templates/**', route => { assert.equal(route.request().method(), 'GET'); templateReads.push(new URL(route.request().url()).pathname); return route.fulfill({ json: { data: template } }); });
  await page.route('**/api/v1/suppliers', route => { assert.equal(route.request().method(), 'GET'); return route.fulfill({ json: { data: suppliers } }); });
  await page.route('**/api/v1/products', route => { assert.equal(route.request().method(), 'GET'); return route.fulfill({ json: { data: products } }); });
  await page.route('**/api/v1/stores', route => { assert.equal(route.request().method(), 'GET'); return route.fulfill({ json: { data: [store] } }); });
  const shot = async name => { await page.waitForTimeout(200); await page.screenshot({ path: `${output}/${name}.png` }); report.screenshots.push(`${name}.png`); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); };
  const editor = () => page.getByRole('dialog').filter({ hasText: '拒单重分配' });
  const target = item => page.getByLabel(`目标供应商${item.id}`, { exact: true });
  async function choose(item, supplier) { await target(item).click(); await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: supplier.name }).click(); }
  async function cancel(item) { await editor().locator(`[data-row-key="${item.id}"], [data-item-id="${item.id}"]`).getByText('取消商品', { exact: true }).click(); }
  async function review() { await page.getByRole('button', { name: '核对处理清单', exact: true }).click(); await page.getByRole('heading', { name: '处理清单', exact: true }).waitFor(); }
  async function confirm() { await page.getByRole('button', { name: '确认处理', exact: true }).click(); await page.locator('.ant-popconfirm:visible').getByRole('button', { name: '确定', exact: true }).click(); }
  async function open() { await page.goto(`http://127.0.0.1:4174/purchase-requests?request=${purchase.id}&rejectedOrder=${rejectedOrder.id}`); await target(items[0]).waitFor(); }
  await page.reload(); await page.getByRole('heading', { name: '拒单待办', exact: true }).waitFor(); await page.getByRole('button', { name: '处理拒单验收单', exact: true }).waitFor();
  for (const width of [1440, 320]) { await page.setViewportSize({ width, height: 1000 }); await shot(`rejection-todos-${width}`); }
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.getByRole('button', { name: '处理拒单验收单', exact: true }).click(); await target(items[0]).waitFor();
  assert.equal(await editor().locator(`tr[data-row-key="${items[2].id}"]`).count(), 0);
  assert.equal(await page.getByRole('button', { name: '确认处理', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '核对处理清单', exact: true }).click(); await page.getByText('请填写处理原因，最多300字。', { exact: true }).waitFor(); assert.equal(writes.length, 0);
  await page.getByLabel('处理原因', { exact: true }).fill('缺货转供并取消食用油');
  await page.getByRole('button', { name: '核对处理清单', exact: true }).click(); await page.getByText('每项商品请选择可用供应商，或选择取消商品。', { exact: true }).waitFor();
  await target(items[0]).click();
  const dropdown = page.locator('.ant-select-dropdown:visible');
  for (const supplier of suppliers.slice(2)) assert.equal(await dropdown.getByText(supplier.name, { exact: true }).count(), 0);
  await dropdown.getByText(suppliers[1].name, { exact: true }).click(); await cancel(items[1]); await review();
  assert.ok(templateReads.every(path => path.endsWith(template.id))); assert.notEqual(template.id, store.templateId);
  for (const width of [1440, 320]) { await page.setViewportSize({ width, height: 1000 }); await shot(`rejection-review-${width}`); }
  await editor().locator(`[data-item-id="${items[1].id}"]`).getByText('重分配', { exact: true }).click();
  await choose(items[1], suppliers[1]); await cancel(items[1]); await review(); await shot('rejection-mobile-controls');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('处理原因', { exact: true }).fill('更新处理原因'); assert.equal(await page.getByRole('button', { name: '确认处理', exact: true }).isDisabled(), true);
  await review(); await confirm(); await editor().waitFor({ state: 'hidden' });
  assert.ok(writes.at(-1).key); assert.equal(writes.at(-1).body.expectedVersion, 7); assert.equal(writes.at(-1).body.rejectedOrderId, rejectedOrder.id);
  assert.deepEqual(writes.at(-1).body.assignments, [{ requestItemId: items[0].id, supplierId: suppliers[1].id }, { requestItemId: items[1].id, cancel: true }]);
  assert.equal(writes.at(-1).body.reason, '更新处理原因');
  await page.getByRole('heading', { name: '拒单待办' }).waitFor(); assert.equal(await page.getByRole('button', { name: '处理拒单验收单', exact: true }).count(), 0);
  report.checks.push('Original template (not current store template), exact rejected request-item coverage, active/non-archived/unshipped targets, required reason and review invalidation; mixed assignment/cancel payload verified without floating-point money calculations.');
  await page.goto(`http://127.0.0.1:4174/purchase-requests?request=${purchase.id}&rejectedOrder=${rejectedOrder.id}`); await page.getByText('拒单已处理或申请状态已变更，请返回刷新待办。', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '确认处理', exact: true }).isDisabled(), true);
  purchase = structuredClone(originalPurchase);
  await page.goto(`http://127.0.0.1:4174/purchase-requests?request=${purchase.id}&rejectedOrder=${historicalOrder.id}`); await page.getByText('拒单已处理或申请状态已变更，请返回刷新待办。', { exact: true }).waitFor();
  report.checks.push('Handled/historical rejections and non-reallocatable request status refuse direct-link editing.');
  products[0].isActive = false;
  await open(); await cancel(items[0]); await cancel(items[1]); await page.getByLabel('处理原因', { exact: true }).fill('全部取消拒单商品'); await review(); failNext = 'version'; await confirm();
  await page.getByText('资料已变更，请刷新后重新编辑。', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '确认处理', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '恢复原提交', exact: true }).count(), 0);
  await page.getByRole('button', { name: '重新读取拒单', exact: true }).click(); await target(items[0]).waitFor();
  assert.equal(await page.getByLabel('处理原因', { exact: true }).inputValue(), '');
  await cancel(items[0]); await cancel(items[1]); await page.getByLabel('处理原因', { exact: true }).fill('取消拒单商品，保留其他供货'); await review(); failNext = 'abort'; await confirm();
  await page.getByText('待确认提交：拒单重分配', { exact: true }).waitFor(); const unknown = structuredClone(writes.at(-1));
  assert.deepEqual(unknown.body.assignments, items.slice(0, 2).map(item => ({ requestItemId: item.id, cancel: true })));
  await page.reload(); await page.getByText('待确认提交：拒单重分配', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '确认处理', exact: true }).isDisabled(), true); await shot('rejection-recovery');
  await page.goto(`http://127.0.0.1:4174/supplier-orders?order=${rejectedOrder.id}`); await page.getByRole('button', { name: '核对资金', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '核对资金', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '恢复原提交', exact: true }).click(); await page.getByText('存在待确认提交：拒单重分配', { exact: true }).waitFor({ state: 'hidden' });
  assert.deepEqual(writes.at(-1), unknown);
  report.checks.push('409 clears terminal command, invalidates review and permits fresh read; unknown all-cancel result blocks new writes and survives refresh/cross-page recovery with identical key and body. No supplierId on cancellation entries; inactive products remain cancellable. Mobile per-item controls verified.');
  purchase = structuredClone(originalPurchase);
  await page.reload(); await page.getByRole('button', { name: '处理拒单', exact: true }).waitFor(); await page.getByRole('button', { name: '处理拒单', exact: true }).click(); await target(items[0]).waitFor();
  report.checks.push('Supplier-order rejection action deep-links to fresh purchase/rejected-order validation.');
  await page.route('**/api/v1/me', async route => { const response = await route.fetch(); const envelope = await response.json(); envelope.data.user.roles = ['HQ_FINANCE']; await route.fulfill({ json: envelope }); });
  const readsBefore = todoReads; await page.reload(); await page.getByRole('dialog').waitFor(); await page.getByText(purchase.requestNo, { exact: true }).first().waitFor();
  assert.equal(await page.getByRole('heading', { name: '拒单待办', exact: true }).count(), 0); assert.equal(await page.getByRole('button', { name: '确认处理', exact: true }).count(), 0); assert.equal(todoReads, readsBefore);
  await page.goto(`http://127.0.0.1:4174/supplier-orders?order=${rejectedOrder.id}`); await page.getByRole('button', { name: '采购申请', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '处理拒单', exact: true }).count(), 0);
  report.checks.push('HQ finance receives no rejection-todo request or write controls, including direct rejected-order URLs.');
  assert.deepEqual(report.errors, []); report.status = 'PASSED'; await rm(`${output}/failure.png`, { force: true }); console.log(report.status, report.checks);
} catch (failure) {
  report.status = 'FAILED'; report.failure = failure.stack; const page = browser.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: `${output}/failure.png` }); report.visibleText = await page.locator('body').innerText(); }
  console.error(failure); process.exitCode = 1;
} finally { await writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2)); await browser.close(); }
