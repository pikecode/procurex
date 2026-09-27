import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const outputDir = resolve(root, 'var/m5-browser-evidence');
const userDataDir = resolve(root, 'var/chrome-m5-ops-evidence');
const webBaseUrl = 'http://127.0.0.1:4173';
const apiBaseUrl = 'http://127.0.0.1:3100/api/v1';
const chromeCandidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

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
  throw new Error('No Chrome or Chromium runtime found for M5 ops evidence capture.');
}

async function wait(ms) {
  await new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function waitForHttp(url, label) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep waiting.
    }
    await wait(250);
  }
  throw new Error(`${label} is not reachable at ${url}`);
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

async function captureScreenshot(cdp, file) {
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(file, Buffer.from(screenshot.data, 'base64'));
  const fileStats = await stat(file);
  if (fileStats.size < 10_000) throw new Error(`Screenshot looks too small: ${file}`);
}

async function prepareOpsPage(cdp) {
  await navigate(cdp, `${webBaseUrl}/ops.html`);
  await evaluate(cdp, `
    (async () => {
      const login = await fetch('${apiBaseUrl}/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'pxrpt_admin', password: 'correct-password', client: 'WEB' })
      });
      if (!login.ok) throw new Error('M5 ops browser login failed: ' + login.status);
      const body = await login.json();
      sessionStorage.setItem('procurex-token', body.data.accessToken);
      location.reload();
    })()
  `);
  await wait(1000);

  return evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 80; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => !document.querySelector('#workspace')?.classList.contains('hidden'), 'workspace');
      await waitFor(() => document.querySelectorAll('#issues tr').length >= 2, 'reconciliation issues');
      await waitFor(() => document.querySelector('#export-health-summary')?.textContent.includes('导出任务'), 'export health');
      await waitFor(() => document.querySelector('#notifications')?.textContent.includes('对账异常待核查'), 'notifications');
      return {
        issueRows: document.querySelectorAll('#issues tr').length,
        exportHealthRows: document.querySelectorAll('#export-health-jobs tr').length,
        notificationRows: document.querySelectorAll('#notifications tr').length,
        auditRows: document.querySelectorAll('#audit-logs tr').length,
        summaryText: document.querySelector('#summary').textContent.trim(),
        exportHealthText: document.querySelector('#export-health-summary').textContent.trim(),
        notificationText: document.querySelector('#notifications').textContent.trim(),
        auditText: document.querySelector('#audit-logs').textContent.trim(),
        hasBalanceIssue: document.querySelector('#issues').textContent.includes('账户余额与最新流水不一致'),
        hasCreditIssue: document.querySelector('#issues').textContent.includes('挂账占用与资金占用不一致'),
        hasExportHealth: document.querySelector('#export-health-summary').textContent.includes('超时处理中'),
        hasNotification: document.querySelector('#notifications').textContent.includes('对账异常待核查'),
        hasAuditTable: Boolean(document.querySelector('#audit-logs'))
      };
    })()
  `);
}

await waitForHttp(`${apiBaseUrl}/health/ready`, 'API');
await waitForHttp(`${webBaseUrl}/ops.html`, 'Web server');
await mkdir(outputDir, { recursive: true });

const browser = await findBrowser();
const { chrome, port } = await launchChrome(browser);
try {
  const cdp = await connectToChrome(port);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const state = await prepareOpsPage(cdp);
  const file = resolve(outputDir, 'ops-reconciliation.png');
  await rm(file, { force: true });
  await captureScreenshot(cdp, file);
  await writeFile(resolve(outputDir, 'ops-manifest.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), browser, webBaseUrl, apiBaseUrl, evidenceType: 'm5-ops-reconciliation-screenshot', screenshot: file, state }, null, 2)}\n`);
  console.log('M5 ops evidence captured.');
  console.log(`  Browser: ${browser}`);
  console.log(`  Screenshot: ${file}`);
  console.log(`  Issue rows: ${state.issueRows}`);
  console.log(`  Export health rows: ${state.exportHealthRows}`);
  console.log(`  Notification rows: ${state.notificationRows}`);
  console.log(`  Audit rows: ${state.auditRows}`);
  console.log(`  Manifest: ${resolve(outputDir, 'ops-manifest.json')}`);
} finally {
  chrome.kill('SIGTERM');
}
