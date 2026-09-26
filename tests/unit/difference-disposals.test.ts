import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { DifferenceDisposalDirection } from '../../packages/backend/generated/prisma/enums.js';
import { DifferenceDisposalsService } from '../../apps/api/src/difference-disposals/difference-disposals.service.js';

test('B12 can offset a negative credit against an available positive adjustment', async () => {
  const targetId = Buffer.from(JSON.stringify({ kind: 'ADJUSTMENT', supplierOrderId: 'order-1', adjustmentDocumentId: 'adjustment-1', adjustmentSide: 'STORE' })).toString('base64url');
  const service = new DifferenceDisposalsService({ client: {} } as any);
  const client = {
    supplierOrder: { findMany: async () => [{
      id: 'order-1', storeId: 'store-1', supplierId: 'supplier-1', status: 'COMPLETED', firstShippedAt: new Date(),
    }] },
    adjustmentDocument: { findMany: async () => [{
      id: 'adjustment-1', supplierOrderId: 'order-1', side: 'STORE', amount: new Decimal('20.00'),
    }] },
    paymentAllocation: { findMany: async () => [{ settlementItemId: targetId, amount: new Decimal('2.00') }] },
    differenceDisposalItem: { findMany: async () => [{ targetDebitItemId: targetId, amount: new Decimal('3.00') }] },
  };
  const available = await (service as any).loadTargetAvailability(
    [targetId], 'supplier-1', 'store-1', DifferenceDisposalDirection.COMPANY_TO_STORE, client,
  );
  assert.equal(available.get(targetId)?.toFixed(2), '15.00');
});

test('B12 rejects positive adjustment targets on the opposite settlement side', async () => {
  const targetId = Buffer.from(JSON.stringify({ kind: 'ADJUSTMENT', supplierOrderId: 'order-1', adjustmentDocumentId: 'adjustment-1', adjustmentSide: 'STORE' })).toString('base64url');
  const service = new DifferenceDisposalsService({ client: {} } as any);
  await assert.rejects(
    () => (service as any).loadTargetAvailability([targetId], 'supplier-1', 'store-1', DifferenceDisposalDirection.SUPPLIER_TO_COMPANY, {}),
    (error: any) => error?.getResponse?.()?.code === 'TARGET_DEBIT_KIND_NOT_SUPPORTED',
  );
});
