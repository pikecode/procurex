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
  'var/main-flow-demo-evidence/interactive-manifest.json',
  'docs/m6-production-readiness.md',
  'docs/m6-wechat-device-evidence-guide.md',
  'docs/m6-external-evidence-templates.md',
];

const [
  readiness,
  externalEvidence,
  performance,
  rollback,
  initialization,
  pilot,
  browserManifest,
] = await Promise.all([
  readJson('apps/web/m6-readiness.json'),
  readJson('apps/web/m6-external-evidence.json'),
  readJson('var/m6-performance-report.json'),
  readJson('var/m6-rollback-drill.json'),
  readJson('var/m6-initialization-signoff.json'),
  readJson('var/m6-pilot-run.json'),
  readJson('var/m6-readiness-evidence/manifest.json'),
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
    'npm run m6:external-evidence',
    'npm run m6:check-external-templates',
    'npm run m6:readiness',
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
