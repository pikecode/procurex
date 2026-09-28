import net from 'node:net';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';

const defaultUrl = 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const databaseUrl = process.env.DATABASE_URL ?? defaultUrl;
const parsedDb = new URL(databaseUrl);
const dbHost = parsedDb.hostname || '127.0.0.1';
const dbPort = Number(parsedDb.port || 5432);

function printLine(label, status, detail) {
  console.log(`${label.padEnd(30)} ${status.padEnd(9)} ${detail}`);
}

const checks = [];

function record(label, status, detail) {
  checks.push({ label, status, detail });
  printLine(label, status, detail);
}

function checkPort(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(1200);
    socket.on('connect', () => {
      socket.end();
      resolve({ ok: true });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, detail: `timeout at ${host}:${port}` });
    });
    socket.on('error', (error) => resolve({ ok: false, detail: error.message }));
  });
}

function checkDocker() {
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
  if (result.status === 0) return { ok: true, detail: result.stdout.trim() };
  return { ok: false, detail: (result.stderr || result.stdout || 'docker info failed').trim().split('\n')[0] };
}

async function findBrowser() {
  for (const path of [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Firefox.app/Contents/MacOS/firefox',
  ].filter(Boolean)) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // Try the next candidate.
    }
  }

  for (const command of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'firefox']) {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    if (result.status === 0) return result.stdout.trim();
  }
  return null;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function fileReady(path) {
  const fileStats = await stat(path).catch(() => null);
  return Boolean(fileStats?.size);
}

function acceptanceSummary(run) {
  if (!run) return null;
  const status = run.status || (run.passed === false ? 'FAILED' : 'PASSED');
  const steps = Array.isArray(run.steps) ? run.steps.length : 0;
  const failed = Array.isArray(run.steps) ? run.steps.filter((step) => step.status === 'FAILED' || step.passed === false).length : 0;
  return { status, steps, failed, generatedAt: run.generatedAt || run.finishedAt || run.startedAt || 'unknown time' };
}

console.log('M5 status report');
console.log('');

const docker = checkDocker();
record('Docker daemon', docker.ok ? 'READY' : 'BLOCKED', docker.ok ? `Docker ${docker.detail}` : `${docker.detail}; start Docker Desktop before DB-backed acceptance`);

const db = await checkPort(dbHost, dbPort);
record('Local database', db.ok ? 'READY' : 'BLOCKED', db.ok ? `${dbHost}:${dbPort}` : `${db.detail}; run npm run db:up after Docker starts`);

const browser = await findBrowser();
record('Browser runtime', browser ? 'READY' : 'MISSING', browser || 'Chrome/Chromium/Firefox needed for evidence capture');

const reportsRun = acceptanceSummary(await readJson('apps/web/reports-acceptance-run.json'));
record(
  'M5 browserless result',
  reportsRun ? reportsRun.status : 'MISSING',
  reportsRun ? `${reportsRun.steps} steps, ${reportsRun.failed} failed, ${reportsRun.generatedAt}` : 'run npm run acceptance:m5-browserless after DB is ready',
);

const reportManifest = await readJson('var/m5-browser-evidence/manifest.json');
const reportScreenshot = reportManifest?.screenshot || 'var/m5-browser-evidence/reports-dashboard.png';
record(
  'W11 browser evidence',
  reportManifest && await fileReady(reportScreenshot) ? 'READY' : 'MISSING',
  reportManifest ? reportScreenshot : 'run npm run m5:capture-browser-evidence after acceptance data exists',
);

const opsManifest = await readJson('var/m5-browser-evidence/ops-manifest.json');
const opsScreenshot = opsManifest?.screenshot || 'var/m5-browser-evidence/ops-reconciliation.png';
const opsState = opsManifest?.state || {};
record(
  'W13 browser evidence',
  opsManifest && await fileReady(opsScreenshot) ? 'READY' : 'MISSING',
  opsManifest ? `${opsScreenshot}; auditRows=${opsState.auditRows ?? 'n/a'}, notificationRows=${opsState.notificationRows ?? 'n/a'}, issueRows=${opsState.issueRows ?? 'n/a'}` : 'run npm run m5:capture-ops-evidence after acceptance data exists',
);

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const scripts = packageJson.scripts || {};
for (const [label, scriptName] of [
  ['M5 acceptance command', 'acceptance:m5-browserless'],
  ['W11 capture command', 'm5:capture-browser-evidence'],
  ['W13 capture command', 'm5:capture-ops-evidence'],
  ['Web visibility command', 'web:check'],
]) {
  record(label, scripts[scriptName] ? 'READY' : 'MISSING', scripts[scriptName] ? `npm run ${scriptName}` : `package script ${scriptName} missing`);
}

console.log('');
const summary = !db.ok
  ? 'M5 DB-backed acceptance is currently blocked by the local PostgreSQL/Docker environment, not by application code.'
  : 'Run npm run acceptance:m5-browserless, then refresh W11/W13 evidence with the m5 capture scripts.';
if (!db.ok) {
  console.log(summary);
} else {
  console.log(summary);
}

await mkdir('apps/web', { recursive: true });
await writeFile(
  'apps/web/m5-status.json',
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    summary,
    checks,
  }, null, 2)}\n`,
);
