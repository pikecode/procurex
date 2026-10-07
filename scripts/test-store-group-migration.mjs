import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

test('store group migration consolidates trimmed legacy names without losing membership', async () => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(process.env.DATABASE_URL).hostname), 'Local migration test only');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const schema = `group_migration_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^group_migration_[a-f0-9]{32}$/);
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(`CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'DISABLED');
      CREATE TABLE "Store" ("id" uuid PRIMARY KEY, "groupName" varchar(120), "updatedAt" timestamptz NOT NULL);
      INSERT INTO "Store" VALUES
      (gen_random_uuid(), ' East ', '2026-01-01'), (gen_random_uuid(), 'East', '2026-01-01'),
      (gen_random_uuid(), 'West', '2026-01-01'), (gen_random_uuid(), '  ', '2026-01-01'),
      (gen_random_uuid(), NULL, '2026-01-01');`);
    await client.query(await readFile('database/migrations/20261006140000_store_groups/migration.sql', 'utf8'));
    const groups = (await client.query('SELECT "name" FROM "StoreGroup" ORDER BY "name"')).rows;
    assert.deepEqual(groups, [{ name: 'East' }, { name: 'West' }]);
    const stores = (await client.query('SELECT "groupName", count(*)::int AS count FROM "Store" GROUP BY "groupName" ORDER BY "groupName" NULLS LAST')).rows;
    assert.deepEqual(stores, [{ groupName: 'East', count: 2 }, { groupName: 'West', count: 1 }, { groupName: null, count: 2 }]);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM "Store" WHERE "updatedAt" > '2026-01-01'`)).rows[0].count, 2);
    await client.query(`UPDATE "StoreGroup" SET "name" = 'Renamed' WHERE "name" = 'East'`);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM "Store" WHERE "groupName" = 'Renamed'`)).rows[0].count, 2);
    await assert.rejects(client.query(`DELETE FROM "StoreGroup" WHERE "name" = 'Renamed'`), error => ['23503', '23001'].includes(error.code) && error.constraint === 'Store_groupName_fkey');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
