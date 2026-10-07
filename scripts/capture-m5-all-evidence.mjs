import { spawn } from 'node:child_process';

const webBaseUrl = 'http://127.0.0.1:4173';
const apiReadyUrl = 'http://127.0.0.1:3100/api/v1/health/ready';
const children = [];

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function canReach(url) {
  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}ts=${Date.now()}`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, label) {
  for (let i = 0; i < 80; i += 1) {
    if (await canReach(url)) return;
    await wait(250);
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

function start(command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} ${args.join(' ')} exited by ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function withService(url, label, command, args, callback) {
  if (await canReach(url)) return callback(false);

  const child = start(command, args);
  try {
    await waitFor(url, label);
    return await callback(true);
  } finally {
    if (!child.killed) child.kill('SIGTERM');
  }
}

async function main() {
  await withService(apiReadyUrl, 'API', 'npm', ['run', 'start:api'], async (startedApi) => {
    await withService(`${webBaseUrl}/ops.html`, 'Web server', 'npm', ['run', 'start:web:legacy'], async (startedWeb) => {
      console.log('Refreshing M5 browser evidence...');
      console.log(`  API started by script: ${startedApi ? 'yes' : 'no'}`);
      console.log(`  Web started by script: ${startedWeb ? 'yes' : 'no'}`);
      await run('npm', ['run', 'm5:capture-browser-evidence']);
      await run('npm', ['run', 'm5:capture-ops-evidence']);
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
