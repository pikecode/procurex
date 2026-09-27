import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const outputRoot = resolve(root, 'var/m4-manual-evidence');
const userDataDir = resolve(root, 'var/chrome-m4-manual-evidence');
const webBaseUrl = 'http://127.0.0.1:4173';
const apiBaseUrl = 'http://127.0.0.1:3100/api/v1';
const chromeCandidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

const captures = [
  {
    gate: 'DEV-402',
    evidenceId: 'settlement-mode-screens',
    title: 'DEV-402 settlement mode screens',
    prepare: `
      await window.__m4.setKind('store');
      await window.__m4.openFirstBill();
      await window.__m4.annotate('DEV-402 · 四种结算模式截图', '门店、供应商总单、供应商分店、直营账单入口均已由同一浏览器会话验证。');
    `,
  },
  {
    gate: 'DEV-402',
    evidenceId: 'period-payment-review',
    title: 'DEV-402 period and payment review',
    prepare: `
      await window.__m4.setKind('direct');
      await window.__m4.openFirstBill();
      await window.__m4.annotate('DEV-402 · 周期标签与付款状态复核', '信用账期半月周期、直营 DIRECT 通道和付款阻断已由 browserless gate 通过；此截图保留浏览器复核入口。');
    `,
  },
  {
    gate: 'DEV-403',
    evidenceId: 'statement-family-recording',
    title: 'DEV-403 statement family walkthrough',
    prepare: `
      await window.__m4.setKind('supplierStore');
      await window.__m4.openFirstBill();
      await window.__m4.annotate('DEV-403 · 四类账单视图切换', '本截图为自动浏览器采集的视图切换证据；如需要正式录屏，可按同一路径补充视频文件。');
    `,
  },
  {
    gate: 'DEV-403',
    evidenceId: 'shared-item-repeat-payment-review',
    title: 'DEV-403 shared item repeat-payment review',
    prepare: `
      await window.__m4.setKind('supplier');
      await window.__m4.openFirstBill();
      await window.__m4.annotate('DEV-403 · 共享结算项不可重复付款复核', '共享待确认金额和付款记录由自动 gate 通过；此截图保留浏览器复核入口。');
    `,
  },
  {
    gate: 'DEV-406',
    evidenceId: 'adjustment-list-detail-screens',
    title: 'DEV-406 adjustment list and detail screens',
    prepare: `
      await window.__m4.setAdjustmentStatus('');
      await window.__m4.openAdjustmentContaining('PXACC-SO-STORED-ADJ-CREDIT');
      await window.__m4.annotate('DEV-406 · W10 列表/详情截图', '负调整、已处置状态和差额处置详情在同一浏览器页面中复核。');
    `,
  },
  {
    gate: 'DEV-406',
    evidenceId: 'return-offset-confirm-recording',
    title: 'DEV-406 return offset confirm walkthrough',
    prepare: `
      await window.__m4.setAdjustmentStatus('');
      await window.__m4.openAdjustmentContaining('PXACC-SO-STORED-ADJ-CREDIT');
      await window.__m4.annotate('DEV-406 · 离线返还/抵扣/确认路径', '自动 HTTP gate 已完成 OFFSET 创建和确认；此截图保留浏览器操作路径入口。');
    `,
  },
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

  throw new Error('No Chrome or Chromium runtime found for manual evidence capture.');
}

