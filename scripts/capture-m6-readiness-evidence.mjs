import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const outputDir = resolve(root, 'var/m6-readiness-evidence');
const userDataDir = resolve(root, 'var/chrome-m6-readiness-evidence');
const webBaseUrl = 'http://127.0.0.1:4173';
const chromeCandidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

async function wait(ms) {
  await new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function canReach(url) {
  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}ts=${Date.now()}`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHttp(url, label) {
  for (let i = 0; i < 80; i += 1) {
    if (await canReach(url)) return;
    await wait(250);
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: root, env: process.env, stdio: 'inherit' });
    child.on('exit', (code, signal) => {
      if (signal) rejectRun(new Error(`${command} ${args.join(' ')} exited by ${signal}`));
      else if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', rejectRun);
  });
}

async function withWebServer(callback) {
  if (await canReach(`${webBaseUrl}/m6-readiness.html`)) return callback(false);
  const server = spawn('python3', ['-m', 'http.server', '4173', '--directory', 'apps/web'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForHttp(`${webBaseUrl}/m6-readiness.html`, 'Web server');
    return await callback(true);
  } finally {
    if (!server.killed) server.kill('SIGTERM');
  }
}

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
  throw new Error('No Chrome or Chromium runtime found for M6 readiness evidence capture.');
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    socket.addEventListener('message', (event) => this.handleMessage(event.data));
  }

  handleMessage(raw) {
    const message = JSON.parse(raw);
    if (message.id && this.pending.has(message.id)) {
      const { resolveSend, rejectSend } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) rejectSend(new Error(message.error.message));
      else resolveSend(message.result || {});
      return;
    }
    for (const listener of this.events.get(message.method) || []) listener(message.params || {});
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolveSend, rejectSend });
    });
  }

  once(method) {
    return new Promise((resolveEvent) => {
      const listeners = this.events.get(method) || [];
      const listener = (params) => {
        this.events.set(method, (this.events.get(method) || []).filter((item) => item !== listener));
        resolveEvent(params);
      };
      listeners.push(listener);
      this.events.set(method, listeners);
    });
  }
}

async function launchChrome(browser) {
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });
  const chrome = spawn(browser, [
    '--headless',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,1200',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const activePortFile = resolve(userDataDir, 'DevToolsActivePort');
  for (let i = 0; i < 80; i += 1) {
    const content = await readFile(activePortFile, 'utf8').catch(() => null);
    if (content) return { chrome, port: Number(content.split('\n')[0]) };
    await wait(250);
  }
  chrome.kill('SIGKILL');
  throw new Error('Chrome did not expose a DevTools port.');
}

async function connectToChrome(port) {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const pageTarget = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!pageTarget) throw new Error('Chrome did not expose a page DevTools target.');
  const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });
  return new Cdp(socket);
}

async function navigate(cdp, url) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    throw new Error(details.exception?.description || details.exception?.value || details.text || 'Runtime evaluation failed.');
  }
  return result.result?.value;
}

async function setViewport(cdp, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
  });
}

async function captureScreenshot(cdp, file) {
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(file, Buffer.from(screenshot.data, 'base64'));
  const fileStats = await stat(file);
  if (fileStats.size < 10_000) throw new Error(`Screenshot looks too small: ${file}`);
}

async function captureReadiness(cdp, viewport, fileName) {
  await setViewport(cdp, viewport);
  await navigate(cdp, `${webBaseUrl}/m6-readiness.html`);
  const state = await evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 80; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#readiness-status')?.textContent.trim() === 'NOT_READY', 'readiness status');
      await waitFor(() => document.querySelectorAll('#checks article').length >= 10, 'readiness checks');
      await waitFor(() => document.querySelector('#external-status')?.textContent.trim() === 'BLOCKED', 'external evidence status');
      await waitFor(() => document.querySelectorAll('#external-checks article').length >= 6, 'external evidence checks');
      await waitFor(() => document.querySelectorAll('#handoff-links article').length >= 6, 'handoff links');
      const bodyText = document.body.textContent || '';
      return {
        readinessStatus: document.querySelector('#readiness-status')?.textContent.trim() || '',
        externalStatus: document.querySelector('#external-status')?.textContent.trim() || '',
        readyMetric: [...document.querySelectorAll('.metric')].find((item) => item.textContent.includes('READY'))?.textContent.trim() || '',
        readinessRows: document.querySelectorAll('#checks article').length,
        externalRows: document.querySelectorAll('#external-checks article').length,
        handoffRows: document.querySelectorAll('#handoff-links article').length,
        hasDev604: bodyText.includes('DEV-604') && bodyText.includes('数据初始化'),
        hasDev605: bodyText.includes('DEV-605') && bodyText.includes('试运行'),
        hasWechatBlocker: bodyText.includes('WECHAT_DEVICE'),
        hasProductionRuntimeBlocker: bodyText.includes('PRODUCTION_RUNTIME'),
        hasTemplatePath: bodyText.includes('docs/m6-evidence-templates/'),
        hasWechatGuide: bodyText.includes('docs/m6-wechat-device-evidence-guide.md') && bodyText.includes('m6:check-wechat-evidence'),
        hasProductionRuntimeGuide: bodyText.includes('docs/m6-production-runtime-guide.md') && bodyText.includes('m6:check-production-runtime'),
        hasCustomerEvidenceRequest: bodyText.includes('docs/m6-customer-evidence-request.md'),
        hasLocalHandoff: bodyText.includes('docs/m6-local-evidence-handoff.md'),
        hasStrictGateCommands: bodyText.includes('m6:external-evidence:strict') && bodyText.includes('m6:readiness:strict'),
        viewportWidth: window.innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
      };
    })()
  `);
  const file = resolve(outputDir, fileName);
  await rm(file, { force: true });
  await captureScreenshot(cdp, file);
  return { file, viewport, state };
}

await run('npm', ['run', 'm6:readiness']);
await run('npm', ['run', 'm6:external-evidence']);
await mkdir(outputDir, { recursive: true });

const browser = await findBrowser();
await withWebServer(async () => {
  const { chrome, port } = await launchChrome(browser);
  try {
    const cdp = await connectToChrome(port);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const desktop = await captureReadiness(cdp, { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, 'm6-readiness-desktop.png');
    const mobile = await captureReadiness(cdp, { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, 'm6-readiness-mobile.png');
    const manifest = {
      generatedAt: new Date().toISOString(),
      browser,
      webBaseUrl,
      evidenceType: 'm6-readiness-browser-screenshot',
      note: 'Shows the M6 internal readiness ledger, external launch-material blockers, and review handoff links on desktop and 390px mobile viewports.',
      desktop,
      mobile,
    };
    await writeFile(resolve(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log('M6 readiness browser evidence captured.');
    console.log(`  Desktop: ${desktop.file}`);
    console.log(`  Mobile: ${mobile.file}`);
    console.log(`  Readiness rows: ${desktop.state.readinessRows}`);
    console.log(`  External rows: ${desktop.state.externalRows}`);
    console.log(`  Handoff rows: ${desktop.state.handoffRows}`);
    console.log(`  Manifest: ${resolve(outputDir, 'manifest.json')}`);
  } finally {
    chrome.kill('SIGTERM');
  }
});
