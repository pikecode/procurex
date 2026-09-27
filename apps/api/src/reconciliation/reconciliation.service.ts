import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { DatabaseService } from '../database/database.service.js';

export type ReconciliationIssueView = {
  issueId: string;
  type: 'STORE_BALANCE_LEDGER_MISMATCH' | 'STORE_CREDIT_USED_MISMATCH';
  severity: 'ERROR';
  storeId: string;
  storeCode: string;
  storeName: string;
  expectedAmount: string;
  actualAmount: string;
  deltaAmount: string;
  basis: string;
  detectedAt: string;
};

@Injectable()
export class ReconciliationService {
  constructor(private readonly database: DatabaseService) {}

  async listIssues(): Promise<ReconciliationIssueView[]> {
    const detectedAt = new Date().toISOString();
    const accounts = await this.database.client.storeAccount.findMany({
      include: {
        store: true,
        ledgers: { orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 1 },
        fundingAllocations: { where: { active: true }, select: { creditOutstanding: true } },
      },
      orderBy: { storeId: 'asc' },
    });

    const issues: ReconciliationIssueView[] = [];
    for (const account of accounts) {
      const latestLedgerBalance = account.ledgers[0]?.balanceAfter ?? new Decimal(0);
      if (!account.balance.equals(latestLedgerBalance)) {
        issues.push(issue({
          id: `STORE_BALANCE_LEDGER_MISMATCH:${account.id}`,
          type: 'STORE_BALANCE_LEDGER_MISMATCH',
          account,
          expected: latestLedgerBalance,
          actual: account.balance,
          basis: 'StoreAccount.balance must match the latest AccountLedger.balanceAfter for the account.',
          detectedAt,
        }));
      }

      const creditOutstanding = account.fundingAllocations.reduce((total, allocation) => total.plus(allocation.creditOutstanding), new Decimal(0));
      if (!account.creditUsed.equals(creditOutstanding)) {
        issues.push(issue({
          id: `STORE_CREDIT_USED_MISMATCH:${account.id}`,
          type: 'STORE_CREDIT_USED_MISMATCH',
          account,
          expected: creditOutstanding,
          actual: account.creditUsed,
          basis: 'StoreAccount.creditUsed must equal active FundingAllocation.creditOutstanding total.',
          detectedAt,
        }));
      }
    }

    return issues;
  }
}

function issue(input: {
  id: string;
  type: ReconciliationIssueView['type'];
  account: { storeId: string; store: { code: string; name: string } };
  expected: Decimal;
  actual: Decimal;
  basis: string;
  detectedAt: string;
}): ReconciliationIssueView {
  return {
    issueId: input.id,
    type: input.type,
    severity: 'ERROR',
    storeId: input.account.storeId,
    storeCode: input.account.store.code,
    storeName: input.account.store.name,
    expectedAmount: input.expected.toFixed(2),
    actualAmount: input.actual.toFixed(2),
    deltaAmount: input.actual.minus(input.expected).toFixed(2),
    basis: input.basis,
    detectedAt: input.detectedAt,
  };
}
