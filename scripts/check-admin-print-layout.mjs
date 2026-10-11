import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from '../apps/admin/node_modules/vite/dist/node/index.js';
import { createElement } from '../apps/admin/node_modules/react/index.js';
import { renderToStaticMarkup } from '../apps/admin/node_modules/react-dom/server.node.js';
import { launchAcceptanceBrowser } from './acceptance-browser.mjs';

const output = 'var/admin-print-layout-evidence';
await mkdir(output, { recursive: true });
const vite = await createServer({ root: resolve('apps/admin'), server: { middlewareMode: true, hmr: false }, appType: 'custom' });
let browser;
try {
  const { PurchasePrintSheet } = await vite.ssrLoadModule('/src/components/PurchasePrint.tsx');
  const items = Array.from({ length: 65 }, (_, index) => ({ id: String(index), productName: `打印分页验收长名称商品${index}蔬菜水果冷冻食品`, unitName: '袋', quantity: '2', salesUnitPrice: '12.3', salesLineAmount: '24.6' }));
  const sheet = { purchase: { requestNo: '打印布局夹具001', status: 'CONFIRMED', submittedAt: '2026-10-11T00:00:00Z', salesGoodsAmount: '1599', items }, store: { name: '打印布局测试门店', address: '广州市天河区测试路', contactName: '测试经理', contactPhone: '13800000000' } };
  const css = await readFile('apps/admin/src/components/PurchasePrint.css', 'utf8');
  browser = await launchAcceptanceBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.setContent(`<html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head><body>${renderToStaticMarkup(createElement(PurchasePrintSheet, { sheet }))}</body></html>`);
  assert.equal(await page.locator('tbody tr').count(), 65);
  const pdf = await page.pdf({ path: `${output}/65-items-A4.pdf`, preferCSSPageSize: true, printBackground: true });
  const source = pdf.toString('latin1');
  const pages = (source.match(/\/Type\s*\/Page\b/g) || []).length;
  assert.ok(pages >= 2, 'Long order must span multiple pages');
  const box = source.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(box && Math.abs(Number(box[1]) - 595.28) < 1 && Math.abs(Number(box[2]) - 841.89) < 1, 'PDF page dimensions must match A4 within renderer rounding');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/65-items-mobile.png`, fullPage: true });
  await writeFile(`${output}/manifest.json`, JSON.stringify({ status: 'PASSED', generatedAt: new Date().toISOString(), items: 65, pages, mobileWidth: 390, boundary: 'Actual component and Chromium PDF pagination with layout-only fixtures, not a physical printer or business order.' }, null, 2));
  console.log(`A4 layout passed: 65 items, ${pages} pages, mobile 390px`);
} finally {
  await browser?.close();
  await vite.close();
}
