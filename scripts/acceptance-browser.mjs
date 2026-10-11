import { chromium, firefox, webkit } from 'playwright';

export async function launchAcceptanceBrowser() {
  if (process.env.WORKSPACE_BROWSER_WS) {
    return chromium.connect(process.env.WORKSPACE_BROWSER_WS, { exposeNetwork: '<loopback>' });
  }
  if (process.env.ACCEPTANCE_BROWSER === 'webkit') return webkit.launch();
  if (process.env.ACCEPTANCE_BROWSER === 'firefox') return firefox.launch();
  return chromium.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
}
