const workflowKey = 'procurex-product-app-workflow';

export function loadWorkflowContext() {
  try {
    return JSON.parse(sessionStorage.getItem(workflowKey) || 'null');
  } catch {
    return null;
  }
}

export function saveWorkflowContext(next) {
  const value = { ...(loadWorkflowContext() || {}), ...next, updatedAt: new Date().toISOString() };
  sessionStorage.setItem(workflowKey, JSON.stringify(value));
  return value;
}

export function clearWorkflowContext() {
  sessionStorage.removeItem(workflowKey);
}

export async function refreshWorkflowContext(refreshers) {
  const current = loadWorkflowContext();
  if (!current) throw new Error('没有可刷新的流程交接');
  const results = await Promise.all(Object.entries(refreshers).map(async ([name, refresh]) => {
    try {
      return { name, updates: await refresh(current) };
    } catch (error) {
      return { name, error: error.message };
    }
  }));
  const updates = Object.assign({}, ...results.filter((item) => item.updates).map((item) => item.updates));
  if (Object.keys(updates).length) saveWorkflowContext({ ...updates, refreshedAt: new Date().toISOString() });
  return {
    workflow: loadWorkflowContext(),
    refreshed: results.filter((item) => item.updates).map((item) => item.name),
    errors: results.filter((item) => item.error),
  };
}

export function workflowNextAction(workflow) {
  if (!workflow?.purchaseRequestId) return { title: '先执行业务流转', detail: '运行主流程后生成可交接的业务上下文。', href: '#/flow' };
  if (!workflow.supplierOrderId || workflow.purchaseRequestStatus === 'PENDING_PROCUREMENT' || workflow.supplierOrderStatus === 'REJECTED') {
    return { title: workflow.supplierOrderStatus === 'REJECTED' ? '采购处理供应商拒单' : '采购确认并分配供应商', detail: workflow.purchaseRequestNo || workflow.purchaseRequestId, href: '#/purchaser' };
  }
  if (!workflow.shipmentId) return { title: '供应商继续发货', detail: workflow.supplierOrderId || '等待供应商执行单', href: '#/supplier' };
  if (!workflow.receiptId) return { title: '门店继续收货', detail: workflow.shipmentNo || workflow.shipmentId, href: '#/store' };
  if (!workflow.paymentId) return { title: '财务登记付款', detail: workflow.receiptNo || workflow.receiptId, href: '#/finance' };
  if (workflow.paymentStatus === 'PENDING') return { title: '供应商确认收款', detail: workflow.paymentNo || workflow.paymentId, href: '#/supplier' };
  return { title: '流程复核完成', detail: workflow.paymentStatus || workflow.status || 'COMPLETED', href: '#/overview' };
}
