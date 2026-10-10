import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Select, Spin, Table } from 'antd';
import { Check, Eye, RotateCcw } from 'lucide-react';
import { request } from '../lib/api';
import { decimalRule } from '../lib/catalogTypes';
import type { useWorkflowCommand } from '../lib/useWorkflowCommand';
import type { ShippingOrder, ShipmentInput, ShipmentPreview } from '../lib/workflowTypes';

type Draft = { deliveryMode: 'SELF' | 'LOGISTICS'; trackingNo?: string; freightConfirmationId?: string; items: { orderItemId: string; shipQuantity: string; permanentlyReduceQuantity: string; gapAllocations: { gapId: string; quantity: string }[] }[] };
const positive = (value: string) => /[1-9]/.test(value);
export function ShipmentEditor({ orderId, supplierId, onRecover, command, onClose, onSaved }: { orderId: string; supplierId?: string; onRecover?: () => Promise<void>; command: ReturnType<typeof useWorkflowCommand>; onClose: () => void; onSaved: () => void }) {
  const [order, setOrder] = useState<ShippingOrder | null>(null); const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [preview, setPreview] = useState<ShipmentPreview | null>(null); const [signature, setSignature] = useState(''); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [form] = Form.useForm<Draft>(); const { message } = App.useApp(); const invalidate = () => { setPreview(null); setSignature(''); };
  const drafts = Form.useWatch('items', form) as Draft['items'] | undefined;
  const deliveryMode = Form.useWatch('deliveryMode', form);
  useEffect(() => {
    const controller = new AbortController(); setOrder(null); setLoading(true); setError(''); invalidate(); form.resetFields();
    request<ShippingOrder>(`/supplier-orders/${orderId}`, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (supplierId && value.supplierId !== supplierId) throw new Error('订单不属于当前供应商。');
      if (value.id !== orderId || !['PUSHED', 'ACCEPTED', 'PARTIAL_SHIPPED', 'SHIPPED'].includes(value.status)) throw new Error('订单当前状态不能发货，请返回刷新。');
      setOrder(value); form.setFieldsValue({ deliveryMode: value.defaultDeliveryMode, items: value.items.map(item => ({ orderItemId: item.id, shipQuantity: '0', permanentlyReduceQuantity: '0', gapAllocations: (item.replenishmentGaps || []).filter(gap => ['PENDING', 'PARTIAL_FILLED'].includes(gap.status)).map(gap => ({ gapId: gap.id, quantity: '0' })) })) });
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [orderId, supplierId, revision, form]);
  async function draft(): Promise<ShipmentInput> {
    const values = await form.validateFields(); if (!order || loading) throw new Error('请先读取订单。');
    const items = values.items.filter(item => positive(item.shipQuantity) || positive(item.permanentlyReduceQuantity) || item.gapAllocations.some(gap => positive(gap.quantity))).map(item => ({ orderItemId: item.orderItemId, shipQuantity: item.shipQuantity, permanentlyReduceQuantity: item.permanentlyReduceQuantity,
      ...(item.gapAllocations.some(gap => positive(gap.quantity)) ? { gapAllocations: item.gapAllocations.filter(gap => positive(gap.quantity)) } : {}) }));
    if (!items.length) throw new Error('至少填写一项发货数量或永久减量。');
    const confirmation = order.freightConfirmations?.find(row => row.id === values.freightConfirmationId && row.status === 'CONFIRMED' && !row.usedAt);
    if (values.freightConfirmationId && !confirmation) throw new Error('运费确认已失效，请重新读取订单。');
    return { expectedVersion: order.version, deliveryMode: values.deliveryMode, items, freight: confirmation?.amount || '0.00', ...(confirmation ? { freightConfirmationId: confirmation.id } : {}), ...(values.deliveryMode === 'LOGISTICS' && values.trackingNo?.trim() ? { trackingNo: values.trackingNo.trim() } : {}) };
  }
  async function readPreview() {
    if (lock.current || command.blocked) return; lock.current = true; setBusy(true); setError(''); invalidate();
    try {
      const body = await draft(); const result = await request<ShipmentPreview>(`/supplier-orders/${orderId}/shipment-preview`, { method: 'POST', body });
      if (result.supplierOrderId !== orderId || result.version !== body.expectedVersion || result.freightConfirmationId !== (body.freightConfirmationId || null) || !result.totals || !Array.isArray(result.items)
        || result.items.length !== body.items.length || new Set(result.items.map(item => item.orderItemId)).size !== body.items.length || result.items.some(item => !body.items.some(row => row.orderItemId === item.orderItemId) || (!supplierId && !item.salesLineAmount) || !item.supplyLineAmount)) throw new Error('发货预览不完整，请重新读取并预览。');
      setPreview(result); setSignature(JSON.stringify(body));
    } catch (failure) { if (!('errorFields' in (failure as object))) setError((failure as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Modal open zIndex={1200} title="发货与补发" width={960} maskClosable={false} closable={!busy && !command.busy} onCancel={() => { if (!busy && !command.busy) onClose(); }} footer={<div className="actions workflow-actions">
    <Button onClick={onClose} disabled={busy || command.busy}>取消</Button><Button aria-label="重新读取发货订单" icon={<RotateCcw size={16} />} disabled={busy || command.blocked} onClick={() => { command.clearError(); setRevision(value => value + 1); }} />
    <Button icon={<Eye size={16} />} loading={busy} disabled={!order || loading || command.blocked} onClick={readPreview}>预览发货</Button>
    <Popconfirm key={revision} zIndex={1400} title="确认发货？永久减量将取消对应数量，不再补发。" disabled={!preview || busy || command.blocked} onConfirm={async () => {
      if (busy || command.blocked) return;
      try { const body = await draft(); if (!preview || signature !== JSON.stringify(body)) { invalidate(); throw new Error('内容已变化，请重新预览。'); }
        if (await command.submit({ path: `/supplier-orders/${orderId}/shipments`, method: 'POST', label: '订单发货', body: { ...body } })) { message.success('发货已确认'); onSaved(); } else invalidate();
      } catch (failure) { if (!('errorFields' in (failure as object))) setError((failure as Error).message); }
    }}><Button type="primary" icon={<Check size={16} />} loading={command.busy} disabled={!preview || busy || command.blocked}>确认发货</Button></Popconfirm>
  </div>}>
    {(error || command.error) && <Alert type="error" showIcon title={error || command.error} />}
    {command.pending && supplierId && onRecover && <Alert type="warning" showIcon title={`待确认提交：${command.pending.label}`} action={<Button loading={command.busy} onClick={onRecover}>恢复原提交</Button>} />}
    {command.pending && !supplierId && <Alert type="warning" showIcon title={`待确认提交：${command.pending.label}`} action={<Button loading={command.busy} onClick={async () => { if (await command.recover()) { message.success('原提交已确认'); onSaved(); } }}>恢复原提交</Button>} />}
    {loading ? <Spin /> : order && <Form form={form} layout="vertical" className="compact-form" disabled={busy || command.blocked} onValuesChange={invalidate}>
      <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[{ key: 'no', label: '供应商订单', children: order.supplierOrderNo }, { key: 'dest', label: '收货地址', children: order.destination?.address || '-' }]} />
      <div className="form-grid"><Form.Item label="配送方式" name="deliveryMode" rules={[{ required: true, message: '请选择配送方式' }]}><Select aria-label="配送方式" options={[{ value: 'SELF', label: '自配送' }, { value: 'LOGISTICS', label: '物流' }]} /></Form.Item>
        {deliveryMode === 'LOGISTICS' && <Form.Item label="物流单号" name="trackingNo" rules={[{ max: 100, message: '最多100字' }]}><Input maxLength={100} /></Form.Item>}
        <Form.Item label="运费确认" name="freightConfirmationId"><Select aria-label="运费确认" allowClear placeholder="无运费" disabled={order.requiresFreightSnapshot === false || busy || command.blocked} options={(order.freightConfirmations || []).filter(row => row.status === 'CONFIRMED' && !row.usedAt && positive(row.amount)).map(row => ({ value: row.id, label: `${row.amount} 元 · ${row.reason}` }))} /></Form.Item></div>
      <Form.List name="items">{fields => fields.map(field => { const item = order.items[field.name]; return <div className="shipping-item" key={field.key}>
        <strong>{item.productName || item.productId}</strong><div className="template-price">销售单位：{item.unitName || item.unitSnapshot?.salesUnitName || '历史未核定'}；待发货：{item.remainingToShipQuantity ?? '-'}；已发货：{item.shippedQuantity ?? '-'}</div>
        <Form.Item name={[field.name, 'orderItemId']} hidden><Input /></Form.Item>
        <div className="form-grid"><Form.Item label="本次发货数量" name={[field.name, 'shipQuantity']} rules={[decimalRule('发货数量')]}><InputNumber aria-label={`发货数量${item.id}`} stringMode min="0" controls={false} /></Form.Item>
          <Form.Item label="永久减量" name={[field.name, 'permanentlyReduceQuantity']} rules={[decimalRule('永久减量')]}><InputNumber aria-label={`永久减量${item.id}`} stringMode min="0" controls={false} /></Form.Item></div>
        <Form.List name={[field.name, 'gapAllocations']}>{gaps => gaps.map(gapField => { const gap = item.replenishmentGaps?.find(row => row.id === drafts?.[field.name]?.gapAllocations?.[gapField.name]?.gapId); return <div key={gapField.key}>
          <Form.Item name={[gapField.name, 'gapId']} hidden><Input /></Form.Item><Form.Item label={`补发缺口分配（剩余 ${gap?.remainingQuantity ?? '-'}）`} name={[gapField.name, 'quantity']} rules={[decimalRule('补发数量')]}><InputNumber aria-label={`补发数量${gap?.id}`} stringMode min="0" controls={false} /></Form.Item>
        </div>; })}</Form.List>
      </div>; })}</Form.List>
    </Form>}
    {preview && <section className="price-band"><h2>发货预览</h2><Descriptions size="small" column={{ xs: 1, sm: 3 }} items={[{ key: 'ship', label: '发货数量', children: preview.totals.shipQuantity }, { key: 'reduce', label: '永久减量', children: preview.totals.permanentlyReduceQuantity }, { key: 'remain', label: '剩余数量', children: preview.totals.remainingQuantity }, ...(!supplierId ? [{ key: 'sales', label: '销售金额', children: preview.totals.salesGoodsAmount }] : []), { key: 'supply', label: '供货金额', children: preview.totals.supplyGoodsAmount }, { key: 'freight', label: '运费', children: preview.totals.freight }]} />
      <Table rowKey="orderItemId" size="small" pagination={false} scroll={{ x: 650 }} dataSource={preview.items} columns={[{ title: '商品', render: (_, item) => order?.items.find(row => row.id === item.orderItemId)?.productName }, { title: '发货', dataIndex: 'shipQuantity' }, { title: '永久减量', dataIndex: 'permanentlyReduceQuantity' }, { title: '剩余', dataIndex: 'remainingQuantityAfter' }, ...(!supplierId ? [{ title: '销售金额', dataIndex: 'salesLineAmount' }] : []), { title: '供货金额', dataIndex: 'supplyLineAmount' }]} />
    </section>}
  </Modal>;
}
