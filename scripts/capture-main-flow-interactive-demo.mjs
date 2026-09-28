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

async function setViewport(cdp, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
  });
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
        viewportWidth: window.innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        currentStage: [...document.querySelectorAll('.metric')].find((item) => item.textContent.includes('当前阶段'))?.textContent.trim() || '',
        paymentPreviewText: document.querySelector('#steps')?.textContent || '',
        noticeText: document.querySelector('#notice')?.textContent.trim() || '',
        runAllText: document.querySelector('#run-all')?.textContent.trim() || ''
      };
    })()
  `);
}

async function captureRun(cdp, viewport, fileName) {
  await setViewport(cdp, viewport);
  const state = await runInteractiveDemo(cdp);
  const file = resolve(outputDir, fileName);
  await rm(file, { force: true });
  await captureScreenshot(cdp, file);
  return { file, state, viewport };
}

async function runRoleWorkbenchStoreOrder(cdp, viewport, fileName) {
  await setViewport(cdp, viewport);
  await navigate(cdp, `${webBaseUrl}/role-workbenches.html`);
  const state = await evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 120; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#role-workbench-status')?.textContent.trim() === 'PASSED', 'role workbench status');
      await waitFor(() => document.querySelector('#store-order-action') && !document.querySelector('#store-order-action').disabled, 'store order action button');
      document.querySelector('#store-order-action').click();
      await waitFor(() => document.querySelector('#role-action-label')?.textContent.trim() === 'PENDING_PROCUREMENT', 'store role order creation');
      await waitFor(() => document.querySelector('#purchaser-confirm-action') && !document.querySelector('#purchaser-confirm-action').disabled, 'purchaser confirm action button');
      document.querySelector('#purchaser-confirm-action').click();
      await waitFor(() => document.querySelector('#role-action-label')?.textContent.trim() === 'CONFIRMED', 'purchaser role order confirmation');
      await waitFor(() => document.querySelector('#supplier-shipment-action') && !document.querySelector('#supplier-shipment-action').disabled, 'supplier shipment action button');
      document.querySelector('#supplier-shipment-action').click();
      await waitFor(() => document.querySelector('#role-action-label')?.textContent.trim() === 'SHIPPED', 'supplier role shipment creation');
      await waitFor(() => document.querySelector('#store-receipt-action') && !document.querySelector('#store-receipt-action').disabled, 'store receipt action button');
      document.querySelector('#store-receipt-action').click();
      await waitFor(() => document.querySelector('#role-action-label')?.textContent.trim() === 'COMPLETED', 'store role receipt completion');
      await waitFor(() => document.querySelector('#supplier-discrepancy-action') && !document.querySelector('#supplier-discrepancy-action').disabled, 'supplier discrepancy action button');
      document.querySelector('#supplier-discrepancy-action').click();
      await waitFor(() => document.querySelector('#role-action-label')?.textContent.trim() === 'RESOLVED', 'supplier discrepancy resolution');
      await waitFor(() => document.querySelector('#supplier-rejection-action') && !document.querySelector('#supplier-rejection-action').disabled, 'supplier rejection action button');
      document.querySelector('#supplier-rejection-action').click();
      await waitFor(() => document.querySelector('#role-action-label')?.textContent.trim() === 'REALLOCATED', 'supplier rejection handling');
      await waitFor(() => document.querySelector('#supplier-discrepancy-branches-action') && !document.querySelector('#supplier-discrepancy-branches-action').disabled, 'supplier discrepancy branches action button');
      document.querySelector('#supplier-discrepancy-branches-action').click();
      await waitFor(() => document.querySelector('#role-action-label')?.textContent.trim() === 'BRANCHES_READY', 'supplier discrepancy replenishment and return branches');
      const resultText = document.querySelector('#store-order-result')?.textContent.trim() || '';
      const purchaserResultText = document.querySelector('#purchaser-confirm-result')?.textContent.trim() || '';
      const shipmentResultText = document.querySelector('#supplier-shipment-result')?.textContent.trim() || '';
      const receiptResultText = document.querySelector('#store-receipt-result')?.textContent.trim() || '';
      const discrepancyResultText = document.querySelector('#supplier-discrepancy-result')?.textContent.trim() || '';
      const rejectionResultText = document.querySelector('#supplier-rejection-result')?.textContent.trim() || '';
      const discrepancyBranchesResultText = document.querySelector('#supplier-discrepancy-branches-result')?.textContent.trim() || '';
      return {
        status: document.querySelector('#role-action-label')?.textContent.trim() || '',
        storeResultText: resultText,
        purchaserResultText,
        shipmentResultText,
        receiptResultText,
        discrepancyResultText,
        rejectionResultText,
        discrepancyBranchesResultText,
        hasRequestNo: resultText.includes('PR'),
        hasPaidStatus: resultText.includes('PAID'),
        hasSupplierOrderId: purchaserResultText.includes('CONFIRMED') && purchaserResultText.split('·').length >= 2,
        hasShipmentNo: shipmentResultText.includes('SHIPPED') && shipmentResultText.split('·').length >= 2,
        hasReceiptNo: receiptResultText.includes('COMPLETED') && receiptResultText.split('·').length >= 2,
        hasResolvedDiscrepancy: discrepancyResultText.includes('RESOLVED') && discrepancyResultText.split('·').length >= 2,
        hasReallocatedRejection: rejectionResultText.includes('REALLOCATED') && rejectionResultText.split('·').length >= 2,
        hasDiscrepancyBranches: discrepancyBranchesResultText.includes('BRANCHES_READY') && discrepancyBranchesResultText.includes('REPLENISH_PENDING') && discrepancyBranchesResultText.includes('RETURN'),
        laneRows: document.querySelectorAll('#role-lanes article').length,
        viewportWidth: window.innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
      };
    })()
  `);
  const file = resolve(outputDir, fileName);
  await rm(file, { force: true });
  await captureScreenshot(cdp, file);
  return { file, state, viewport };
}

