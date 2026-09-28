import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

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

const [billingHtml, billingJs, billingCss, appJs, appCss, reportHtml, mainFlowHtml, mainFlowJs, m4Html, m4Js, m4Css, m4Gates, mainFlowDemoHtml, mainFlowDemoJs, opsHtml, opsJs] = await Promise.all([
  readProjectFile('apps/web/billing.html'),
  readProjectFile('apps/web/billing.js'),
  readProjectFile('apps/web/billing.css'),
  readProjectFile('apps/web/app.js'),
  readProjectFile('apps/web/style.css'),
  readProjectFile('apps/web/index.html'),
  readProjectFile('apps/web/main-flow.html'),
  readProjectFile('apps/web/main-flow.js'),
  readProjectFile('apps/web/m4-acceptance.html'),
  readProjectFile('apps/web/m4-acceptance.js'),
  readProjectFile('apps/web/m4-acceptance.css'),
  readProjectFile('apps/web/m4-gates.json'),
  readProjectFile('apps/web/main-flow-demo.html'),
  readProjectFile('apps/web/main-flow-demo.js'),
  readProjectFile('apps/web/ops.html'),
  readProjectFile('apps/web/ops.js'),
]);

for (const path of [
  'apps/web/style.css',
  'apps/web/billing.css',
  'apps/web/billing.js',
  'apps/web/app.js',
  'apps/web/main-flow.html',
  'apps/web/main-flow.js',
  'apps/web/m4-acceptance.html',
  'apps/web/m4-acceptance.js',
  'apps/web/m4-acceptance.css',
  'apps/web/m4-gates.json',
  'apps/web/main-flow-demo.html',
  'apps/web/main-flow-demo.js',
  'apps/web/ops.html',
  'apps/web/ops.js',
]) {
  assertExists(path, 'web asset');
}

checkSyntax('apps/web/billing.js');
checkSyntax('apps/web/app.js');
checkSyntax('apps/web/main-flow.js');
checkSyntax('apps/web/m4-acceptance.js');
checkSyntax('apps/web/main-flow-demo.js');
checkSyntax('apps/web/ops.js');

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
assertIncludes(reportHtml, '/ops.html', 'W13 navigation entry');
assertIncludes(reportHtml, 'M5 验收状态', 'M5 acceptance summary');
assertIncludes(reportHtml, 'id="m5-acceptance"', 'M5 acceptance summary');
assertIncludes(reportHtml, 'id="export-jobs"', 'R04 export job list');
assertIncludes(appJs, '/reports/${active}', 'W11 report endpoints');
assertIncludes(appJs, '/exports', 'R04 export workflow');
assertIncludes(appJs, '/retry', 'DEV-505 export retry workflow');
assertIncludes(appJs, 'loadExportJobs', 'R04 export job list');
assertIncludes(appJs, 'data-export-retry', 'DEV-505 export retry button');
assertIncludes(appJs, 'reports-acceptance-run.json', 'M5 acceptance summary output');
assertIncludes(appJs, 'loadAcceptance', 'M5 acceptance summary loader');
assertIncludes(appCss, '.acceptance-list', 'M5 acceptance summary styles');
assertIncludes(appCss, '.export-card', 'R04 export job list styles');
assertIncludes(packageJson.scripts['billing:seed-acceptance'], 'seed-billing-acceptance.mjs', 'billing acceptance seed script');
assertIncludes(packageJson.scripts['billing:check-acceptance'], 'check-billing-acceptance.mjs', 'billing acceptance check script');
assertIncludes(packageJson.scripts['reports:seed-acceptance'], 'seed-reports-acceptance.mjs', 'reports acceptance seed script');
assertIncludes(packageJson.scripts['reports:check-acceptance'], 'check-reports-acceptance.mjs', 'reports acceptance check script');
assertIncludes(packageJson.scripts['acceptance:m5-browserless'], 'reports:check-acceptance', 'M5 browserless acceptance script');
assertIncludes(packageJson.scripts['m5:capture-browser-evidence'], 'capture-m5-browser-evidence.mjs', 'M5 browser evidence capture script');
assertIncludes(packageJson.scripts['db:check'], 'check-local-db.mjs', 'local database check script');
assertIncludes(packageJson.scripts['acceptance:m4-browserless'], 'billing:check-acceptance', 'M4 browserless acceptance script');
assertIncludes(packageJson.scripts['acceptance:m4-close'], 'm4:check-manual-evidence', 'M4 close acceptance script');
assertIncludes(packageJson.scripts['m4:check-browser-runtime'], 'check-browser-runtime.mjs', 'M4 browser runtime check script');
assertIncludes(packageJson.scripts['m4:capture-browser-evidence'], 'capture-m4-browser-evidence.mjs', 'M4 browser evidence capture script');
assertIncludes(packageJson.scripts['m4:capture-manual-evidence'], 'capture-m4-manual-evidence.mjs', 'M4 manual evidence capture script');
assertIncludes(packageJson.scripts['m4:manual-evidence-status'], 'check-m4-manual-evidence.mjs', 'M4 manual evidence status script');
assertIncludes(packageJson.scripts['m4:check-manual-evidence'], 'check-m4-manual-evidence.mjs', 'M4 manual evidence check script');
assertIncludes(packageJson.scripts['m4:prepare-manual-acceptance'], 'prepare-m4-manual-acceptance.mjs', 'M4 manual acceptance prep script');
assertIncludes(packageJson.scripts['m4:status'], 'report-m4-status.mjs', 'M4 status report script');
assertIncludes(packageJson.scripts['m4:start-manual-acceptance'], 'start-m4-manual-acceptance.mjs', 'M4 manual acceptance launcher script');
assertIncludes(packageJson.scripts['m4:gate-status'], 'check-m4-gate-status.mjs', 'M4 gate status script');
assertIncludes(packageJson.scripts['m4:write-manual-checklist'], 'write-m4-manual-checklist.mjs', 'M4 manual checklist script');
assertIncludes(packageJson.scripts['m4:check-manual-checklist'], '--check', 'M4 manual checklist check script');
assertIncludes(packageJson.scripts['acceptance:m4-browserless'], 'm4:gate-status', 'M4 browserless acceptance script');
assertIncludes(packageJson.scripts['acceptance:m4-browserless'], 'm4:check-manual-checklist', 'M4 browserless acceptance script');
assertIncludes(packageJson.scripts['acceptance:m4-browserless'], 'acceptance:main-flow', 'M4 browserless acceptance script');
assertIncludes(packageJson.scripts['main-flow:seed-demo'], 'seed-main-flow-demo.mjs', 'main-flow demo seed script');
assertIncludes(packageJson.scripts['main-flow:check-demo'], 'check-main-flow-demo.mjs', 'main-flow demo check script');
assertIncludes(packageJson.scripts['acceptance:m4-browserless'], 'main-flow:check-demo', 'M4 browserless acceptance script');

