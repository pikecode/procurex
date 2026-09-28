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

const [billingHtml, billingJs, billingCss, appJs, appCss, reportHtml, mainFlowHtml, mainFlowJs, m4Html, m4Js, m4Css, m4Gates, mainFlowDemoHtml, mainFlowDemoJs, roleWorkbenchesHtml, roleWorkbenchesJs, mainFlowInteractiveCapture, opsHtml, opsJs, m6Html, m6Js, m6ReadinessScript] = await Promise.all([
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
  readProjectFile('apps/web/role-workbenches.html'),
  readProjectFile('apps/web/role-workbenches.js'),
  readProjectFile('scripts/capture-main-flow-interactive-demo.mjs'),
  readProjectFile('apps/web/ops.html'),
  readProjectFile('apps/web/ops.js'),
  readProjectFile('apps/web/m6-readiness.html'),
  readProjectFile('apps/web/m6-readiness.js'),
  readProjectFile('scripts/report-m6-readiness.mjs'),
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
  'apps/web/role-workbenches.html',
  'apps/web/role-workbenches.js',
  'apps/web/ops.html',
  'apps/web/ops.js',
  'apps/web/m6-readiness.html',
  'apps/web/m6-readiness.js',
]) {
  assertExists(path, 'web asset');
}

checkSyntax('apps/web/billing.js');
checkSyntax('apps/web/app.js');
checkSyntax('apps/web/main-flow.js');
checkSyntax('apps/web/m4-acceptance.js');
checkSyntax('apps/web/main-flow-demo.js');
checkSyntax('apps/web/role-workbenches.js');
checkSyntax('apps/web/ops.js');
checkSyntax('apps/web/m6-readiness.js');
checkSyntax('scripts/report-m6-readiness.mjs');
checkSyntax('scripts/check-m6-initialization.mjs');
checkSyntax('scripts/check-m6-pilot.mjs');
checkSyntax('scripts/check-m6-external-evidence.mjs');
checkSyntax('scripts/write-m6-external-evidence-templates.mjs');

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
assertIncludes(reportHtml, '/m6-readiness.html', 'M6 readiness navigation entry');
assertIncludes(reportHtml, 'M5 验收状态', 'M5 acceptance summary');
assertIncludes(reportHtml, 'id="m5-acceptance"', 'M5 acceptance summary');
assertIncludes(reportHtml, 'M5 环境状态', 'M5 status summary');
assertIncludes(reportHtml, 'id="m5-status"', 'M5 status summary');
assertIncludes(reportHtml, 'M5 收口状态', 'M5 gate status summary');
assertIncludes(reportHtml, 'id="m5-gate-status"', 'M5 gate status summary');
assertIncludes(reportHtml, 'id="export-jobs"', 'R04 export job list');
assertIncludes(appJs, '/reports/${active}', 'W11 report endpoints');
assertIncludes(appJs, '/exports', 'R04 export workflow');
assertIncludes(appJs, '/retry', 'DEV-505 export retry workflow');
assertIncludes(appJs, 'loadExportJobs', 'R04 export job list');
assertIncludes(appJs, 'data-export-retry', 'DEV-505 export retry button');
assertIncludes(appJs, 'reports-acceptance-run.json', 'M5 acceptance summary output');
assertIncludes(appJs, 'm5-status.json', 'M5 status summary output');
assertIncludes(appJs, 'm5-gate-status.json', 'M5 gate status summary output');
assertIncludes(appJs, 'loadAcceptance', 'M5 acceptance summary loader');
assertIncludes(appJs, 'loadM5Status', 'M5 status summary loader');
assertIncludes(appJs, 'loadM5GateStatus', 'M5 gate status summary loader');
assertIncludes(appCss, '.acceptance-list', 'M5 acceptance summary styles');
assertIncludes(appCss, '.export-card', 'R04 export job list styles');
assertIncludes(appCss, '@media(max-width:720px)', 'mobile workbench styles');
assertIncludes(appCss, 'min-width:0', 'mobile workbench body width reset');
assertIncludes(packageJson.scripts['billing:seed-acceptance'], 'seed-billing-acceptance.mjs', 'billing acceptance seed script');
assertIncludes(packageJson.scripts['billing:check-acceptance'], 'check-billing-acceptance.mjs', 'billing acceptance check script');
assertIncludes(packageJson.scripts['reports:seed-acceptance'], 'seed-reports-acceptance.mjs', 'reports acceptance seed script');
assertIncludes(packageJson.scripts['reports:check-acceptance'], 'check-reports-acceptance.mjs', 'reports acceptance check script');
assertIncludes(packageJson.scripts['acceptance:m5-browserless'], 'reports:check-acceptance', 'M5 browserless acceptance script');
assertIncludes(packageJson.scripts['m5:capture-browser-evidence'], 'capture-m5-browser-evidence.mjs', 'M5 browser evidence capture script');
assertIncludes(packageJson.scripts['m5:capture-all-evidence'], 'capture-m5-all-evidence.mjs', 'M5 browser evidence refresh script');
assertIncludes(packageJson.scripts['m5:status'], 'report-m5-status.mjs', 'M5 status report script');
assertIncludes(packageJson.scripts['m5:gate-status'], 'check-m5-gate-status.mjs', 'M5 gate status script');
assertIncludes(packageJson.scripts['m6:readiness'], 'report-m6-readiness.mjs', 'M6 readiness script');
assertIncludes(packageJson.scripts['m6:readiness:strict'], '--strict', 'M6 strict readiness script');
assertIncludes(packageJson.scripts['m6:initialization-check'], 'check-m6-initialization.mjs', 'M6 initialization script');
assertIncludes(packageJson.scripts['m6:pilot-check'], 'check-m6-pilot.mjs', 'M6 pilot script');
assertIncludes(packageJson.scripts['m6:external-evidence'], 'check-m6-external-evidence.mjs', 'M6 external evidence script');
assertIncludes(packageJson.scripts['m6:external-evidence:strict'], '--strict', 'M6 strict external evidence script');
assertIncludes(packageJson.scripts['m6:write-external-templates'], 'write-m6-external-evidence-templates.mjs', 'M6 external evidence template writer');
assertIncludes(packageJson.scripts['m6:check-external-templates'], '--check', 'M6 external evidence template check');
assertIncludes(packageJson.scripts['acceptance:m5-close'], 'm5:gate-status', 'M5 close acceptance script');
assertIncludes(packageJson.scripts['acceptance:m5-close'], 'main-flow:check-demo', 'M5 close acceptance script');
assertIncludes(packageJson.scripts['acceptance:m5-close'], 'm5:capture-all-evidence', 'M5 close acceptance script');
assertIncludes(packageJson.scripts['acceptance:m5-close'], 'main-flow:capture-demo-evidence', 'M5 close acceptance script');
assertIncludes(packageJson.scripts['acceptance:m5-close'], 'main-flow:capture-interactive-demo', 'M5 close acceptance script');
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
assertIncludes(packageJson.scripts['main-flow:capture-demo-evidence'], 'capture-main-flow-demo-evidence.mjs', 'main-flow demo browser evidence capture script');
assertIncludes(packageJson.scripts['main-flow:capture-interactive-demo'], 'capture-main-flow-interactive-demo.mjs', 'main-flow interactive browser evidence capture script');
assertIncludes(mainFlowInteractiveCapture, 'main-flow-demo-interactive-mobile.png', 'main-flow mobile interactive evidence capture');
assertIncludes(mainFlowInteractiveCapture, 'Emulation.setDeviceMetricsOverride', 'main-flow mobile viewport evidence capture');
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
assertIncludes(mainFlowDemoHtml, '/role-workbenches.html', 'role workbench navigation');
assertIncludes(mainFlowDemoHtml, '角色复核', 'main-flow demo role evidence card');
assertIncludes(mainFlowDemoHtml, '分角色视图', 'main-flow demo role view card');
assertIncludes(mainFlowDemoHtml, '主流程证据', 'main-flow demo evidence card');
assertIncludes(mainFlowDemoHtml, '一键执行', 'main-flow demo run-all control');
assertIncludes(mainFlowDemoJs, 'main-flow-demo-seed.json', 'main-flow demo seed output');
assertIncludes(mainFlowDemoJs, 'main-flow-demo-run.json', 'main-flow demo evidence output');
assertIncludes(mainFlowDemoJs, 'roleEvidence', 'main-flow demo role evidence loader');
assertIncludes(mainFlowDemoJs, 'roleAccounts', 'main-flow demo role seed accounts');
assertIncludes(mainFlowDemoJs, 'renderRoleView', 'main-flow demo role view renderer');
assertIncludes(mainFlowDemoJs, '下一步工作台边界', 'main-flow demo role next-work boundary');
assertIncludes(mainFlowDemoJs, 'loadDemoEvidence', 'main-flow demo evidence loader');
assertIncludes(mainFlowDemoJs, 'runAll', 'main-flow demo run-all workflow');
assertIncludes(mainFlowDemoJs, '/purchase-requests', 'main-flow demo purchase request call');
assertIncludes(mainFlowDemoJs, '/shipments/', 'main-flow demo receipt call');