async function main() {
  await run('npm', ['run', 'main-flow:seed-demo']);
  await run('npm', ['run', 'main-flow:check-demo']);
  const browser = await findBrowser();
  await mkdir(outputDir, { recursive: true });
  await withService(apiReadyUrl, 'API', 'npm', ['run', 'start:api'], async (startedApi) => {
    await withService(`${webBaseUrl}/main-flow-demo.html`, 'Web server', 'npm', ['run', 'start:web'], async (startedWeb) => {
      const { chrome, port } = await launchChrome(browser);
      try {
        const cdp = await connectToChrome(port);
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        const desktop = await captureRun(cdp, { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, 'main-flow-demo-interactive.png');
        const mobile = await captureRun(cdp, { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, 'main-flow-demo-interactive-mobile.png');
        const roleWorkbenchAction = await runRoleWorkbenchStoreOrder(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'role-workbenches-interactive.png',
        );
        const mobileRoleWorkbenchAction = await runRoleWorkbenchStoreOrder(
          cdp,
          { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
          'role-workbenches-interactive-mobile.png',
        );
        await writeFile(resolve(outputDir, 'interactive-manifest.json'), `${JSON.stringify({
          generatedAt: new Date().toISOString(),
          browser,
          webBaseUrl,
          apiReadyUrl,
          evidenceType: 'main-flow-interactive-browser-screenshot',
          note: 'These screenshots prove the main-flow operator demo and role workbench can execute the order-to-payment and role exception paths through desktop and mobile browser viewports against real APIs.',
          screenshot: desktop.file,
          mobileScreenshot: mobile.file,
          roleWorkbenchActionScreenshot: roleWorkbenchAction.file,
          mobileRoleWorkbenchActionScreenshot: mobileRoleWorkbenchAction.file,
          services: { startedApi, startedWeb },
          state: desktop.state,
          roleWorkbenchAction: roleWorkbenchAction.state,
          mobileRoleWorkbenchAction: mobileRoleWorkbenchAction.state,
          viewports: { desktop, mobile, roleWorkbenchAction, mobileRoleWorkbenchAction },
        }, null, 2)}\n`);
        console.log('Main-flow interactive browser evidence captured.');
        console.log(`  Browser: ${browser}`);
        console.log(`  API started by script: ${startedApi ? 'yes' : 'no'}`);
        console.log(`  Web started by script: ${startedWeb ? 'yes' : 'no'}`);
        console.log(`  Desktop screenshot: ${desktop.file}`);
        console.log(`  Mobile screenshot: ${mobile.file}`);
        console.log(`  Role workbench screenshot: ${roleWorkbenchAction.file}`);
        console.log(`  Mobile role workbench screenshot: ${mobileRoleWorkbenchAction.file}`);
        console.log(`  Desktop completed rows: ${desktop.state.completedRows}/${desktop.state.stepRows}`);
        console.log(`  Mobile completed rows: ${mobile.state.completedRows}/${mobile.state.stepRows}`);
        console.log(`  Role workbench flow: ${roleWorkbenchAction.state.status} (${roleWorkbenchAction.state.storeResultText}; ${roleWorkbenchAction.state.purchaserResultText}; ${roleWorkbenchAction.state.shipmentResultText}; ${roleWorkbenchAction.state.receiptResultText}; ${roleWorkbenchAction.state.discrepancyResultText}; ${roleWorkbenchAction.state.rejectionResultText}; ${roleWorkbenchAction.state.discrepancyBranchesResultText})`);
        console.log(`  Mobile role workbench flow: ${mobileRoleWorkbenchAction.state.status} (${mobileRoleWorkbenchAction.state.storeResultText}; ${mobileRoleWorkbenchAction.state.purchaserResultText}; ${mobileRoleWorkbenchAction.state.shipmentResultText}; ${mobileRoleWorkbenchAction.state.receiptResultText}; ${mobileRoleWorkbenchAction.state.discrepancyResultText}; ${mobileRoleWorkbenchAction.state.rejectionResultText}; ${mobileRoleWorkbenchAction.state.discrepancyBranchesResultText})`);
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
