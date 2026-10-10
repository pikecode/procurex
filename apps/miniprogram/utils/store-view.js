function dateText(value, withTime = true) {
  if (!value) return '';
  const date = new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const pad = number => String(number).padStart(2, '0');
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return withTime ? `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` : day;
}

function decimalText(value) {
  const text = String(value === undefined || value === null ? '' : value);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

function orderStage(order) {
  if (['pending', 'receive', 'completed', 'canceled'].includes(order.fulfillmentStage)) return order.fulfillmentStage;
  if (['CANCELED', 'CANCELLED', 'REJECTED'].includes(order.status)) return 'canceled';
  if (order.rejectedSupplierCount > 0) return 'pending';
  if (order.status === 'COMPLETED' || (order.supplierCount > 0 && order.completedSupplierCount + (order.canceledSupplierCount || 0) === order.supplierCount && order.completedSupplierCount > 0)) return 'completed';
  if (order.supplierCount > 0 && order.canceledSupplierCount === order.supplierCount) return 'pending';
  return ['PENDING_FUNDS', 'PENDING_PROCUREMENT', 'DRAFT'].includes(order.status) ? 'pending' : 'receive';
}

// Tones mirror labels.wxs: green for settled, amber for in flight, red for blocked, grey for inactive.
const STAGE_TONES = { pending: 'progress', receive: 'progress', completed: 'done', canceled: 'muted' };
function orderStageTone(order) {
  if (order.rejectedSupplierCount > 0) return 'fail';
  return STAGE_TONES[orderStage(order)] || 'muted';
}
const STATUS_TONES = {
  COMPLETED: 'done', SUCCEEDED: 'done', RECEIVED: 'done', PAID: 'done', SETTLED: 'done',
  CANCELED: 'muted', CANCELLED: 'muted', DRAFT: 'muted',
  REJECTED: 'fail', FAILED: 'fail', SHORT_RECEIVED: 'fail', UNPAID: 'fail', SHORTFALL: 'fail', PENDING_FUNDS: 'fail',
  PENDING_PROCUREMENT: 'progress', PROCESSING: 'progress', PUSHED: 'progress',
  PARTIAL_PUSHED: 'progress', PARTIAL_SHIPPED: 'progress', PARTIAL_PAID: 'progress', OPEN: 'progress',
};
function statusTone(value) { return STATUS_TONES[value] || 'muted'; }
function previewGroups(preview, products, expandedKey) {
  const groups = [];
  for (const line of preview.items || []) {
    const product = products.find(product => product.id === line.productId) || {};
    let group = groups.find(group => group.supplierId === line.supplierId);
    if (!group) {
      group = { supplierId: line.supplierId, supplierName: product.supplierName || '配送供应商', deliveryContactPhone: product.deliveryContactPhone || '', items: [] };
      groups.push(group);
    }
    group.items.push({ ...line, productName: product.name || '商品', unitName: line.unitName || line.unitSnapshot?.salesUnitName || product.unitName || '',
      purchaseInput: Boolean(line.unitSnapshot?.purchaseUnitId && line.unitSnapshot.inputUnitId === line.unitSnapshot.purchaseUnitId) });
  }
  // Keep the first supplier open unless the admin has opened another, so a long order stays scannable.
  return groups.map((group, index) => {
    const total = group.items.reduce((sum, line) => sum + Number(line.salesLineAmount || 0), 0);
    return { ...group, itemCount: group.items.length, groupAmount: total.toFixed(2), open: expandedKey ? expandedKey === group.supplierId : index === 0 };
  });
}

function previewSignature(preview) {
  return JSON.stringify({ items: (preview.items || []).map(item => [item.productId, item.quantity, item.salesUnitPrice, item.priceVersionId, item.supplyPriceVersionId, item.unitSnapshot]),
    total: preview.totals && preview.totals.salesGoodsAmount, stored: preview.funding && preview.funding.stored,
    credit: preview.funding && preview.funding.credit });
}

function monthRange() {
  const today = dateText(new Date().toISOString(), false);
  const first = today.slice(0, 8) + '01';
  const nextMonth = new Date(first + 'T00:00:00Z');
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  nextMonth.setUTCDate(0);
  return { from: first, to: nextMonth.toISOString().slice(0, 10) };
}

function statementPeriod(statement) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statement.periodStart || '') || !/^\d{4}-\d{2}-\d{2}$/.test(statement.periodEndExclusive || '')) return '';
  const end = new Date(statement.periodEndExclusive + 'T00:00:00Z');
  if (Number.isNaN(end.getTime())) return '';
  end.setUTCDate(end.getUTCDate() - 1);
  return `${statement.periodStart} 至 ${end.toISOString().slice(0, 10)}`;
}

module.exports = { dateText, decimalText, orderStage, orderStageTone, statusTone, previewGroups, previewSignature, monthRange, statementPeriod };
