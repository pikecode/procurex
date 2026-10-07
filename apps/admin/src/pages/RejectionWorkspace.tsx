import { useEffect, useState } from 'react';
import { Alert, App, Button, Descriptions, Form, Grid, Input, Modal, Popconfirm, Segmented, Select, Spin, Table, Tooltip } from 'antd';
import { Check, RotateCcw } from 'lucide-react';
import { ListPage } from '../components/ListPage';
import { request } from '../lib/api';
import type { CatalogProduct, CatalogSupplier, TemplateDetail } from '../lib/catalogTypes';
import { useRows } from '../lib/useRows';
import type { useWorkflowCommand } from '../lib/useWorkflowCommand';
import { workflowTime, type Order, type Purchase, type WorkflowItem } from '../lib/workflowTypes';

type Todo = { id: string; supplierOrderId: string; supplierOrderNo: string; purchaseRequestId: string; requestNo: string; storeName: string; supplierName: string; reason: string; createdAt: string };
type Choice = { requestItemId: string; supplierId?: string; cancel?: boolean };
type Context = { purchase: Purchase; order: Order; items: WorkflowItem[]; template: TemplateDetail; suppliers: CatalogSupplier[]; products: CatalogProduct[]; shipped: Set<string> };

export function RejectionTodos({ revision, onOpen }: { revision: number; onOpen: (requestId: string, orderId: string) => void }) {
  const list = useRows<Todo>('/purchase-requests/rejection-todos');
  const reload = list.reload;
  useEffect(() => { reload(); }, [revision, reload]);
  return <ListPage title="拒单待办" rows={list.rows.map(row => ({ ...row, name: row.supplierOrderNo }))} loading={list.loading} error={list.error} reload={list.reload}
    columns={[{ title: '订单编号', dataIndex: 'supplierOrderNo', width: 210 }, { title: '采购申请', dataIndex: 'requestNo', width: 210 }, { title: '门店', dataIndex: 'storeName', width: 160 },
      { title: '供应商', dataIndex: 'supplierName', width: 160 }, { title: '拒单原因', dataIndex: 'reason', width: 240 }, { title: '拒单时间', dataIndex: 'createdAt', render: workflowTime, width: 170 },
      { title: '操作', width: 64, fixed: 'right', render: (_, row) => <Tooltip title="处理拒单"><Button type="text" aria-label={`处理${row.supplierOrderNo}`} icon={<RotateCcw size={16} />} onClick={() => onOpen(row.purchaseRequestId, row.supplierOrderId)} /></Tooltip> }]} />;
}