assertIncludes(roleWorkbenchesHtml, '角色工作台', 'role workbenches page');
assertIncludes(roleWorkbenchesHtml, '/role-workbenches.js', 'role workbenches script');
assertIncludes(roleWorkbenchesHtml, '门店、采购、供应商工作台', 'role workbenches heading');
assertIncludes(roleWorkbenchesHtml, 'id="role-lanes"', 'role workbenches lane grid');
assertIncludes(roleWorkbenchesHtml, 'id="role-detail"', 'role workbenches detail grid');
assertIncludes(roleWorkbenchesHtml, 'id="role-actions"', 'role workbenches real action panel');
assertIncludes(roleWorkbenchesHtml, 'id="evidence-map"', 'role workbenches evidence map');
assertIncludes(roleWorkbenchesJs, 'main-flow-demo-seed.json', 'role workbenches seed loader');
assertIncludes(roleWorkbenchesJs, 'main-flow-demo-run.json', 'role workbenches evidence loader');
assertIncludes(roleWorkbenchesJs, '/purchase-requests/preview', 'role workbenches store order preview');
assertIncludes(roleWorkbenchesJs, '/purchase-requests', 'role workbenches store order creation');
assertIncludes(roleWorkbenchesJs, '/confirm', 'role workbenches purchaser confirmation');
assertIncludes(roleWorkbenchesJs, '/shipment-preview', 'role workbenches supplier shipment preview');
assertIncludes(roleWorkbenchesJs, '/shipments', 'role workbenches supplier shipment creation');
assertIncludes(roleWorkbenchesJs, '/receipts', 'role workbenches store receipt creation');
assertIncludes(roleWorkbenchesJs, '/discrepancies/${discrepancyId}/resolve', 'role workbenches supplier discrepancy resolution');
assertIncludes(roleWorkbenchesJs, '/reject', 'role workbenches supplier rejection');
assertIncludes(roleWorkbenchesJs, '/reallocate', 'role workbenches purchaser rejection handling');
assertIncludes(roleWorkbenchesJs, 'secondarySupplierId', 'role workbenches multi-supplier reallocation');
assertIncludes(roleWorkbenchesJs, "action: 'REPLENISH'", 'role workbenches discrepancy replenishment branch');
assertIncludes(roleWorkbenchesJs, "action: 'RETURN'", 'role workbenches discrepancy return branch');
assertIncludes(roleWorkbenchesJs, 'store-order-action', 'role workbenches store action button');
assertIncludes(roleWorkbenchesJs, 'purchaser-confirm-action', 'role workbenches purchaser action button');
assertIncludes(roleWorkbenchesJs, 'supplier-shipment-action', 'role workbenches supplier shipment action button');
assertIncludes(roleWorkbenchesJs, 'store-receipt-action', 'role workbenches store receipt action button');
assertIncludes(roleWorkbenchesJs, 'supplier-discrepancy-action', 'role workbenches supplier discrepancy action button');
assertIncludes(roleWorkbenchesJs, 'supplier-rejection-action', 'role workbenches supplier rejection action button');
assertIncludes(roleWorkbenchesJs, 'supplier-discrepancy-branches-action', 'role workbenches supplier discrepancy branch action button');
assertIncludes(roleWorkbenchesJs, '门店工作台', 'role workbenches store lane');
assertIncludes(roleWorkbenchesJs, '采购工作台', 'role workbenches purchaser lane');
assertIncludes(roleWorkbenchesJs, '供应商工作台', 'role workbenches supplier lane');
assertIncludes(roleWorkbenchesJs, '下一步页面边界', 'role workbenches next page boundary');
assertIncludes(roleWorkbenchesJs, 'roleEvidence', 'role workbenches role evidence mapping');

