import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function fileDigest(path) {
  try {
    const content = await readFile(path);
    const fileStats = await stat(path);
    return {
      path,
      exists: true,
      sizeBytes: fileStats.size,
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  } catch {
    return { path, exists: false, sizeBytes: 0, sha256: null };
  }
}

async function gitValue(args, fallback = null) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return fallback;
  }
}

const evidenceFiles = [
  'apps/web/m6-readiness.json',
  'apps/web/m6-external-evidence.json',
  'var/m6-external-evidence.json',
  'var/m6-performance-report.json',
  'var/m6-rollback-drill.json',
  'var/m6-initialization-signoff.json',
  'var/m6-pilot-run.json',
  'var/m6-readiness-evidence/manifest.json',
  'var/m6-readiness-evidence/m6-readiness-desktop.png',
  'var/m6-readiness-evidence/m6-readiness-mobile.png',
  'apps/miniprogram/mini-flow-check.json',
  'apps/web/m5-gate-status.json',
  'apps/web/app.html',
  'apps/web/product-app/main.js',
  'apps/web/product-app/api.js',
  'apps/web/product-app/shell.js',
  'apps/web/product-app/pages/overview.js',
  'apps/web/product-app/pages/flow.js',
  'apps/web/product-app/pages/store.js',
  'apps/web/product-app/pages/purchaser.js',
  'apps/web/product-app/pages/supplier.js',
  'apps/web/product-app/pages/finance.js',
  'apps/web/store-workbench.html',
  'apps/web/store-workbench.js',
  'apps/web/purchaser-workbench.html',
  'apps/web/purchaser-workbench.js',
  'apps/web/supplier-workbench.html',
  'apps/web/supplier-workbench.js',
  'apps/web/m7-business-flow.html',
  'apps/web/m7-business-flow.js',
  'var/main-flow-demo-evidence/interactive-manifest.json',
  'var/main-flow-demo-evidence/store-workbench.png',
  'var/main-flow-demo-evidence/store-workbench-mobile.png',
  'var/main-flow-demo-evidence/purchaser-workbench.png',
  'var/main-flow-demo-evidence/purchaser-workbench-mobile.png',
  'var/main-flow-demo-evidence/supplier-workbench.png',
  'var/main-flow-demo-evidence/supplier-workbench-mobile.png',
  'var/main-flow-demo-evidence/product-app.png',
  'var/main-flow-demo-evidence/product-app-mobile.png',
  'var/main-flow-demo-evidence/product-app-store.png',
  'var/main-flow-demo-evidence/product-app-purchaser.png',
  'var/main-flow-demo-evidence/product-app-supplier.png',
  'var/main-flow-demo-evidence/product-app-finance.png',
  'var/main-flow-demo-evidence/product-app-flow-action.png',
  'var/main-flow-demo-evidence/m7-business-flow.png',
  'var/main-flow-demo-evidence/m7-business-flow-mobile.png',
  'docs/m6-production-readiness.md',
  'docs/m6-wechat-device-evidence-guide.md',
  'docs/m6-production-runtime-guide.md',
  'docs/m6-storage-policy-guide.md',
  'docs/m6-external-evidence-templates.md',
  'var/m6-production-runtime.json',
  'var/m6-production-storage-policy.json',
];

const [
  readiness,
  externalEvidence,
  performance,
  rollback,
  initialization,
  pilot,
  browserManifest,
  interactiveManifest,
] = await Promise.all([
  readJson('apps/web/m6-readiness.json'),
  readJson('apps/web/m6-external-evidence.json'),
  readJson('var/m6-performance-report.json'),
  readJson('var/m6-rollback-drill.json'),
  readJson('var/m6-initialization-signoff.json'),
  readJson('var/m6-pilot-run.json'),
  readJson('var/m6-readiness-evidence/manifest.json'),
  readJson('var/main-flow-demo-evidence/interactive-manifest.json'),
]);

const files = await Promise.all(evidenceFiles.map((path) => fileDigest(path)));
const missingFiles = files.filter((file) => !file.exists).map((file) => file.path);
const dirtyStatus = await gitValue(['status', '--short'], '');
const commit = await gitValue(['rev-parse', 'HEAD']);
const branch = await gitValue(['branch', '--show-current']);
const remote = await gitValue(['remote', 'get-url', 'origin']);

