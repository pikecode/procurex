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

async function captureBusinessFlow(cdp, viewport, fileName) {
  await setViewport(cdp, viewport);
  await navigate(cdp, `${webBaseUrl}/m7-business-flow.html`);
  const state = await evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 80; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#flow-status')?.textContent.trim() === 'PASSED', 'business flow status');
      await waitFor(() => document.querySelectorAll('#business-board article').length >= 5, 'business board stages');
      const bodyText = document.body.textContent || '';
      return {
        status: document.querySelector('#flow-status')?.textContent.trim() || '',
        stageRows: document.querySelectorAll('#business-board article').length,
        todoRows: document.querySelectorAll('#todo-list article').length,
        timelineRows: document.querySelectorAll('#timeline article').length,
        financeRows: document.querySelectorAll('#finance-panel article').length,
        hasStoreStage: bodyText.includes('门店下单'),
        hasPurchaserStage: bodyText.includes('采购确认'),
        hasSupplierStage: bodyText.includes('供应商履约'),
        hasFinanceStage: bodyText.includes('财务结算'),
        hasRoleNavigation: bodyText.includes('去门店工作台') && bodyText.includes('去财务结算'),
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

async function captureStoreWorkbench(cdp, viewport, fileName) {
  await setViewport(cdp, viewport);
  await navigate(cdp, `${webBaseUrl}/store-workbench.html`);
  const state = await evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 100; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#store-page-status')?.textContent.trim() === 'READY', 'store workbench status');
      await waitFor(() => document.querySelectorAll('#store-summary .metric').length >= 4, 'store summary metrics');
      const bodyText = document.body.textContent || '';
      return {
        status: document.querySelector('#store-page-status')?.textContent.trim() || '',
        summaryRows: document.querySelectorAll('#store-summary .metric').length,
        accountRows: document.querySelectorAll('#store-account article').length,
        orderRows: document.querySelectorAll('#store-orders tr').length,
        notificationCards: document.querySelectorAll('#store-notifications article').length,
        hasOrderForm: Boolean(document.querySelector('#store-order-form')),
        hasReceiptPanel: Boolean(document.querySelector('#store-receipt')),
        hasAccountEndpointCopy: bodyText.includes('/stores/{id}/account') || bodyText.includes('门店账款'),
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

async function capturePurchaserWorkbench(cdp, viewport, fileName) {
  await setViewport(cdp, viewport);
  await navigate(cdp, `${webBaseUrl}/purchaser-workbench.html`);
  const state = await evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 100; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#purchaser-page-status')?.textContent.trim() === 'READY', 'purchaser workbench status');
      await waitFor(() => document.querySelectorAll('#purchaser-summary .metric').length >= 4, 'purchaser summary metrics');
      const bodyText = document.body.textContent || '';
      return {
        status: document.querySelector('#purchaser-page-status')?.textContent.trim() || '',
        summaryRows: document.querySelectorAll('#purchaser-summary .metric').length,
        requestRows: document.querySelectorAll('#purchase-requests tr').length,
        rejectionCards: document.querySelectorAll('#rejection-todos article').length,
        hasDetailPanel: Boolean(document.querySelector('#request-detail')),
        hasReallocatePanel: Boolean(document.querySelector('#reallocate-result')),
        hasConfirmCopy: bodyText.includes('确认并拆单'),
        hasReallocateCopy: bodyText.includes('改派供应商'),
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

async function captureSupplierWorkbench(cdp, viewport, fileName) {
  await setViewport(cdp, viewport);
  await navigate(cdp, `${webBaseUrl}/supplier-workbench.html`);
  const state = await evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 100; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#supplier-page-status')?.textContent.trim() === 'READY', 'supplier workbench status');
      await waitFor(() => document.querySelectorAll('#supplier-summary .metric').length >= 4, 'supplier summary metrics');
      const bodyText = document.body.textContent || '';
      return {
        status: document.querySelector('#supplier-page-status')?.textContent.trim() || '',
        summaryRows: document.querySelectorAll('#supplier-summary .metric').length,
        orderRows: document.querySelectorAll('#supplier-orders tr').length,
        discrepancyCards: document.querySelectorAll('#supplier-discrepancies article').length,
        statementRows: document.querySelectorAll('#supplier-statements tr').length,
        paymentRows: document.querySelectorAll('#supplier-payments tr').length,
        hasShipmentPanel: Boolean(document.querySelector('#supplier-order-detail')),
        hasDiscrepancyPanel: Boolean(document.querySelector('#discrepancy-result')),
        hasPaymentPanel: Boolean(document.querySelector('#payment-result')),
        hasShipmentCopy: bodyText.includes('创建发货') && bodyText.includes('拒单'),
        hasDiscrepancyCopy: bodyText.includes('同意少收') && bodyText.includes('安排补发') && bodyText.includes('退回核对'),
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

async function captureProductApp(cdp, viewport, route, fileName) {
  await setViewport(cdp, viewport);
  await navigate(cdp, `${webBaseUrl}/app.html?demo=1&capture=${Date.now()}#/${route}`);
  const state = await evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 100; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#app-status')?.textContent.trim() === 'READY' || document.querySelector('#app-status')?.textContent.trim() === 'PASSED', 'product app status');
      await waitFor(() => document.querySelectorAll('#app-view .metric').length >= 4, 'product app metrics');
      const bodyText = document.body.textContent || '';
      return {
        status: document.querySelector('#app-status')?.textContent.trim() || '',
        route: document.querySelector('#app-route-label')?.textContent.trim() || '',
        metricRows: document.querySelectorAll('#app-view .metric').length,
        dataCards: document.querySelectorAll('#app-view .data-card').length,
        routeCards: document.querySelectorAll('.app-route-grid article').length,
        hasStoreLink: bodyText.includes('门店工作台'),
        hasPurchaserLink: bodyText.includes('采购工作台'),
        hasSupplierLink: bodyText.includes('供应商工作台'),
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

async function runProductAppFlow(cdp, viewport, fileName) {
  await setViewport(cdp, viewport);
  await navigate(cdp, `${webBaseUrl}/app.html?demo=1&capture=${Date.now()}#/flow`);
  const state = await evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 160; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#app-status')?.textContent.trim() === 'READY', 'product app flow route');
      await waitFor(() => document.querySelector('#app-flow-run') && !document.querySelector('#app-flow-run').disabled, 'product app flow action button');
      document.querySelector('#app-flow-run').click();
      await waitFor(() => document.querySelector('#app-flow-status')?.textContent.trim() === 'COMPLETED', 'product app flow completion');
      await waitFor(() => document.querySelector('#app-exception-run') && !document.querySelector('#app-exception-run').disabled, 'product app exception action button');
      document.querySelector('#app-exception-run').click();
      await waitFor(() => document.querySelector('#app-exception-status')?.textContent.trim() === 'BRANCHES_READY', 'product app exception completion');
      const bodyText = document.body.textContent || '';
      return {
        status: document.querySelector('#app-flow-status')?.textContent.trim() || '',
        exceptionStatus: document.querySelector('#app-exception-status')?.textContent.trim() || '',
        route: document.querySelector('#app-route-label')?.textContent.trim() || '',
        resultRows: document.querySelectorAll('#app-flow-result article').length,
        exceptionRows: document.querySelectorAll('#app-exception-result article').length,
        hasStoreOrder: bodyText.includes('门店下单'),
        hasPurchaserConfirm: bodyText.includes('采购确认'),
        hasSupplierShipment: bodyText.includes('供应商发货'),
        hasStoreReceipt: bodyText.includes('门店收货'),
        hasSupplierRejection: bodyText.includes('供应商拒单'),
        hasPurchaserReallocation: bodyText.includes('采购改派'),
        hasDiscrepancyAccept: bodyText.includes('差异同意'),
        hasReplenishReturn: bodyText.includes('补发退回'),
        noticeText: document.querySelector('#app-notice')?.textContent.trim() || '',
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

async function runProductAppSupplierDiscrepancyAction(cdp, viewport, fileName) {
  await setViewport(cdp, viewport);
  await navigate(cdp, `${webBaseUrl}/app.html?demo=1&capture=${Date.now()}#/supplier`);
  const state = await evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 200; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#app-status')?.textContent.trim() === 'READY', 'product app supplier discrepancy route');
      const seed = await (await fetch('/main-flow-demo-seed.json?ts=' + Date.now())).json();
      const apiBase = location.protocol + '//' + location.hostname + ':3100/api/v1';
      const call = async (path, token, options = {}) => {
        const response = await fetch(apiBase + path, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...options.headers } });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || 'API ' + path + ' failed: ' + response.status);
        return body.data ?? body;
      };
      const auth = async (username, client) => (await call('/auth/login', null, { method: 'POST', body: JSON.stringify({ username, password: seed.password, client }) })).accessToken;
      const [storeToken, purchaserToken, supplierToken] = await Promise.all([
        auth(seed.storeUsername, 'product-app-discrepancy-store'),
        auth(seed.username, 'product-app-discrepancy-purchaser'),
        auth(seed.supplierUsername, 'product-app-discrepancy-supplier'),
      ]);
      const createRoleDiscrepancy = async (prefix) => {
        const input = { storeId: seed.storeId, items: [{ productId: seed.productId, quantity: seed.quantity }] };
        const created = await call('/purchase-requests', storeToken, { method: 'POST', headers: { 'idempotency-key': prefix + '-order-' + crypto.randomUUID() }, body: JSON.stringify(input) });
        const requestDetail = await call('/purchase-requests/' + created.id, purchaserToken);
        const confirmed = await call('/purchase-requests/' + created.id + '/confirm', purchaserToken, { method: 'POST', headers: { 'idempotency-key': prefix + '-confirm-' + crypto.randomUUID() }, body: JSON.stringify({ expectedVersion: requestDetail.version }) });
        const orderId = confirmed.supplierOrderIds?.[0] || confirmed.supplierOrders?.[0]?.id || confirmed.orders?.[0]?.id;
        if (!orderId) throw new Error('Supplier order was not created for role discrepancy evidence.');
        const order = await call('/supplier-orders/' + orderId, supplierToken);
        const shipInput = { expectedVersion: order.version, items: order.items.map((item) => ({ orderItemId: item.id, shipQuantity: (Number(item.quantity) - 2).toFixed(6), permanentlyReduceQuantity: '0' })), freight: '0.00', trackingNo: 'APP-ROLE-DISCREPANCY-' + Date.now() };
        await call('/supplier-orders/' + orderId + '/shipment-preview', supplierToken, { method: 'POST', body: JSON.stringify(shipInput) });
        const shipment = await call('/supplier-orders/' + orderId + '/shipments', supplierToken, { method: 'POST', headers: { 'idempotency-key': prefix + '-ship-' + crypto.randomUUID() }, body: JSON.stringify(shipInput) });
        const afterShip = await call('/supplier-orders/' + orderId, supplierToken);
        const receipt = await call('/shipments/' + shipment.id + '/receipts', storeToken, { method: 'POST', headers: { 'idempotency-key': prefix + '-receipt-' + crypto.randomUUID() }, body: JSON.stringify({ expectedOrderVersion: afterShip.version, expectedReceiptRevision: 0, items: shipment.items.map((item) => ({ shipmentItemId: item.id, receivedQuantity: (Number(item.quantity) - 2).toFixed(6) })) }) });
        const notifications = await call('/notifications', supplierToken);
        const message = (notifications.notifications || []).find((item) => item.payload?.receiptId === receipt.id);
        const discrepancyId = message?.payload?.discrepancyIds?.[0];
        if (!discrepancyId) throw new Error('Supplier discrepancy notification was not created.');
        return { discrepancyId, workflow: { purchaseRequestId: created.id, purchaseRequestNo: created.requestNo, purchaseRequestStatus: confirmed.status, supplierOrderId: orderId, supplierOrderStatus: afterShip.status, shipmentId: shipment.id, shipmentNo: shipment.shipmentNo, shipmentStatus: shipment.status || 'SHIPPED', receiptId: receipt.id, receiptStatus: receipt.status, updatedAt: new Date().toISOString() } };
      };
      const replenishCase = await createRoleDiscrepancy('product-app-role-replenish');
      const discrepancyId = replenishCase.discrepancyId;
      sessionStorage.setItem('procurex-product-app-workflow', JSON.stringify(replenishCase.workflow));
      location.hash = '#/overview';
      await waitFor(() => document.querySelector('#app-route-label')?.textContent.trim() === '业务总览', 'overview before supplier refresh');
      location.hash = '#/supplier';
      await waitFor(() => document.querySelector('#app-route-label')?.textContent.trim() === '供应商' && document.querySelector('#app-status')?.textContent.trim() === 'READY' && document.querySelector('#app-resolve-discrepancy'), 'refreshed supplier discrepancy route');
      await waitFor(() => [...document.querySelectorAll('[data-app-discrepancy]')].some((button) => button.dataset.appDiscrepancy === discrepancyId), 'supplier discrepancy notification row');
      document.querySelector('[data-app-discrepancy="' + discrepancyId + '"]').click();
      await waitFor(() => document.querySelector('#app-supplier-result')?.textContent.includes(discrepancyId), 'supplier discrepancy detail');
      document.querySelector('#app-discrepancy-action').value = 'REPLENISH';
      document.querySelector('#app-resolve-discrepancy').click();
      await waitFor(() => document.querySelector('#app-supplier-label')?.textContent.includes('补发已发出') || document.querySelector('#app-notice')?.textContent.trim(), 'supplier replenishment shipment');
      if (!document.querySelector('#app-supplier-label')?.textContent.includes('补发已发出')) throw new Error('Supplier role replenishment failed: ' + document.querySelector('#app-notice')?.textContent.trim());
      const workflow = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}');
      const supplierLabel = document.querySelector('#app-supplier-label')?.textContent.trim() || '';
      location.hash = '#/overview';
      await waitFor(() => document.querySelector('#app-view')?.textContent.includes('门店继续收货'), 'store receiving next action');
      const roleActions = [{ action: 'REPLENISH', status: workflow.discrepancyStatus || '' }];
      for (const action of ['ACCEPT', 'RETURN']) {
        const nextCase = await createRoleDiscrepancy('product-app-role-' + action.toLowerCase());
        location.hash = '#/overview';
        await waitFor(() => document.querySelector('#app-route-label')?.textContent.trim() === '业务总览', 'overview before ' + action);
        location.hash = '#/supplier';
        await waitFor(() => document.querySelector('#app-route-label')?.textContent.trim() === '供应商' && document.querySelector('#app-status')?.textContent.trim() === 'READY' && document.querySelector('#app-resolve-discrepancy'), 'supplier route for ' + action);
        await waitFor(() => [...document.querySelectorAll('[data-app-discrepancy]')].some((button) => button.dataset.appDiscrepancy === nextCase.discrepancyId), action + ' discrepancy notification');
        document.querySelector('[data-app-discrepancy="' + nextCase.discrepancyId + '"]').click();
        await waitFor(() => document.querySelector('#app-supplier-result')?.textContent.includes(nextCase.discrepancyId), action + ' discrepancy detail');
        document.querySelector('#app-discrepancy-action').value = action;
        document.querySelector('#app-resolve-discrepancy').click();
        await waitFor(() => document.querySelector('#app-supplier-label')?.textContent.trim() === 'RESOLVED' || document.querySelector('#app-notice')?.textContent.trim(), action + ' resolution result');
        if (document.querySelector('#app-supplier-label')?.textContent.trim() !== 'RESOLVED') throw new Error('Supplier role ' + action + ' failed: ' + document.querySelector('#app-notice')?.textContent.trim());
        const actionWorkflow = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}');
        roleActions.push({ action, status: actionWorkflow.discrepancyStatus || '', discrepancyId: actionWorkflow.discrepancyId || '' });
      }
      if (roleActions.map((item) => item.action).join(',') !== 'REPLENISH,ACCEPT,RETURN' || roleActions.some((item) => !item.status)) throw new Error('Supplier role discrepancy actions did not all reach a resolved state.');
      sessionStorage.setItem('procurex-product-app-workflow', JSON.stringify(workflow));
      location.hash = '#/overview';
      await waitFor(() => document.querySelector('#app-view')?.textContent.includes('门店继续收货'), 'overview after discrepancy role actions');
      return {
        status: supplierLabel,
        action: workflow.discrepancyAction || '',
        discrepancyStatus: workflow.discrepancyStatus || '',
        hasGapAllocation: Boolean(workflow.replenishmentGapId),
        shipmentId: workflow.shipmentId || '',
        nextAction: '门店继续收货',
        roleActions,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    })()
  `);
  const file = resolve(outputDir, fileName);
  await rm(file, { force: true });
  await captureScreenshot(cdp, file);
  return { file, state, viewport };
}

async function runProductAppRoleMutationJourney(cdp, viewport, fileName) {
  await setViewport(cdp, viewport);
  await navigate(cdp, `${webBaseUrl}/app.html?demo=1&capture=${Date.now()}#/store`);
  const state = await evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 200; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      const route = async (hash, label) => {
        location.hash = hash;
        await waitFor(() => document.querySelector('#app-route-label')?.textContent.trim() === label && document.querySelector('#app-view')?.children.length > 0, label + ' route');
      };
      const handoff = async (title) => {
        await route('#/overview', '业务总览');
        await waitFor(() => document.querySelector('#app-view')?.textContent.includes(title), 'Overview next action: ' + title);
        return title;
      };
      await waitFor(() => document.querySelector('#app-route-label')?.textContent.trim() === '门店' && document.querySelector('#app-store-order-form'), 'product app Store route');
      document.querySelector('#app-store-order-form button[type="submit"]').click();
      await waitFor(() => document.querySelector('#app-store-order-label')?.textContent.trim() === '已提交', 'Store order create');
      const requestId = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}').purchaseRequestId;
      const nextActions = [await handoff('采购确认并分配供应商')];

      await route('#/purchaser', '采购');
      await waitFor(() => document.querySelector('#app-request-id')?.value === requestId, 'Purchaser request prefill');
      document.querySelector('#app-load-request').click();
      await waitFor(() => document.querySelector('#app-purchaser-label')?.textContent === 'PENDING_PROCUREMENT', 'Purchaser request detail');
      document.querySelector('#app-confirm-request').click();
      await waitFor(() => document.querySelector('#app-purchaser-action-label')?.textContent === 'CONFIRMED', 'Purchaser confirm action');
      nextActions.push(await handoff('供应商继续发货'));

      await route('#/supplier', '供应商');
      document.querySelector('#app-ship-order').click();
      await waitFor(() => document.querySelector('#app-supplier-label')?.textContent === 'SHIPPED', 'Supplier shipment action');
      nextActions.push(await handoff('门店继续收货'));

      await route('#/store', '门店');
      document.querySelector('#app-receive-shipment').click();
      await waitFor(() => document.querySelector('#app-store-receipt-label')?.textContent === 'COMPLETED', 'Store receipt action');
      nextActions.push(await handoff('财务登记付款'));
      const completedWorkflow = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}');

      await route('#/store', '门店');
      document.querySelector('#app-store-order-form button[type="submit"]').click();
      await waitFor(() => document.querySelector('#app-store-order-label')?.textContent.trim() === '已提交', 'Store order create for rejection branch');
      const rejectedRequestId = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}').purchaseRequestId;
      nextActions.push(await handoff('采购确认并分配供应商'));
      await route('#/purchaser', '采购');
      await waitFor(() => document.querySelector('#app-request-id')?.value === rejectedRequestId, 'Purchaser rejection-branch request prefill');
      document.querySelector('#app-load-request').click();
      await waitFor(() => document.querySelector('#app-purchaser-label')?.textContent === 'PENDING_PROCUREMENT', 'Purchaser rejection-branch request detail');
      document.querySelector('#app-confirm-request').click();
      await waitFor(() => document.querySelector('#app-purchaser-action-label')?.textContent === 'CONFIRMED', 'Purchaser rejection-branch confirmation');
      nextActions.push(await handoff('供应商继续发货'));

      await route('#/supplier', '供应商');
      document.querySelector('#app-reject-order').click();
      await waitFor(() => document.querySelector('#app-supplier-label')?.textContent === 'REJECTED', 'Supplier reject action');
      nextActions.push(await handoff('采购处理供应商拒单'));
      await route('#/purchaser', '采购');
      await waitFor(() => [...document.querySelectorAll('[data-app-reject-request]')].some((button) => button.dataset.appRejectRequest === rejectedRequestId), 'Purchaser rejection task');
      const rejectionTask = [...document.querySelectorAll('[data-app-reject-request]')].find((button) => button.dataset.appRejectRequest === rejectedRequestId);
      rejectionTask.click();
      await waitFor(() => document.querySelectorAll('#app-request-detail article').length > 0, 'Purchaser rejection task detail');
      document.querySelector('#app-reallocate-request').click();
      await waitFor(() => document.querySelector('#app-purchaser-action-label')?.textContent === 'REALLOCATED' || document.querySelector('#app-notice')?.textContent.trim(), 'Purchaser reallocation action');
      if (document.querySelector('#app-purchaser-action-label')?.textContent !== 'REALLOCATED') throw new Error('Purchaser reallocation failed: ' + document.querySelector('#app-notice')?.textContent.trim());
      const reallocationWorkflow = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}');
      const reallocationNextAction = await handoff('供应商继续发货');
      nextActions.push(reallocationNextAction);
      const rejectedSupplierOrderId = rejectionTask.dataset.appRejectOrder;
      if (!reallocationWorkflow.supplierOrderId || reallocationWorkflow.supplierOrderId === rejectedSupplierOrderId || reallocationWorkflow.purchaseRequestStatus !== 'CONFIRMED' || reallocationNextAction !== '供应商继续发货') {
        throw new Error('Purchaser reallocation did not create a replacement supplier handoff: ' + JSON.stringify({ rejectedSupplierOrderId, reallocationWorkflow, reallocationNextAction }));
      }
      const workflow = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}');
      return { requestId, nextActions, supplierOrderId: workflow.supplierOrderId || '', supplierOrderStatus: workflow.supplierOrderStatus || '', purchaseRequestStatus: workflow.purchaseRequestStatus || '', rejectedSupplierOrderId, reallocatedSupplierOrderId: reallocationWorkflow.supplierOrderId || '', reallocatedPurchaseRequestStatus: reallocationWorkflow.purchaseRequestStatus || '', completedShipmentId: completedWorkflow.shipmentId || '', completedReceiptId: completedWorkflow.receiptId || '', completedReceiptStatus: completedWorkflow.receiptStatus || '', horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
    })()
  `);
  const file = resolve(outputDir, fileName);
  await rm(file, { force: true });
  await captureScreenshot(cdp, file);
  return { file, state, viewport };
}

async function runProductAppFinanceAction(cdp, viewport, fileName) {
  await setViewport(cdp, viewport);
  await navigate(cdp, `${webBaseUrl}/app.html?demo=1&capture=${Date.now()}#/finance`);
  const state = await evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 180; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#app-status')?.textContent.trim() === 'READY', 'product app finance route');
      await waitFor(() => document.querySelector('#app-create-confirm-payment') && !document.querySelector('#app-create-confirm-payment').disabled, 'product app create payment button');
      document.querySelector('#app-create-confirm-payment').click();
      await waitFor(() => document.querySelector('#app-payment-action-label')?.textContent.trim() === 'CONFIRMED', 'product app finance payment confirmation');
      const bodyText = document.body.textContent || '';
      return {
        status: document.querySelector('#app-payment-action-label')?.textContent.trim() || '',
        route: document.querySelector('#app-route-label')?.textContent.trim() || '',
        resultRows: document.querySelectorAll('#app-finance-result article').length,
        hasPaymentRecord: bodyText.includes('付款记录'),
        hasConfirmedStatus: bodyText.includes('CONFIRMED'),
        noticeText: document.querySelector('#app-notice')?.textContent.trim() || '',
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

async function runProductAppFinancePendingAction(cdp, viewport, fileName) {
  await setViewport(cdp, viewport);
  await navigate(cdp, `${webBaseUrl}/app.html?demo=1&capture=${Date.now()}#/finance`);
  const state = await evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 180; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#app-status')?.textContent.trim() === 'READY', 'product app finance route');
      await waitFor(() => document.querySelector('#app-create-pending-payment') && !document.querySelector('#app-create-pending-payment').disabled, 'product app pending payment button');
      document.querySelector('#app-create-pending-payment').click();
      await waitFor(() => document.querySelector('#app-payment-action-label')?.textContent.trim() === 'PENDING' || document.querySelector('#app-notice')?.textContent.trim(), 'product app pending payment registration');
      if (document.querySelector('#app-payment-action-label')?.textContent.trim() !== 'PENDING') {
        throw new Error(document.querySelector('#app-notice')?.textContent.trim() || 'Pending payment was not registered.');
      }
      const workflow = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}');
      const bodyText = document.body.textContent || '';
      const financeState = {
        status: document.querySelector('#app-payment-action-label')?.textContent.trim() || '',
        resultRows: document.querySelectorAll('#app-finance-result article').length,
        hasPaymentRecord: bodyText.includes('付款记录'),
        hasPendingStatus: bodyText.includes('PENDING'),
        workflowPaymentStatus: workflow.paymentStatus || '',
        workflowNextAction: workflow.paymentStatus === 'PENDING' ? '供应商确认收款' : '',
        noticeText: document.querySelector('#app-notice')?.textContent.trim() || '',
        viewportWidth: window.innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
      };
      location.hash = '#/overview';
      await waitFor(() => document.querySelector('#app-view')?.textContent.includes('供应商确认收款'), 'product app supplier next action');
      financeState.overviewRecommendsSupplier = document.querySelector('#app-view')?.textContent.includes('供应商确认收款') || false;
      document.querySelector('#app-refresh-workflow').click();
      await waitFor(() => document.querySelector('#app-notice')?.textContent.includes('API 刷新') || document.querySelector('#app-notice')?.textContent.includes('已更新可读取项'), 'product app workflow API refresh');
      const refreshedWorkflow = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}');
      financeState.overviewRefreshNotice = document.querySelector('#app-notice')?.textContent.trim() || '';
      financeState.refreshedPurchaseRequestStatus = refreshedWorkflow.purchaseRequestStatus || '';
      financeState.refreshedSupplierOrderStatus = refreshedWorkflow.supplierOrderStatus || '';
      financeState.refreshedShipmentStatus = refreshedWorkflow.shipmentStatus || '';
      financeState.refreshedReceiptStatus = refreshedWorkflow.receiptStatus || '';
      financeState.refreshedPaymentVersion = refreshedWorkflow.paymentVersion ?? null;
      financeState.refreshedReceiptRevision = refreshedWorkflow.receiptRevision ?? null;

      const journey = [];
      location.hash = '#/purchaser';
      await waitFor(() => document.querySelector('#app-load-request'), 'purchaser route refresh control');
      let refreshStamp = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}').updatedAt;
      document.querySelector('#app-load-request').click();
      await waitFor(() => { const current = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}'); return current.purchaseRequestStatus && current.updatedAt !== refreshStamp; }, 'purchaser request refresh');
      journey.push('PURCHASER');

      location.hash = '#/supplier';
      await waitFor(() => document.querySelector('#app-load-supplier-order'), 'supplier route refresh control');
      refreshStamp = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}').updatedAt;
      document.querySelector('#app-load-supplier-order').click();
      await waitFor(() => { const current = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}'); return current.supplierOrderStatus && current.updatedAt !== refreshStamp; }, 'supplier order refresh');
      journey.push('SUPPLIER_ORDER');

      location.hash = '#/store';
      await waitFor(() => document.querySelector('#app-load-shipment'), 'store route refresh control');
      refreshStamp = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}').updatedAt;
      document.querySelector('#app-load-shipment').click();
      await waitFor(() => { const current = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}'); return current.receiptRevision === 1 && current.updatedAt !== refreshStamp; }, 'store shipment and receipt refresh');
      journey.push('STORE');

      location.hash = '#/finance';
      await waitFor(() => document.querySelector('#app-load-payment'), 'finance route refresh control');
      refreshStamp = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}').updatedAt;
      document.querySelector('#app-load-payment').click();
      await waitFor(() => { const current = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}'); return current.paymentVersion && current.updatedAt !== refreshStamp; }, 'finance payment refresh');
      journey.push('FINANCE');

      location.hash = '#/supplier';
      await waitFor(() => document.querySelector('#app-supplier-order-id') && document.querySelector('#app-load-payment'), 'supplier payment route refresh control');
      document.querySelector('#app-load-payment').click();
      await waitFor(() => document.querySelector('#app-supplier-label')?.textContent.trim() === 'PENDING', 'supplier pending payment detail');
      document.querySelector('#app-confirm-payment').click();
      await waitFor(() => JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}').paymentStatus === 'CONFIRMED', 'supplier confirms payment');
      journey.push('SUPPLIER_PAYMENT');
      financeState.guidedJourney = journey;
      financeState.finalPaymentStatus = JSON.parse(sessionStorage.getItem('procurex-product-app-workflow') || '{}').paymentStatus;

      location.hash = '#/overview';
      await waitFor(() => document.querySelector('#app-view')?.textContent.includes('流程复核完成'), 'guided journey returns to overview');
      financeState.finalOverviewShowsCompleted = document.querySelector('#app-view')?.textContent.includes('流程复核完成') || false;
      return financeState;
    })()
  `);
  const file = resolve(outputDir, fileName);
  await rm(file, { force: true });
  await captureScreenshot(cdp, file);
  return { file, state, viewport };
}

async function runProductAppFinanceRejectAction(cdp, viewport, fileName) {
  await setViewport(cdp, viewport);
  await navigate(cdp, `${webBaseUrl}/app.html?demo=1&capture=${Date.now()}#/finance`);
  const state = await evaluate(cdp, `
    (async () => {
      const waitFor = async (predicate, label) => {
        for (let i = 0; i < 180; i += 1) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(label + ' did not become ready.');
      };
      await waitFor(() => document.querySelector('#app-status')?.textContent.trim() === 'READY', 'product app finance route');
      await waitFor(() => document.querySelector('#app-create-reject-payment') && !document.querySelector('#app-create-reject-payment').disabled, 'product app reject payment button');
      document.querySelector('#app-create-reject-payment').click();
      await waitFor(() => document.querySelector('#app-payment-action-label')?.textContent.trim() === 'REJECTED', 'product app finance payment rejection');
      const bodyText = document.body.textContent || '';
      return {
        status: document.querySelector('#app-payment-action-label')?.textContent.trim() || '',
        route: document.querySelector('#app-route-label')?.textContent.trim() || '',
        resultRows: document.querySelectorAll('#app-finance-result article').length,
        hasPaymentRecord: bodyText.includes('付款记录'),
        hasRejectedStatus: bodyText.includes('REJECTED'),
        noticeText: document.querySelector('#app-notice')?.textContent.trim() || '',
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
    await withService(`${webBaseUrl}/main-flow-demo.html`, 'Web server', 'npm', ['run', 'start:web:legacy'], async (startedWeb) => {
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
        const businessFlow = await captureBusinessFlow(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'm7-business-flow.png',
        );
        const mobileBusinessFlow = await captureBusinessFlow(
          cdp,
          { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
          'm7-business-flow-mobile.png',
        );
        const storeWorkbench = await captureStoreWorkbench(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'store-workbench.png',
        );
        const mobileStoreWorkbench = await captureStoreWorkbench(
          cdp,
          { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
          'store-workbench-mobile.png',
        );
        const purchaserWorkbench = await capturePurchaserWorkbench(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'purchaser-workbench.png',
        );
        const mobilePurchaserWorkbench = await capturePurchaserWorkbench(
          cdp,
          { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
          'purchaser-workbench-mobile.png',
        );
        const supplierWorkbench = await captureSupplierWorkbench(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'supplier-workbench.png',
        );
        const mobileSupplierWorkbench = await captureSupplierWorkbench(
          cdp,
          { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
          'supplier-workbench-mobile.png',
        );
        const productApp = await captureProductApp(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'overview',
          'product-app.png',
        );
        const mobileProductApp = await captureProductApp(
          cdp,
          { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
          'overview',
          'product-app-mobile.png',
        );
        const productAppStore = await captureProductApp(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'store',
          'product-app-store.png',
        );
        const productAppPurchaser = await captureProductApp(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'purchaser',
          'product-app-purchaser.png',
        );
        const productAppSupplier = await captureProductApp(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'supplier',
          'product-app-supplier.png',
        );
        const productAppFinance = await captureProductApp(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'finance',
          'product-app-finance.png',
        );
        const productAppFlowAction = await runProductAppFlow(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'product-app-flow-action.png',
        );
        const productAppFinanceRejectAction = await runProductAppFinanceRejectAction(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'product-app-finance-reject-action.png',
        );
        const productAppFinanceAction = await runProductAppFinanceAction(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'product-app-finance-action.png',
        );
        await run('npm', ['run', 'main-flow:seed-demo']);
        await run('npm', ['run', 'main-flow:check-demo']);
        const productAppSupplierDiscrepancyAction = await runProductAppSupplierDiscrepancyAction(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'product-app-supplier-discrepancy-action.png',
        );
        const productAppRoleMutationJourney = await runProductAppRoleMutationJourney(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'product-app-role-mutation-journey.png',
        );
        const mobileProductAppRoleMutationJourney = await runProductAppRoleMutationJourney(
          cdp,
          { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
          'product-app-role-mutation-journey-mobile.png',
        );
        const productAppWorkflowRefreshFlowAction = await runProductAppFlow(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'product-app-workflow-refresh-flow-action.png',
        );
        const productAppFinancePendingAction = await runProductAppFinancePendingAction(
          cdp,
          { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
          'product-app-finance-pending-action.png',
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
          businessFlowScreenshot: businessFlow.file,
          mobileBusinessFlowScreenshot: mobileBusinessFlow.file,
          storeWorkbenchScreenshot: storeWorkbench.file,
          mobileStoreWorkbenchScreenshot: mobileStoreWorkbench.file,
          purchaserWorkbenchScreenshot: purchaserWorkbench.file,
          mobilePurchaserWorkbenchScreenshot: mobilePurchaserWorkbench.file,
          supplierWorkbenchScreenshot: supplierWorkbench.file,
          mobileSupplierWorkbenchScreenshot: mobileSupplierWorkbench.file,
          productAppScreenshot: productApp.file,
          mobileProductAppScreenshot: mobileProductApp.file,
          productAppStoreScreenshot: productAppStore.file,
          productAppPurchaserScreenshot: productAppPurchaser.file,
          productAppSupplierScreenshot: productAppSupplier.file,
          productAppFinanceScreenshot: productAppFinance.file,
          productAppFlowActionScreenshot: productAppFlowAction.file,
          productAppExceptionActionScreenshot: productAppFlowAction.file,
          productAppFinanceRejectActionScreenshot: productAppFinanceRejectAction.file,
          productAppFinanceActionScreenshot: productAppFinanceAction.file,
          productAppFinancePendingActionScreenshot: productAppFinancePendingAction.file,
          productAppWorkflowRefreshFlowActionScreenshot: productAppWorkflowRefreshFlowAction.file,
          productAppSupplierDiscrepancyActionScreenshot: productAppSupplierDiscrepancyAction.file,
          productAppRoleMutationJourneyScreenshot: productAppRoleMutationJourney.file,
          mobileProductAppRoleMutationJourneyScreenshot: mobileProductAppRoleMutationJourney.file,
          services: { startedApi, startedWeb },
          state: desktop.state,
          roleWorkbenchAction: roleWorkbenchAction.state,
          mobileRoleWorkbenchAction: mobileRoleWorkbenchAction.state,
          businessFlow: businessFlow.state,
          mobileBusinessFlow: mobileBusinessFlow.state,
          storeWorkbench: storeWorkbench.state,
          mobileStoreWorkbench: mobileStoreWorkbench.state,
          purchaserWorkbench: purchaserWorkbench.state,
          mobilePurchaserWorkbench: mobilePurchaserWorkbench.state,
          supplierWorkbench: supplierWorkbench.state,
          mobileSupplierWorkbench: mobileSupplierWorkbench.state,
          productApp: productApp.state,
          mobileProductApp: mobileProductApp.state,
          productAppStore: productAppStore.state,
          productAppPurchaser: productAppPurchaser.state,
          productAppSupplier: productAppSupplier.state,
          productAppFinance: productAppFinance.state,
          productAppFlowAction: productAppFlowAction.state,
          productAppFinanceRejectAction: productAppFinanceRejectAction.state,
          productAppFinanceAction: productAppFinanceAction.state,
          productAppFinancePendingAction: productAppFinancePendingAction.state,
          productAppWorkflowRefreshFlowAction: productAppWorkflowRefreshFlowAction.state,
          productAppSupplierDiscrepancyAction: productAppSupplierDiscrepancyAction.state,
          productAppRoleMutationJourney: productAppRoleMutationJourney.state,
          mobileProductAppRoleMutationJourney: mobileProductAppRoleMutationJourney.state,
          productAppExceptionAction: {
            status: productAppFlowAction.state.exceptionStatus,
            resultRows: productAppFlowAction.state.exceptionRows,
            hasSupplierRejection: productAppFlowAction.state.hasSupplierRejection,
            hasPurchaserReallocation: productAppFlowAction.state.hasPurchaserReallocation,
            hasDiscrepancyAccept: productAppFlowAction.state.hasDiscrepancyAccept,
            hasReplenishReturn: productAppFlowAction.state.hasReplenishReturn,
            horizontalOverflow: productAppFlowAction.state.horizontalOverflow,
          },
          viewports: { desktop, mobile, roleWorkbenchAction, mobileRoleWorkbenchAction, businessFlow, mobileBusinessFlow, storeWorkbench, mobileStoreWorkbench, purchaserWorkbench, mobilePurchaserWorkbench, supplierWorkbench, mobileSupplierWorkbench, productApp, mobileProductApp, productAppStore, productAppPurchaser, productAppSupplier, productAppFinance, productAppFlowAction, productAppFinanceRejectAction, productAppFinanceAction, productAppFinancePendingAction, productAppWorkflowRefreshFlowAction, productAppSupplierDiscrepancyAction, productAppRoleMutationJourney, mobileProductAppRoleMutationJourney },
        }, null, 2)}\n`);
        console.log('Main-flow interactive browser evidence captured.');
        console.log(`  Browser: ${browser}`);
        console.log(`  API started by script: ${startedApi ? 'yes' : 'no'}`);
        console.log(`  Web started by script: ${startedWeb ? 'yes' : 'no'}`);
        console.log(`  Desktop screenshot: ${desktop.file}`);
        console.log(`  Mobile screenshot: ${mobile.file}`);
        console.log(`  Role workbench screenshot: ${roleWorkbenchAction.file}`);
        console.log(`  Mobile role workbench screenshot: ${mobileRoleWorkbenchAction.file}`);
        console.log(`  Business flow screenshot: ${businessFlow.file}`);
        console.log(`  Mobile business flow screenshot: ${mobileBusinessFlow.file}`);
        console.log(`  Store workbench screenshot: ${storeWorkbench.file}`);
        console.log(`  Mobile store workbench screenshot: ${mobileStoreWorkbench.file}`);
        console.log(`  Purchaser workbench screenshot: ${purchaserWorkbench.file}`);
        console.log(`  Mobile purchaser workbench screenshot: ${mobilePurchaserWorkbench.file}`);
        console.log(`  Supplier workbench screenshot: ${supplierWorkbench.file}`);
        console.log(`  Mobile supplier workbench screenshot: ${mobileSupplierWorkbench.file}`);
        console.log(`  Product app screenshot: ${productApp.file}`);
        console.log(`  Mobile product app screenshot: ${mobileProductApp.file}`);
        console.log(`  Product app finance screenshot: ${productAppFinance.file}`);
        console.log(`  Product app flow action screenshot: ${productAppFlowAction.file}`);
        console.log(`  Product app finance reject action screenshot: ${productAppFinanceRejectAction.file}`);
        console.log(`  Product app finance action screenshot: ${productAppFinanceAction.file}`);
        console.log(`  Desktop completed rows: ${desktop.state.completedRows}/${desktop.state.stepRows}`);
        console.log(`  Mobile completed rows: ${mobile.state.completedRows}/${mobile.state.stepRows}`);
        console.log(`  Role workbench flow: ${roleWorkbenchAction.state.status} (${roleWorkbenchAction.state.storeResultText}; ${roleWorkbenchAction.state.purchaserResultText}; ${roleWorkbenchAction.state.shipmentResultText}; ${roleWorkbenchAction.state.receiptResultText}; ${roleWorkbenchAction.state.discrepancyResultText}; ${roleWorkbenchAction.state.rejectionResultText}; ${roleWorkbenchAction.state.discrepancyBranchesResultText})`);
        console.log(`  Mobile role workbench flow: ${mobileRoleWorkbenchAction.state.status} (${mobileRoleWorkbenchAction.state.storeResultText}; ${mobileRoleWorkbenchAction.state.purchaserResultText}; ${mobileRoleWorkbenchAction.state.shipmentResultText}; ${mobileRoleWorkbenchAction.state.receiptResultText}; ${mobileRoleWorkbenchAction.state.discrepancyResultText}; ${mobileRoleWorkbenchAction.state.rejectionResultText}; ${mobileRoleWorkbenchAction.state.discrepancyBranchesResultText})`);
        console.log(`  Business flow stages: ${businessFlow.state.stageRows}, todos: ${businessFlow.state.todoRows}, finance cards: ${businessFlow.state.financeRows}`);
        console.log(`  Store workbench status: ${storeWorkbench.state.status}, orders: ${storeWorkbench.state.orderRows}, account cards: ${storeWorkbench.state.accountRows}`);
        console.log(`  Purchaser workbench status: ${purchaserWorkbench.state.status}, requests: ${purchaserWorkbench.state.requestRows}, rejections: ${purchaserWorkbench.state.rejectionCards}`);
        console.log(`  Supplier workbench status: ${supplierWorkbench.state.status}, orders: ${supplierWorkbench.state.orderRows}, discrepancies: ${supplierWorkbench.state.discrepancyCards}`);
        console.log(`  Product app routes: ${productApp.state.status}/${productAppStore.state.status}/${productAppPurchaser.state.status}/${productAppSupplier.state.status}/${productAppFinance.state.status}`);
        console.log(`  Product app flow action: ${productAppFlowAction.state.status}, rows: ${productAppFlowAction.state.resultRows}`);
        console.log(`  Product app exception action: ${productAppFlowAction.state.exceptionStatus}, rows: ${productAppFlowAction.state.exceptionRows}`);
        console.log(`  Product app finance reject action: ${productAppFinanceRejectAction.state.status}, rows: ${productAppFinanceRejectAction.state.resultRows}`);
        console.log(`  Product app finance action: ${productAppFinanceAction.state.status}, rows: ${productAppFinanceAction.state.resultRows}`);
        console.log(`  Product app pending handoff: ${productAppFinancePendingAction.state.status}, next: ${productAppFinancePendingAction.state.workflowNextAction}`);
        console.log(`  Product app supplier discrepancy: ${productAppSupplierDiscrepancyAction.state.action}/${productAppSupplierDiscrepancyAction.state.discrepancyStatus}, next: ${productAppSupplierDiscrepancyAction.state.nextAction}`);
        console.log(`  Product app role mutation journey: ${productAppRoleMutationJourney.state.nextActions.join(' -> ')}`);
        console.log(`  Mobile product app role mutation journey: ${mobileProductAppRoleMutationJourney.state.nextActions.join(' -> ')}`);
        console.log(`  Product app API refresh: ${productAppFinancePendingAction.state.overviewRefreshNotice}`);
        console.log(`  Product app guided journey: ${productAppFinancePendingAction.state.guidedJourney.join(' -> ')} -> ${productAppFinancePendingAction.state.finalPaymentStatus}, overview: ${productAppFinancePendingAction.state.finalOverviewShowsCompleted}`);
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
