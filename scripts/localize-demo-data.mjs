import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { localizedFixtureName } from './demo-chinese-names.mjs';

const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only a local fixture database is allowed');
const apply = process.argv.includes('--apply');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const changes = [];
await client.connect();
try {
  await client.query('BEGIN');
  for (const table of ['Store', 'Supplier', 'Product', 'Category', 'Unit', 'OrderTemplate', 'User']) {
    const field = table === 'User' ? 'displayName' : 'name';
    const key = table === 'User' ? 'username' : table === 'Product' ? 'sku' : 'code';
    const rows = (await client.query(`SELECT id, "${key}" AS code, "${field}" AS name FROM "${table}" FOR UPDATE`)).rows;
    for (const row of rows) {
      const name = localizedFixtureName(table, row.code || '', row.name);
      if (name === row.name) continue;
      changes.push({ table, id: row.id, code: row.code, before: row.name, after: name });
      if (apply) {
        const version = ['Category', 'Unit'].includes(table) ? ', version = version + 1'
          : ', "updatedAt" = GREATEST(clock_timestamp(), "updatedAt" + interval \'1 millisecond\')';
        const updated = await client.query(`UPDATE "${table}" SET "${field}" = $1 ${version} WHERE id = $2 AND "${field}" = $3`, [name, row.id, row.name]);
        assert.equal(updated.rowCount, 1);
      }
    }
  }
  await mkdir('var/demo-localization-evidence', { recursive: true });
  await writeFile(`var/demo-localization-evidence/${apply ? 'applied' : 'preview'}.json`, JSON.stringify({ apply, changes }, null, 2));
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(JSON.stringify({ apply, changed: changes.length, tables: Object.fromEntries([...new Set(changes.map(change => change.table))].map(table => [table, changes.filter(change => change.table === table).length])) }));
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
