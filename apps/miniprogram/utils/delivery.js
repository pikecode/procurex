const quantity = require('./quantity');

function supplierOrderState(order) {
  if (order.status === 'REJECTED' || order.status === 'CANCELED') return order.status;
  if (order.status === 'COMPLETED' || order.deliveryState === 'COMPLETED' || (!order.deliveryState && order.fulfillmentStatus === 'COMPLETED')) return 'COMPLETED';
  if (order.pendingSupplierReceiptExceptionCount > 0) return 'DISPUTED';
  if (order.pendingReplenishmentCount > 0) return 'REPLENISHING';
  if (order.deliveryState === 'DECLINED') return order.pendingReceiptCount > 0 ? 'SHIPPED' : 'WAITING_STORE_CONFIRM';
  if (order.deliveryState === 'FINISHED') return order.pendingReceiptCount === 0 ? 'WAITING_STORE_CONFIRM' : 'SHIPPED';
  const current = { IN_PROGRESS: 'PARTIAL_SHIPPED', DISPUTED: 'DISPUTED', REPLENISHING: 'REPLENISHING' }[order.deliveryState];
  if (current) return current;
  if (order.status === 'COMPLETED' || order.fulfillmentStatus === 'COMPLETED') return 'COMPLETED';
  if (order.fulfillmentStatus === 'CANCELED') return 'CANCELED';
  if (order.status === 'PARTIAL_SHIPPED' || order.fulfillmentStatus === 'PARTIAL_SHIPPED') return 'PARTIAL_SHIPPED';
  if (order.status === 'SHIPPED' || ['SHIPPED', 'RECEIVED'].includes(order.fulfillmentStatus)) return order.pendingReceiptCount === 0 ? 'WAITING_STORE_CONFIRM' : 'SHIPPED';
  return ['PUSHED', 'ACCEPTED'].includes(order.status) ? 'pending' : order.status;
}

function shipmentLines(order) {
  return order.items.map(item => {
    const gaps = (item.replenishmentGaps || []).filter(gap => ['PENDING', 'PARTIAL_FILLED'].includes(gap.status) && Number(gap.remainingQuantity) > 0);
    const normal = item.remainingToShipQuantity || quantity.remaining(item.quantity, item.shippedQuantity);
    let remaining = quantity.sum([normal, ...gaps.map(gap => gap.remainingQuantity)]);
    if (order.deliveryState === 'REPLENISHING') {
      const line = order.deliveryReview?.items.find(line => line.orderItemId === item.id);
      remaining = line ? quantity.remaining(line.quantity, quantity.remaining(item.shippedQuantity, line.shippedBefore)) : '0';
    }
    return { ...item, normalRemaining: normal, remainingQuantity: remaining, shipQuantity: remaining,
      selectedForShipment: Number(remaining) > 0, shipQuantityError: '', gaps,
      imageUrl: '', imageFailed: false, imageLoading: Boolean(item.imageFile?.id || item.imageFileId) };
  });
}

function supplierOrderLabel(order) {
  const state = supplierOrderState(order);
  return ({ pending: '待发货', PARTIAL_SHIPPED: '发货中', SHIPPED: '待收货', WAITING_STORE_CONFIRM: '待门店确认',
    DISPUTED: '待处理异常', REPLENISHING: '待补发', COMPLETED: '已完成', REJECTED: '已关闭 · 已拒单', CANCELED: '已关闭 · 已取消' })[state] || state;
}

function needsExplanation(items, completeDelivery) {
  return completeDelivery && items.some(item => Number(item.selectedForShipment === false ? 0 : item.shipQuantity || 0) < Number(item.remainingQuantity));
}

function shipmentPayload(items) {
  return items.filter(item => item.selectedForShipment !== false).map(item => {
    const shipQuantity = quantity.validate(item.shipQuantity, { allowZero: true, max: item.remainingQuantity });
    let replacement = quantity.remaining(shipQuantity, item.normalRemaining || '0');
    const gapAllocations = [];
    for (const gap of item.gaps || []) {
      const amount = String(Math.min(Number(replacement), Number(gap.remainingQuantity)));
      if (Number(amount) > 0) gapAllocations.push({ gapId: gap.id, quantity: amount });
      replacement = quantity.remaining(replacement, amount);
    }
    return { orderItemId: item.id, shipQuantity, permanentlyReduceQuantity: '0', ...(gapAllocations.length ? { gapAllocations } : {}) };
  }).filter(item => Number(item.shipQuantity) > 0);
}

module.exports = { shipmentLines, needsExplanation, shipmentPayload, supplierOrderState, supplierOrderLabel };
