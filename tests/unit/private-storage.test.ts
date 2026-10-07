import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import OSS from 'ali-oss';
import { PrivateStorage } from '../../apps/api/src/files/private-storage.js';
import { FilesService } from '../../apps/api/src/files/files.service.js';
import type { DatabaseService } from '../../apps/api/src/database/database.service.js';

const config = { FILE_STORAGE: 'oss', OSS_BUCKET: 'test-bucket', OSS_REGION: 'oss-cn-guangzhou',
  OSS_ENDPOINT: 'https://oss-cn-guangzhou.aliyuncs.com', OSS_PREFIX: 'procurex-test/', OSS_ACCESS_KEY_ID: 'test-id', OSS_ACCESS_KEY_SECRET: 'test-secret' };

test('local storage remains exclusive and rejects path traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'procurex-storage-'));
  try {
    const storage = new PrivateStorage({ PRIVATE_FILE_DIR: root });
    const key = storage.newKey();
    const bytes = Buffer.from('private evidence');
    await storage.put(key, bytes, 'application/pdf');
    assert.deepEqual(await storage.get(key), bytes);
    assert.deepEqual(await new PrivateStorage({ ...config, PRIVATE_FILE_DIR: root }).get(key), bytes);
    await assert.rejects(storage.get('oss:procurex-test/00000000-0000-0000-0000-000000000000'));
    await assert.rejects(storage.put(key, bytes, 'application/pdf'), { code: 'EEXIST' });
    await assert.rejects(storage.get('../escape'));
    await storage.remove(key);
    await storage.remove(key);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('completion does not reject metadata when OSS is unavailable', async (t) => {
  let updates = 0;
  const database = { client: { fileObject: {
    findFirst: async () => ({ objectKey: 'oss:procurex-test/00000000-0000-0000-0000-000000000000' }),
    update: async () => { updates++; },
  } } } as unknown as DatabaseService;
  t.mock.method(PrivateStorage.prototype, 'get', async () => { throw Object.assign(new Error('Denied'), { code: 'AccessDenied' }); });
  await assert.rejects(new FilesService(database).complete('owner', 'file'), { code: 'AccessDenied' });
  assert.equal(updates, 0);
});

test('OSS requires explicit opt-in and complete safe configuration', () => {
  assert.ok(!new PrivateStorage(configWithLocal()).newKey().startsWith('oss:'));
  assert.throws(() => new PrivateStorage({ FILE_STORAGE: 'invalid' }));
  assert.throws(() => new PrivateStorage({ ...config, OSS_ACCESS_KEY_SECRET: '' }));
  assert.throws(() => new PrivateStorage({ ...config, OSS_ENDPOINT: 'http://example.com' }));
  assert.throws(() => new PrivateStorage({ ...config, OSS_PREFIX: '../' }));
});

function configWithLocal() { return { ...config, FILE_STORAGE: 'local' }; }

test('OSS uses only owned keys, private uploads, and propagates storage outages', async (t) => {
  const storage = new PrivateStorage(config);
  const key = storage.newKey();
  const bytes = Buffer.from('evidence');
  let calls = 0;
  t.mock.method(OSS.prototype, 'put', async (name: string, body: Buffer, options: OSS.PutObjectOptions) => {
    calls++;
    assert.equal(name, key.slice(4));
    assert.deepEqual(body, bytes);
    assert.equal((options.headers as Record<string, string>)['x-oss-object-acl'], 'private');
    return {};
  });
  t.mock.method(OSS.prototype, 'get', async () => ({ content: bytes }));
  t.mock.method(OSS.prototype, 'delete', async () => { throw Object.assign(new Error('Unavailable'), { code: 'AccessDenied' }); });
  await storage.put(key, bytes, 'application/pdf');
  assert.deepEqual(await storage.get(key), bytes);
  await assert.rejects(storage.put('oss:other-prefix/abc', bytes, 'application/pdf'));
  assert.equal(calls, 1);
  await assert.rejects(storage.remove(key), { code: 'AccessDenied' });
});
