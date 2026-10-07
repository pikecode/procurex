import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentRecordsService } from '../../apps/api/src/payment-records/payment-records.service.js';
import { FilesService } from '../../apps/api/src/files/files.service.js';

for (const type of ['STORE', 'STORE_FINANCE', 'SUPPLIER']) {
  const direction = type === 'SUPPLIER' ? 'STORE_TO_COMPANY' : 'COMPANY_TO_SUPPLIER';
  const scope = { type, storeId: 'store', supplierId: 'supplier' };
  test(`${type} cannot read opposite-side payment or private proof`, async () => {
    const payment = { storeId: 'store', supplierId: 'supplier', direction };
    let where: any;
    const client = {
      paymentRecord: { findUnique: async () => payment, findMany: async (query: any) => { where = query.where; return []; } },
      fileObject: { findFirst: async () => ({ ownerId: 'central', payment }) },
    };
    await assert.rejects(new PaymentRecordsService({ client } as never).get('payment', scope), { status: 404 });
    await new PaymentRecordsService({ client } as never).list({ direction } as never, scope);
    assert.equal(where.direction, direction);
    assert.deepEqual(where.AND, [{ direction: { not: direction } }]);
    await assert.rejects(new FilesService({ client } as never).download('actor', 'proof', scope, [type]), { status: 404 });
  });
  test(`${type} cannot preview opposite-side settlement amounts`, async () => {
    const kind = type === 'SUPPLIER' ? 'STORE_RECEIVABLE' : 'SUPPLIER_PAYABLE';
    const service = new PaymentRecordsService({ client: {} } as never);
    for (const item of [{ kind, supplierOrderId: 'order' },
      { kind: 'ADJUSTMENT', supplierOrderId: 'order', adjustmentDocumentId: 'adjustment', adjustmentSide: type === 'SUPPLIER' ? 'STORE' : 'SUPPLIER' }]) {
      const id = Buffer.from(JSON.stringify(item)).toString('base64url');
      await assert.rejects(service.preview([id], undefined, scope), { status: 404 });
    }
  });
}
