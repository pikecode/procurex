import { access, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const outputDir = resolve(root, 'var/m4-browser-evidence');
const userDataDir = resolve(root, 'var/chrome-m4-browser-evidence');
const webBaseUrl = 'http://127.0.0.1:4173';
const chromeCandidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Firefox.app/Contents/MacOS/firefox',
].filter(Boolean);

const pages = [
  ['m4-acceptance', '/m4-acceptance.html', 'M4 acceptance gate page'],
  ['billing-entry', '/billing.html', 'W09/W10 billing entry page'],
  ['main-flow-demo', '/main-flow-demo.html', 'Interactive main-flow demo page'],
];

async function findBrowser() {
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  for (const command of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    if (result.status === 0) return result.stdout.trim();
  }

  throw new Error('No Chrome or Chromium runtime found for browser evidence capture.');
}

async function canReachWeb() {
  try {
    const response = await fetch(`${webBaseUrl}/m4-acceptance.html?ts=${Date.now()}`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForWeb() {
  for (let i = 0; i < 30; i += 1) {
    if (await canReachWeb()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Web server did not become ready at ${webBaseUrl}`);
}

async function withWebServer(callback) {
  if (await canReachWeb()) return callback(false);

  const server = spawn('python3', ['-m', 'http.server', '4173', '--directory', 'apps/web'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForWeb();
    return await callback(true);
  } finally {
    server.kill('SIGTERM');
  }
}

async function capturePage(browser, slug, path) {
  const file = resolve(outputDir, `${slug}.png`);
  const url = `${webBaseUrl}${path}`;
  await rm(file, { force: true });
  const result = spawnSync(browser, [
    '--headless',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--metrics-recording-only',
    '--hide-scrollbars',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=5000',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,1200',
    `--screenshot=${file}`,
    url,
  ], { encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL' });

  if (result.error || result.signal || result.status !== 0) {
    const fileStats = await stat(file).catch(() => null);
    if (fileStats?.size > 0) {
      return { slug, url, file, warning: result.signal ? `Chrome exited by ${result.signal} after writing screenshot` : 'Chrome reported errors after writing screenshot' };
    }
    throw new Error(`Chrome screenshot failed for ${url}:\n${result.stderr || result.stdout}`);
  }

  return { slug, url, file };
}

const browser = await findBrowser();
await mkdir(outputDir, { recursive: true });
await rm(userDataDir, { recursive: true, force: true });

const captured = await withWebServer(async (startedServer) => {
  const screenshots = [];
  for (const [slug, path] of pages) {
    screenshots.push(await capturePage(browser, slug, path));
  }
  return { startedServer, screenshots };
});

const manifest = {
  generatedAt: new Date().toISOString(),
  browser,
  webBaseUrl,
  evidenceType: 'browser-entry-screenshots',
  note: 'These screenshots prove the M4 browser entry points render. They do not replace DEV-402/403/406 manual workflow screenshots or recordings.',
  screenshots: captured.screenshots,
};

await writeFile(resolve(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log('M4 browser evidence captured.');
console.log(`  Browser: ${browser}`);
console.log(`  Web server started by script: ${captured.startedServer ? 'yes' : 'no'}`);
for (const screenshot of captured.screenshots) {
  console.log(`  ${screenshot.slug}: ${screenshot.file}${screenshot.warning ? ` (${screenshot.warning})` : ''}`);
}
console.log(`  Manifest: ${resolve(outputDir, 'manifest.json')}`);
