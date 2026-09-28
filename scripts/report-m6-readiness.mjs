import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';

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
const perfReportReady = await fileExists('var/m6-performance-report.json');
add(
  'DEV-602-PERF',
  '性能与兼容压测',
  perfReportReady ? 'READY' : 'PLANNED',
  perfReportReady
    ? 'A performance evidence manifest exists for review.'
    : 'Need reproducible data scale, p50/p95/error-rate report, and export generation timing before production launch.',
  ['var/m6-performance-report.json'],
);
add(
  'DEV-602-BROWSER',
  '浏览器与移动视口证据',
  hasBrowser && mainFlowReady ? 'LOCAL_READY' : 'BLOCKED',
  hasBrowser && mainFlowReady
    ? 'Local Chrome desktop and 390px mobile viewport evidence is available; production device breadth remains open.'
    : 'Chrome/mobile viewport evidence is missing or stale.',
  ['var/main-flow-demo-evidence/main-flow-demo-interactive-mobile.png', 'var/main-flow-demo-evidence/role-workbenches-interactive-mobile.png'],
);
add(
  'DEV-602-WECHAT',
  '微信小程序真机与订阅消息',
  envReady(['WECHAT_APP_ID', 'WECHAT_TEST_ACCOUNT']) && await fileExists('var/m6-wechat-device-evidence/manifest.json') ? 'READY' : 'BLOCKED',
  envReady(['WECHAT_APP_ID', 'WECHAT_TEST_ACCOUNT'])
    ? 'WeChat identifiers are configured, but real-device evidence is still required unless the manifest exists.'
    : 'Missing WECHAT_APP_ID/WECHAT_TEST_ACCOUNT and real-device evidence; do not claim mini-program readiness from Web evidence.',
  ['var/m6-wechat-device-evidence/manifest.json'],
);

const productionEnvReady = envReady(['DATABASE_URL', 'PRIVATE_FILE_DIR', 'PUBLIC_API_BASE_URL']);
const storagePolicyReady = await fileExists('docs/m6-production-readiness.md');
add(
  'DEV-603-DEPLOY',
  '部署配置与生产环境',
  productionEnvReady ? 'READY' : 'BLOCKED',
  productionEnvReady
    ? 'Required production runtime endpoints are configured in the current environment.'
    : 'DATABASE_URL, PRIVATE_FILE_DIR, and PUBLIC_API_BASE_URL must point at production-grade services before launch.',
  ['.env.example', 'infra/compose/compose.yaml'],
);
add(
  'DEV-603-STORAGE',
  '对象存储与私有凭证策略',
  envReady(['PRIVATE_FILE_DIR']) && storagePolicyReady ? 'LOCAL_READY' : 'BLOCKED',
  envReady(['PRIVATE_FILE_DIR'])
    ? 'Private file path is configured; production object storage retention, access, and backup policy still need sign-off.'
    : 'PRIVATE_FILE_DIR/object storage policy is not configured for production.',
  ['docs/m6-production-readiness.md'],
);

const localRestoreEvidence =
  (await readFile('docs/progress.md', 'utf8')).includes('independent PostgreSQL backup/restore drill completed') &&
  (await readFile('docs/progress.md', 'utf8')).includes('private evidence file matched its source SHA-256');
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
  storagePolicyReady ? 'PLANNED' : 'BLOCKED',
  storagePolicyReady
    ? 'Production readiness document exists; it still needs environment-specific runbook values and drill evidence.'
    : 'Create a production readiness runbook before release review.',
  ['docs/m6-production-readiness.md'],
);

add(
  'DEV-604',
  '数据初始化与财务对平',
  await fileExists('var/m6-initialization-signoff.json') ? 'READY' : 'PLANNED',
  'Need cutoff date, source files, opening balances, uncleared payables/receivables, role bindings, and finance sign-off.',
  ['var/m6-initialization-signoff.json'],
);
add(
  'DEV-605',
  '试运行与交接',
  await fileExists('var/m6-pilot-run.json') ? 'READY' : 'PLANNED',
  'Need selected stores/suppliers, one recharge/clearing, one cross-period replenishment, one full statement cycle, issue closure, and handover.',
  ['var/m6-pilot-run.json'],
);

const readyCount = checks.filter((check) => check.status === 'READY').length;
const localReadyCount = checks.filter((check) => check.status === 'LOCAL_READY').length;
const blockedCount = checks.filter((check) => check.status === 'BLOCKED').length;
const plannedCount = checks.filter((check) => check.status === 'PLANNED').length;
const status = checks.every((check) => check.status === 'READY') ? 'READY' : 'NOT_READY';
const summary = status === 'READY'
  ? 'M6 production readiness evidence is complete.'
  : 'M6 is not production-ready yet; local product evidence is strong, but external WeChat, production environment, recovery, initialization, and pilot evidence remain open.';

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
