import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const usernames = ['admin', 'store1', 'store2', 'supplier1', 'supplier2', 'buyer', 'fin'];
const [mode, path] = process.argv.slice(2);
assert.ok(['export', 'import', 'verify'].includes(mode) && path, 'Use export/import/verify and a private bundle path');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.pathname, '/procurex');
if (mode === 'export') assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
else assert.equal(process.env.CONFIRM_ACCOUNT_SYNC, 'append-local-test-accounts');
const pool = new pg.Pool({ connectionString: url.toString() });
const db = await pool.connect();
const quote = name => `"${name.replaceAll('"', '""')}"`;
const read = async (table, where = 'TRUE', values = []) => (await db.query(`SELECT * FROM ${quote(table)} WHERE ${where}`, values)).rows;
const ids = rows => rows.map(row => row.id);
const selectIds = (table, column, values) => read(table, `${quote(column)} = ANY($1::uuid[])`, [values]);
const manifest = {};
try {
  if (mode === 'export') {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    manifest.User = await read('User', 'username = ANY($1)', [usernames]);
    assert.equal(manifest.User.length, usernames.length, 'Missing local test account');
    manifest.UserRole = await selectIds('UserRole', 'userId', ids(manifest.User));
    manifest.Role = await selectIds('Role', 'id', manifest.UserRole.map(row => row.roleId));
    manifest.UserScope = await selectIds('UserScope', 'userId', ids(manifest.User));
    manifest.UserScopeStore = await selectIds('UserScopeStore', 'scopeId', ids(manifest.UserScope));
    manifest.Store = await selectIds('Store', 'id', [...manifest.UserScope.map(row => row.storeId), ...manifest.UserScopeStore.map(row => row.storeId)].filter(Boolean));
    manifest.StoreGroup = await read('StoreGroup', 'name = ANY($1)', [manifest.Store.map(row => row.groupName).filter(Boolean)]);
    manifest.StoreAccount = await selectIds('StoreAccount', 'storeId', ids(manifest.Store));
    manifest.StoreTemplateBinding = await read('StoreTemplateBinding', '"storeId" = ANY($1::uuid[]) AND "effectiveAt" <= NOW() AND ("expiredAt" IS NULL OR "expiredAt" > NOW())', [ids(manifest.Store)]);
    manifest.OrderTemplate = await selectIds('OrderTemplate', 'id', manifest.StoreTemplateBinding.map(row => row.templateId));
    manifest.TemplateItem = await selectIds('TemplateItem', 'templateId', ids(manifest.OrderTemplate));
    manifest.TemplateItemSupplier = await selectIds('TemplateItemSupplier', 'templateItemId', ids(manifest.TemplateItem));
    manifest.TemplateSupplierSetting = await selectIds('TemplateSupplierSetting', 'templateId', ids(manifest.OrderTemplate));
    manifest.TemplateStoreSupplierCycle = await read('TemplateStoreSupplierCycle', '"templateId" = ANY($1::uuid[]) AND "storeId" = ANY($2::uuid[])', [ids(manifest.OrderTemplate), ids(manifest.Store)]);
    manifest.Supplier = await selectIds('Supplier', 'id', [...manifest.UserScope.map(row => row.supplierId), ...manifest.TemplateItemSupplier.map(row => row.supplierId), ...manifest.TemplateSupplierSetting.map(row => row.supplierId)].filter(Boolean));
    manifest.Product = await selectIds('Product', 'id', manifest.TemplateItem.map(row => row.productId));
    manifest.SupplierProduct = await read('SupplierProduct', '"productId" = ANY($1::uuid[]) AND "supplierId" = ANY($2::uuid[])', [ids(manifest.Product), ids(manifest.Supplier)]);
    manifest.ProductUnitConversion = await selectIds('ProductUnitConversion', 'productId', ids(manifest.Product));
    manifest.Unit = await selectIds('Unit', 'id', [...manifest.Product.map(row => row.baseUnitId), ...manifest.ProductUnitConversion.flatMap(row => [row.fromUnitId, row.toUnitId])]);
    manifest.Brand = await selectIds('Brand', 'id', manifest.Product.map(row => row.brandId).filter(Boolean));
    manifest.Category = await selectIds('Category', 'id', manifest.Product.map(row => row.categoryId));
    let ancestors = manifest.Category.map(row => row.parentId).filter(Boolean);
    while (ancestors.length) {
      const rows = (await selectIds('Category', 'id', ancestors)).filter(row => !manifest.Category.some(existing => existing.id === row.id));
      manifest.Category.push(...rows);
      ancestors = rows.map(row => row.parentId).filter(Boolean);
    }
    manifest.PriceScope = await read('PriceScope', '"productId" = ANY($1::uuid[]) AND "supplierId" = ANY($2::uuid[]) AND ("templateKey" = \'\' OR "templateKey" = ANY($3))', [ids(manifest.Product), ids(manifest.Supplier), ids(manifest.OrderTemplate)]);
    // Keep price history including future effective prices, but no order or financial history.
    manifest.PriceVersion = await selectIds('PriceVersion', 'scopeId', ids(manifest.PriceScope));
    await db.query('COMMIT');
    for (const row of manifest.Product) row.imageFileId = null;
    for (const row of manifest.StoreAccount) Object.assign(row, { balance: '0', reservedBalance: '0', creditUsed: '0', creditCumulative: '0', version: 1 });
    await writeFile(path, JSON.stringify({ format: 1, createdAt: new Date(), usernames, tables: manifest }), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ exported: Object.fromEntries(Object.entries(manifest).map(([name, rows]) => [name, rows.length])), privateBundle: path }));
  } else {
    const bundle = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(bundle.format, 1);
    assert.deepEqual(bundle.usernames, usernames);
    const tables = bundle.tables;
    if (mode === 'verify') {
      for (const source of tables.User) {
        const [actual] = await read('User', 'username = $1', [source.username]);
        assert.ok(actual && actual.status === source.status && actual.passwordHash === source.passwordHash, `Account differs: ${source.username}`);
        const roles = (await db.query('SELECT r.code FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId" WHERE ur."userId" = $1', [actual.id])).rows.map(row => row.code).sort();
        const expected = tables.UserRole.filter(row => row.userId === source.id).map(row => tables.Role.find(role => role.id === row.roleId).code).sort();
        assert.deepEqual(roles, expected);
        const [scope] = await read('UserScope', '"userId" = $1', [actual.id]);
        const expectedScope = tables.UserScope.find(row => row.userId === source.id);
        assert.ok(scope && scope.scopeType === expectedScope.scopeType && scope.storeId === expectedScope.storeId && scope.supplierId === expectedScope.supplierId);
        if (scope.storeId) {
          const bindings = await read('StoreTemplateBinding', '"storeId"=$1 AND "effectiveAt" <= NOW() AND ("expiredAt" IS NULL OR "expiredAt" > NOW())', [scope.storeId]);
          assert.equal(bindings.length, 1, 'Store must have one active template');
          const items = await read('TemplateItem', '"templateId"=$1 AND "isEnabled"=TRUE', [bindings[0].templateId]);
          assert.ok(items.length > 0, 'Missing template products');
          const [account] = await read('StoreAccount', '"storeId"=$1', [scope.storeId]);
          assert.ok(account && Number(account.balance) === 0 && Number(account.reservedBalance) === 0 && Number(account.creditUsed) === 0);
          console.log(`PASS template and empty financial account: ${source.username}, ${items.length} configured products`);
        }
        if (scope.supplierId) {
          const products = await read('SupplierProduct', '"supplierId"=$1', [scope.supplierId]);
          assert.ok(products.length > 0, 'Missing supplier products');
          console.log(`PASS supplier product associations: ${source.username}, ${products.length} products`);
        }
        console.log(`PASS account, local password hash, roles and scope: ${source.username}`);
      }
    } else {
      await db.query('BEGIN');
      await db.query("SELECT pg_advisory_xact_lock(hashtext('procurex.catalog-registry'))");
      await db.query('SELECT pg_advisory_xact_lock(810081)');
      const remap = new Map();
      async function insert(table, source) {
        const row = { ...source };
        for (const key of ['baseUnitId', 'fromUnitId', 'toUnitId', 'brandId']) if (remap.has(row[key])) row[key] = remap.get(row[key]);
        const columns = Object.keys(row);
        await db.query(`INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`, columns.map(key => row[key]));
      }
      for (const table of ['StoreGroup', 'Unit', 'Brand']) {
        for (const row of tables[table]) {
          const existing = await read(table, 'name = $1', [row.name]);
          assert.ok(existing.length <= 1, `Ambiguous ${table} name`);
          if (existing.length) remap.set(row.id, existing[0].id);
          else await insert(table, row);
        }
      }
      const categories = [...tables.Category];
      while (categories.length) {
        const index = categories.findIndex(row => !row.parentId || !categories.some(parent => parent.id === row.parentId));
        assert.ok(index >= 0, 'Category cycle');
        await insert('Category', categories.splice(index, 1)[0]);
      }
      for (const table of ['Supplier', 'Store', 'Product', 'ProductUnitConversion', 'SupplierProduct', 'OrderTemplate', 'TemplateItem', 'TemplateItemSupplier', 'TemplateSupplierSetting', 'TemplateStoreSupplierCycle', 'StoreTemplateBinding', 'StoreAccount', 'PriceScope', 'PriceVersion']) {
        for (const row of tables[table]) await insert(table, row);
      }
      for (const source of tables.User) {
        const [existing] = await read('User', 'username = $1', [source.username]);
        assert.ok(!existing || source.username === 'admin', `Refusing to overwrite existing account ${source.username}`);
        const userId = existing?.id || randomUUID();
        if (existing) {
          await db.query('UPDATE "User" SET "passwordHash"=$1,"displayName"=$2,status=$3,"updatedAt"=NOW() WHERE id=$4', [source.passwordHash, source.displayName, source.status, userId]);
          await db.query('UPDATE "UserSession" SET "revokedAt"=NOW() WHERE "userId"=$1 AND "revokedAt" IS NULL', [userId]);
          await db.query('DELETE FROM "UserRole" WHERE "userId"=$1', [userId]);
          await db.query('DELETE FROM "UserScope" WHERE "userId"=$1', [userId]);
        } else await insert('User', { ...source, id: userId, phone: null });
        for (const sourceRole of tables.UserRole.filter(row => row.userId === source.id)) {
          const roleCode = tables.Role.find(row => row.id === sourceRole.roleId).code;
          const [role] = await read('Role', 'code=$1', [roleCode]);
          assert.ok(role, `Missing server role ${roleCode}`);
          await insert('UserRole', { ...sourceRole, userId, roleId: role.id });
        }
        const sourceScope = tables.UserScope.find(row => row.userId === source.id);
        assert.ok(sourceScope, `Missing source scope ${source.username}`);
        const scopeId = randomUUID();
        await insert('UserScope', { ...sourceScope, id: scopeId, userId });
        for (const row of tables.UserScopeStore.filter(row => row.scopeId === sourceScope.id)) await insert('UserScopeStore', { ...row, scopeId });
      }
      await db.query('COMMIT');
      console.log('Committed append-only test catalog and seven accounts. Existing admin sessions revoked; financial balances and business orders not copied.');
    }
  }
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  // Do not log database row details containing password hashes.
  console.error(error.code ? `Database operation failed (${error.code}); transaction rolled back.` : error.message);
  process.exitCode = 1;
} finally {
  db.release();
  await pool.end();
}