assertIncludes(opsHtml, '运营与对账', 'W13 ops page');
assertIncludes(opsHtml, '/ops.js', 'W13 ops script');
assertIncludes(opsHtml, '/m6-readiness.html', 'M6 readiness navigation entry');
assertIncludes(opsHtml, 'id="issues"', 'R05 issue table');
assertIncludes(opsHtml, 'id="export-issues"', 'R05 issue CSV export action');
assertIncludes(opsHtml, 'id="export-health-summary"', 'DEV-505 export health summary');
assertIncludes(opsHtml, 'id="export-health-csv"', 'DEV-505 export health CSV action');
assertIncludes(opsHtml, 'id="notifications"', 'I08 notifications table');
assertIncludes(opsHtml, 'id="read-all-notifications"', 'I08 notification bulk read action');
assertIncludes(opsHtml, 'id="audit-logs"', 'DEV-504 audit log table');
assertIncludes(opsHtml, 'id="audit-filter-form"', 'DEV-504 audit filters');
assertIncludes(opsHtml, 'id="export-audit-logs"', 'DEV-504 audit CSV export action');
assertIncludes(opsJs, '/reconciliation-issues', 'R05 reconciliation endpoint');
assertIncludes(opsJs, 'procurex-reconciliation-issues-', 'R05 issue CSV export filename');
assertIncludes(opsJs, '/exports/health', 'DEV-505 export health endpoint');
assertIncludes(opsJs, 'procurex-export-health-', 'DEV-505 export health CSV filename');
assertIncludes(opsJs, '/notifications', 'I08 notifications endpoint');
assertIncludes(opsJs, '/notifications/read-all', 'I08 notification bulk read endpoint');
assertIncludes(opsJs, '/audit-logs', 'DEV-504 audit endpoint');
assertIncludes(opsJs, 'URLSearchParams', 'DEV-504 audit filter query');
assertIncludes(opsJs, 'procurex-audit-logs-', 'DEV-504 audit CSV export filename');
assertIncludes(opsJs, 'data-notification-read', 'I08 notification read action');
assertIncludes(opsJs, '超时处理中', 'DEV-505 stale export health label');
assertIncludes(opsJs, 'STORE_BALANCE_LEDGER_MISMATCH', 'R05 issue labels');

