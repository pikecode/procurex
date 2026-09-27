import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing expected fragment: ${expected}`);
  }
}

function assertExists(path, label) {
  if (!existsSync(resolve(root, path))) {
    throw new Error(`${label} is missing: ${path}`);
  }
}

function checkSyntax(path) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, path)], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${path} failed syntax check:\n${result.stderr || result.stdout}`);
  }
}

const [billingHtml, billingJs, billingCss, appJs, reportHtml] = await Promise.all([
  readProjectFile('apps/web/billing.html'),
  readProjectFile('apps/web/billing.js'),
  readProjectFile('apps/web/billing.css'),
  readProjectFile('apps/web/app.js'),
  readProjectFile('apps/web/index.html'),
]);

for (const path of ['apps/web/style.css', 'apps/web/billing.css', 'apps/web/billing.js', 'apps/web/app.js']) {
  assertExists(path, 'web asset');
}

checkSyntax('apps/web/billing.js');
checkSyntax('apps/web/app.js');

assertIncludes(billingHtml, '账单及付款', 'W09 billing page');
assertIncludes(billingHtml, '账单调整与差额', 'W10 adjustment page');
assertIncludes(billingHtml, 'id="bill-tabs"', 'W09 billing page');
assertIncludes(billingHtml, 'id="payment-actions"', 'W09 payment workflow');
assertIncludes(billingHtml, 'id="proof"', 'payment evidence upload');
assertIncludes(billingHtml, 'id="adjustments"', 'W10 adjustment list');
assertIncludes(billingHtml, 'id="adjustment-detail"', 'W10 adjustment detail');

assertIncludes(billingJs, 'store-statements', 'W09 statement endpoints');
assertIncludes(billingJs, 'supplier-statements', 'W09 statement endpoints');
assertIncludes(billingJs, 'supplier-store-statements', 'W09 statement endpoints');
assertIncludes(billingJs, 'direct-statements', 'W09 statement endpoints');
assertIncludes(billingJs, '/payment-records/preview', 'payment preview workflow');
assertIncludes(billingJs, '/payment-records', 'payment registration workflow');
assertIncludes(billingJs, '/files/upload-sessions', 'payment evidence workflow');
assertIncludes(billingJs, '/adjustments', 'W10 adjustment workflow');
assertIncludes(billingJs, '/difference-disposals', 'W10 difference disposal workflow');
assertIncludes(billingJs, 'OFFLINE_RETURN', 'W10 offline return workflow');
assertIncludes(billingJs, 'OFFSET', 'W10 offset workflow');

assertIncludes(billingCss, '.bill-tabs', 'billing styles');
assertIncludes(billingCss, '.adjustment-detail', 'adjustment styles');
assertIncludes(billingCss, '@media', 'responsive billing styles');

assertIncludes(reportHtml, '报表与分析', 'W11 report page');
assertIncludes(appJs, '/reports/${active}', 'W11 report endpoints');
assertIncludes(appJs, '/exports', 'R04 export workflow');

console.log('Web workbench check passed.');
