import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const execute = promisify(execFile), runId = randomUUID();
assert.ok(process.argv.slice(2).every(argument => argument === '--diagnostics'), 'Unknown load-runner argument');
const container = `procurex-load-${runId}`, root = `/private/tmp/${container}`;
const report = { status: 'RUNNING', generatedAt: new Date().toISOString(), runId,
  isolation: 'Dedicated random container/database/port/private files; no existing business database connection' };
let started = false;
const command = (file, args, env = process.env) => execute(file, args, { env, timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
const docker = args => command('docker', args);
try {
  await mkdir(root, { mode: 0o700 }); await chmod(root, 0o700); await mkdir(join(root, 'files'), { mode: 0o700 });
  await docker(['run', '--rm', '-d', '--name', container, '-p', '127.0.0.1::5432', '-e', 'POSTGRES_USER=procurex',
    '-e', 'POSTGRES_PASSWORD=load_local_only', '-e', 'POSTGRES_DB=load_acceptance', 'postgres:18.3-alpine']); started = true;
  let ready = false;
  for (let index = 0; index < 60; index++) {
    try { await docker(['exec', container, 'pg_isready', '-U', 'procurex', '-d', 'load_acceptance']); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert.ok(ready);
  const info = JSON.parse((await docker(['inspect', container])).stdout)[0];
  const binding = info.NetworkSettings.Ports['5432/tcp'][0]; assert.equal(binding.HostIp, '127.0.0.1');
  const env = { ...process.env, NODE_ENV: 'test', LOAD_ROOT: root, LOAD_RUN_ID: runId,
    LOAD_DIAGNOSTICS: process.argv.includes('--diagnostics') ? '1' : '0',
    DATABASE_URL: `postgresql://procurex:load_local_only@127.0.0.1:${binding.HostPort}/load_acceptance?schema=public`, PRIVATE_FILE_DIR: join(root, 'files') };
  await command('npm', ['run', 'db:migrate'], env);
  console.log('Fresh isolated schema ready; starting three real order-arrival profiles');
  try { await command(process.execPath, ['scripts/check-isolated-order-load.mjs'], env); }
  finally {
    try { report.load = JSON.parse(await readFile(join(root, 'load.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  assert.ok(['PASSED', 'CAPACITY_NOT_MET'].includes(report.load?.status));
  report.status = report.load.status;
  if (report.status !== 'PASSED') process.exitCode = 1;
} catch (error) { report.status = 'FAILED'; report.failure = error.message; process.exitCode = 1; }
finally {
  try {
    if (started) await docker(['rm', '-f', container]);
    assert.equal(root, `/private/tmp/procurex-load-${runId}`); await rm(root, { recursive: true, force: true }); report.cleanup = 'PASSED';
  } catch (error) { report.cleanup = 'FAILED'; report.cleanupError = error.message; report.status = 'FAILED'; process.exitCode = 1; }
  await mkdir(resolve('var/ops-order-load-evidence'), { recursive: true });
  try {
    const previous = await readFile(resolve('var/ops-order-load-evidence/manifest.json'), 'utf8');
    const oldRunId = JSON.parse(previous).runId;
    assert.match(oldRunId, /^[0-9a-f-]{36}$/);
    await writeFile(resolve(`var/ops-order-load-evidence/run-${oldRunId}.json`), previous);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(resolve('var/ops-order-load-evidence/manifest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
