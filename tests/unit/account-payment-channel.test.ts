import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { PaymentRecordsService } from '../../apps/api/src/payment-records/payment-records.service.js';

for (const mode of ['STORED_VALUE', 'CREDIT']) {
  for (const adjustment of [false, true]) {
    test(`${mode} rejects ${adjustment ? 'store adjustment' : 'store receivable'} double payment even with a frozen snapshot`, async () => {
      const id = Buffer.from(JSON.stringify(adjustment
        ? { kind: 'ADJUSTMENT', adjustmentDocumentId: 'adjustment', supplierOrderId: 'order', adjustmentSide: 'STORE' }
        : { kind: 'STORE_RECEIVABLE', supplierOrderId: 'order' })).toString('base64url');
      const client = {
        supplierOrder: { findMany: async () => [{ id: 'order', status: 'COMPLETED', firstShippedAt: new Date(), settlementMode: mode, request: { shortfallAmount: '0' }, shipments: [] }] },
        settlementItemSnapshot: { findMany: async () => [{ settlementItemId: id, payableAmount: '120' }] },
        adjustmentDocument: { findMany: async () => [{ id: 'adjustment', supplierOrderId: 'order', side: 'STORE', amount: '20' }] },
        paymentAllocation: { findMany: async () => [] },
        differenceDisposalItem: { findMany: async () => [] },
      };
      const service = new PaymentRecordsService({ client } as never);
      await assert.rejects(service.preview([id]), error => {
        assert.ok(error instanceof NotFoundException);
        const response = error.getResponse() as { details: { blockedItems: Array<{ code: string }> } };
        assert.deepEqual(response.details.blockedItems.map(item => item.code), ['ACCOUNT_SETTLEMENT_NOT_PAYABLE']);
        return true;
      });
    });
  }
}
