import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { writeFileSync, openSync, closeSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';
import sharp from 'sharp';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';

const base = process.env.PROCUREX_API_BASE || 'http://127.0.0.1:3114/api/v1';
assert.equal(new URL(base).hostname, '127.0.0.1');
const connectionString = process.env.DATABASE_URL || 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
assertLocalFixtureDatabase(connectionString);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const seed = JSON.parse(await readFile('apps/web/main-flow-demo-seed.json', 'utf8'));
const output = resolve('var/product-media-evidence');
await mkdir(output, { recursive: true });
const evidence = { generatedAt: new Date().toISOString(), status: 'RUNNING', apiBase: base, realDevice: false,
  source: 'Synthetic bitmap and temporary PXMEDIA-UI product, not genuine product photography', screenshots: [] };
const sku = `PXMEDIA-UI-${Date.now()}`;
let productId;
const fileIds = [];
function tool(name, options = {}) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  const args = ['-c', 'Codex', name, '--project', resolve('apps/miniprogram')];
  for (const [key, value] of Object.entries(options)) args.push(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
  const responsePath = `/tmp/procurex-media-${process.pid}.json`;
  const fd = openSync(responsePath, 'w', 0o600);
  let result;
  try {
    result = spawnSync(process.env.WECHATIDE_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', fd, 'pipe'] });
    result.stdout = readFileSync(responsePath, 'utf8');
  } finally { closeSync(fd); unlinkSync(responsePath); }
  const start = result.stdout?.indexOf('{') ?? -1;
  assert.ok(start >= 0, `${name}: missing result`);
  const body = JSON.parse(result.stdout.slice(start));
  assert.ok(result.status === 0 && body.ok && body.result?.success !== false, `${name}: ${body.message || body.result?.error || 'failed'}`);
  return body.result;
}
const data = path => tool('automation_page_action', { action: 'getData', dataPath: path }).data;
const patch = value => tool('automation_page_action', { action: 'setData', patch: JSON.stringify(value) });
function method(name, event) {
  const argsFile = resolve(output, 'method-args.json');
  writeFileSync(argsFile, JSON.stringify(event ? [event] : []));
  return tool('automation_page_action', { action: 'callMethod', method: name, argsFile });
}
function wait(path, predicate) {
  for (let i = 0; i < 40; i++) { const value = data(path); if (predicate(value)) return value; }
  throw new Error(`Missing state: ${path}`);
}
function screenshot(name) {
  tool('simulator_screenshot', { path: resolve(output, `${name}.jpg`) });
  evidence.screenshots.push(`${name}.jpg`); console.log(`Product media: ${name}`);
}
try {
  tool('close_project_window'); tool('open_project_window'); tool('simulator_open_page', { page: '/pages/login/index' });
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ username: seed.username, password: seed.password, client: 'WEB' }) });
  assert.equal(login.status, 201);
  const token = (await login.json()).data.accessToken;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', connection: 'close' };
  const bitmap = await sharp({ create: { width: 300, height: 600, channels: 3, background: '#16a085' } })
    .composite([{ input: await sharp({ create: { width: 140, height: 400, channels: 3, background: '#e84663' } }).png().toBuffer(), left: 80, top: 100 }]).png().toBuffer();
  const session = await fetch(`${base}/files/upload-sessions`, { method: 'POST', headers, body: JSON.stringify({ purpose: 'RECEIPT', filename: 'synthetic-crop-source.png', mimeType: 'image/png', sizeBytes: bitmap.length }) });
  assert.equal(session.status, 201); const source = (await session.json()).data; fileIds.push(source.id);
  assert.equal((await fetch(`${base}/files/${source.id}/content`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-upload-token': source.uploadToken, 'content-type': 'application/octet-stream', connection: 'close' }, body: bitmap })).status, 201);
  assert.equal((await fetch(`${base}/files/${source.id}/complete`, { method: 'POST', headers })).status, 201);
  tool('automation_runtime_info', { action: 'currentPage' });
  tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
  tool('automation_element_action', { action: 'text', selector: '.primary', waitForSelector: '.primary' });
  tool('automation_page_action', { action: 'setData', waitForSelector: '.primary', patch: JSON.stringify({ username: seed.username, password: seed.password, apiBase: base }) });
  tool('automation_element_action', { action: 'tap', selector: '.primary', waitForSelector: '.primary' });
  for (let i = 0; i < 30; i++) {
    if (tool('automation_runtime_info', { action: 'currentPage' }).currentPage.path !== 'pages/login/index') break;
  }
  tool('automation_navigate', { action: 'navigateTo', url: '/pages/products/index' });
  const products = wait('products', value => value?.some(product => product.id === seed.productId));
  const original = products.find(product => product.id === seed.productId);
  screenshot('product-list');
  method('newProduct');
  patch({ draft: { ...data('draft'), sku, defaultSalesPrice: '12', name: '测试商品图片', categoryId: original.categoryId, baseUnitId: original.baseUnitId, specification: '500 mL × 24 瓶', brand: '图片验收品牌', storageCondition: 'AMBIENT' },
    categoryIndex: data('categories').findIndex(item => item.id === original.categoryId), unitIndex: data('units').findIndex(item => item.id === original.baseUnitId), storageIndex: 1 });
  tool('automation_evaluate', { fnSource: `async function() { const pages=getCurrentPages(), p=pages[pages.length-1]; const f=await new Promise((resolve,reject)=>wx.downloadFile({url:${JSON.stringify(`${base}/files/${source.id}/download`)},header:{Authorization:${JSON.stringify(`Bearer ${token}`)}},success:resolve,fail:reject})); if(f.statusCode!==200) throw new Error('Source unavailable'); await p.prepareCrop(f.tempFilePath); return true; }` });
  assert.equal(data('crop').height, 480); screenshot('square-crop');
  method('confirmCrop');
  const image = wait('imageFile', value => value?.id);
  fileIds.push(image.id);
  const cleared = tool('automation_evaluate', { fnSource: 'function() { const p=getCurrentPages(); const d=p[p.length-1].data; return {cleared: !d.crop && !d.error}; }' });
  assert.ok(JSON.stringify(cleared).includes('"cleared":true'));
  screenshot('product-editor-image');
  tool('automation_viewport_action', { action: 'pageScrollTo', scrollTop: 10000 });
  screenshot('product-editor-thumbnail');
  method('saveProduct');
  wait('editing', value => value === false);
  const saved = wait('products', value => value?.some(product => product.sku === sku)).find(product => product.sku === sku);
  productId = saved.id; assert.equal(saved.imageFile.id, image.id); assert.equal(saved.specification, '500 mL × 24 瓶');
  const download = await fetch(`${base}/files/${image.id}/download`, { headers });
  assert.equal(download.status, 200);
  const cropped = Buffer.from(await download.arrayBuffer());
  const metadata = await sharp(cropped).metadata(); assert.equal(metadata.width, 800); assert.equal(metadata.height, 800);
  const stats = await sharp(cropped).stats(); assert.ok(stats.channels.some(channel => channel.stdev > 10), 'Canvas must contain nonblank bitmap');
  evidence.image = { width: metadata.width, height: metadata.height, bytes: cropped.length, nonblank: true };
  const binding = await db.storeTemplateBinding.findFirstOrThrow({ where: { storeId: seed.storeId, expiredAt: null }, include: { template: true } });
  assert.equal(binding.template.code, 'PXFLOW-TPL');
  await db.templateItem.create({ data: { templateId: binding.templateId, productId, sortOrder: 999 } });
  tool('automation_navigate', { action: 'redirectTo', url: '/pages/login/index' });
  tool('automation_page_action', { action: 'setData', waitForSelector: '.primary', patch: JSON.stringify({ username: seed.storeUsername, password: seed.password, apiBase: base }) });
  tool('automation_element_action', { action: 'tap', selector: '.primary', waitForSelector: '.primary' });
  wait('products', value => value?.some(product => product.id === productId && product.imageUrl));
  method('onSearch', { detail: { value: '测试商品图片' } }); screenshot('store-product-media');
  evidence.status = 'PASSED'; evidence.mutations = 'Temporary product/template item only; no orders, prices or monetary records';
} catch (error) { evidence.status = 'FAILED'; evidence.error = `${error.message}${error.cause?.code ? ` (${error.cause.code})` : ''}`; process.exitCode = 1; }
finally {
  try {
    const fixture = productId || (await db.product.findUnique({ where: { sku } }))?.id;
    if (fixture) { await db.templateItem.deleteMany({ where: { productId: fixture } }); await db.product.delete({ where: { id: fixture } }); }
    const files = await db.fileObject.findMany({ where: { id: { in: fileIds } } });
    assert.equal(await db.product.count({ where: { imageFileId: { in: fileIds } } }), 0);
    for (const file of files) {
      assert.match(file.objectKey, /^[0-9a-f-]{36}$/);
      await db.fileObject.delete({ where: { id: file.id } });
      await unlink(join(resolve(process.env.PRIVATE_FILE_DIR || 'var/private-files'), file.objectKey)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    assert.equal(await db.product.count({ where: { sku } }), 0);
    assert.equal(await db.fileObject.count({ where: { id: { in: fileIds } } }), 0);
    evidence.cleanup = 'PASSED';
    evidence.cleanupScope = 'Only this fixture product/template item and tracked file IDs; authenticated sessions and product creation audit remain';
  } catch (error) { evidence.cleanup = 'FAILED'; evidence.cleanupError = error.message; evidence.status = 'FAILED'; process.exitCode = 1; }
  finally { await db.$disconnect(); }
  await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Product media evidence: ${evidence.status}`);
}
