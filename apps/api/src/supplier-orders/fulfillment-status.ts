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
    returnRecord?: unknown;
    replenishmentGap?: { status: ReplenishmentGapStatus; remainingQuantity: Decimal } | null;
  }>;
};

export function resolveSupplierOrderFulfillmentStatus(items: FulfillmentStatusItem[]): FulfillmentStatus {
  const allComplete = items.every((item) => {
    const permanentlyReduced = item.shipmentItems.reduce((sum, shipmentItem) => sum.plus(shipmentItem.permanentlyReduced), new Decimal(0));
    const acceptedMissing = item.discrepancies
      .filter((discrepancy) => discrepancy.status === DiscrepancyStatus.RESOLVED && !discrepancy.returnRecord)
      .reduce((sum, discrepancy) => sum.plus(discrepancy.missingQuantity), new Decimal(0));
    const hasBlockingDiscrepancy = item.discrepancies.some((discrepancy) => {
      if (discrepancy.status === DiscrepancyStatus.OPEN) {
        return true;
      }
      if (discrepancy.status === DiscrepancyStatus.RESOLVED && discrepancy.returnRecord) return true;
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

export function effectiveOrderItemQuantity(item: Pick<FulfillmentStatusItem, 'quantity' | 'shipmentItems' | 'discrepancies'>): Decimal {
  const reduced = item.shipmentItems.reduce((sum, shipment) => sum.plus(shipment.permanentlyReduced), new Decimal(0));
  const accepted = item.discrepancies.filter(discrepancy => discrepancy.status === DiscrepancyStatus.RESOLVED && !discrepancy.returnRecord)
    .reduce((sum, discrepancy) => sum.plus(discrepancy.missingQuantity), new Decimal(0));
  return Decimal.max(0, new Decimal(item.quantity).minus(reduced).minus(accepted));
}

export function remainingNormalShipmentQuantity(item: {
  quantity: Decimal.Value;
  shippedQuantity: Decimal.Value;
  shipmentItems?: Array<{ permanentlyReduced: Decimal.Value; gapAllocations?: Array<{ quantity: Decimal.Value }> }>;
}): Decimal {
  const shipments = item.shipmentItems ?? [];
  const reduced = shipments.reduce((sum, shipment) => sum.plus(shipment.permanentlyReduced), new Decimal(0));
  const replenished = shipments.reduce((sum, shipment) => sum.plus((shipment.gapAllocations ?? [])
    .reduce((quantity, allocation) => quantity.plus(allocation.quantity), new Decimal(0))), new Decimal(0));
  // Gap replacements repair earlier shipments; they do not consume the unshipped original quantity.
  return Decimal.max(0, new Decimal(item.quantity).minus(item.shippedQuantity).minus(reduced).plus(replenished));
}