assertIncludes(mainFlowHtml, '主流程验收', 'main-flow acceptance page');
assertIncludes(mainFlowHtml, '/main-flow.js', 'main-flow acceptance script');
assertIncludes(mainFlowJs, 'main-flow-run.json', 'main-flow runner output');
assertIncludes(mainFlowJs, 'totalPayableAmount', 'main-flow payment preview evidence');
assertIncludes(mainFlowJs, 'fulfillmentStatus', 'main-flow receipt completion evidence');

assertIncludes(m4Html, 'M4 验收', 'M4 acceptance page');
assertIncludes(m4Html, '/m4-acceptance.js', 'M4 acceptance script');
assertIncludes(m4Html, '/m4-acceptance.css', 'M4 acceptance styles');
assertIncludes(m4Js, 'billing-acceptance-run.json', 'M4 billing acceptance output');
assertIncludes(m4Js, 'main-flow-run.json', 'M4 main-flow acceptance output');
assertIncludes(m4Js, 'm4-gates.json', 'M4 gate definitions');
assertIncludes(m4Js, 'acceptance:m4-browserless', 'M4 acceptance command');
assertIncludes(m4Js, 'collectEvidence', 'M4 gate evidence mapping');
assertIncludes(m4Js, 'localStorage', 'M4 manual evidence checklist');
assertIncludes(m4Js, 'data-manual-evidence', 'M4 manual evidence checklist');
assertIncludes(m4Js, 'renderEvidenceSummary', 'M4 evidence summary');
assertIncludes(m4Js, 'navigator.clipboard', 'M4 evidence summary copy');
assertIncludes(m4Js, 'renderManualPlan', 'M4 manual acceptance plan');
assertIncludes(m4Gates, 'DEV-402', 'M4 gate definitions');
assertIncludes(m4Gates, 'DEV-403', 'M4 gate definitions');
assertIncludes(m4Gates, 'DEV-406', 'M4 gate definitions');
assertIncludes(m4Gates, 'stored-value-payable', 'M4 structured gate evidence');
assertIncludes(m4Gates, 'manualSteps', 'M4 manual acceptance plan');
assertIncludes(m4Css, '.gate-card', 'M4 gate styles');
assertIncludes(m4Css, '.passed', 'M4 gate evidence styles');
assertIncludes(m4Css, '.manual-check', 'M4 manual evidence styles');
assertIncludes(m4Css, '.evidence-card', 'M4 evidence summary styles');
assertIncludes(m4Css, '.manual-plan', 'M4 manual acceptance plan styles');

assertIncludes(mainFlowDemoHtml, '主流程操作台', 'main-flow demo page');
assertIncludes(mainFlowDemoHtml, '/main-flow-demo.js', 'main-flow demo script');
assertIncludes(mainFlowDemoJs, 'main-flow-demo-seed.json', 'main-flow demo seed output');
assertIncludes(mainFlowDemoJs, '/purchase-requests', 'main-flow demo purchase request call');
assertIncludes(mainFlowDemoJs, '/shipments/', 'main-flow demo receipt call');

assertIncludes(opsHtml, '运营与对账', 'W13 ops page');
assertIncludes(opsHtml, '/ops.js', 'W13 ops script');
assertIncludes(opsHtml, 'id="issues"', 'R05 issue table');
assertIncludes(opsHtml, 'id="export-health-summary"', 'DEV-505 export health summary');
assertIncludes(opsHtml, 'id="notifications"', 'I08 notifications table');
assertIncludes(opsHtml, 'id="read-all-notifications"', 'I08 notification bulk read action');
assertIncludes(opsHtml, 'id="audit-logs"', 'DEV-504 audit log table');
assertIncludes(opsHtml, 'id="audit-filter-form"', 'DEV-504 audit filters');
assertIncludes(opsJs, '/reconciliation-issues', 'R05 reconciliation endpoint');
assertIncludes(opsJs, '/exports/health', 'DEV-505 export health endpoint');
assertIncludes(opsJs, '/notifications', 'I08 notifications endpoint');
assertIncludes(opsJs, '/notifications/read-all', 'I08 notification bulk read endpoint');
assertIncludes(opsJs, '/audit-logs', 'DEV-504 audit endpoint');
assertIncludes(opsJs, 'URLSearchParams', 'DEV-504 audit filter query');
assertIncludes(opsJs, 'data-notification-read', 'I08 notification read action');
assertIncludes(opsJs, '超时处理中', 'DEV-505 stale export health label');
assertIncludes(opsJs, 'STORE_BALANCE_LEDGER_MISMATCH', 'R05 issue labels');

console.log('Web workbench check passed.');
