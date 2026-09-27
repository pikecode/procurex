import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';

const pathCommands = [
  ['chromium', 'Chromium'],
  ['chromium-browser', 'Chromium'],
  ['google-chrome', 'Google Chrome'],
  ['google-chrome-stable', 'Google Chrome'],
  ['firefox', 'Firefox'],
];

const appPaths = [
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'Google Chrome'],
  ['/Applications/Chromium.app/Contents/MacOS/Chromium', 'Chromium'],
  ['/Applications/Firefox.app/Contents/MacOS/firefox', 'Firefox'],
];

const found = [];

for (const [command, name] of pathCommands) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  if (result.status === 0) found.push({ name, path: result.stdout.trim(), source: 'PATH' });
}

for (const [path, name] of appPaths) {
  try {
    await access(path, constants.X_OK);
    found.push({ name, path, source: 'macOS app' });
  } catch {
    // Missing browsers are expected in headless development environments.
  }
}

if (found.length) {
  console.log('Browser runtime available for manual M4 acceptance:');
  for (const item of found) console.log(`  ${item.name}: ${item.path} (${item.source})`);
  process.exit(0);
}

console.log('No Chromium, Chrome, or Firefox runtime was found.');
console.log('M4 browserless evidence can still run, but DEV-402/403/406 cannot be finally closed without manual browser screenshots or recordings.');
