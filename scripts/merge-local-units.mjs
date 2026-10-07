import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

const connectionString = process.env.DATABASE_URL;
assertLocalFixtureDatabase(connectionString);
const apply = process.argv.includes('--apply');
const name = '件';
const output = `var/unit-merge-evidence/${new Date().toISOString().replaceAll(':', '-')}`;
const client = new pg.Client({ connectionString });
const quote = value => `"${value.replaceAll('"', '""')}"`;
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('procurex.catalog-registry'))");
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename")).rows.map(row => row.tablename);
  // Freeze local writers so before/after hashes prove that historical rows were not changed.
  await client.query(`LOCK TABLE ${tables.map(quote).join(', ')} IN SHARE ROW EXCLUSIVE MODE`);
  const units = (await client.query('SELECT * FROM "Unit" WHERE btrim(name)=$1 ORDER BY "createdAt",id FOR UPDATE', [name])).rows;
  const canonical = units.find(unit => unit.code === 'PXFLOW-UNIT') || units[0];
  if (!canonical || units.length < 2) {
    await client.query('ROLLBACK'); console.log(JSON.stringify({ status: 'NO_CHANGE', count: units.length }));
  } else {
    const removed = units.filter(unit => unit.id !== canonical.id); const removedIds = removed.map(unit => unit.id);
    const unitIds = units.map(unit => unit.id);
    const products = (await client.query('SELECT * FROM "Product" WHERE "baseUnitId"=ANY($1::uuid[]) ORDER BY id', [unitIds])).rows;
    const conversions = (await client.query('SELECT * FROM "ProductUnitConversion" WHERE "fromUnitId"=ANY($1::uuid[]) OR "toUnitId"=ANY($1::uuid[])', [unitIds])).rows;
    // Same-named units do not prove that a conversion has the same physical meaning.
    assert.equal(conversions.length, 0, 'Unit conversions require manual review; refusing automatic merge');
    const references = (await client.query('SELECT conrelid::regclass::text AS relation,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE confrelid=$1::regclass', ['"Unit"'])).rows;
    assert.equal(references.length, 1, 'Unexpected unit foreign keys');
    assert.equal(references[0].relation, '"Product"');
    const fingerprint = async table => (await client.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(record, '' ORDER BY record), '')) AS hash FROM (SELECT row_to_json(t)::text AS record FROM ${quote(table)} t) rows`)).rows[0];
    const unchangedTables = tables.filter(table => !['Product', 'Unit'].includes(table));
    const before = {};
    for (const table of unchangedTables) before[table] = await fingerprint(table);
    await mkdir(output, { recursive: true });
    await writeFile(`${output}/backup.json`, JSON.stringify({ canonical, units, products, conversions, before }, null, 2), { mode: 0o600 });
    const moved = await client.query('UPDATE "Product" SET "baseUnitId"=$1::uuid,"updatedAt"=GREATEST(clock_timestamp(),"updatedAt"+interval \'1 millisecond\') WHERE "baseUnitId"=ANY($2::uuid[]) RETURNING id', [canonical.id, removedIds]);
    const afterProducts = (await client.query('SELECT * FROM "Product" WHERE id=ANY($1::uuid[]) ORDER BY id', [products.map(product => product.id)])).rows;
    for (let index = 0; index < products.length; index++) {
      const { baseUnitId, updatedAt, ...old } = products[index];
      const { baseUnitId: currentUnit, updatedAt: currentVersion, ...current } = afterProducts[index];
      assert.deepEqual(current, old); assert.equal(currentUnit, canonical.id);
      if (removedIds.includes(baseUnitId)) assert.ok(currentVersion > updatedAt);
    }
    const deleted = await client.query('DELETE FROM "Unit" WHERE id=ANY($1::uuid[]) RETURNING id', [removedIds]);
    assert.equal(deleted.rowCount, removed.length);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM "Unit" WHERE btrim(name)=$1', [name])).rows[0].count, 1);
    for (const table of unchangedTables) assert.deepEqual(await fingerprint(table), before[table], `Historical or unrelated table changed: ${table}`);
    const report = { status: apply ? 'APPLIED' : 'DRY_RUN', canonical: { id: canonical.id, code: canonical.code, name }, removed: removed.map(unit => ({ id: unit.id, code: unit.code })), movedProducts: moved.rowCount, verifiedUnchangedTables: unchangedTables, backup: `${output}/backup.json` };
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify(report, null, 2));
  }
} catch (failure) {
  await client.query('ROLLBACK'); throw failure;
} finally { await client.end(); }
