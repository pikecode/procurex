import { loadSeedState } from './state.js';
import { routeFromHash, renderShell } from './shell.js';
import { setNotice } from './ui.js';
import * as overview from './pages/overview.js';
import * as flow from './pages/flow.js';
import * as store from './pages/store.js';
import * as purchaser from './pages/purchaser.js';
import * as supplier from './pages/supplier.js';
import * as finance from './pages/finance.js';
import { startWorkspace } from './workspace.js';

const pages = { overview, flow, store, purchaser, supplier, finance };

async function renderApp() {
  const route = routeFromHash();
  document.getElementById('product-app').innerHTML = renderShell(route);
  try {
    await loadSeedState();
    await pages[route].render();
  } catch (error) {
    setNotice(error.message);
    document.getElementById('app-status').textContent = '需要种子/API';
  }
}

if (new URLSearchParams(location.search).get('demo') === '1' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet'; stylesheet.href = '/style.css'; document.head.append(stylesheet);
  window.addEventListener('hashchange', renderApp);
  renderApp();
} else {
  startWorkspace();
}
