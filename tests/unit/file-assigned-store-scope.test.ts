import assert from 'node:assert/strict';
import test from 'node:test';
import { FilesService } from '../../apps/api/src/files/files.service.js';

test('assigned-store proof access never falls back to previous file ownership', async () => {
  for (const document of [{ recharge: { storeId: 'store-b' } }, { payment: { storeId: 'store-b' } }, {}]) {
    const service = new FilesService({ client: { fileObject: { findFirst: async () => ({ ownerId: 'actor', purpose: 'PAYMENT', ...document }) } } } as never);
    await assert.rejects(service.download('actor', 'proof', { type: 'MULTI_STORE', storeIds: ['store-a'] }, ['REGION_FINANCE']), { status: 404 });
  }
});

test('empty assigned-store proof scope fails before looking up the file', async () => {
  const service = new FilesService({ client: {} } as never);
  await assert.rejects(service.download('actor', 'proof', { type: 'MULTI_STORE', storeIds: [] }, ['REGION_MANAGER']), { status: 403 });
});
