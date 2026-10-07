import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const output = 'var/react-admin-r4-accounts-evidence'; await mkdir(output, { recursive: true });
const checks = [], screenshots = [], errors = []; const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/store-finance'); await page.getByLabel('用户名').fill('pxflow_user'); await page.getByLabel('密码', { exact: true }).fill('correct-password'); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.getByRole('heading', { name: '门店财务', exact: true }).waitFor();
  const real = await page.evaluate(async () => { const session = JSON.parse(sessionStorage.getItem('procurex-react-admin-session-v1')); const response = await fetch('/api/v1/stores/finance-overview', { headers: { Authorization: `Bearer ${session.accessToken}` } }); return { status: response.status, count: (await response.json()).data.length }; }); assert.equal(real.status, 200); checks.push(`Real login/finance overview read: ${real.count} stores. Following all writes intercepted.`);
  const id = n => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
  const storeId = id('1'), allocationId = id('2'), collectionId = id('3'), fileId = id('4'), documentId = id('5'), ledgerId = id('6');
  let role = 'ADMIN', missing = false, collectionActive = true, completeFails = true, rechargeUnknown = true, creditConflict = true, previewChanged = false, clearingUnknown = true, scopedReads = 0;
  const uploads = [], recharges = [], limits = [], clearings = [];
  const account = { storeId, balance: '100.00', reservedBalance: '20.00', availableBalance: '80.00', creditLimit: '500.00', creditUsed: '100.00', creditCumulative: '350.00', creditAvailable: '400.00', version: 3 };
  const store = { id: storeId, name: '广州财务验收门店', groupName: '华南直营', status: 'ACTIVE', account };
  const preview = { storeId, totalAmount: '100.00', items: [{ fundingAllocationId: allocationId, version: 2, clearableAmount: '100.00' }] };
  let previewReads = 0;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9sAAAAASUVORK5CYII=', 'base64');
  await page.route('**/api/v1/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/v1/notifications') return route.fulfill({ json: { data: { unreadCount: 0, notifications: [] } } });
    const req = route.request(), path = new URL(req.url()).pathname.replace('/api/v1', ''), method = req.method(); const data = value => route.fulfill({ json: { data: value } });
    if (path === '/me') return data({ user: { id: id('7'), displayName: '财务验收', roles: [role], ...(['STORE', 'STORE_FINANCE'].includes(role) ? { scope: { type: role, ...(missing ? {} : { storeId }) } } : {}) }, session: { expiresAt: new Date(Date.now() + 3600000).toISOString() } });
    if (path === '/stores/finance-overview') { assert.ok(['ADMIN', 'HQ_FINANCE'].includes(role)); return data([store]); }
    if (path === `/stores/${storeId}/account`) { scopedReads++; return data(account); }
    if (path === '/collection-accounts') return data([{ id: collectionId, name: '公司收款账户', bankName: '招商银行', accountNo: '1234567890', status: collectionActive ? 'ACTIVE' : 'INACTIVE' }]);
    if (path === `/stores/${storeId}/ledgers`) return data([{ id: ledgerId, direction: 'CREDIT', amount: '100.00', balanceAfter: '100.00', note: '期初充值', sourceType: 'RECHARGE', sourceId: documentId, occurredAt: new Date().toISOString() }]);
    if (path === `/stores/${storeId}/credit-items`) return data([{ fundingAllocationId: allocationId, supplierName: '广州粮油配送', supplierOrderNo: '待销账订单', occurredAt: new Date().toISOString(), creditOutstanding: '100.00', version: 2 }]);
    if (path === `/stores/${storeId}/credit-movements`) return data([{ id: allocationId, sourceType: 'CLEARING', sourceId: documentId, kind: 'CLEARING', amount: '50.00', outstandingAfter: '100.00', occurredAt: new Date().toISOString() }]);
    if (path === `/stores/${storeId}/recharges/${documentId}` || path === `/stores/${storeId}/clearings/${documentId}`) return data({ id: documentId, storeId, documentNo: '财务凭证单据', kind: path.includes('/recharges/') ? 'RECHARGE' : 'CLEARING', amount: '100.00', businessDate: '2026-10-06', operatorName: '财务测试员', remark: '单据备注', evidenceFiles: [{ id: fileId, filename: '充值凭证.png', mimeType: 'image/png' }] });
    if (path === `/files/${fileId}/download`) { assert.ok(req.headers().authorization?.startsWith('Bearer ')); return route.fulfill({ contentType: 'image/png', body: png }); }
    if (path === '/files/upload-sessions') { uploads.push(req.postDataJSON()); return data({ id: fileId, uploadToken: 'fixture-token' }); }
    if (path === `/files/${fileId}/content`) { assert.equal(req.headers()['x-upload-token'], 'fixture-token'); assert.ok(req.postDataBuffer().equals(png)); return data({ uploaded: true }); }
    if (path === `/files/${fileId}/complete`) { if (completeFails) { completeFails = false; return route.fulfill({ status: 409, json: { error: { code: 'FILE_CONTENT_INVALID', message: 'invalid' } } }); } return data({ id: fileId, status: 'READY' }); }
    if (path === `/stores/${storeId}/recharges`) { recharges.push({ body: req.postDataJSON(), key: req.headers()['idempotency-key'] }); if (rechargeUnknown) { rechargeUnknown = false; return route.abort('failed'); } account.balance = '223.45'; account.version++; return data({ id: documentId }); }
    if (path === `/stores/${storeId}/credit-limit`) { limits.push({ body: req.postDataJSON(), key: req.headers()['idempotency-key'] }); if (creditConflict) { creditConflict = false; account.version++; return route.fulfill({ status: 409, json: { error: { code: 'VERSION_CONFLICT', message: 'changed' } } }); } account.creditLimit = req.postDataJSON().limit; account.version++; return data(account); }
    if (path === `/stores/${storeId}/clearings/preview`) { assert.deepEqual(req.postDataJSON(), { fundingAllocationIds: [allocationId] }); previewReads++; if (previewChanged) { previewChanged = false; preview.totalAmount = '90.00'; preview.items[0].version = 3; preview.items[0].clearableAmount = '90.00'; } return data(preview); }
    if (path === `/stores/${storeId}/clearings`) { clearings.push({ body: req.postDataJSON(), key: req.headers()['idempotency-key'] }); if (clearingUnknown) { clearingUnknown = false; return route.abort('failed'); } account.creditUsed = '10.00'; account.creditAvailable = '490.00'; account.version++; return data({ id: documentId }); }
    throw new Error(`Unmocked request forbidden: ${method} ${path}`);
  });
  const shot = async name => { await page.waitForTimeout(250); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: `${output}/${name}.png` }); screenshots.push(`${name}.png`); };
  const confirm = async () => { await page.getByRole('heading', { name: '提交核对', exact: true }).waitFor({ state: 'hidden' }); await page.locator('.ant-popconfirm:visible').waitFor({ state: 'hidden' }); await page.getByRole('button', { name: '核对提交', exact: true }).click(); await page.getByRole('heading', { name: '提交核对', exact: true }).waitFor(); await page.getByRole('button', { name: '确认提交', exact: true }).click(); try { await page.locator('.ant-popconfirm:visible').getByRole('button', { name: '确定', exact: true }).click({ timeout: 5000 }); } catch (error) { await page.screenshot({ path: `${output}/confirmation-failure.png`, fullPage: true }); console.log(await page.locator('.ant-popconfirm').evaluateAll(nodes => nodes.map(n => ({ text: n.textContent, class: n.className, rect: n.getBoundingClientRect().toJSON() })))); throw error; } };
  await page.reload(); await page.getByRole('button', { name: store.name, exact: true }).click(); await page.getByRole('button', { name: '充值', exact: true }).click();
  await page.getByLabel('充值金额', { exact: true }).fill('123.456'); await page.getByRole('button', { name: '核对提交', exact: true }).click(); await page.getByText('请输入大于零的金额，最多两位小数', { exact: true }).waitFor();
  await page.getByLabel('充值金额', { exact: true }).fill('123.45'); await page.getByLabel('收款账户', { exact: true }).click(); await page.locator('.ant-select-dropdown:visible').getByText('公司收款账户 · 招商银行 · 尾号7890', { exact: true }).click(); await page.getByLabel('业务日期', { exact: true }).fill('2026-10-06');
  const fileInput = page.locator('.ant-modal:visible').last().locator('input[type=file]'); await fileInput.setInputFiles({ name: '充值凭证.png', mimeType: 'image/png', buffer: png }); await page.getByText('凭证内容与图片类型不符，请重新选择。', { exact: true }).waitFor(); assert.equal(await page.getByLabel('移除充值凭证.png').count(), 0);
  await fileInput.setInputFiles({ name: '充值凭证.png', mimeType: 'image/png', buffer: png }); await page.getByLabel('移除充值凭证.png').waitFor(); assert.equal(uploads.at(-1).purpose, 'RECHARGE');
  for (const width of [1440, 320]) { await page.setViewportSize({ width, height: 1100 }); await shot(`recharge-${width}`); }
  await confirm(); await page.getByText('存在待确认提交：门店充值', { exact: true }).waitFor(); await page.reload(); await page.getByRole('button', { name: '恢复原提交', exact: true }).click(); await page.getByText('存在待确认提交：门店充值', { exact: true }).waitFor({ state: 'hidden' }); assert.deepEqual(recharges[1], recharges[0]); assert.deepEqual(recharges[0].body, { businessDate: '2026-10-06', amount: '123.45', collectionAccountId: collectionId, evidenceFileIds: [fileId] });
  checks.push('Recharge decimal validation, active collection account, purpose-bound READY evidence, binary token/authenticated thumbnail and unknown-result identical-key reload recovery.');
  const confirmCredit = async () => {
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: '确认调整挂账额度' }); await dialog.waitFor();
    assert.ok(await dialog.getByText('原挂账额度', { exact: true }).isVisible());
    assert.ok(await dialog.getByText('新挂账额度', { exact: true }).isVisible());
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1100 }); await page.waitForTimeout(300); await shot(`credit-confirm-${width}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
  };
  await page.getByRole('button', { name: '调整额度', exact: true }).click(); await page.getByRole('button', { name: '保存', exact: true }).click(); await page.getByText('请输入调整原因，最多300字', { exact: true }).waitFor(); assert.equal(limits.length, 0); assert.equal(await page.getByRole('button', { name: '核对提交', exact: true }).count(), 0);
  await page.getByLabel('挂账额度', { exact: true }).fill('600.00'); await page.getByLabel('调整原因', { exact: true }).fill('业务额度调整'); await page.getByRole('button', { name: '保存', exact: true }).click(); await page.getByRole('button', { name: '返回修改', exact: true }).click(); assert.equal(limits.length, 0); await confirmCredit(); await page.getByText('资料已变更，请刷新后重新编辑。', { exact: true }).waitFor(); const oldVersion = limits[0].body.expectedVersion;
  await page.locator('.ant-modal:visible').last().getByRole('button', { name: '取消', exact: true }).first().click(); await page.getByRole('button', { name: '调整额度', exact: true }).click(); await page.getByLabel('挂账额度', { exact: true }).fill('600.00'); await page.getByLabel('调整原因', { exact: true }).fill('重新核对额度'); await confirmCredit(); await page.getByRole('button', { name: '调整额度', exact: true }).waitFor(); assert.equal(limits[1].body.expectedVersion, oldVersion + 1);
  checks.push('Credit limit uses fresh account version and reason; 409 requires reopening and fresh read.');
  await page.getByRole('row', { name: /待销账订单/ }).getByRole('checkbox').check(); await page.getByRole('button', { name: '销账核对（1）', exact: true }).click(); await page.getByLabel('业务日期', { exact: true }).fill('2026-10-06'); await page.locator('.ant-modal:visible').last().getByText('100.00', { exact: true }).first().waitFor(); previewChanged = true; await confirm(); await page.getByText('挂账明细已变化，请按最新金额重新核对。', { exact: true }).waitFor(); assert.equal(clearings.length, 0); await confirm(); await page.getByText('存在待确认提交：门店销账', { exact: true }).waitFor(); await page.reload(); await page.getByRole('button', { name: '恢复原提交', exact: true }).click(); await page.getByText('存在待确认提交：门店销账', { exact: true }).waitFor({ state: 'hidden' }); assert.deepEqual(clearings[1], clearings[0]); assert.deepEqual(clearings[0].body.items, [{ fundingAllocationId: allocationId, expectedVersion: 3, expectedAmount: '90.00' }]); assert.equal(account.balance, '223.45');
  checks.push('Clearing fresh preview changed amount blocks write, re-review uses current per-allocation version/amount; replay preserves body/key and stored balance. Financial effects fixture only.');
  await page.setViewportSize({ width: 1440, height: 1100 }); await page.getByRole('tab', { name: '充值历史', exact: true }).click(); const rechargePanel = page.getByRole('tabpanel', { name: '充值历史', exact: true }); await rechargePanel.getByAltText('充值凭证.png').waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('img[alt="充值凭证.png"]')].some(img => img.complete && img.naturalWidth)); assert.equal(await page.locator('.ant-modal:visible').count(), 1); await rechargePanel.getByAltText('充值凭证.png').click(); await page.locator('.ant-image-preview:visible').waitFor(); await shot('inline-history-preview'); await page.locator('.ant-image-preview-close').click(); await rechargePanel.getByRole('button', { name: '单据与凭证', exact: true }).click(); await page.waitForFunction(() => [...document.querySelectorAll('img[alt="充值凭证.png"]')].some(img => img.complete && img.naturalWidth)); await page.getByRole('dialog', { name: '账户单据', exact: true }).getByAltText('充值凭证.png').click(); await page.locator('.ant-image-preview:visible').waitFor(); await shot('private-document-preview'); await page.locator('.ant-image-preview-close').click();
  await page.getByRole('dialog', { name: '账户单据', exact: true }).locator('.ant-modal-close').click();
  await page.getByRole('tab', { name: '储值流水', exact: true }).click();
  const ledgerPanel = page.getByRole('tabpanel', { name: '储值流水', exact: true });
  await ledgerPanel.getByAltText('充值凭证.png').waitFor();
  await ledgerPanel.getByAltText('充值凭证.png').click();
  await page.locator('.ant-image-preview:visible').waitFor();
  await shot('inline-ledger-preview');
  await page.locator('.ant-image-preview-close').click();
  checks.push('Recharge history and stored-value ledger show inline authenticated thumbnails with direct image preview.');
  role = 'STORE_FINANCE'; await page.goto('http://127.0.0.1:4174/store-finance?store=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); await page.getByRole('heading', { name: '门店账户', exact: true }).waitFor(); await page.getByRole('tab', { name: '未销账明细', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '充值', exact: true }).count(), 0); assert.equal(await page.getByRole('button', { name: '调整额度', exact: true }).count(), 0); await shot('store-account-readonly');
  missing = true; const before = scopedReads; await page.reload(); await page.getByText('尚未绑定门店，无法查看账户', { exact: true }).waitFor(); assert.equal(scopedReads, before);
  role = 'PURCHASER'; missing = false; await page.reload(); await page.getByText('无权访问此页面', { exact: true }).waitFor();
  role = 'HQ_FINANCE'; await page.goto(`http://127.0.0.1:4174/store-finance?store=${storeId}`); await page.getByRole('button', { name: '充值', exact: true }).waitFor(); collectionActive = false; await page.getByRole('button', { name: '充值', exact: true }).click(); await page.getByText('暂无启用的收款账户，请先配置收款账户', { exact: true }).waitFor(); assert.ok(await page.getByRole('button', { name: '核对提交', exact: true }).isDisabled());
  checks.push('Store finance own scope overrides query, no writes; missing scope prevents API reads; purchaser route denied; central finance writable but no active collection blocks recharge.'); assert.deepEqual(errors, []);
  await writeFile(`${output}/manifest.json`, JSON.stringify({ status: 'PASS', checks, screenshots, errors }, null, 2)); console.log(checks.join('\n'));
} finally { await browser.close(); }