const requiredStatuses = [
  ['readiness', readiness?.status === 'NOT_READY' && readiness?.counts?.ready === 1 && readiness?.counts?.localReady >= 7],
  ['externalEvidence', externalEvidence?.status === 'BLOCKED'],
  ['performance', performance?.status === 'LOCAL_READY'],
  ['rollback', rollback?.status === 'LOCAL_READY'],
  ['initialization', initialization?.status === 'LOCAL_READY'],
  ['pilot', pilot?.status === 'LOCAL_READY'],
  ['browserEvidenceDesktop', browserManifest?.desktop?.state?.readinessRows >= 11 && browserManifest?.desktop?.state?.externalRows >= 6],
  ['browserEvidenceMobile', browserManifest?.mobile?.state?.readinessRows >= 11 && browserManifest?.mobile?.state?.externalRows >= 6],
  ['businessFlowDesktop', interactiveManifest?.businessFlow?.stageRows >= 5 && interactiveManifest?.businessFlow?.financeRows >= 4],
  ['businessFlowMobile', interactiveManifest?.mobileBusinessFlow?.stageRows >= 5 && interactiveManifest?.mobileBusinessFlow?.financeRows >= 4],
  ['storeWorkbenchDesktop', interactiveManifest?.storeWorkbench?.status === 'READY' && interactiveManifest?.storeWorkbench?.summaryRows >= 4 && interactiveManifest?.storeWorkbench?.accountRows >= 4],
  ['storeWorkbenchMobile', interactiveManifest?.mobileStoreWorkbench?.status === 'READY' && interactiveManifest?.mobileStoreWorkbench?.summaryRows >= 4 && interactiveManifest?.mobileStoreWorkbench?.accountRows >= 4],
  ['purchaserWorkbenchDesktop', interactiveManifest?.purchaserWorkbench?.status === 'READY' && interactiveManifest?.purchaserWorkbench?.summaryRows >= 4 && interactiveManifest?.purchaserWorkbench?.requestRows >= 1],
  ['purchaserWorkbenchMobile', interactiveManifest?.mobilePurchaserWorkbench?.status === 'READY' && interactiveManifest?.mobilePurchaserWorkbench?.summaryRows >= 4 && interactiveManifest?.mobilePurchaserWorkbench?.requestRows >= 1],
  ['supplierWorkbenchDesktop', interactiveManifest?.supplierWorkbench?.status === 'READY' && interactiveManifest?.supplierWorkbench?.summaryRows >= 4 && interactiveManifest?.supplierWorkbench?.orderRows >= 1],
  ['supplierWorkbenchMobile', interactiveManifest?.mobileSupplierWorkbench?.status === 'READY' && interactiveManifest?.mobileSupplierWorkbench?.summaryRows >= 4 && interactiveManifest?.mobileSupplierWorkbench?.orderRows >= 1],
  ['productAppDesktop', ['READY', 'PASSED'].includes(interactiveManifest?.productApp?.status) && interactiveManifest?.productApp?.metricRows >= 4],
  ['productAppMobile', ['READY', 'PASSED'].includes(interactiveManifest?.mobileProductApp?.status) && interactiveManifest?.mobileProductApp?.metricRows >= 4],
  ['productAppRoutes', interactiveManifest?.productAppStore?.status === 'READY' && interactiveManifest?.productAppPurchaser?.status === 'READY' && interactiveManifest?.productAppSupplier?.status === 'READY' && interactiveManifest?.productAppFinance?.status === 'READY'],
  ['productAppFlowAction', interactiveManifest?.productAppFlowAction?.status === 'COMPLETED' && interactiveManifest?.productAppFlowAction?.resultRows >= 4],
  ['productAppExceptionAction', interactiveManifest?.productAppExceptionAction?.status === 'BRANCHES_READY' && interactiveManifest?.productAppExceptionAction?.resultRows >= 4],
];
const failedStatusChecks = requiredStatuses.filter(([, passed]) => !passed).map(([name]) => name);
const status = missingFiles.length === 0 && failedStatusChecks.length === 0 ? 'LOCAL_READY' : 'BLOCKED';

const result = {
  generatedAt: new Date().toISOString(),
  title: 'M6 Local Evidence Package',
  status,
  summary: status === 'LOCAL_READY'
    ? 'All expected local M6 evidence artifacts are present and internally consistent; external launch evidence remains separate.'
    : 'One or more expected local M6 evidence artifacts or status checks are missing.',
  git: {
    branch,
    commit,
    remote,
    dirty: dirtyStatus.length > 0,
    dirtyStatus: dirtyStatus.split('\n').filter(Boolean),
  },
  commands: [
    'npm run m6:performance',
    'npm run m6:rollback-check',
    'npm run m6:initialization-check',
    'npm run m6:pilot-check',
    'npm run m6:prepare-wechat-evidence',
    'npm run m6:check-wechat-evidence',
    'npm run m6:check-production-runtime',
    'npm run m6:check-storage-policy',
    'npm run m6:external-evidence',
    'npm run m6:check-external-templates',
    'npm run m6:readiness',
    'npm run main-flow:capture-interactive-demo',
    'npm run m6:capture-readiness-evidence',
  ],
  readiness: {
    status: readiness?.status ?? 'MISSING',
    counts: readiness?.counts ?? null,
  },
  externalEvidence: {
    status: externalEvidence?.status ?? 'MISSING',
    blocked: (externalEvidence?.checks || []).filter((check) => check.status === 'BLOCKED').map((check) => check.id),
  },
  localEvidence: {
    performance: performance?.status ?? 'MISSING',
    rollback: rollback?.status ?? 'MISSING',
    initialization: initialization?.status ?? 'MISSING',
    pilot: pilot?.status ?? 'MISSING',
    browserEvidence: {
      desktopRows: browserManifest?.desktop?.state?.readinessRows ?? 0,
      desktopExternalRows: browserManifest?.desktop?.state?.externalRows ?? 0,
      mobileRows: browserManifest?.mobile?.state?.readinessRows ?? 0,
      mobileExternalRows: browserManifest?.mobile?.state?.externalRows ?? 0,
      desktopOverflow: browserManifest?.desktop?.state?.horizontalOverflow ?? null,
      mobileOverflow: browserManifest?.mobile?.state?.horizontalOverflow ?? null,
    },
  },
  files,
  missingFiles,
  failedStatusChecks,
};

await mkdir('var', { recursive: true });
await mkdir('apps/web', { recursive: true });
await writeFile('var/m6-local-evidence-package.json', `${JSON.stringify(result, null, 2)}\n`);
await writeFile('apps/web/m6-local-evidence-package.json', `${JSON.stringify(result, null, 2)}\n`);

console.log('M6 local evidence package written.');
console.log(`  Status: ${status}`);
console.log(`  Commit: ${commit}`);
console.log(`  Evidence files: ${files.filter((file) => file.exists).length}/${files.length}`);
console.log('  Wrote: var/m6-local-evidence-package.json');
console.log('  Wrote: apps/web/m6-local-evidence-package.json');
if (status !== 'LOCAL_READY') process.exitCode = 1;
