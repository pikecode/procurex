import assert from 'node:assert/strict';
import test from 'node:test';
import { StoresService } from '../../apps/api/src/stores/stores.service.js';
import type { DatabaseService } from '../../apps/api/src/database/database.service.js';

function fixture(counts = {}, version = 1000) {
  let deleted = false;
  const tx = { $queryRaw: async () => [], store: {
    findUnique: async () => ({ id: 'store', updatedAt: new Date(version), _count: counts }),
    delete: async () => { deleted = true; }
  } };
  const database = { client: { $transaction: async (work: (client: typeof tx) => unknown) => work(tx) } };
  return { service: new StoresService(database as unknown as DatabaseService), deleted: () => deleted };
}

test('unrelated store can be deleted', async () => {
  const f = fixture({ requests: 0, accounts: 0 });
  assert.deepEqual(await f.service.removeStore('store', 1000), { id: 'store', deleted: true });
  assert.equal(f.deleted(), true);
});

for (const relation of ['bindings', 'cycleOverrides', 'accounts', 'requests', 'supplierOrders', 'rechargeDocuments', 'clearingDocuments', 'userScopes', 'assignedUserScopes', 'overpayments']) {
  test(`store deletion preserves ${relation}`, async () => {
    const f = fixture({ [relation]: 1 });
    await assert.rejects(f.service.removeStore('store', 1000), /不能删除/);
    assert.equal(f.deleted(), false);
  });
}

test('store deletion refuses a stale version', async () => {
  const f = fixture();
  await assert.rejects(f.service.removeStore('store', 999), /已变化/);
  assert.equal(f.deleted(), false);
});
