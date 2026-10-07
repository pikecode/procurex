import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const execute = promisify(execFile);
const runId = randomUUID();
const container = `procurex-clean-${runId}`;
const root = `/private/tmp/${container}`;
const directory = resolve('var/clean-start-evidence');
const report = { runId, generatedAt: new Date().toISOString(), status: 'RUNNING',
  isolation: 'Owned disposable PostgreSQL, empty schema, new local private-file root and separate API; no existing database/files or OSS access', checks: [] };
let started = false;
let apiProcess;
let apiExit;
let apiLogs = '';
const command = (file, args, env = process.env) => execute(file, args, { env, timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
const docker = args => command('docker', args);
try {
  assert.match(container, /^procurex-clean-[0-9a-f-]{36}$/);
  await mkdir(root, { mode: 0o700 }); await chmod(root, 0o700);
  await mkdir(directory, { recursive: true });
  await command('npm', ['run', 'build']);
  await docker(['run', '--rm', '-d', '--name', container, '-p', '127.0.0.1::5432', '-e', 'POSTGRES_USER=procurex',
    '-e', 'POSTGRES_PASSWORD=clean_local_only', '-e', 'POSTGRES_DB=drill_source', 'postgres:18.3-alpine']);
  started = true;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { await docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'procurex', '-d', 'drill_source']); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert.ok(ready);
  const inspected = JSON.parse((await docker(['inspect', container])).stdout)[0];
  const binding = inspected.NetworkSettings.Ports['5432/tcp'][0];
  assert.equal(binding.HostIp, '127.0.0.1');
  assert.notEqual(binding.HostPort, '55438');
  const empty = await docker(['exec', container, 'psql', '-U', 'procurex', '-d', 'drill_source', '-Atc', "SELECT count(*) FROM pg_tables WHERE schemaname='public'"]);
  assert.equal(empty.stdout.trim(), '0');
  const env = { ...process.env, DATABASE_URL: `postgresql://procurex:clean_local_only@127.0.0.1:${binding.HostPort}/drill_source?schema=public`,
    FILE_STORAGE: 'local', PRIVATE_FILE_DIR: join(root, 'files'), NODE_ENV: 'test', HOST: '127.0.0.1', WORKSPACE_EVIDENCE_DIR: join(directory, 'web') };
  for (const key of Object.keys(env)) if (key.startsWith('OSS_')) delete env[key];
  await command('npm', ['run', 'db:migrate'], env);
  const migrations = await docker(['exec', container, 'psql', '-U', 'procurex', '-d', 'drill_source', '-Atc', 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL']);
  report.checks.push({ name: 'Build and deploy migrations from empty database', status: 'PASSED', migrations: Number(migrations.stdout.trim()) });
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  assert.ok(port !== 3114 && port !== 3100);
  env.PORT = String(port);
  env.WORKSPACE_API_URL = `http://127.0.0.1:${port}/api/v1`;
  apiProcess = spawn(process.execPath, ['dist/apps/api/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  apiExit = new Promise(resolve => { apiProcess.once('close', resolve); apiProcess.once('error', resolve); });
  for (const stream of [apiProcess.stdout, apiProcess.stderr]) stream.on('data', bytes => { apiLogs = (apiLogs + bytes.toString()).slice(-100000); });
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${env.WORKSPACE_API_URL}/health/ready`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).data.database === 'reachable') { healthy = true; break; }
    } catch { /* Startup may still be establishing its own pool. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(healthy, 'Fresh application must become ready');
  report.checks.push({ name: 'Separate fresh API readiness', status: 'PASSED', port });
  await command(process.execPath, ['scripts/capture-web-workspace.mjs'], env);
  const workspace = JSON.parse(await readFile(join(directory, 'web', 'manifest.json'), 'utf8'));
  assert.equal(workspace.status, 'PASSED');
  assert.equal(workspace.fixtureCleanup, 'PASSED');
  assert.deepEqual(workspace.browserErrors, []);
  report.checks.push({ name: 'Current formal Web cross-role workflow and scoped fixtures', status: 'PASSED', steps: workspace.steps.length, screenshots: workspace.screenshots.length });
  report.status = 'PASSED';
} catch (error) { report.status = 'FAILED'; report.failure = error.message; process.exitCode = 1; }
finally {
  try {
    if (apiProcess && apiProcess.exitCode === null && apiProcess.signalCode === null) apiProcess.kill('SIGTERM');
    if (apiExit) await apiExit;
    if (started) await docker(['rm', '-f', container]);
    assert.equal(root, `/private/tmp/procurex-clean-${runId}`);
    await rm(root, { recursive: true, force: true });
    report.cleanup = 'PASSED';
  } catch (error) { report.cleanup = 'FAILED'; report.cleanupError = error.message; report.status = 'FAILED'; process.exitCode = 1; }
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'api.log'), apiLogs);
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
}
