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

const scripts = packageJson.scripts || {};
assert.ok(scripts['acceptance:m5-browserless']?.includes('notifications:check-acceptance'), 'M5 browserless command must include notification acceptance');
assert.ok(scripts['acceptance:m5-close']?.includes('m5:gate-status'), 'M5 close command must include m5:gate-status');

console.log('M5 gate status from local evidence');
console.log(`  Reports generated: ${reportsRun.generatedAt}`);
console.log(`  W11 evidence: ${w11Manifest.generatedAt}`);
console.log(`  W13 evidence: ${w13Manifest.generatedAt}`);
console.log(`  Main flow demo: ${mainFlowDemoRun.generatedAt}`);

record('DEV-501/502', 'R01-R03 reports and permission boundaries', 'READY', `${reportSteps.length} report/scope evidence steps passed`);
record('R04/W11', 'CSV export, task listing, and W11 browser evidence', 'READY', `job ${exportStep.data.jobId}; reportRows=${w11State.reportRows}; exportRows=${w11State.exportRows}`);
record('DEV-505', 'Export recovery, health visibility, and failed retry', 'READY', `stale job ${exportHealthStep.data.jobId}; retry job ${exportRetryStep.data.jobId}`);
record('R05/W13', 'Reconciliation issues and operations browser evidence', 'READY', `${reconciliationStep.data.issueCount} seeded issues; W13 rows=${w13State.issueRows}`);
record('DEV-503', 'In-app notification acceptance and business triggers', 'READY', `${demoSteps.filter((step) => step.title.includes('notification')).length} trigger evidence steps; W13 notificationRows=${w13State.notificationRows}`);
record('DEV-504', 'Audit log coverage and W13 visibility', 'READY', `${actions.size} audited action types; W13 auditRows=${w13State.auditRows}`);

const chromeReady = await executableReady(w11Manifest.browser) || await executableReady(w13Manifest.browser);
record('Browser', 'Chrome evidence runtime', chromeReady ? 'READY' : 'MISSING', w11Manifest.browser || w13Manifest.browser || 'browser path missing');

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
