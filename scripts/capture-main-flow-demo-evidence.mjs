import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const outputDir = resolve(root, 'var/main-flow-demo-evidence');
const userDataDir = resolve(root, 'var/chrome-main-flow-demo-evidence');
const webBaseUrl = 'http://127.0.0.1:4173';
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

  throw new Error('No Chrome or Chromium runtime found for main-flow demo evidence capture.');
}

async function wait(ms) {
  await new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function canReachWeb() {
  try {
    const response = await fetch(`${webBaseUrl}/main-flow-demo.html?ts=${Date.now()}`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForWeb() {
  for (let i = 0; i < 50; i += 1) {
    if (await canReachWeb()) return;
    await wait(250);
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
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    const description = details.exception?.description || details.exception?.value || details.text || 'Runtime evaluation failed.';
    throw new Error(description);
  }
  return result.result?.value;
}

async function captureScreenshot(cdp, file) {
  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  await writeFile(file, Buffer.from(screenshot.data, 'base64'));
  const fileStats = await stat(file);
  if (fileStats.size < 10_000) throw new Error(`Screenshot looks too small: ${file}`);
}

async function prepareDemoPage(cdp) {
  await navigate(cdp, `${webBaseUrl}/main-flow-demo.html`);
  return evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 80; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#demo-evidence-label')?.textContent.trim() === 'PASSED', 'main-flow demo evidence');
      await waitFor(() => document.querySelectorAll('#demo-evidence article').length >= 6, 'main-flow demo evidence rows');
      await waitFor(() => document.querySelector('#role-evidence-label')?.textContent.trim() === 'PASSED', 'main-flow role evidence');
      await waitFor(() => document.querySelectorAll('#role-evidence article').length >= 4, 'main-flow role evidence rows');
      await waitFor(() => document.querySelector('#role-view-label')?.textContent.trim() === 'PASSED', 'main-flow role view');
      await waitFor(() => document.querySelectorAll('#role-tabs .tab').length >= 4, 'main-flow role view tabs');
      await waitFor(() => document.querySelectorAll('#role-detail article').length >= 4, 'main-flow role view detail');
      return {
        seedStatus: document.querySelector('#seed-status')?.textContent.trim() || '',
        evidenceStatus: document.querySelector('#demo-evidence-label')?.textContent.trim() || '',
        evidenceRows: document.querySelectorAll('#demo-evidence article').length,
        roleStatus: document.querySelector('#role-evidence-label')?.textContent.trim() || '',
        roleRows: document.querySelectorAll('#role-evidence article').length,
        roleViewStatus: document.querySelector('#role-view-label')?.textContent.trim() || '',
        roleTabRows: document.querySelectorAll('#role-tabs .tab').length,
        roleDetailRows: document.querySelectorAll('#role-detail article').length,
        hasRoleNextBoundary: document.querySelector('#role-detail')?.textContent.includes('下一步工作台边界') || false,
        hasOperatorRole: document.querySelector('#role-evidence')?.textContent.includes('Operator') || false,
        hasStoreRole: document.querySelector('#role-evidence')?.textContent.includes('Store') || false,
        hasSupplierRole: document.querySelector('#role-evidence')?.textContent.includes('Supplier') || false,
        hasPurchaserRole: document.querySelector('#role-evidence')?.textContent.includes('Purchaser') || false,
        stepRows: document.querySelectorAll('#steps tr').length,
        hasShipmentNotification: document.querySelector('#demo-evidence')?.textContent.includes('Store shipment notification') || false,
        hasSupplierNotification: document.querySelector('#demo-evidence')?.textContent.includes('Supplier receipt-discrepancy notification') || false,
        hasRejectionNotification: document.querySelector('#demo-evidence')?.textContent.includes('Purchaser supplier-rejection notification') || false,
        hasAuditEvidence: document.querySelector('#demo-evidence')?.textContent.includes('audit actions') || false
      };
    })()
  `);
}

async function prepareRoleWorkbenchesPage(cdp) {
  await navigate(cdp, `${webBaseUrl}/role-workbenches.html`);
  return evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 80; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#role-workbench-status')?.textContent.trim() === 'PASSED', 'role workbench status');
      await waitFor(() => document.querySelectorAll('#role-lanes article').length >= 4, 'role workbench lanes');
      await waitFor(() => document.querySelectorAll('#role-tabs .tab').length >= 4, 'role workbench tabs');
      await waitFor(() => document.querySelectorAll('#role-detail article').length >= 4, 'role workbench detail');
      await waitFor(() => document.querySelectorAll('#evidence-map article').length >= 6, 'role workbench evidence map');
      const bodyText = document.body.textContent || '';
      return {
        status: document.querySelector('#role-workbench-status')?.textContent.trim() || '',
        laneRows: document.querySelectorAll('#role-lanes article').length,
        tabRows: document.querySelectorAll('#role-tabs .tab').length,
        detailRows: document.querySelectorAll('#role-detail article').length,
        evidenceRows: document.querySelectorAll('#evidence-map article').length,
        hasStoreWorkbench: bodyText.includes('门店工作台'),
        hasPurchaserWorkbench: bodyText.includes('采购工作台'),
        hasSupplierWorkbench: bodyText.includes('供应商工作台'),
        hasOperatorWorkbench: bodyText.includes('运营联调台'),
        hasNextPageBoundary: bodyText.includes('下一步页面边界'),
        hasEvidenceMapping: bodyText.includes('主流程证据映射'),
        hasStoreOrderAction: bodyText.includes('门店真实下单') && Boolean(document.querySelector('#store-order-action')),
        hasPurchaserConfirmAction: bodyText.includes('采购真实确认') && Boolean(document.querySelector('#purchaser-confirm-action')),
        hasSupplierShipmentAction: bodyText.includes('供应商真实发货') && Boolean(document.querySelector('#supplier-shipment-action')),
        hasStoreReceiptAction: bodyText.includes('门店真实收货') && Boolean(document.querySelector('#store-receipt-action')),
        hasSupplierDiscrepancyAction: bodyText.includes('供应商差异处理') && Boolean(document.querySelector('#supplier-discrepancy-action')),
        hasSupplierRejectionAction: bodyText.includes('供应商拒单改派') && Boolean(document.querySelector('#supplier-rejection-action')),
        hasSupplierDiscrepancyBranchesAction: bodyText.includes('差异补发与退回') && Boolean(document.querySelector('#supplier-discrepancy-branches-action'))
      };
    })()
  `);
}

const browser = await findBrowser();
await mkdir(outputDir, { recursive: true });

const captured = await withWebServer(async (startedServer) => {
  const { chrome, port } = await launchChrome(browser);
  try {
    const cdp = await connectToChrome(port);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const state = await prepareDemoPage(cdp);
    const file = resolve(outputDir, 'main-flow-demo.png');
    await rm(file, { force: true });
    await captureScreenshot(cdp, file);
    const roleWorkbenchState = await prepareRoleWorkbenchesPage(cdp);
    const roleWorkbenchFile = resolve(outputDir, 'role-workbenches.png');
    await rm(roleWorkbenchFile, { force: true });
    await captureScreenshot(cdp, roleWorkbenchFile);
    return { startedServer, file, roleWorkbenchFile, state, roleWorkbenchState };
  } finally {
    chrome.kill('SIGTERM');
  }
});

const manifest = {
  generatedAt: new Date().toISOString(),
  browser,
  webBaseUrl,
  evidenceType: 'main-flow-demo-browser-screenshot',
  note: 'This screenshot proves the main-flow operator demo can render persisted notification, audit, and payment-preview evidence in a real browser session.',
  screenshot: captured.file,
  roleWorkbenchScreenshot: captured.roleWorkbenchFile,
  state: captured.state,
  roleWorkbenchState: captured.roleWorkbenchState,
};

await writeFile(resolve(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log('Main-flow demo browser evidence captured.');
console.log(`  Browser: ${browser}`);
console.log(`  Web server started by script: ${captured.startedServer ? 'yes' : 'no'}`);
console.log(`  Screenshot: ${captured.file}`);
console.log(`  Evidence status: ${captured.state.evidenceStatus} (${captured.state.evidenceRows} rows)`);
console.log(`  Role status: ${captured.state.roleStatus} (${captured.state.roleRows} rows)`);
console.log(`  Role view: ${captured.state.roleViewStatus} (${captured.state.roleTabRows} tabs)`);
console.log(`  Role workbenches: ${captured.roleWorkbenchState.status} (${captured.roleWorkbenchState.laneRows} lanes)`);
console.log(`  Step rows: ${captured.state.stepRows}`);
console.log(`  Manifest: ${resolve(outputDir, 'manifest.json')}`);
