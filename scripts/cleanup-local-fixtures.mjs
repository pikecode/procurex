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
  backup = resolve(directory, `before-fixture-cleanup-${stamp}.dump`);
  await writeFile(backup, dump.stdout, { flag: 'wx', mode: 0o600 });
  await run('docker', ['cp', backup, `procurex-local-postgres-1:/tmp/fixture-cleanup-${stamp}.dump`]);
  await run('docker', ['exec', 'procurex-local-postgres-1', 'pg_restore', '--list', `/tmp/fixture-cleanup-${stamp}.dump`]);
  assert.ok((await stat(backup)).size > 0);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
try {
  await db.query('BEGIN');
  await db.query("SELECT pg_advisory_xact_lock(hashtext('procurex.catalog-registry'))");
  const names = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'")).rows.map(row => row.tablename);
  const temp = new Map(names.map((name, index) => [name, `cleanup_fixture_${index}`]));
  const marked = name => quote(temp.get(name));
  for (const name of names) await db.query(`CREATE TEMP TABLE ${marked(name)} ON COMMIT DROP AS SELECT * FROM ${quote(name)} WHERE FALSE`);
  const fks = (await db.query(`SELECT child.relname child, parent.relname parent,
    ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,o) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.o) cc,
    ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,o) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.o) pc
    FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid
    JOIN pg_namespace ns ON ns.oid=child.relnamespace WHERE c.contype='f' AND ns.nspname='public'`)).rows;
  // Match known integration fixtures, not the TEST_/CATDEMO acceptance catalog.
  const fixturePattern = '^(APQ|CCF|SCC[SC]|SPM[SC][PIF][TS]|ITLIST|ITTP|PC|TPL(CAT|UNIT|SKU|SUP|CYC)|CONF(CAT|UNIT|SKU[A-Z]*|SUP[A-Z]*|STORE|TPL))[0-9]';
  const roots = new Map();
  for (const name of ['Product', 'Category', 'Unit', 'Supplier', 'Store', 'OrderTemplate']) {
    const field = name === 'Product' ? 'sku' : 'code';
    const extra = name === 'Supplier' ? " OR code ~ '^it_workbench_[0-9]+'" : ['Store', 'OrderTemplate'].includes(name) ? " OR code LIKE 'SETTLE12%'" : '';
    await db.query(`INSERT INTO ${marked(name)} SELECT * FROM ${quote(name)} WHERE ${quote(field)} ~ $1${extra}`, [fixturePattern]);
    roots.set(name, (await db.query(`SELECT id FROM ${marked(name)}`)).rows.map(row => row.id));
  }
  await db.query(`INSERT INTO ${marked('User')} SELECT * FROM "User" WHERE username ~ $1 OR username ~ '^it_(confirm_|template_items_)[0-9A-Za-z_]*' OR (username LIKE 'permissions_admin_%' AND status='DISABLED')`, [fixturePattern]);
  const users = (await db.query(`SELECT username FROM ${marked('User')}`)).rows.map(row => row.username);
  assert.ok(!users.includes('admin'));
  await db.query(`INSERT INTO ${marked('PriceScope')} SELECT * FROM "PriceScope" WHERE "templateKey" IN (SELECT id::text FROM ${marked('OrderTemplate')})`);
  const baselineOrders = (await db.query('SELECT id FROM "SupplierOrder" WHERE "storeId" <> ALL($1::uuid[]) ORDER BY id', [roots.get('Store')])).rows;
  const before = {};
  for (const name of ['Product', 'Category', 'Unit', 'Supplier', 'Store', 'OrderTemplate', 'User', 'SupplierOrder', 'RechargeDocument']) before[name] = Number((await db.query(`SELECT count(*) n FROM ${quote(name)}`)).rows[0].n);
  let changed = true;
  while (changed) {
    changed = false;
    for (const fk of fks) {
      const join = fk.cc.map((column, index) => `c.${quote(column)}=p.${quote(fk.pc[index])}`).join(' AND ');
      const result = await db.query(`INSERT INTO ${marked(fk.child)} SELECT c.* FROM ${quote(fk.child)} c WHERE EXISTS
        (SELECT 1 FROM ${marked(fk.parent)} p WHERE ${join}) AND NOT EXISTS
        (SELECT 1 FROM ${marked(fk.child)} m WHERE to_jsonb(m)=to_jsonb(c))`);
      changed ||= result.rowCount > 0;
    }
  }
  for (const [name, ids] of roots) assert.equal((await db.query(`SELECT id FROM ${marked(name)} WHERE id <> ALL($1::uuid[])`, [ids])).rowCount, 0, `Cleanup crosses a preserved ${name}`);
  for (const name of ['Role', 'Permission', 'StoreGroup']) assert.equal((await db.query(`SELECT * FROM ${marked(name)}`)).rowCount, 0, `${name} must be preserved`);
  assert.equal((await db.query(`SELECT id FROM ${marked('SupplierOrder')} WHERE "storeId" NOT IN (SELECT id FROM ${marked('Store')}) OR "supplierId" NOT IN (SELECT id FROM ${marked('Supplier')})`)).rowCount, 0, 'Fixture order crosses a preserved store/supplier');
  assert.equal((await db.query(`SELECT id FROM ${marked('PurchaseRequest')} WHERE "storeId" NOT IN (SELECT id FROM ${marked('Store')})`)).rowCount, 0, 'Fixture request crosses a preserved store');
  for (const [child, parent, field] of [['OrderItem', 'SupplierOrder', 'supplierOrderId'], ['RequestItem', 'PurchaseRequest', 'requestId']]) {
    assert.equal((await db.query(`SELECT id FROM ${marked(child)} WHERE ${quote(field)} NOT IN (SELECT id FROM ${marked(parent)})`)).rowCount, 0, `Fixture item crosses a preserved ${parent}`);
  }
  const counts = {};
  for (const name of names) { const count = Number((await db.query(`SELECT count(*) n FROM ${marked(name)}`)).rows[0].n); if (count) counts[name] = count; }
  const report = { apply, backup, before, deletionCounts: counts, fixtureAccounts: users, preservedOrderCount: baselineOrders.length };
  console.log(JSON.stringify(report, null, 2));
  if (apply) {
    const pending = new Set(Object.keys(counts));
    while (pending.size) {
      const leaf = [...pending].find(name => !fks.some(fk => fk.parent === name && fk.child !== name && pending.has(fk.child)));
      assert.ok(leaf, `Foreign-key cycle: ${[...pending].join(', ')}`);
      await db.query(`DELETE FROM ${quote(leaf)} c USING ${marked(leaf)} m WHERE to_jsonb(c)=to_jsonb(m)`);
      pending.delete(leaf);
    }
    assert.deepEqual((await db.query('SELECT id FROM "SupplierOrder" WHERE "storeId" <> ALL($1::uuid[]) ORDER BY id', [roots.get('Store')])).rows, baselineOrders);
    report.after = {};
    for (const name of Object.keys(before)) report.after[name] = Number((await db.query(`SELECT count(*) n FROM ${quote(name)}`)).rows[0].n);
    assert.equal(report.after.RechargeDocument, before.RechargeDocument);
    await db.query('COMMIT');
    await writeFile(resolve(directory, `fixture-cleanup-${stamp}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: 'PASS', backup, after: report.after, preservedOrders: baselineOrders.length }));
  } else await db.query('ROLLBACK');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally { db.release(); await pool.end(); }
