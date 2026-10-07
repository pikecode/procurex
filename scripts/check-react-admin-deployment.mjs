import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const exec = promisify(execFile);
const output = 'var/react-admin-deployment-evidence';
await mkdir(output, { recursive: true });
const name = `procurex-admin-smoke-${process.pid}`;
const report = { status: 'RUNNING', startedAt: new Date().toISOString(), checks: [], errors: [],
  boundary: 'Local production static container and existing local API. Login and reads only; no business/funds/OSS writes. Not production deployment approval.' };
let container, browser;
try {
  await exec('docker', ['build', '-f', 'infra/admin/Dockerfile', '-t', name, '.'], { timeout: 180000 });
  container = (await exec('docker', ['run', '-d', '--name', name, '-p', '127.0.0.1::80', name])).stdout.trim();
  const info = JSON.parse((await exec('docker', ['inspect', container])).stdout)[0];
  const port = info.NetworkSettings.Ports['80/tcp'][0].HostPort;
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* Nginx may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Static container did not start');
  await exec('docker', ['exec', container, 'nginx', '-t']);
  const index = await readFile('apps/admin/dist/index.html', 'utf8');
  report.indexSha256 = createHash('sha256').update(index).digest('hex');
  for (const path of ['/stores', '/templates', '/purchase-requests', '/supplier-orders', '/store-orders', '/finance', '/settlement-differences', '/reports']) {
    const response = await fetch(`${base}${path}`); assert.equal(response.status, 200); assert.equal(await response.text(), index);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
  }
  report.checks.push('Eight direct SPA paths serve the built index with revalidation');
  const assets = [...index.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map(match => match[1]);
  assert.ok(assets.length >= 2);
  for (const path of assets) {
    const response = await fetch(`${base}${path}`); assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  assert.equal((await fetch(`${base}/assets/not-present.js`)).status, 404);
  assert.equal((await fetch(`${base}/api/v1/stores`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/health/ready`)).status, 200);
  report.checks.push('Built JS/CSS load; missing assets return 404; API proxy returns API health/401, not SPA HTML');
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${base}/finance`);
  await page.getByLabel('用户名').fill('pxflow_user'); await page.getByLabel('密码', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '账单查询', exact: true }).waitFor();
  await page.reload(); await page.getByRole('heading', { name: '账单查询', exact: true }).waitFor();
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${output}/finance-${width}.png` });
  }
  assert.deepEqual(report.errors, []);
  report.checks.push('Built React login and session restore on direct finance route; desktop/mobile render without page errors or page overflow');
  report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.errors.push(error.message); process.exitCode = 1; }
finally {
  await browser?.close();
  try {
    if (container) await exec('docker', ['rm', '-f', container]);
    await exec('docker', ['image', 'rm', name]);
    report.cleanup = 'PASS';
  } catch (error) { report.cleanup = 'FAIL'; report.status = 'FAIL'; report.errors.push(error.message); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
