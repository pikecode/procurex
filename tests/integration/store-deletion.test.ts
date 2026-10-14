import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DatabaseService } from '../../apps/api/src/database/database.service.js';
import { StoresService } from '../../apps/api/src/stores/stores.service.js';

test('store deletion removes an empty store and preserves account-linked store in PostgreSQL', async () => {
  const database = new DatabaseService();
  const service = new StoresService(database);
  const code = `DELETE_TEST_${randomUUID()}`;
  let id: string | undefined;
  try {
    const empty = await service.createStore({ code, name: '删除验证门店' });
    id = empty.id;
    await assert.rejects(service.removeStore(id, empty.version - 1), /已变化/);
    await database.client.storeAccount.create({ data: { storeId: id } });
    await assert.rejects(service.removeStore(id, empty.version), /门店账户/);
    assert.ok(await database.client.store.findUnique({ where: { id } }));
    await database.client.storeAccount.deleteMany({ where: { storeId: id } });
    assert.deepEqual(await service.removeStore(id, empty.version), { id, deleted: true });
    assert.equal(await database.client.store.findUnique({ where: { id } }), null);
    await assert.rejects(service.removeStore(id, empty.version), /不存在/);
  } finally {
    if (id) {
      await database.client.storeAccount.deleteMany({ where: { storeId: id } });
      await database.client.store.deleteMany({ where: { id } });
    }
    await database.client.$disconnect();
  }
});
