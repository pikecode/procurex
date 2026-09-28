import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const outputDir = resolve(root, 'var/main-flow-demo-evidence');
const userDataDir = resolve(root, 'var/chrome-main-flow-interactive-demo');
const webBaseUrl = 'http://127.0.0.1:4173';
const apiReadyUrl = 'http://127.0.0.1:3100/api/v1/health/ready';
const chromeCandidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
const children = [];

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

function start(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
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

async function withService(url, label, command, args, callback) {
  if (await canReach(url)) return callback(false);
  const child = start(command, args);
  try {
    await waitForHttp(url, label);
    return await callback(true);
  } finally {
    if (!child.killed) child.kill('SIGTERM');
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
  throw new Error('No Chrome or Chromium runtime found for main-flow interactive evidence capture.');
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

async function runInteractiveDemo(cdp) {
  await navigate(cdp, `${webBaseUrl}/main-flow-demo.html`);
  return evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 120; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#run-all') && !document.querySelector('#run-all').disabled, 'run-all button');
      document.querySelector('#run-all').click();
      await waitFor(() => document.querySelector('#run-all')?.textContent.trim() === '已完成', 'interactive main flow completion');
      await waitFor(() => document.querySelector('#steps')?.textContent.includes('COMPANY_TO_SUPPLIER'), 'payment preview result');
      return {
        seedStatus: document.querySelector('#seed-status')?.textContent.trim() || '',
        completedRows: document.querySelectorAll('#steps .tag-settled').length,
        stepRows: document.querySelectorAll('#steps tr').length,
        currentStage: [...document.querySelectorAll('.metric')].find((item) => item.textContent.includes('当前阶段'))?.textContent.trim() || '',
        paymentPreviewText: document.querySelector('#steps')?.textContent || '',
        noticeText: document.querySelector('#notice')?.textContent.trim() || '',
        runAllText: document.querySelector('#run-all')?.textContent.trim() || ''
      };
    })()
  `);
}

async function main() {
  await run('npm', ['run', 'main-flow:seed-demo']);
  const browser = await findBrowser();
  await mkdir(outputDir, { recursive: true });
  await withService(apiReadyUrl, 'API', 'npm', ['run', 'start:api'], async (startedApi) => {
    await withService(`${webBaseUrl}/main-flow-demo.html`, 'Web server', 'npm', ['run', 'start:web'], async (startedWeb) => {
      const { chrome, port } = await launchChrome(browser);
      try {
        const cdp = await connectToChrome(port);
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        const state = await runInteractiveDemo(cdp);
        const file = resolve(outputDir, 'main-flow-demo-interactive.png');
        await rm(file, { force: true });
        await captureScreenshot(cdp, file);
        await writeFile(resolve(outputDir, 'interactive-manifest.json'), `${JSON.stringify({
          generatedAt: new Date().toISOString(),
          browser,
          webBaseUrl,
          apiReadyUrl,
          evidenceType: 'main-flow-interactive-browser-screenshot',
          note: 'This screenshot proves the main-flow operator demo can execute the order-to-payment path through the browser against real APIs.',
          screenshot: file,
          services: { startedApi, startedWeb },
          state,
        }, null, 2)}\n`);
        console.log('Main-flow interactive browser evidence captured.');
        console.log(`  Browser: ${browser}`);
        console.log(`  API started by script: ${startedApi ? 'yes' : 'no'}`);
        console.log(`  Web started by script: ${startedWeb ? 'yes' : 'no'}`);
        console.log(`  Screenshot: ${file}`);
        console.log(`  Completed rows: ${state.completedRows}/${state.stepRows}`);
        console.log(`  Manifest: ${resolve(outputDir, 'interactive-manifest.json')}`);
      } finally {
        chrome.kill('SIGTERM');
      }
    });
  });
}

try {
  await main();
} finally {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
}