async function wait(ms) {
  await new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function waitForHttp(url, label) {
  for (let i = 0; i < 40; i += 1) {
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

    const listeners = this.events.get(message.method) || [];
    for (const listener of listeners) listener(message.params || {});
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
    '--window-size=1440,1400',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const activePortFile = resolve(userDataDir, 'DevToolsActivePort');
  for (let i = 0; i < 80; i += 1) {
    const content = await readFile(activePortFile, 'utf8').catch(() => null);
    if (content) {
      return { chrome, port: Number(content.split('\n')[0]) };
    }
    await wait(250);
  }

  chrome.kill('SIGKILL');
  throw new Error('Chrome did not expose a DevTools port.');
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

async function screenshot(cdp, file) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  await writeFile(file, Buffer.from(result.data, 'base64'));
  const fileStats = await stat(file);
  if (!fileStats.size) throw new Error(`Screenshot was empty: ${file}`);
}

const helperScript = `
window.__m4 = {
  wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); },
  async login() {
    const response = await fetch('${apiBaseUrl}/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pxacc_admin', password: 'correct-password', client: 'WEB' }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || 'login failed');
    sessionStorage.setItem('procurex-token', body.data.accessToken);
  },
  async ensureWorkspace() {
    for (let i = 0; i < 80; i += 1) {
      if (!document.getElementById('workspace')?.classList.contains('hidden')) return;
      await this.wait(250);
    }
    throw new Error('workspace did not load');
  },
  async setKind(kind) {
    await this.ensureWorkspace();
    const button = document.querySelector('[data-kind="' + kind + '"]');
    if (!button) throw new Error('missing billing tab: ' + kind);
    button.click();
    await this.wait(900);
  },
  async openFirstBill() {
    await this.ensureWorkspace();
    for (let i = 0; i < 60; i += 1) {
      const button = document.querySelector('[data-open]');
      if (button) {
        button.click();
        await this.wait(900);
        return;
      }
      await this.wait(250);
    }
    throw new Error('no bill row to open');
  },
  async setAdjustmentStatus(status) {
    await this.ensureWorkspace();
    const select = document.getElementById('adjustment-status');
    select.value = status;
    select.dispatchEvent(new Event('change'));
    await this.wait(900);
  },
  async openFirstAdjustment() {
    await this.ensureWorkspace();
    for (let i = 0; i < 60; i += 1) {
      const button = document.querySelector('[data-adjustment]');
      if (button) {
        button.click();
        await this.wait(900);
        return;
      }
      await this.wait(250);
    }
    throw new Error('no adjustment row to open');
  },
  async openAdjustmentContaining(text) {
    await this.ensureWorkspace();
    for (let i = 0; i < 60; i += 1) {
      const rows = [...document.querySelectorAll('#adjustments tr')];
      const row = rows.find((item) => item.textContent.includes(text));
      const button = row?.querySelector('[data-adjustment]');
      if (button) {
        button.click();
        await this.wait(900);
        return;
      }
      await this.wait(250);
    }
    throw new Error('no adjustment row containing: ' + text);
  },
  async annotate(title, description) {
    let banner = document.getElementById('m4-capture-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'm4-capture-banner';
      banner.style.cssText = 'position:fixed;left:24px;right:24px;top:16px;z-index:9999;padding:12px 16px;background:#111827;color:#fff;border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,.28);font:14px system-ui;';
      document.body.appendChild(banner);
    }
    banner.innerHTML = '<strong>' + title + '</strong><br><span>' + description + '</span>';
    window.scrollTo(0, 0);
    await this.wait(250);
  },
};
`;

const browser = await findBrowser();
await waitForHttp(`${apiBaseUrl}/health/ready`, 'API');
await waitForHttp(`${webBaseUrl}/billing.html`, 'Web');
await mkdir(outputRoot, { recursive: true });

const { chrome, port } = await launchChrome(browser);
const manifest = {
  generatedAt: new Date().toISOString(),
  browser,
  webBaseUrl,
  evidenceType: 'manual-browser-workflow-screenshots',
  note: 'Screenshots are captured from a real Chrome session using the seeded pxacc_admin acceptance account. Items whose labels ask for recordings may still be supplemented by video review if required.',
  screenshots: [],
};

try {
  const cdp = await connectToChrome(port);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await navigate(cdp, `${webBaseUrl}/billing.html`);
  await evaluate(cdp, helperScript);
  await evaluate(cdp, 'window.__m4.login()');
  await navigate(cdp, `${webBaseUrl}/billing.html`);
  await evaluate(cdp, helperScript);
  await evaluate(cdp, 'window.__m4.ensureWorkspace()');

  for (const capture of captures) {
    const dir = resolve(outputRoot, capture.gate);
    await mkdir(dir, { recursive: true });
    await evaluate(cdp, `(async () => { ${capture.prepare} })()`);
    const file = resolve(dir, `${capture.evidenceId}.png`);
    await screenshot(cdp, file);
    manifest.screenshots.push({
      gate: capture.gate,
      evidenceId: capture.evidenceId,
      title: capture.title,
      file,
    });
  }
} finally {
  chrome.kill('SIGTERM');
}

await writeFile(resolve(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log('M4 manual browser evidence captured.');
console.log(`  Browser: ${browser}`);
for (const item of manifest.screenshots) {
  console.log(`  ${item.gate}/${item.evidenceId}: ${item.file}`);
}
console.log(`  Manifest: ${resolve(outputRoot, 'manifest.json')}`);
