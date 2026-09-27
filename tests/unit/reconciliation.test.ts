import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { ReconciliationService } from '../../apps/api/src/reconciliation/reconciliation.service.js';

test('reconciliation reports store balance and credit-used mismatches without changing data', async () => {
  let updateCalled = false;
  const service = new ReconciliationService({
    client: {
      storeAccount: {
        findMany: async () => [{
          id: 'account-1',
          storeId: 'store-1',
          balance: new Decimal('120.00'),
          creditUsed: new Decimal('80.00'),
          store: { code: 'PX-001', name: 'PX Store' },
          ledgers: [{ balanceAfter: new Decimal('100.00') }],
          fundingAllocations: [{ creditOutstanding: new Decimal('30.00') }, { creditOutstanding: new Decimal('20.00') }],
        }],
        update: async () => { updateCalled = true; },
      },
    },
  } as any);

  const issues = await service.listIssues();

  assert.equal(updateCalled, false);
  assert.deepEqual(issues.map((issue) => issue.type), ['STORE_BALANCE_LEDGER_MISMATCH', 'STORE_CREDIT_USED_MISMATCH']);
  assert.deepEqual(issues.map((issue) => [issue.expectedAmount, issue.actualAmount, issue.deltaAmount]), [
    ['100.00', '120.00', '20.00'],
    ['50.00', '80.00', '30.00'],
  ]);
});

test('reconciliation returns no issues when account facts match ledger and allocations', async () => {
  const service = new ReconciliationService({
    client: {
      storeAccount: {
        findMany: async () => [{
          id: 'account-1',
          storeId: 'store-1',
          balance: new Decimal('100.00'),
          creditUsed: new Decimal('50.00'),
          store: { code: 'PX-001', name: 'PX Store' },
          ledgers: [{ balanceAfter: new Decimal('100.00') }],
          fundingAllocations: [{ creditOutstanding: new Decimal('50.00') }],
        }],
      },
    },
  } as any);

  assert.deepEqual(await service.listIssues(), []);
});
