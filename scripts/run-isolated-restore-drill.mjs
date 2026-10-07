import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const execute = promisify(execFile);
const runId = randomUUID();
const container = `procurex-restore-${runId}`;
const root = `/private/tmp/${container}`;
const sourceFiles = join(root, 'source-files'), backupFiles = join(root, 'backup-files'), restoredFiles = join(root, 'restored-files');
const reportPath = resolve('var/ops-restore-evidence/manifest.json');
const report = { status: 'RUNNING', generatedAt: new Date().toISOString(), runId,
  isolation: 'Dedicated disposable container, two dedicated databases, private temporary file directories; existing business DB/files never connected or changed.',
  scope: 'Local point-in-time database/private-image recovery; not production RPO/RTO, OSS, continuous backup scheduling or previous-build rollback acceptance.', checks: [] };
let started = false;
const command = (file, args, env = process.env) => execute(file, args, { env, maxBuffer: 16 * 1024 * 1024, timeout: 180000 });
const docker = args => command('docker', args);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  assert.match(container, /^procurex-restore-[0-9a-f-]{36}$/);
  await mkdir(root, { mode: 0o700 }); await chmod(root, 0o700); await mkdir(sourceFiles, { mode: 0o700 });
  await mkdir(resolve('var/ops-restore-evidence'), { recursive: true });
  await docker(['run', '--rm', '-d', '--name', container, '-p', '127.0.0.1::5432', '-e', 'POSTGRES_USER=procurex', '-e', 'POSTGRES_PASSWORD=restore_local_only', '-e', 'POSTGRES_DB=drill_source', 'postgres:18.3-alpine']); started = true;
  let ready = false;
  for (let i = 0; i < 60; i++) { try { await docker(['exec', container, 'pg_isready', '-U', 'procurex', '-d', 'drill_source']); ready = true; break; } catch { await new Promise(r => setTimeout(r, 500)); } }
  assert.ok(ready, 'Dedicated PostgreSQL must become ready');
  const inspected = JSON.parse((await docker(['inspect', container])).stdout)[0];
  const binding = inspected.NetworkSettings.Ports['5432/tcp'][0]; assert.equal(binding.HostIp, '127.0.0.1');
  const sourceUrl = `postgresql://procurex:restore_local_only@127.0.0.1:${binding.HostPort}/drill_source?schema=public`;
  const restoreUrl = sourceUrl.replace('/drill_source?', '/drill_restore?');
  const password = randomUUID();
  const env = (url, files) => ({ ...process.env, DATABASE_URL: url, PRIVATE_FILE_DIR: files, RESTORE_DRILL_ROOT: root, RESTORE_DRILL_PASSWORD: password, REPORTS_ACCEPTANCE_OUTPUT: join(root, 'reports-acceptance.json'), PERFORMANCE_ACCEPTANCE_OUTPUT: join(root, 'performance.json') });
  await command('npm', ['run', 'db:migrate'], env(sourceUrl, sourceFiles));
  await command(process.execPath, ['scripts/restore-drill-scenario.mjs', 'seed'], env(sourceUrl, sourceFiles));
  const checkpoint = JSON.parse(await readFile(join(root, 'checkpoint.json'), 'utf8'));
  report.checks.push({ name: 'Fresh schema migration and real HTTP financial/evidence fixture', status: 'PASS', migrations: checkpoint.migrations, fileCount: checkpoint.files.length });
  const backupStarted = Date.now();
  await docker(['exec', container, 'pg_dump', '-U', 'procurex', '-d', 'drill_source', '--format=custom', '--file=/tmp/drill.dump']);
  const dumpPath = join(root, 'database.dump');
  await docker(['cp', `${container}:/tmp/drill.dump`, dumpPath]); await chmod(dumpPath, 0o600);
  await cp(sourceFiles, backupFiles, { recursive: true }); await chmod(backupFiles, 0o700);
  report.backup = { bytes: (await stat(dumpPath)).size, checksum: hash(await readFile(dumpPath)), files: checkpoint.files.length, durationMs: Date.now() - backupStarted };
  assert.ok(report.backup.bytes > 0);
  await docker(['exec', container, 'psql', '-U', 'procurex', '-d', 'drill_source', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE TABLE "PostBackupProbe" (id integer PRIMARY KEY); INSERT INTO "PostBackupProbe" VALUES (1);']);
  const outageStarted = Date.now();
  await docker(['exec', container, 'dropdb', '-U', 'procurex', 'drill_source']);
  await rm(sourceFiles, { recursive: true });
  await assert.rejects(stat(sourceFiles));
  await docker(['exec', container, 'createdb', '-U', 'procurex', 'drill_restore']);
  const empty = await docker(['exec', container, 'psql', '-U', 'procurex', '-d', 'drill_restore', '-Atc', "SELECT count(*) FROM pg_tables WHERE schemaname='public'"]);
  assert.equal(empty.stdout.trim(), '0');
  await docker(['exec', container, 'pg_restore', '--exit-on-error', '--no-owner', '-U', 'procurex', '-d', 'drill_restore', '/tmp/drill.dump']);
  await cp(backupFiles, restoredFiles, { recursive: true }); await chmod(restoredFiles, 0o700);
  await command(process.execPath, ['scripts/restore-drill-scenario.mjs', 'verify'], env(restoreUrl, restoredFiles));
  const verified = JSON.parse(await readFile(join(root, 'verified.json'), 'utf8'));
  report.checks.push(...verified.checks);
  report.measurements = { recoveryMs: Date.now() - outageStarted, checkpointAgeAtOutageMs: outageStarted - backupStarted, recoveryTargetMs: 4 * 60 * 60 * 1000, checkpointAgeTargetMs: 15 * 60 * 1000,
    limitation: 'Age of this local manual backup at simulated outage, not evidence of scheduled production RPO or WAL point-in-time recovery.' };
  assert.ok(report.measurements.recoveryMs <= report.measurements.recoveryTargetMs);
  assert.ok(report.measurements.checkpointAgeAtOutageMs <= report.measurements.checkpointAgeTargetMs);
  for (const [script, name] of [
    ['seed-reports-acceptance.mjs', 'Prepare separate report fixtures inside recovered disposable database'],
    ['check-reports-acceptance.mjs', 'Current R01-R05 reports, scoped CSV, stale export recovery and failed-job retry'],
    ['check-m6-performance.mjs', 'Bounded concurrent list/report requests and complete CSV download in disposable database'],
    ['seed-notifications-acceptance.mjs', 'Prepare separate overdue-notification fixtures inside recovered disposable database'],
    ['check-notifications-acceptance.mjs', 'Current own-user read, foreign-user refusal and overdue reminder deduplication'],
    ['check-isolated-scale.mjs', '100,000 completed profit rows: real HTTP totals and asynchronous CSV download'],
  ]) {
    const startedAt = Date.now();
    try {
      await command(process.execPath, [`scripts/${script}`], env(restoreUrl, restoredFiles));
    } catch (error) {
      if (script === 'check-m6-performance.mjs') {
        report.performanceAcceptance = JSON.parse(await readFile(join(root, 'performance.json'), 'utf8'));
      }
      throw error;
    }
    report.checks.push({ name, status: 'PASS', durationMs: Date.now() - startedAt });
  }
  const reports = JSON.parse(await readFile(join(root, 'reports-acceptance.json'), 'utf8'));
  assert.equal(reports.status, 'PASSED'); report.reportAcceptance = { status: reports.status, steps: reports.steps.length, fixture: 'PXRPT in disposable recovered database, not existing business database' };
  const performanceReport = JSON.parse(await readFile(join(root, 'performance.json'), 'utf8'));
  assert.equal(performanceReport.status, 'LOCAL_READY');
  report.performanceAcceptance = performanceReport;
  report.scaleAcceptance = JSON.parse(await readFile(join(root, 'scale.json'), 'utf8'));
  assert.equal(report.scaleAcceptance.status, 'PASSED');
  report.status = 'PASSED';
} catch (error) { report.status = 'FAILED'; report.failure = error.message; process.exitCode = 1; }
finally {
  try {
    if (started) await docker(['rm', '-f', container]);
    assert.equal(root, `/private/tmp/procurex-restore-${runId}`); await rm(root, { recursive: true, force: true }); report.cleanup = 'PASSED';
  } catch (error) { report.cleanup = 'FAILED'; report.cleanupError = error.message; report.status = 'FAILED'; process.exitCode = 1; }
  await mkdir(resolve('var/ops-restore-evidence'), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
