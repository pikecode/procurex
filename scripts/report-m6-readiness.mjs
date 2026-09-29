import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { validateWechatDeviceEvidence } from './m6-wechat-evidence-lib.mjs';

const strict = process.argv.includes('--strict');
const checks = [];

async function fileExists(path) {
  try {
    const fileStats = await stat(path);
    return fileStats.size > 0;
  } catch {
    return false;
  }
}

async function executableExists(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function envReady(names) {
  return names.every((name) => Boolean(process.env[name]));
}

function envValue(name) {
  return process.env[name] || '';
}

function notLocalDatabase(value) {
  return Boolean(value) && !value.includes('127.0.0.1') && !value.includes('localhost') && !value.includes('procurex_local_only');
}

function notLocalFileDir(value) {
  return Boolean(value) && !value.startsWith('var/') && !value.includes('/var/private-files');
}

function productionHttpsUrl(value) {
  return /^https:\/\/[^/]+/.test(value) && !value.includes('example.com');
}

function add(id, title, status, detail, evidence = []) {
  checks.push({ id, title, status, detail, evidence });
}

const m5Gate = await readJson('apps/web/m5-gate-status.json');
const interactive = await readJson('var/main-flow-demo-evidence/interactive-manifest.json');
const m5GatesReady = (m5Gate?.gates || []).length > 0 && (m5Gate.gates || []).every((gate) => gate.status === 'READY');
const mainFlowReady =
  interactive?.state?.completedRows === 6 &&
  interactive?.viewports?.mobile?.state?.completedRows === 6 &&
  interactive?.roleWorkbenchAction?.status === 'BRANCHES_READY' &&
  interactive?.mobileRoleWorkbenchAction?.status === 'BRANCHES_READY';

add(
  'DEV-601',
  '全场景回归证据',
  m5GatesReady && mainFlowReady ? 'READY' : 'BLOCKED',
  m5GatesReady && mainFlowReady
    ? 'M5 close gate and desktop/mobile main-flow plus role-workbench evidence are present.'
    : 'Run npm run acceptance:m5-close before starting M6 customer acceptance.',
  ['apps/web/m5-gate-status.json', 'var/main-flow-demo-evidence/interactive-manifest.json'],
);

const browserReady = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
let hasBrowser = false;
for (const candidate of browserReady) {
  if (await executableExists(candidate)) hasBrowser = true;
}
const perfReport = await readJson('var/m6-performance-report.json');
const perfReportReady = perfReport?.status === 'LOCAL_READY';
const miniFlow = await readJson('apps/miniprogram/mini-flow-check.json');
const miniFlowReady = miniFlow?.status === 'PASSED' && (miniFlow.coveredEndpoints || []).length >= 20;
add(
  'DEV-602-PERF',
  '性能与兼容压测',
  perfReportReady ? 'LOCAL_READY' : 'PLANNED',
  perfReportReady
    ? 'Local list/report/export performance evidence exists with p50/p95/error-rate and export timing; production-scale load evidence is still required.'
    : 'Need reproducible data scale, p50/p95/error-rate report, and export generation timing before production launch.',
  ['scripts/check-m6-performance.mjs', 'var/m6-performance-report.json'],
);
add(
  'DEV-602-BROWSER',
  '浏览器与移动视口证据',
  hasBrowser && mainFlowReady ? 'LOCAL_READY' : 'BLOCKED',
  hasBrowser && mainFlowReady
    ? 'Local Chrome desktop and 390px mobile viewport evidence is available; production device breadth remains open.'
    : 'Chrome/mobile viewport evidence is missing or stale.',
  ['var/main-flow-demo-evidence/main-flow-demo-interactive-mobile.png', 'var/main-flow-demo-evidence/role-workbenches-interactive-mobile.png', 'var/m6-readiness-evidence/manifest.json'],
);
add(
  'DEV-602-MINI',
  '小程序产品端与真实 API 流',
  miniFlowReady ? 'LOCAL_READY' : await fileExists('apps/miniprogram/app.json') ? 'PLANNED' : 'BLOCKED',
  miniFlowReady
    ? 'Native Store/Purchaser/Supplier mini-program role APIs pass the local HTTP flow check; real-device WeChat acceptance remains open.'
    : await fileExists('apps/miniprogram/app.json')
      ? 'Native mini-program role pages exist, but npm run mini:flow-check must pass before local product-client readiness is claimed.'
      : 'Mini-program product-client pages have not been created yet.',
  ['apps/miniprogram/app.json', 'scripts/check-miniprogram-surface.mjs', 'scripts/check-miniprogram-flow.mjs', 'apps/miniprogram/mini-flow-check.json'],
);
const wechatDeviceEvidence = await validateWechatDeviceEvidence(await readJson('var/m6-wechat-device-evidence/manifest.json'), envValue('WECHAT_APP_ID'));
add(
  'DEV-602-WECHAT',
  '微信小程序真机与订阅消息',
  envReady(['WECHAT_APP_ID', 'WECHAT_TEST_ACCOUNT']) && wechatDeviceEvidence.ready ? 'READY' : 'BLOCKED',
  envReady(['WECHAT_APP_ID', 'WECHAT_TEST_ACCOUNT'])
    ? 'WeChat identifiers are configured, but the real-device manifest must include device, flow, screenshot or recording, subscription-message, and sign-off evidence.'
    : 'Missing WECHAT_APP_ID/WECHAT_TEST_ACCOUNT and real-device evidence; do not claim mini-program readiness from Web evidence.',
  ['var/m6-wechat-device-evidence/manifest.json'],
);

const productionEnvReady =
  notLocalDatabase(envValue('DATABASE_URL')) &&
  notLocalFileDir(envValue('PRIVATE_FILE_DIR')) &&
  productionHttpsUrl(envValue('PUBLIC_API_BASE_URL'));
const productionRuntime = await readJson('var/m6-production-runtime.json');
const readinessRunbookExists = await fileExists('docs/m6-production-readiness.md');
const storagePolicy = await readJson('var/m6-production-storage-policy.json');
const storagePolicyReady = storagePolicy?.status === 'READY' && storagePolicy?.signed === true;
add(
  'DEV-603-DEPLOY',
  '部署配置与生产环境',
  productionRuntime?.status === 'READY' && productionEnvReady ? 'READY' : 'BLOCKED',
  productionRuntime?.status === 'READY' && productionEnvReady
    ? 'Production runtime preflight and current env vars are ready for launch review.'
    : 'Run npm run m6:check-production-runtime with production DATABASE_URL, PRIVATE_FILE_DIR, PUBLIC_API_BASE_URL, NODE_ENV, HOST, and PORT; localhost, local private-file paths, and example domains do not count.',
  ['docs/m6-production-runtime-guide.md', 'var/m6-production-runtime.json', '.env.example', 'infra/compose/compose.yaml'],
);
add(
  'DEV-603-STORAGE',
  '对象存储与私有凭证策略',
  storagePolicyReady ? 'READY' : 'BLOCKED',
  storagePolicyReady
    ? 'Signed production object storage/private evidence policy passed the storage-policy preflight.'
    : 'Run npm run m6:check-storage-policy with signed retention, access-control, backup, restore, and evidence-download policy; a local PRIVATE_FILE_DIR is not enough.',
  ['docs/m6-storage-policy-guide.md', 'var/m6-production-storage-policy.json'],
);

const localRestoreEvidence =
  (await readFile('docs/progress.md', 'utf8')).includes('independent PostgreSQL backup/restore drill completed') &&
  (await readFile('docs/progress.md', 'utf8')).includes('private evidence file matched its source SHA-256');
const rollbackDrill = await readJson('var/m6-rollback-drill.json');
const rollbackReady = rollbackDrill?.status === 'LOCAL_READY';
add(
  'DEV-603-RECOVERY',
  '备份恢复与 RPO/RTO',
  localRestoreEvidence ? 'LOCAL_READY' : 'BLOCKED',
  localRestoreEvidence
    ? 'Local database/private-file restore evidence exists; production drill must still prove RPO<=15 minutes and RTO<=4 hours.'
    : 'Local restore evidence is missing.',
  ['docs/progress.md', 'docs/m6-production-readiness.md'],
);
add(
  'DEV-603-ROLLBACK',
  '发布、迁移与回滚手册',
  rollbackReady ? 'LOCAL_READY' : readinessRunbookExists ? 'PLANNED' : 'BLOCKED',
  rollbackReady
    ? 'Local migration status, required release scripts, rollback runbook text, and rollback checklist evidence exist; production rehearsal is still required.'
    : readinessRunbookExists
      ? 'Production readiness document exists; run npm run m6:rollback-check to create local rollback evidence.'
      : 'Create a production readiness runbook before release review.',
  ['docs/m6-production-readiness.md', 'scripts/check-m6-rollback.mjs', 'var/m6-rollback-drill.json'],
);

const initializationSignoff = await readJson('var/m6-initialization-signoff.json');
const initializationReady = initializationSignoff?.status === 'READY' && initializationSignoff?.productionFinalSignoff?.signed === true;
const initializationLocalReady = initializationSignoff?.status === 'LOCAL_READY';
add(
  'DEV-604',
  '数据初始化与财务对平',
  initializationReady ? 'READY' : initializationLocalReady ? 'LOCAL_READY' : 'PLANNED',
  initializationReady
    ? 'Customer cutoff date, source files, opening balances, uncleared payables/receivables, role bindings, and finance sign-off are complete.'
    : initializationLocalReady
      ? 'Local initialization inventory and finance reconciliation checks pass; customer source files and finance sign-off are still required.'
      : 'Run npm run m6:initialization-check, then collect customer cutoff date, source files, opening balances, uncleared payables/receivables, role bindings, and finance sign-off.',
  ['scripts/check-m6-initialization.mjs', 'var/m6-initialization-signoff.json'],
);
const pilotRun = await readJson('var/m6-pilot-run.json');
const pilotReady = pilotRun?.status === 'READY' && pilotRun?.customerPilot?.signed === true;
const pilotLocalReady = pilotRun?.status === 'LOCAL_READY';
add(
  'DEV-605',
  '试运行与交接',
  pilotReady ? 'READY' : pilotLocalReady ? 'LOCAL_READY' : 'PLANNED',
  pilotReady
    ? 'Customer pilot stores/suppliers, recharge/clearing, cross-period replenishment, statement cycle, issue closure, and handover are complete.'
    : pilotLocalReady
      ? 'Local pilot rehearsal evidence is complete; real customer pilot participants, handover, and sign-off are still required.'
      : 'Run npm run m6:pilot-check, then complete selected stores/suppliers, one recharge/clearing, one cross-period replenishment, one full statement cycle, issue closure, and handover.',
  ['scripts/check-m6-pilot.mjs', 'var/m6-pilot-run.json'],
);

const readyCount = checks.filter((check) => check.status === 'READY').length;
const localReadyCount = checks.filter((check) => check.status === 'LOCAL_READY').length;
const blockedCount = checks.filter((check) => check.status === 'BLOCKED').length;
const plannedCount = checks.filter((check) => check.status === 'PLANNED').length;
const status = checks.every((check) => check.status === 'READY') ? 'READY' : 'NOT_READY';
const summary = status === 'READY'
  ? 'M6 production readiness evidence is complete.'
  : 'M6 is not production-ready yet; local product evidence is strong, but external WeChat, production environment, recovery, customer finance sign-off, customer pilot, and handover evidence remain open.';

console.log('M6 production readiness');
console.log(`  Status: ${status}`);
console.log(`  READY ${readyCount}, LOCAL_READY ${localReadyCount}, BLOCKED ${blockedCount}, PLANNED ${plannedCount}`);
for (const check of checks) {
  console.log(`  ${check.id.padEnd(15)} ${check.status.padEnd(11)} ${check.title}`);
  console.log(`                  ${check.detail}`);
}

await mkdir('apps/web', { recursive: true });
await writeFile(
  'apps/web/m6-readiness.json',
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    status,
    summary,
    counts: { ready: readyCount, localReady: localReadyCount, blocked: blockedCount, planned: plannedCount },
    checks,
  }, null, 2)}\n`,
);

if (strict && status !== 'READY') {
  process.exitCode = 1;
}
