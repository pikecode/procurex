import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';

assert.equal(process.env.CONFIRM_ACCEPTANCE_RESET, 'test-only-backed-up');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, 'postgres');
assert.equal(url.pathname, '/procurex');
const bundle = JSON.parse(await readFile(process.argv[2], 'utf8'));
const apply = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: url.toString() });
const db = await pool.connect();
const q = value => `"${value.replaceAll('"', '""')}"`;
try {
  await db.query('BEGIN');
  await db.query("SELECT pg_advisory_xact_lock(hashtext('procurex.catalog-registry'))");
  await db.query('SELECT pg_advisory_xact_lock(810081)');
  const names = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'")).rows.map(row => row.tablename);
  const temp = new Map(names.map((name, index) => [name, `acceptance_cleanup_${index}`]));
  for (const name of names) await db.query(`CREATE TEMP TABLE ${q(temp.get(name))} AS SELECT * FROM ${q(name)} WHERE FALSE`);
  const fks = (await db.query(`SELECT child.relname child, parent.relname parent,
    ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,o) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.o) cc,
    ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,o) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.o) pc
    FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid
    JOIN pg_namespace ns ON ns.oid=child.relnamespace WHERE c.contype='f' AND ns.nspname='public'`)).rows;
  const codeTest = 'code LIKE \'TEST\\_%\' OR code LIKE \'MINITEST%\' OR code LIKE \'PXSERVERFLOW%\' OR code LIKE \'ACCEPT20261012%\'';
  for (const name of ['Store', 'Supplier', 'OrderTemplate', 'Category']) {
    const known = (bundle.tables[name] || []).map(row => row.id);
    await db.query(`INSERT INTO ${q(temp.get(name))} SELECT * FROM ${q(name)} WHERE (${codeTest}) OR id=ANY($1::uuid[])`, [known]);
  }
  const productIds = bundle.tables.Product.map(row => row.id);
  await db.query(`INSERT INTO ${q(temp.get('Product'))} SELECT * FROM "Product" WHERE sku LIKE 'TEST\\_%' OR sku LIKE 'MINITEST%' OR sku LIKE 'PXSERVERFLOW%' OR sku LIKE 'ACCEPT20261012%' OR id=ANY($1::uuid[])`, [productIds]);
  await db.query(`INSERT INTO ${q(temp.get('PriceScope'))} SELECT * FROM "PriceScope" WHERE "productId" IN (SELECT id FROM ${q(temp.get('Product'))}) OR "templateKey" IN (SELECT id::text FROM ${q(temp.get('OrderTemplate'))})`);
  // Expand deletion candidates through actual FK metadata without disabling constraints.
  let changed = true;
  while (changed) {
    changed = false;
    for (const fk of fks) {
      const columns = fk.cc.map((column, i) => `c.${q(column)}=p.${q(fk.pc[i])}`).join(' AND ');
      const result = await db.query(`INSERT INTO ${q(temp.get(fk.child))} SELECT c.* FROM ${q(fk.child)} c WHERE EXISTS
        (SELECT 1 FROM ${q(temp.get(fk.parent))} p WHERE ${columns}) AND NOT EXISTS
        (SELECT 1 FROM ${q(temp.get(fk.child))} m WHERE to_jsonb(m)=to_jsonb(c))`);
      changed ||= result.rowCount > 0;
    }
  }
  const marked = name => q(temp.get(name));
  const crossing = (await db.query(`SELECT id FROM ${marked('SupplierOrder')} WHERE "storeId" NOT IN (SELECT id FROM ${marked('Store')}) OR "supplierId" NOT IN (SELECT id FROM ${marked('Supplier')})`)).rows;
  assert.equal(crossing.length, 0, 'Test data crosses a non-test order; cleanup refused');
  assert.equal((await db.query(`SELECT id FROM ${marked('SupplierProduct')} WHERE "supplierId" NOT IN (SELECT id FROM ${marked('Supplier')})`)).rowCount, 0, 'Test product linked to non-test supplier; cleanup refused');
  assert.equal((await db.query(`SELECT id FROM ${marked('StoreTemplateBinding')} WHERE "storeId" NOT IN (SELECT id FROM ${marked('Store')}) OR "templateId" NOT IN (SELECT id FROM ${marked('OrderTemplate')})`)).rowCount, 0, 'Test template linked to non-test store; cleanup refused');
  assert.equal((await db.query(`SELECT id FROM ${marked('Product')} WHERE id NOT IN (SELECT id FROM "Product" WHERE sku LIKE 'TEST\\_%' OR sku LIKE 'MINITEST%' OR sku LIKE 'PXSERVERFLOW%' OR sku LIKE 'ACCEPT20261012%' OR id=ANY($1::uuid[]))`, [productIds])).rowCount, 0, 'Category contains non-test products; cleanup refused');
  const acceptanceNames = ['store3', 'store4', 'store_fin1', 'store_fin2', 'store_fin3', 'store_fin4', 'supplier3', 'supplier4', 'supplier5', 'store_empty', 'store_low', 'store_limit', 'store_disabled', 'follower', 'region', 'region_fin', 'disabled_user'];
  const users = (await db.query(`SELECT * FROM "User" WHERE username <> 'admin' AND (username=ANY($1) OR username LIKE 'mini_test_%' OR username LIKE 'pxserverflow_%' OR username LIKE 'accept_%')`, [...bundle.usernames.filter(name => name !== 'admin'), ...acceptanceNames])).rows;
  const userIds = users.map(row => row.id);
  assert.equal((await db.query(`SELECT id FROM ${marked('UserScope')} WHERE "userId" <> ALL($1::uuid[])`, [userIds])).rowCount, 0, 'Test store scope belongs to a non-test account; cleanup refused');
  const counts = {};
  for (const name of names) {
    const count = Number((await db.query(`SELECT COUNT(*) n FROM ${marked(name)}`)).rows[0].n);
    if (count) counts[name] = count;
  }
  assert.ok(!counts.User && !counts.Role && !counts.Permission, 'Identity definitions must not be deleted');
  console.log(JSON.stringify({ apply, accountsToArchive: users.map(row => row.username), deletionCounts: counts }));
  if (apply) {
    await db.query('UPDATE "UserSession" SET "revokedAt"=NOW() WHERE "userId"=ANY($1::uuid[]) AND "revokedAt" IS NULL', [userIds]);
    const suffix = Date.now().toString(36);
    await db.query('UPDATE "User" SET username=LEFT(username,50)||$1,"displayName"=LEFT("displayName",110)||\'（历史停用）\',status=\'DISABLED\',"updatedAt"=NOW() WHERE id=ANY($2::uuid[])', [`_old_${suffix}`, userIds]);
    const pending = new Set(Object.keys(counts));
    while (pending.size) {
      const leaf = [...pending].find(name => !fks.some(fk => fk.parent === name && fk.child !== name && pending.has(fk.child)));
      assert.ok(leaf, `Foreign-key cycle in cleanup: ${[...pending].join(',')}`);
      await db.query(`DELETE FROM ${q(leaf)} c USING ${marked(leaf)} m WHERE to_jsonb(c)=to_jsonb(m)`);
      pending.delete(leaf);
    }
    await db.query('COMMIT');
    await writeFile('/tmp/procurex-acceptance-cleanup.json', JSON.stringify({ executedAt: new Date(), archivedAccounts: users.map(row => row.username), counts }), { mode: 0o600 });
    console.log('Test-only cleanup committed; non-test data and administrator preserved.');
  } else await db.query('ROLLBACK');
} catch (error) {
  await db.query('ROLLBACK');
  console.error(error.code ? `Cleanup failed (${error.code}); rolled back` : error.message);
  process.exitCode = 1;
} finally { db.release(); await pool.end(); }
