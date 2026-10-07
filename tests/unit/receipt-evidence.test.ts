import assert from 'node:assert/strict';
import test from 'node:test';
import { FilesService } from '../../apps/api/src/files/files.service.js';

test('receipt upload sessions only accept bounded JPEG/PNG images before creating metadata', async () => {
  const files = new FilesService({ client: {} } as never);
  for (const input of [
    { purpose: 'RECEIPT', filename: 'receipt.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
    { purpose: 'RECEIPT', filename: 'receipt.png', mimeType: 'image/png', sizeBytes: 0 },
    { purpose: 'RECEIPT', filename: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 10 * 1024 * 1024 + 1 },
    { purpose: 'RECEIPT', filename: 42, mimeType: 'image/jpeg', sizeBytes: 10 },
  ]) {
    await assert.rejects(files.create('owner', input as never), (error: unknown) =>
      (error as { getResponse(): { code: string } }).getResponse().code === 'FILE_METADATA_INVALID');
  }
});

test('receipt upload session uses private object identity and hashed credentials', async () => {
  let stored: Record<string, unknown> | undefined;
  const files = new FilesService({ client: { fileObject: {
    findMany: async () => [], create: async ({ data }: { data: Record<string, unknown> }) => { stored = data; return data; },
  } } } as never);
  const session = await files.create('owner', { purpose: 'RECEIPT', filename: 'receipt.png', mimeType: 'image/png', sizeBytes: 10 });
  assert.equal(stored!.purpose, 'RECEIPT'); assert.equal(stored!.ownerId, 'owner');
  assert.equal(stored!.sizeBytes, 10n); assert.notEqual(stored!.objectKey, 'receipt.png');
  assert.equal((stored!.uploadTokenHash as string).length, 64); assert.notEqual(stored!.uploadTokenHash, session.uploadToken);
  assert.ok(!('objectKey' in session));
});
