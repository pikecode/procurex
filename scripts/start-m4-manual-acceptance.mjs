import { spawn } from 'node:child_process';

const urls = [
  'http://127.0.0.1:4173/m4-acceptance.html',
  'http://127.0.0.1:4173/billing.html',
  'http://127.0.0.1:4173/main-flow-demo.html',
];

const children = [];

function start(name, command, args) {
  const child = spawn(command, args, { stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (signal) return;
    console.log(`${name} exited with code ${code}`);
    shutdown(code ?? 0);
  });
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('Starting M4 manual acceptance services...');
console.log('API: http://127.0.0.1:3100/api/v1');
console.log('Web: http://127.0.0.1:4173');
console.log('');
console.log('Seeded accounts use password: correct-password');
console.log('Primary reviewer account: pxacc_admin');
console.log('');

start('api', 'npm', ['run', 'start:api']);
start('web', 'npm', ['run', 'start:web']);

setTimeout(() => {
  console.log('');
  console.log('Opening manual acceptance pages:');
  for (const url of urls) console.log(`  ${url}`);

  if (process.platform === 'darwin') {
    spawn('open', ['-a', 'Google Chrome', ...urls], { stdio: 'ignore', detached: true }).unref();
  } else {
    console.log('Open the URLs above in Chrome, Chromium, or Firefox.');
  }
}, 2500);

console.log('Press Ctrl+C to stop the API and web server.');
