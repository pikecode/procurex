type RequestProgressInput = {
  status: string;
  items: Array<{ productId: string; supplierId: string }>;
  supplierOrders: Array<{ id?: string; createdAt?: Date; status: string; supplierId: string; items: Array<{ productId: string }> }>;
};

export function requestProgress(request: RequestProgressInput) {
  // Rejected orders remain historical records after reassignment, not active delivery obligations.
  const orders = request.supplierOrders.filter(order => !isHistoricalRejection(request, order));
  const counts = {
    supplierCount: orders.length,
    completedSupplierCount: orders.filter(order => order.status === 'COMPLETED').length,
    canceledSupplierCount: orders.filter(order => order.status === 'CANCELED').length,
    rejectedSupplierCount: orders.filter(order => order.status === 'REJECTED').length,
  };
  const fulfillmentStage = request.status === 'CANCELED' || (!request.items.length && request.supplierOrders.length > 0) || (counts.supplierCount > 0 && counts.canceledSupplierCount === counts.supplierCount) ? 'canceled'
    : request.status === 'COMPLETED' ? 'completed'
    : counts.rejectedSupplierCount > 0 || ['PENDING_FUNDS', 'PENDING_PROCUREMENT', 'DRAFT'].includes(request.status) ? 'pending'
    : counts.supplierCount > 0 && counts.completedSupplierCount + counts.canceledSupplierCount === counts.supplierCount ? 'completed'
    : 'receive';
  return { ...counts, fulfillmentStage };
}

export function isHistoricalRejection(request: Pick<RequestProgressInput, 'items' | 'supplierOrders'>, order: RequestProgressInput['supplierOrders'][number]) {
  if (order.status !== 'REJECTED') return false;
  const active = order.items.some(line => {
    if (!request.items.some(item => item.productId === line.productId && item.supplierId === order.supplierId)) return false;
    return !request.supplierOrders.some(replacement => {
      if (replacement.status === 'CANCELED' || replacement.supplierId !== order.supplierId || !replacement.items.some(item => item.productId === line.productId)) return false;
      if (replacement.status !== 'REJECTED') return true;
      return replacement.id !== order.id && replacement.createdAt && order.createdAt && replacement.createdAt.getTime() > order.createdAt.getTime();
    });
  });
  return !active;
}
