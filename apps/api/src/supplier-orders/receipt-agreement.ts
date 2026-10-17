import { Decimal } from 'decimal.js';
import { effectiveOrderItemQuantity, type FulfillmentStatusItem } from './fulfillment-status.js';

type AgreementReceipt = {
  exceptionStatus?: string | null;
  exceptionDecision?: string | null;
  items: Array<{ shipmentItemId: string; receivedQuantity: Decimal.Value; discrepancy?: { status: string } | null }>;
};
type AgreementShipment = {
  items: Array<{ id: string; orderItemId: string; quantity: Decimal.Value }>;
  receipts: AgreementReceipt[];
};

export function unagreedShortages(items: Array<FulfillmentStatusItem & { id: string }>, shipments: AgreementShipment[],
  deliveryState?: string | null, review?: { respondedAt?: string; items: Array<{ orderItemId: string; quantity: string }> } | null) {
  const approved = new Map<string, Decimal>();
  for (const shipment of shipments) for (const receipt of shipment.receipts) {
    if (receipt.exceptionStatus !== 'RESOLVED' || !['ACCEPT_SHORTAGE', 'DECLINED'].includes(receipt.exceptionDecision ?? '')) continue;
    for (const line of receipt.items) {
      const source = shipment.items.find(item => item.id === line.shipmentItemId);
      if (!source || line.discrepancy?.status === 'RESOLVED') continue;
      const shortage = Decimal.max(0, new Decimal(source.quantity).minus(line.receivedQuantity));
      approved.set(source.orderItemId, (approved.get(source.orderItemId) ?? new Decimal(0)).plus(shortage));
    }
  }
  if (deliveryState === 'DECLINED' && review?.respondedAt) for (const line of review.items) {
    approved.set(line.orderItemId, (approved.get(line.orderItemId) ?? new Decimal(0)).plus(line.quantity));
  }
  return items.flatMap(item => {
    const quantity = effectiveOrderItemQuantity(item).minus(item.receivedQuantity).minus(approved.get(item.id) ?? 0);
    return quantity.gt(0) ? [{ orderItemId: item.id, quantity: quantity.toString() }] : [];
  });
}
