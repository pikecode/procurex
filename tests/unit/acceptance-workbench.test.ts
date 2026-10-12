import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthService } from '../../apps/api/src/auth/auth.service.js';

test('production identity switching requires an independent switch and both allowlists', async () => {
  const keys = ['NODE_ENV', 'TEST_WORKBENCH_ENABLED', 'ACCEPTANCE_WORKBENCH_ENABLED', 'ACCEPTANCE_WORKBENCH_ADMIN_USERNAMES', 'ACCEPTANCE_WORKBENCH_USERNAMES'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const queries: unknown[] = [];
  const service = new AuthService({ client: { user: { findMany: async (query: unknown) => { queries.push(query); return []; } } } } as never);
  const auth = (username = 'admin', roles = ['ADMIN']) => ({ user: { id: 'admin-id', username, roles } }) as never;
  try {
    process.env.NODE_ENV = 'production';
    process.env.TEST_WORKBENCH_ENABLED = 'true';
    for (const key of keys.slice(2)) delete process.env[key];
    await assert.rejects(service.testIdentities(auth()));
    process.env.ACCEPTANCE_WORKBENCH_ENABLED = 'true';
    await assert.rejects(service.testIdentities(auth()));
    process.env.ACCEPTANCE_WORKBENCH_ADMIN_USERNAMES = 'admin';
    await assert.rejects(service.testIdentities(auth()));
    process.env.ACCEPTANCE_WORKBENCH_USERNAMES = 'store1, supplier1,buyer,fin';
    await assert.rejects(service.testIdentities(auth('other-admin')));
    await assert.rejects(service.testIdentities(auth('admin', ['PURCHASER'])));
    assert.deepEqual(await service.testIdentities(auth()), []);
    assert.equal(queries.length, 1);
    assert.deepEqual((queries[0] as { where: { username: { in: string[] } } }).where.username.in, ['store1', 'supplier1', 'buyer', 'fin']);
    await assert.rejects(service.testIdentity(auth(), 'unlisted'));
    process.env.ACCEPTANCE_WORKBENCH_ENABLED = 'false';
    await assert.rejects(service.testIdentities(auth()));
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});