export function RejectionEditor({ requestId, orderId, command, canRecover, onClose, onSaved }: { requestId: string; orderId: string; command: ReturnType<typeof useWorkflowCommand>; canRecover: boolean; onClose: () => void; onSaved: () => void }) {
  const [context, setContext] = useState<Context | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [revision, setRevision] = useState(0); const [choices, setChoices] = useState<Choice[]>([]); const [reason, setReason] = useState(''); const [reviewed, setReviewed] = useState(false);
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint(); const mobile = screens.md === false;
  useEffect(() => {
    const controller = new AbortController(); setContext(null); setChoices([]); setReviewed(false); setLoading(true); setError(''); setReason('');
    (async () => {
      const [purchase, order] = await Promise.all([request<Purchase>(`/purchase-requests/${requestId}`, { signal: controller.signal }), request<Order>(`/supplier-orders/${orderId}`, { signal: controller.signal })]);
      const summary = purchase.supplierOrders.find(row => row.id === orderId);
      if (purchase.id !== requestId || order.id !== orderId || order.requestId !== requestId || purchase.status !== 'PARTIAL_PUSHED' || !summary || summary.status !== 'REJECTED' || summary.rejectionHandled || order.status !== 'REJECTED') throw new Error('拒单已处理或申请状态已变更，请返回刷新待办。');
      if (!Array.isArray(order.items) || !order.items.length) throw new Error('拒单明细为空，请重新读取。');
      const productsInOrder = new Set(order.items.map(item => item.productId));
      const items = purchase.items.filter(item => productsInOrder.has(item.productId));
      if (!items.length || new Set(items.map(item => item.id)).size !== items.length) throw new Error('采购明细不完整，请重新读取。');
      const [template, suppliers, products, targets] = await Promise.all([
        request<TemplateDetail>(`/templates/${purchase.templateId}`, { signal: controller.signal }), request<CatalogSupplier[]>('/suppliers', { signal: controller.signal }), request<CatalogProduct[]>('/products', { signal: controller.signal }),
        Promise.all(purchase.supplierOrders.filter(row => row.status !== 'REJECTED').map(row => request<Order>(`/supplier-orders/${row.id}`, { signal: controller.signal }))),
      ]);
      if (template.id !== purchase.templateId || targets.some(row => row.requestId !== requestId)) throw new Error('原模板或目标订单读取异常，请重新读取。');
      if (!controller.signal.aborted) {
        setContext({ purchase, order, items, template, suppliers, products, shipped: new Set(targets.filter(row => row.firstShippedAt).map(row => row.supplierId)) });
        setChoices(items.map(item => ({ requestItemId: item.id })));
      }
    })().catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [requestId, orderId, revision]);
  function options(item: WorkflowItem) {
    const entry = context?.template.items.find(row => row.productId === item.productId && row.isEnabled);
    if (!entry || !context?.products.some(row => row.id === item.productId && row.isActive)) return [];
    return context.suppliers.filter(row => row.status === 'ACTIVE' && !row.isArchived && !context.shipped.has(row.id) && entry.suppliers.some(link => link.supplierId === row.id)).map(row => ({ value: row.id, label: row.name }));
  }
  function change(id: string, value: Omit<Choice, 'requestItemId'>) { setChoices(rows => rows.map(row => row.requestItemId === id ? { requestItemId: id, ...value } : row)); setReviewed(false); setError(''); }
  const productName = (item: WorkflowItem) => item.productName || context?.products.find(row => row.id === item.productId)?.name || item.productId;
  const methodControl = (item: WorkflowItem) => <Segmented aria-label={`处理方式${item.id}`} disabled={command.blocked} value={choices.find(row => row.requestItemId === item.id)?.cancel ? 'cancel' : 'assign'} options={[{ label: '重分配', value: 'assign' }, { label: '取消商品', value: 'cancel' }]} onChange={value => change(item.id, value === 'cancel' ? { cancel: true } : {})} />;
  function supplierControl(item: WorkflowItem) {
    const choice = choices.find(row => row.requestItemId === item.id);
    return choice?.cancel ? '取消，不再采购' : <Select style={{ width: '100%' }} aria-label={`目标供应商${item.id}`} showSearch optionFilterProp="label" placeholder={options(item).length ? '选择供应商' : '无可用供应商'} options={options(item)} value={choice?.supplierId} disabled={command.blocked} onChange={supplierId => change(item.id, { supplierId })} />;
  }
  function validate() {
    if (!context || choices.length !== context.items.length || !reason.trim() || reason.trim().length > 300) throw new Error('请填写处理原因，最多300字。');
    if (choices.some(row => !row.cancel && !options(context.items.find(item => item.id === row.requestItemId)!).some(option => option.value === row.supplierId))) throw new Error('每项商品请选择可用供应商，或选择取消商品。');
  }
  return <Modal open zIndex={1200} title="拒单重分配" width={960} maskClosable={false} closable={!command.busy} onCancel={() => { if (!command.busy) onClose(); }} footer={<div className="actions workflow-actions">
    <Button disabled={command.busy} onClick={onClose}>关闭</Button>
    <Tooltip title="重新读取拒单"><Button aria-label="重新读取拒单" icon={<RotateCcw size={16} />} disabled={loading || command.blocked} onClick={() => { command.clearError(); setRevision(value => value + 1); }} /></Tooltip>
    <Button disabled={loading || command.blocked || !context} onClick={() => { try { validate(); setReviewed(true); setError(''); } catch (failure) { setError((failure as Error).message); } }}>核对处理清单</Button>
    <Popconfirm key={revision} zIndex={1400} title={choices.every(row => row.cancel) ? '确认取消此拒单的全部商品？' : '确认按当前有效价格重分配并核定资金？'} disabled={!reviewed || command.blocked || loading} onConfirm={async () => {
      try {
        validate(); if (!reviewed || command.blocked) return;
        if (await command.submit({ path: `/purchase-requests/${requestId}/reallocate`, method: 'POST', label: '拒单重分配', body: { expectedVersion: context!.purchase.version, rejectedOrderId: orderId, reason: reason.trim(), assignments: choices.map(row => row.cancel ? { requestItemId: row.requestItemId, cancel: true } : { requestItemId: row.requestItemId, supplierId: row.supplierId }) } })) { message.success('拒单处理已确认'); onSaved(); }
        else setReviewed(false);
      } catch (failure) { setError((failure as Error).message); setReviewed(false); }
    }}><Button type="primary" icon={<Check size={16} />} loading={command.busy} disabled={!reviewed || command.blocked || loading}>确认处理</Button></Popconfirm>
  </div>}>
    {(error || command.error) && <Alert type="error" showIcon title={error || command.error} />}
    {command.pending && <Alert type="warning" showIcon title={`待确认提交：${command.pending.label}`} action={<Button disabled={!canRecover} loading={command.busy} onClick={async () => { if (canRecover && await command.recover()) { message.success('原提交已确认'); onSaved(); } }}>恢复原提交</Button>} />}
    {loading ? <Spin /> : context && <>
      <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[{ key: 'request', label: '采购申请', children: context.purchase.requestNo }, { key: 'order', label: '拒单编号', children: context.order.supplierOrderNo }, { key: 'template', label: '原订货模板', children: context.template.name }, { key: 'supplier', label: '原供应商', children: context.suppliers.find(row => row.id === context.order.supplierId)?.name || '-' }]} />
      {mobile ? <Form layout="vertical" className="compact-form">{context.items.map(item => <div className="rejection-item" data-item-id={item.id} key={item.id}>
        <strong>{productName(item)}</strong><div className="template-price">{item.quantity} {item.unitName || item.unitSnapshot?.salesUnitName || ''}</div>
        <Form.Item label="处理方式">{methodControl(item)}</Form.Item><Form.Item label="目标供应商">{supplierControl(item)}</Form.Item>
      </div>)}</Form> : <Table<WorkflowItem> rowKey="id" size="small" dataSource={context.items} pagination={false} scroll={{ x: 720 }} columns={[
        { title: '商品', width: 200, render: (_, item) => productName(item) },
        { title: '数量 / 单位', width: 130, render: (_, item) => `${item.quantity} ${item.unitName || item.unitSnapshot?.salesUnitName || ''}` },
        { title: '处理方式', width: 200, render: (_, item) => methodControl(item) },
        { title: '目标供应商', width: 220, render: (_, item) => supplierControl(item) },
      ]} />}
      <Form layout="vertical" className="compact-form"><Form.Item label="处理原因" required><Input.TextArea aria-label="处理原因" rows={2} maxLength={300} disabled={command.blocked} value={reason} onChange={event => { setReason(event.target.value); setReviewed(false); }} /></Form.Item></Form>
      {reviewed && <section className="price-band"><h2>处理清单</h2><Alert type="warning" showIcon title={`重分配 ${choices.filter(row => !row.cancel).length} 项，取消 ${choices.filter(row => row.cancel).length} 项；销售、供货金额及资金状态按提交时有效价格重新核定。`} /><Table rowKey="requestItemId" size="small" dataSource={choices} pagination={false} scroll={mobile ? undefined : { x: 500 }} columns={[{ title: '商品', render: (_, row) => productName(context.items.find(item => item.id === row.requestItemId)!) }, { title: '处理结果', render: (_, row) => row.cancel ? '取消商品' : context.suppliers.find(item => item.id === row.supplierId)?.name }]} /></section>}
    </>}
  </Modal>;
}
