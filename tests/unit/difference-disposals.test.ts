import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { DifferenceDisposalDirection, DifferenceDisposalMethod, DifferenceDisposalStatus } from '../../packages/backend/generated/prisma/enums.js';
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

test('B12 scope confirmation only exposes the matching receiver direction', async () => {
  const disposal = {
    id: 'disposal-1',
    disposalNo: 'DD-1',
    direction: DifferenceDisposalDirection.SUPPLIER_TO_COMPANY,
    method: DifferenceDisposalMethod.OFFLINE_RETURN,
    storeId: 'store-1',
    supplierId: 'supplier-1',
    amount: new Decimal('8.00'),
    businessDate: new Date('2026-09-27T00:00:00Z'),
    status: DifferenceDisposalStatus.PENDING,
    reason: null,
    version: 1,
    confirmedAt: null,
    createdAt: new Date('2026-09-27T00:00:00Z'),
    items: [],
  };
  const service = new DifferenceDisposalsService({
    client: {
      differenceDisposal: {
        findUnique: async () => disposal,
        updateMany: async () => ({ count: 1 }),
        findUniqueOrThrow: async () => ({ ...disposal, status: DifferenceDisposalStatus.CONFIRMED, version: 2 }),
      },
    },
  } as any);

  await assert.rejects(
    () => service.get(disposal.id, { type: 'STORE', storeId: disposal.storeId }),
    (error: any) => error?.getResponse?.()?.code === 'DIFFERENCE_DISPOSAL_NOT_FOUND',
  );
  await assert.rejects(
    () => service.confirm(disposal.id, { expectedVersion: 1 }, { type: 'STORE', storeId: disposal.storeId }),
    (error: any) => error?.getResponse?.()?.code === 'DIFFERENCE_DISPOSAL_NOT_FOUND',
  );
  assert.equal((await service.get(disposal.id, { type: 'SUPPLIER', supplierId: disposal.supplierId })).id, disposal.id);
  assert.equal((await service.confirm(disposal.id, { expectedVersion: 1 }, { type: 'SUPPLIER', supplierId: disposal.supplierId })).version, 2);
});