assertIncludes(m6Html, 'M6 上线准备', 'M6 readiness page');
assertIncludes(m6Html, '/m6-readiness.js', 'M6 readiness script');
assertIncludes(m6Html, 'id="readiness-status"', 'M6 readiness status label');
assertIncludes(m6Html, 'id="checks"', 'M6 readiness check list');
assertIncludes(m6Html, 'id="external-checks"', 'M6 external evidence check list');
assertIncludes(m6Js, 'm6-readiness.json', 'M6 readiness output loader');
assertIncludes(m6Js, 'm6-external-evidence.json', 'M6 external evidence output loader');
assertIncludes(m6Js, 'LOCAL_READY', 'M6 local-ready status rendering');
assertIncludes(m6Js, 'BLOCKED', 'M6 blocked status rendering');
assertIncludes(m6Js, 'docs/m6-evidence-templates/', 'M6 external evidence template fallback');
assertIncludes(m6ReadinessScript, 'WECHAT_APP_ID', 'M6 WeChat external dependency check');
assertIncludes(m6ReadinessScript, 'mini-flow-check.json', 'M6 mini-program flow evidence check');
assertIncludes(m6ReadinessScript, 'check-miniprogram-flow.mjs', 'M6 mini-program flow script evidence');
assertIncludes(m6ReadinessScript, 'm6-performance-report.json', 'M6 performance evidence check');
assertIncludes(m6ReadinessScript, 'check-m6-performance.mjs', 'M6 performance script evidence');
assertIncludes(m6ReadinessScript, 'm6-rollback-drill.json', 'M6 rollback evidence check');
assertIncludes(m6ReadinessScript, 'check-m6-rollback.mjs', 'M6 rollback script evidence');
assertIncludes(m6ReadinessScript, 'm6-initialization-signoff.json', 'M6 initialization evidence check');
assertIncludes(m6ReadinessScript, 'check-m6-initialization.mjs', 'M6 initialization script evidence');
assertIncludes(m6ReadinessScript, 'productionFinalSignoff', 'M6 initialization final signoff guard');
assertIncludes(m6ReadinessScript, 'm6-pilot-run.json', 'M6 pilot evidence check');
assertIncludes(m6ReadinessScript, 'check-m6-pilot.mjs', 'M6 pilot script evidence');
assertIncludes(m6ReadinessScript, 'customerPilot', 'M6 pilot final signoff guard');
assertIncludes(m6ReadinessScript, 'RPO<=15 minutes', 'M6 recovery target check');
assertIncludes(m6ReadinessScript, 'm6-readiness.json', 'M6 readiness output writer');

console.log('Web workbench check passed.');
