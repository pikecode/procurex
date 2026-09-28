import assert from 'node:assert/strict';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const gates = [];

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${error.message}`);
  }
}

async function fileReady(path) {
  const fileStats = await stat(path).catch(() => null);
  return Boolean(fileStats?.size);
}

async function executableReady(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function requireStep(run, matcher, label) {
  const step = (run.steps || []).find((candidate) => matcher(candidate.title, candidate.data || {}));
  assert.ok(step, `${label} evidence is missing from apps/web/reports-acceptance-run.json`);
  return step;
}

function record(id, title, status, detail) {
  gates.push({ id, title, status, detail });
  console.log(`  ${id.padEnd(12)} ${status.padEnd(8)} ${title}`);
  console.log(`              ${detail}`);
}

const reportsRun = await readJson('apps/web/reports-acceptance-run.json');
const w11Manifest = await readJson('var/m5-browser-evidence/manifest.json');
const w13Manifest = await readJson('var/m5-browser-evidence/ops-manifest.json');
const mainFlowDemoRun = await readJson('apps/web/main-flow-demo-run.json');
const mainFlowDemoManifest = await readJson('var/main-flow-demo-evidence/manifest.json');
const mainFlowInteractiveManifest = await readJson('var/main-flow-demo-evidence/interactive-manifest.json');
const packageJson = await readJson('package.json');

assert.equal(reportsRun.status, 'PASSED', 'M5 reports acceptance output must be PASSED');
assert.equal(mainFlowDemoRun.status, 'PASSED', 'Main flow demo notification/audit output must be PASSED');

const reportSteps = [
  requireStep(reportsRun, (title) => title.includes('R01'), 'R01 order amount'),
  requireStep(reportsRun, (title) => title.includes('R02 product quantities'), 'R02 product quantity'),
  requireStep(reportsRun, (title) => title.includes('R02 rejects'), 'R02 range guard'),
  requireStep(reportsRun, (title) => title.includes('R03'), 'R03 profit'),
  requireStep(reportsRun, (title) => title.includes('bound store scope'), 'report scope guard'),
  requireStep(reportsRun, (title) => title.includes('Supplier role cannot read profit'), 'supplier profit guard'),
];
const exportStep = requireStep(reportsRun, (title, data) => title.includes('R04') && data.status === 'READY', 'R04 export');
const exportHealthStep = requireStep(reportsRun, (title, data) => title.includes('DEV-505 export health') && data.status === 'READY', 'DEV-505 export recovery');
const exportRetryStep = requireStep(reportsRun, (title, data) => title.includes('DEV-505 failed export retries') && data.finalStatus === 'READY', 'DEV-505 failed retry');
const reconciliationStep = requireStep(reportsRun, (title, data) => title.includes('R05') && Number(data.issueCount) >= 2, 'R05 reconciliation');

const w11State = w11Manifest.state || {};
assert.equal(w11State.acceptanceStatus, 'PASSED', 'W11 manifest must show PASSED acceptance status');
assert.ok(Number(w11State.acceptanceSteps) >= 10, 'W11 manifest must show at least 10 acceptance steps');
assert.equal(w11State.m5StatusLabel, 'READY', 'W11 manifest must show M5 status READY');
assert.ok(Number(w11State.reportRows) >= 1, 'W11 manifest must show report rows');
assert.ok(Number(w11State.exportRows) >= 1, 'W11 manifest must show export rows');
assert.ok(await fileReady(w11Manifest.screenshot), 'W11 screenshot file must exist and be non-empty');

const w13State = w13Manifest.state || {};
assert.ok(w13State.hasBalanceIssue, 'W13 manifest must show balance reconciliation issue evidence');
assert.ok(w13State.hasCreditIssue, 'W13 manifest must show credit-used reconciliation issue evidence');
assert.ok(w13State.hasExportHealth, 'W13 manifest must show export health section');
assert.ok(w13State.hasNotification, 'W13 manifest must show notification section');
assert.ok(w13State.hasAuditTable, 'W13 manifest must show audit table');
assert.ok(Number(w13State.issueRows) >= 2, 'W13 manifest must show reconciliation issue rows');
assert.ok(Number(w13State.notificationRows) >= 1, 'W13 manifest must show notification rows');
assert.ok(Number(w13State.auditRows) >= 1, 'W13 manifest must show audit rows');
assert.ok(await fileReady(w13Manifest.screenshot), 'W13 screenshot file must exist and be non-empty');

const demoSteps = mainFlowDemoRun.steps || [];
const demoTitles = demoSteps.map((step) => step.title).join('\n');
for (const label of [
  'Store shipment notification',
  'Supplier receipt-discrepancy notification',
  'Store discrepancy-resolution notification',
  'Purchaser supplier-rejection notification',
  'audit actions',
  'payment preview',
]) {
  assert.ok(demoTitles.toLowerCase().includes(label.toLowerCase()), `${label} evidence is missing from apps/web/main-flow-demo-run.json`);
}

const auditStep = demoSteps.find((step) => step.title.includes('audit actions'));
const actions = new Set(auditStep?.data?.actions || []);
for (const action of [
  'purchase-request.create',
  'purchase-request.confirm',
  'supplier-order.shipment.create',
  'shipment.receipt.create',
  'discrepancy.resolve',
  'supplier-order.reject',
]) {
  assert.ok(actions.has(action), `Main flow demo audit evidence is missing ${action}`);
}

const mainFlowDemoState = mainFlowDemoManifest.state || {};
assert.equal(mainFlowDemoState.evidenceStatus, 'PASSED', 'Main-flow demo browser evidence must show PASSED status');
assert.ok(Number(mainFlowDemoState.evidenceRows) >= 6, 'Main-flow demo browser evidence must show at least 6 evidence rows');
assert.equal(mainFlowDemoState.roleStatus, 'PASSED', 'Main-flow demo browser evidence must show PASSED role status');
assert.ok(Number(mainFlowDemoState.roleRows) >= 4, 'Main-flow demo browser evidence must show at least 4 role rows');
assert.equal(mainFlowDemoState.roleViewStatus, 'PASSED', 'Main-flow demo browser evidence must show PASSED role view status');
assert.ok(Number(mainFlowDemoState.roleTabRows) >= 4, 'Main-flow demo browser evidence must show at least 4 role view tabs');
assert.ok(Number(mainFlowDemoState.roleDetailRows) >= 4, 'Main-flow demo browser evidence must show role detail rows');
assert.ok(mainFlowDemoState.hasRoleNextBoundary, 'Main-flow demo browser evidence must show next role workbench boundary');
assert.ok(mainFlowDemoState.hasOperatorRole, 'Main-flow demo browser evidence must show operator role evidence');
assert.ok(mainFlowDemoState.hasStoreRole, 'Main-flow demo browser evidence must show store role evidence');
assert.ok(mainFlowDemoState.hasSupplierRole, 'Main-flow demo browser evidence must show supplier role evidence');
assert.ok(mainFlowDemoState.hasPurchaserRole, 'Main-flow demo browser evidence must show purchaser role evidence');
assert.ok(Number(mainFlowDemoState.stepRows) >= 6, 'Main-flow demo browser evidence must show at least 6 operation rows');
assert.ok(mainFlowDemoState.hasShipmentNotification, 'Main-flow demo browser evidence must show shipment notification');
assert.ok(mainFlowDemoState.hasSupplierNotification, 'Main-flow demo browser evidence must show supplier discrepancy notification');
assert.ok(mainFlowDemoState.hasRejectionNotification, 'Main-flow demo browser evidence must show supplier rejection notification');
assert.ok(mainFlowDemoState.hasAuditEvidence, 'Main-flow demo browser evidence must show audit evidence');
assert.ok(await fileReady(mainFlowDemoManifest.screenshot), 'Main-flow demo screenshot file must exist and be non-empty');
const roleWorkbenchState = mainFlowDemoManifest.roleWorkbenchState || {};
assert.equal(roleWorkbenchState.status, 'PASSED', 'Role workbench browser evidence must show PASSED status');
assert.ok(Number(roleWorkbenchState.laneRows) >= 4, 'Role workbench browser evidence must show at least 4 role lanes');
assert.ok(Number(roleWorkbenchState.tabRows) >= 4, 'Role workbench browser evidence must show at least 4 role tabs');
assert.ok(Number(roleWorkbenchState.detailRows) >= 4, 'Role workbench browser evidence must show role detail panels');
assert.ok(Number(roleWorkbenchState.evidenceRows) >= 6, 'Role workbench browser evidence must show mapped main-flow evidence rows');
assert.ok(roleWorkbenchState.hasStoreWorkbench, 'Role workbench browser evidence must show store workbench');
assert.ok(roleWorkbenchState.hasPurchaserWorkbench, 'Role workbench browser evidence must show purchaser workbench');
assert.ok(roleWorkbenchState.hasSupplierWorkbench, 'Role workbench browser evidence must show supplier workbench');
assert.ok(roleWorkbenchState.hasOperatorWorkbench, 'Role workbench browser evidence must show operator workbench');
assert.ok(roleWorkbenchState.hasNextPageBoundary, 'Role workbench browser evidence must show next page boundary');
assert.ok(roleWorkbenchState.hasEvidenceMapping, 'Role workbench browser evidence must show main-flow evidence mapping');
assert.ok(roleWorkbenchState.hasStoreOrderAction, 'Role workbench browser evidence must show store order action');
assert.ok(roleWorkbenchState.hasPurchaserConfirmAction, 'Role workbench browser evidence must show purchaser confirm action');
assert.ok(roleWorkbenchState.hasSupplierShipmentAction, 'Role workbench browser evidence must show supplier shipment action');
assert.ok(roleWorkbenchState.hasStoreReceiptAction, 'Role workbench browser evidence must show store receipt action');
assert.ok(roleWorkbenchState.hasSupplierDiscrepancyAction, 'Role workbench browser evidence must show supplier discrepancy action');
assert.ok(roleWorkbenchState.hasSupplierRejectionAction, 'Role workbench browser evidence must show supplier rejection action');
assert.ok(roleWorkbenchState.hasSupplierDiscrepancyBranchesAction, 'Role workbench browser evidence must show supplier discrepancy replenishment/return action');
assert.ok(await fileReady(mainFlowDemoManifest.roleWorkbenchScreenshot), 'Role workbench screenshot file must exist and be non-empty');

const mainFlowInteractiveState = mainFlowInteractiveManifest.state || {};
assert.equal(Number(mainFlowInteractiveState.completedRows), 6, 'Interactive main-flow browser evidence must complete 6 rows');
assert.equal(Number(mainFlowInteractiveState.stepRows), 6, 'Interactive main-flow browser evidence must render 6 rows');
assert.ok(
  String(mainFlowInteractiveState.paymentPreviewText || '').includes('COMPANY_TO_SUPPLIER'),
  'Interactive main-flow browser evidence must reach COMPANY_TO_SUPPLIER preview',
);
assert.ok(
  String(mainFlowInteractiveState.paymentPreviewText || '').includes('¥90.00'),
  'Interactive main-flow browser evidence must show the expected ¥90.00 payment preview',
);
assert.equal(mainFlowInteractiveState.runAllText, '已完成', 'Interactive main-flow run-all control must finish');
assert.ok(await fileReady(mainFlowInteractiveManifest.screenshot), 'Interactive main-flow screenshot file must exist and be non-empty');
const mobileInteractive = mainFlowInteractiveManifest.viewports?.mobile || {};
const mobileInteractiveState = mobileInteractive.state || {};
assert.equal(Number(mobileInteractiveState.completedRows), 6, 'Mobile interactive main-flow evidence must complete 6 rows');
assert.equal(Number(mobileInteractiveState.stepRows), 6, 'Mobile interactive main-flow evidence must render 6 rows');
assert.equal(Number(mobileInteractiveState.viewportWidth), 390, 'Mobile interactive main-flow evidence must run at the expected narrow viewport');
assert.equal(mobileInteractiveState.horizontalOverflow, false, 'Mobile interactive main-flow page must not create page-level horizontal overflow');
assert.ok(
  String(mobileInteractiveState.paymentPreviewText || '').includes('COMPANY_TO_SUPPLIER'),
  'Mobile interactive main-flow evidence must reach COMPANY_TO_SUPPLIER preview',
);
assert.ok(
  String(mobileInteractiveState.paymentPreviewText || '').includes('¥90.00'),
  'Mobile interactive main-flow evidence must show the expected ¥90.00 payment preview',
);
assert.equal(mobileInteractiveState.runAllText, '已完成', 'Mobile interactive main-flow run-all control must finish');
assert.ok(await fileReady(mainFlowInteractiveManifest.mobileScreenshot), 'Mobile interactive main-flow screenshot file must exist and be non-empty');
const roleWorkbenchAction = mainFlowInteractiveManifest.roleWorkbenchAction || {};
assert.equal(roleWorkbenchAction.status, 'BRANCHES_READY', 'Role workbench discrepancy branches action must cover replenishment and return');
assert.ok(roleWorkbenchAction.hasRequestNo, 'Role workbench store action must show the created purchase request number');
assert.ok(roleWorkbenchAction.hasPaidStatus, 'Role workbench store action must show the paid funding status');
assert.ok(roleWorkbenchAction.hasSupplierOrderId, 'Role workbench purchaser action must show a generated supplier order id');
assert.ok(roleWorkbenchAction.hasShipmentNo, 'Role workbench supplier action must show a generated shipment number');
assert.ok(roleWorkbenchAction.hasReceiptNo, 'Role workbench store receipt action must show a generated receipt number');
assert.ok(roleWorkbenchAction.hasResolvedDiscrepancy, 'Role workbench supplier discrepancy action must resolve a short receipt discrepancy');
assert.ok(roleWorkbenchAction.hasReallocatedRejection, 'Role workbench purchaser rejection action must handle the rejected supplier order');
assert.ok(roleWorkbenchAction.hasDiscrepancyBranches, 'Role workbench discrepancy branch action must show replenishment and return evidence');
assert.equal(roleWorkbenchAction.horizontalOverflow, false, 'Role workbench store action page must not create page-level horizontal overflow');
assert.ok(await fileReady(mainFlowInteractiveManifest.roleWorkbenchActionScreenshot), 'Role workbench action screenshot file must exist and be non-empty');

const scripts = packageJson.scripts || {};
assert.ok(scripts['acceptance:m5-browserless']?.includes('notifications:check-acceptance'), 'M5 browserless command must include notification acceptance');
assert.ok(scripts['acceptance:m5-close']?.includes('main-flow:capture-demo-evidence'), 'M5 close command must refresh main-flow demo browser evidence');
assert.ok(scripts['acceptance:m5-close']?.includes('main-flow:capture-interactive-demo'), 'M5 close command must run the interactive main-flow browser demo');
assert.ok(scripts['acceptance:m5-close']?.includes('m5:gate-status'), 'M5 close command must include m5:gate-status');

console.log('M5 gate status from local evidence');
console.log(`  Reports generated: ${reportsRun.generatedAt}`);
console.log(`  W11 evidence: ${w11Manifest.generatedAt}`);
console.log(`  W13 evidence: ${w13Manifest.generatedAt}`);
console.log(`  Main flow demo: ${mainFlowDemoRun.generatedAt}`);
console.log(`  Main flow browser evidence: ${mainFlowDemoManifest.generatedAt}`);
console.log(`  Main flow interactive evidence: ${mainFlowInteractiveManifest.generatedAt}`);

record('DEV-501/502', 'R01-R03 reports and permission boundaries', 'READY', `${reportSteps.length} report/scope evidence steps passed`);
record('R04/W11', 'CSV export, task listing, and W11 browser evidence', 'READY', `job ${exportStep.data.jobId}; reportRows=${w11State.reportRows}; exportRows=${w11State.exportRows}`);
record('DEV-505', 'Export recovery, health visibility, and failed retry', 'READY', `stale job ${exportHealthStep.data.jobId}; retry job ${exportRetryStep.data.jobId}`);
record('R05/W13', 'Reconciliation issues and operations browser evidence', 'READY', `${reconciliationStep.data.issueCount} seeded issues; W13 rows=${w13State.issueRows}`);
record('DEV-503', 'In-app notification acceptance and business triggers', 'READY', `${demoSteps.filter((step) => step.title.includes('notification')).length} trigger evidence steps; W13 notificationRows=${w13State.notificationRows}`);
record('DEV-504', 'Audit log coverage and W13 visibility', 'READY', `${actions.size} audited action types; W13 auditRows=${w13State.auditRows}`);
record('MainFlowUI', 'Browser-visible main-flow notification and audit evidence', 'READY', `${mainFlowDemoState.roleRows} role rows; ${mainFlowDemoState.roleTabRows} role tabs; ${roleWorkbenchState.laneRows} role workbench lanes; ${mainFlowDemoState.evidenceRows} evidence rows; ${mainFlowDemoState.stepRows} operation rows`);
record('MainFlowRun', 'Browser-executed order-to-payment demo', 'READY', `desktop ${mainFlowInteractiveState.completedRows}/${mainFlowInteractiveState.stepRows}, mobile ${mobileInteractiveState.completedRows}/${mobileInteractiveState.stepRows}; role workbench ${roleWorkbenchAction.status}; COMPANY_TO_SUPPLIER ¥90.00`);

const chromeReady = await executableReady(w11Manifest.browser) || await executableReady(w13Manifest.browser) || await executableReady(mainFlowDemoManifest.browser) || await executableReady(mainFlowInteractiveManifest.browser);
record('Browser', 'Chrome evidence runtime', chromeReady ? 'READY' : 'MISSING', w11Manifest.browser || w13Manifest.browser || mainFlowDemoManifest.browser || mainFlowInteractiveManifest.browser || 'browser path missing');

const summary = 'M5 local close evidence is ready for review; remaining product gaps are broader browser/mobile acceptance, WeChat adaptation, and production operations policy in M6.';
console.log('');
console.log(summary);

await mkdir('apps/web', { recursive: true });
await writeFile(
  'apps/web/m5-gate-status.json',
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    summary,
    gates,
  }, null, 2)}\n`,
);
