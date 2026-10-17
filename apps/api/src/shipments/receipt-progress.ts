type ReceiptProgressOrder = { status: string; fulfillmentStatus: string; deliveryState: string | null; deliveryReview: unknown };
type ReceiptProgressShipment = { shippedAt: Date; receipts: Array<{ items: Array<{ discrepancy: { status: string; returnRecord?: unknown } | null }> }> };

export function pendingReceiptKind(order: ReceiptProgressOrder, shipment: ReceiptProgressShipment): 'PENDING' | 'RETURNED' | null {
  if (['COMPLETED', 'REJECTED', 'CANCELED'].includes(order.status) || order.fulfillmentStatus === 'COMPLETED'
    || ['DISPUTED', 'DECLINED', 'COMPLETED'].includes(order.deliveryState ?? '')) return null;
  const reviewedAt = (order.deliveryReview as { requestedAt?: string } | null)?.requestedAt;
  if (reviewedAt && shipment.shippedAt <= new Date(reviewedAt)) return null;
  const receipt = shipment.receipts[0];
  if (!receipt) return 'PENDING';
  return receipt.items.some(item => item.discrepancy?.status === 'RESOLVED' && item.discrepancy.returnRecord) ? 'RETURNED' : null;
}
