import { loadSeedState } from './state.js';
import { routeFromHash, renderShell } from './shell.js';
import { setNotice } from './ui.js';
import * as overview from './pages/overview.js';
import * as flow from './pages/flow.js';
import * as store from './pages/store.js';
import * as purchaser from './pages/purchaser.js';
import * as supplier from './pages/supplier.js';
import * as finance from './pages/finance.js';

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

window.addEventListener('hashchange', renderApp);
renderApp();
