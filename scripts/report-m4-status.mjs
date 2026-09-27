import net from 'node:net';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';

const defaultUrl = 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const databaseUrl = process.env.DATABASE_URL ?? defaultUrl;
const parsedDb = new URL(databaseUrl);
const dbHost = parsedDb.hostname || '127.0.0.1';
const dbPort = Number(parsedDb.port || 5432);

function printLine(label, status, detail) {
  console.log(`${label.padEnd(28)} ${status.padEnd(9)} ${detail}`);
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

async function fileExists(path) {
  const fileStats = await stat(path).catch(() => null);
  return Boolean(fileStats?.size);
}

console.log('M4 status report');
console.log('');

const browser = await findBrowser();
printLine('Browser runtime', browser ? 'READY' : 'MISSING', browser || 'run npm run m4:check-browser-runtime');

const db = await checkPort(dbHost, dbPort);
printLine('Local database', db.ok ? 'READY' : 'BLOCKED', db.ok ? `${dbHost}:${dbPort}` : `${db.detail}; run npm run db:up after Docker starts`);

const billing = await readJson('apps/web/billing-acceptance-run.json');
const gates = await readJson('apps/web/m4-gates.json');
if (!billing || !gates) {
  printLine('Automatic M4 evidence', 'MISSING', 'run npm run acceptance:m4-browserless after DB is ready');
} else {
  const evidenceByGate = new Map();
  for (const step of billing.steps || []) {
    for (const gate of step.gates || []) {
      if (!evidenceByGate.has(gate.gateId)) evidenceByGate.set(gate.gateId, new Set());
      evidenceByGate.get(gate.gateId).add(gate.evidenceId);
    }
  }
  for (const gate of gates) {
    const passed = evidenceByGate.get(gate.id) || new Set();
    const count = gate.autoEvidence.filter(([id]) => passed.has(id)).length;
    printLine(`${gate.id} automatic evidence`, count === gate.autoEvidence.length ? 'READY' : 'PARTIAL', `${count}/${gate.autoEvidence.length}`);
  }
}

const checklist = await readFile('docs/m4-manual-acceptance.md', 'utf8').catch(() => null);
printLine('Manual checklist doc', checklist ? 'READY' : 'MISSING', checklist ? 'docs/m4-manual-acceptance.md' : 'run npm run m4:write-manual-checklist');

const manifest = await readJson('var/m4-browser-evidence/manifest.json');
if (!manifest) {
  printLine('Browser entry screenshots', 'MISSING', 'run npm run m4:capture-browser-evidence');
} else {
  const missing = [];
  for (const screenshot of manifest.screenshots || []) {
    if (!(await fileExists(screenshot.file))) missing.push(screenshot.slug);
  }
  printLine('Browser entry screenshots', missing.length ? 'PARTIAL' : 'READY', missing.length ? `missing: ${missing.join(', ')}` : 'var/m4-browser-evidence/manifest.json');
}

if (gates) {
  let manualReady = 0;
  let manualExpected = 0;
  for (const gate of gates) {
    for (const [evidenceId] of gate.manualEvidence || []) {
      manualExpected += 1;
      const dir = `var/m4-manual-evidence/${gate.id}`;
      const files = await readdir(dir).catch(() => []);
      const found = files.some((file) => file.startsWith(evidenceId) && file.match(/\.(png|jpe?g|webp|mp4|mov|webm|pdf)$/i));
      if (found) manualReady += 1;
    }
  }
  printLine('Manual evidence package', manualReady === manualExpected ? 'READY' : 'MISSING', `${manualReady}/${manualExpected}; run npm run m4:manual-evidence-status`);
}

console.log('');
console.log('M4 closes only after DEV-402/403/406 manual browser screenshots or recordings are collected and reviewed.');
