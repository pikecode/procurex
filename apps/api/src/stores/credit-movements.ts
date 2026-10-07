import { Decimal } from 'decimal.js';
import type { Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import type { LedgerSourceType } from '../../../../packages/backend/generated/prisma/enums.js';

export async function recordCreditMovement(tx: Prisma.TransactionClient, input: {
  accountId: string; fundingAllocationId: string; before: Decimal.Value; after: Decimal.Value;
  sourceType: LedgerSourceType; sourceId: string; clearing?: boolean; occurredAt?: Date;
}) {
  const delta = new Decimal(input.after).minus(input.before);
  if (delta.isZero()) return;
  const kind = delta.gt(0) ? 'BOOKING' : input.clearing ? 'CLEARING' : 'RELEASE';
  await tx.creditMovement.create({ data: { accountId: input.accountId, fundingAllocationId: input.fundingAllocationId,
    kind, amount: delta.abs().toFixed(2), outstandingAfter: new Decimal(input.after).toFixed(2),
    sourceType: input.sourceType, sourceId: input.sourceId, occurredAt: input.occurredAt } });
  // NULL means pre-migration history is unknown; SQL increment preserves that boundary.
  if (kind === 'BOOKING') await tx.storeAccount.update({ where: { id: input.accountId }, data: { creditCumulative: { increment: delta.toFixed(2) } } });
}
