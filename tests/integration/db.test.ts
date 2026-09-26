import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';

function createClient(): InstanceType<typeof PrismaClient> {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

test('database responds to a basic query', async () => {
  const prisma = createClient();

  try {
    const result = await prisma.$queryRaw<[{ value: number }]>`SELECT 1::int AS value`;
    assert.equal(result[0]?.value, 1);
  } finally {
    await prisma.$disconnect();
  }
});

test('core migration created foundational tables', async () => {
  const prisma = createClient();

  try {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('AdjustmentDocument', 'AdjustmentDocumentItem', 'User', 'UserSession', 'CommandRecord', 'Store', 'Supplier', 'Product', 'PurchaseRequest', 'SupplierOrder', 'StoreAccount', '_prisma_migrations')
      ORDER BY table_name
    `;

    assert.deepEqual(
      tables.map((table) => table.table_name),
      [
        'AdjustmentDocument',
        'AdjustmentDocumentItem',
        'CommandRecord',
        'Product',
        'PurchaseRequest',
        'Store',
        'StoreAccount',
        'Supplier',
        'SupplierOrder',
        'User',
        'UserSession',
        '_prisma_migrations',
      ],
    );
  } finally {
    await prisma.$disconnect();
  }
});

test('required migrations are recorded by Prisma', async () => {
  const prisma = createClient();

  try {
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      WHERE migration_name IN ('20260924044950_init_core', '20260924052429_add_command_records', '20260924054927_add_user_sessions', '20260926120000_add_adjustment_documents')
      ORDER BY migration_name
    `;

    assert.deepEqual(
      migrations.map((migration) => migration.migration_name),
      ['20260924044950_init_core', '20260924052429_add_command_records', '20260924054927_add_user_sessions', '20260926120000_add_adjustment_documents'],
    );
    assert.ok(migrations.every((migration) => migration.finished_at));
  } finally {
    await prisma.$disconnect();
  }
});
