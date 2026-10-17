import assert from 'node:assert/strict';
import test from 'node:test';
import { FilesService } from '../../apps/api/src/files/files.service.js';

test('exception reply uploads are supplier-only JPEG or PNG images', async () => {
  const files = new FilesService({ client: { fileObject: { findMany: async () => [], create: async () => ({}) } } } as never);
  const input = { purpose: 'RECEIPT_EXCEPTION_REPLY', filename: 'proof.png', mimeType: 'image/png', sizeBytes: 100 };
  for (const role of ['STORE', 'STORE_FINANCE', 'PURCHASER', 'HQ_FINANCE']) await assert.rejects(files.create('owner', input, [role]), { status: 403 });
  await assert.rejects(files.create('owner', { ...input, mimeType: 'application/pdf' }, ['SUPPLIER']), { status: 409 });
  assert.ok((await files.create('owner', input, ['SUPPLIER'])).id);
});

test('reply evidence download follows its receipt order store and supplier scope', async () => {
  const files = new FilesService({ client: { fileObject: { findFirst: async () => ({ ownerId: 'supplier-user', objectKey: 'proof', purpose: 'RECEIPT_EXCEPTION_REPLY', receiptExceptionReply: { receipt: { shipment: { supplierOrder: { storeId: 'store1', supplierId: 'supplier1' } } } } }) } } } as never);
  Object.defineProperty(files, 'storage', { value: { get: async () => Buffer.from('proof') } });
  assert.equal((await files.download('store-user', 'proof', { type: 'STORE', storeId: 'store1' }, ['STORE'])).bytes.toString(), 'proof');
  assert.equal((await files.download('supplier-user', 'proof', { type: 'SUPPLIER', supplierId: 'supplier1' }, ['SUPPLIER'])).bytes.toString(), 'proof');
  await assert.rejects(files.download('other-store', 'proof', { type: 'STORE', storeId: 'store2' }, ['STORE']), { status: 404 });
  await assert.rejects(files.download('other-supplier', 'proof', { type: 'SUPPLIER', supplierId: 'supplier2' }, ['SUPPLIER']), { status: 404 });
});
