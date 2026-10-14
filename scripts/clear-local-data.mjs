import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

assertLocalFixtureDatabase(process.env.DATABASE_URL);
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.port, '55438');
assert.equal(url.pathname, '/procurex');
assert.equal(url.username, 'procurex');
const apply = process.argv.includes('--apply');
const run = promisify(execFile);
const quote = value => `"${value.replaceAll('"', '""')}"`;
const directory = resolve('var/private-files/database-backups');
const stamp = Date.now();
let backup;
if (apply) {
  const container = JSON.parse((await run('docker', ['inspect', 'procurex-local-postgres-1'])).stdout)[0];
  assert.ok(container.NetworkSettings.Ports['5432/tcp']?.some(binding => binding.HostIp === '127.0.0.1' && binding.HostPort === url.port));
  const dump = await run('docker', ['exec', 'procurex-local-postgres-1', 'pg_dump', '-U', 'procurex', '-d', 'procurex', '-Fc'], { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  backup = resolve(directory, `before-full-local-clear-${stamp}.dump`);
  await writeFile(backup, dump.stdout, { flag: 'wx', mode: 0o600 });
  await run('docker', ['cp', backup, `procurex-local-postgres-1:/tmp/local-clear-${stamp}.dump`]);
  await run('docker', ['exec', 'procurex-local-postgres-1', 'pg_restore', '--list', `/tmp/local-clear-${stamp}.dump`]);
  assert.ok((await stat(backup)).size > 0);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
try {
  await db.query('BEGIN');
  await db.query("SET LOCAL lock_timeout = '10s'");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('procurex.catalog-registry'))");
  const admin = (await db.query(`SELECT u.id FROM "User" u JOIN "UserRole" ur ON ur."userId"=u.id JOIN "Role" r ON r.id=ur."roleId" WHERE u.username='admin' AND u.status='ACTIVE' AND r.code='ADMIN'`)).rows[0];
  assert.ok(admin, 'An active admin login is required');
  const preserved = ['_prisma_migrations', 'User', 'UserRole', 'Role', 'Permission', 'RolePermission'];
  const targets = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename).filter(name => !preserved.includes(name));
  const before = {};
  for (const name of targets) { const count = Number((await db.query(`SELECT count(*) n FROM ${quote(name)}`)).rows[0].n); if (count) before[name] = count; }
  const report = { apply, backup, preservedLogin: 'admin', tablesToClear: before };
  if (apply) {
    // All business tables are cleared together; keep schema and identity definitions.
    await db.query(`TRUNCATE TABLE ${targets.map(quote).join(', ')} RESTART IDENTITY`);
    await db.query('DELETE FROM "UserRole" WHERE "userId" <> $1::uuid', [admin.id]);
    await db.query('DELETE FROM "User" WHERE id <> $1::uuid', [admin.id]);
    await db.query('INSERT INTO "UserScope" (id,"userId","scopeType") VALUES (gen_random_uuid(),$1::uuid,\'COMPANY\')', [admin.id]);
    for (const name of targets.filter(name => name !== 'UserScope')) assert.equal(Number((await db.query(`SELECT count(*) n FROM ${quote(name)}`)).rows[0].n), 0, `${name} is not empty`);
    assert.equal(Number((await db.query('SELECT count(*) n FROM "User"')).rows[0].n), 1);
    await db.query('COMMIT');
    await writeFile(resolve(directory, `full-local-clear-${stamp}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: 'PASS', backup, preservedLogin: 'admin', clearedTables: targets.length, remainingBusinessRecords: 0 }));
  } else { await db.query('ROLLBACK'); console.log(JSON.stringify(report, null, 2)); }
} catch (error) { await db.query('ROLLBACK'); throw error; }
finally { db.release(); await pool.end(); }
