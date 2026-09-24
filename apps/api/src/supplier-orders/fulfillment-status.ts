import { Decimal } from 'decimal.js';
import {
  DiscrepancyStatus,
  FulfillmentStatus,
  ReplenishmentGapStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';

export type FulfillmentStatusItem = {
  quantity: Decimal;
  shippedQuantity: Decimal;
  receivedQuantity: Decimal;
  shipmentItems: Array<{ permanentlyReduced: Decimal }>;
  discrepancies: Array<{
    missingQuantity: Decimal;
    status: DiscrepancyStatus;
    replenishmentGap?: { status: ReplenishmentGapStatus; remainingQuantity: Decimal } | null;
  }>;
};

export function resolveSupplierOrderFulfillmentStatus(items: FulfillmentStatusItem[]): FulfillmentStatus {
  const allComplete = items.every((item) => {
    const permanentlyReduced = item.shipmentItems.reduce((sum, shipmentItem) => sum.plus(shipmentItem.permanentlyReduced), new Decimal(0));
    const acceptedMissing = item.discrepancies
      .filter((discrepancy) => discrepancy.status === DiscrepancyStatus.RESOLVED)
      .reduce((sum, discrepancy) => sum.plus(discrepancy.missingQuantity), new Decimal(0));
    const hasBlockingDiscrepancy = item.discrepancies.some((discrepancy) => {
      if (discrepancy.status === DiscrepancyStatus.OPEN) {
        return true;
      }
      if (discrepancy.status !== DiscrepancyStatus.REPLENISH_PENDING) {
        return false;
      }
      return (
        !discrepancy.replenishmentGap ||
        discrepancy.replenishmentGap.status !== ReplenishmentGapStatus.FILLED ||
        new Decimal(discrepancy.replenishmentGap.remainingQuantity).gt(0)
      );
    });
    const effectiveTarget = Decimal.max(new Decimal(0), new Decimal(item.quantity).minus(permanentlyReduced).minus(acceptedMissing));

    return !hasBlockingDiscrepancy && new Decimal(item.receivedQuantity).gte(effectiveTarget);
  });

  if (allComplete) {
    return FulfillmentStatus.COMPLETED;
  }

  const anyShipped = items.some((item) => new Decimal(item.shippedQuantity).gt(0));
  return anyShipped ? FulfillmentStatus.PARTIAL_SHIPPED : FulfillmentStatus.PENDING;
}
