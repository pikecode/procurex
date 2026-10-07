import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { actualRestorePassed } from './restore-drill-evidence.mjs';

const evidence = () => ({ status: 'PASSED', cleanup: 'PASSED', checks: [{ status: 'PASS', migrations: [{ count: 62 }] }], backup: { bytes: 100, files: 4, checksum: 'a'.repeat(64) }, measurements: { recoveryMs: 1000, checkpointAgeAtOutageMs: 200 } });
test('restore evidence accepts actual successful current-migration drill', () => assert.equal(actualRestorePassed(evidence(), 62), true));
for (const [name, change] of [
  ['missing', () => null], ['failed cleanup', value => ({ ...value, cleanup: 'FAILED' })],
  ['malformed checks', value => ({ ...value, checks: {} })], ['null check', value => ({ ...value, checks: [...value.checks, null] })],
  ['old migrations', value => ({ ...value, checks: [{ status: 'PASS', migrations: [{ count: 61 }] }] })],
  ['failed check', value => ({ ...value, checks: [...value.checks, { status: 'FAIL' }] })],
  ['invalid dump checksum', value => ({ ...value, backup: { ...value.backup, checksum: '' } })],
  ['negative recovery time', value => ({ ...value, measurements: { ...value.measurements, recoveryMs: -1 } })],
  ['missed recovery target', value => ({ ...value, measurements: { ...value.measurements, recoveryMs: 14400001 } })],
  ['missed checkpoint-age target', value => ({ ...value, measurements: { ...value.measurements, checkpointAgeAtOutageMs: 900001 } })],
]) test(`restore evidence refuses ${name}`, () => assert.equal(actualRestorePassed(change(evidence()), 62), false));

for (const [name, database, root, files] of [
  ['existing business database', 'postgresql://local:local@127.0.0.1:55438/procurex', '/private/tmp/other', '/private/tmp/other'],
  ['remote database', 'postgresql://local:local@example.com:5432/drill_source', '/private/tmp/other', '/private/tmp/other'],
  ['existing business port', 'postgresql://local:local@127.0.0.1:55438/drill_source', '/private/tmp/other', '/private/tmp/other'],
  ['unowned file root', 'postgresql://local:local@127.0.0.1:5433/drill_source', '/private/tmp/other', '/private/tmp/other'],
  ['shared private files', 'postgresql://local:local@127.0.0.1:5433/drill_source', '/private/tmp/procurex-restore-00000000-0000-0000-0000-000000000000', 'var/private-files'],
]) test(`restore scenario refuses ${name} before creating its application`, () => {
  const result = spawnSync(process.execPath, ['scripts/restore-drill-scenario.mjs', 'seed'], {
    env: { ...process.env, DATABASE_URL: database, RESTORE_DRILL_ROOT: root, PRIVATE_FILE_DIR: files, RESTORE_DRILL_PASSWORD: 'local-test-only' }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /AssertionError/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|PrismaClientInitializationError/);
  const scale = spawnSync(process.execPath, ['scripts/check-isolated-scale.mjs'], {
    env: { ...process.env, DATABASE_URL: database.replace('/drill_source', '/drill_restore'), RESTORE_DRILL_ROOT: root, PRIVATE_FILE_DIR: files }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(scale.status, 1); assert.match(scale.stderr, /AssertionError/);
  assert.doesNotMatch(scale.stderr, /ECONNREFUSED|PrismaClientInitializationError/);
});
