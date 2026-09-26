import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { DirectStatementsController } from '../../apps/api/src/direct-statements/direct-statements.controller.js';
import { StoreStatementsController } from '../../apps/api/src/store-statements/store-statements.controller.js';
import { SupplierStatementsController } from '../../apps/api/src/supplier-statements/supplier-statements.controller.js';
import { SupplierStoreStatementsController } from '../../apps/api/src/supplier-store-statements/supplier-store-statements.controller.js';
import { StoresController } from '../../apps/api/src/stores/stores.controller.js';

const storeId = '11111111-1111-4111-8111-111111111111';
const supplierId = '22222222-2222-4222-8222-222222222222';

function request(scope: { type: string; storeId?: string; supplierId?: string }) {
  return { auth: { user: { scope } } } as never;
}

test('statement controllers narrow list scope and require configured detail scope', async () => {
  let directInput: unknown;
  const direct = new DirectStatementsController({
    list: async (input: unknown) => { directInput = input; return []; },
    get: async () => ({}) as never,
  } as never);
  await direct.list({ storeId }, request({ type: 'STORE', storeId }));
  assert.deepEqual(directInput, { storeId, supplierId: undefined, cycle: undefined, settlementStatus: undefined });
  assert.throws(() => direct.get('statement', request({ type: 'STORE' })), (error: unknown) => error instanceof ForbiddenException);

  let storeInput: unknown;
  const store = new StoreStatementsController({
    list: async (input: unknown) => { storeInput = input; return []; },
    get: async () => ({}) as never,
  } as never);
  await store.list({}, request({ type: 'STORE_FINANCE', storeId }));
  assert.equal((storeInput as { storeId: string }).storeId, storeId);

  let supplierInput: unknown;
  const supplier = new SupplierStatementsController({
    list: async (input: unknown) => { supplierInput = input; return []; },
    get: async () => ({}) as never,
  } as never);
  await supplier.list({}, request({ type: 'SUPPLIER', supplierId }));
  assert.equal((supplierInput as { supplierId: string }).supplierId, supplierId);

  let supplierStoreInput: unknown;
  const supplierStore = new SupplierStoreStatementsController({
    list: async (input: unknown) => { supplierStoreInput = input; return []; },
    get: async () => ({}) as never,
  } as never);
  await supplierStore.list({}, request({ type: 'SUPPLIER', supplierId }));
  assert.equal((supplierStoreInput as { supplierId: string }).supplierId, supplierId);

  const stores = new StoresController({ getAccount: async () => ({}) as never, listLedgers: async () => [] } as never, {} as never);
  assert.throws(() => stores.getAccount(storeId, request({ type: 'STORE_FINANCE' })), (error: unknown) => error instanceof ForbiddenException);
});
