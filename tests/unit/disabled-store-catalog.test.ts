import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogService } from '../../apps/api/src/catalog/catalog.service.js';

test('disabled store cannot obtain a new ordering catalog even with an active template', async () => {
  const service = new CatalogService({ client: { storeTemplateBinding: { findFirst: async () => ({ store: { status: 'DISABLED' }, template: { id: 'template', items: [] } }) } } } as never, {} as never);
  await assert.rejects(service.readStoreCatalog('store'), (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === 'STORE_DISABLED');
});

test('disabled store retains historical template catalog access for existing requests', async () => {
  const service = new CatalogService({ client: {
    store: { findUnique: async () => ({ id: 'store', status: 'DISABLED', name: '历史门店' }) },
    orderTemplate: { findUnique: async () => ({ id: 'template', isArchived: false, items: [] }) },
    supplierProduct: { findMany: async () => [] },
  } } as never, {} as never);
  assert.deepEqual((await service.readTemplateCatalog('store', 'template')).items, []);
});
