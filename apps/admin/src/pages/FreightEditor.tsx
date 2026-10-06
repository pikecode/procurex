import { useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Popconfirm, Spin } from 'antd';
import { Check } from 'lucide-react';
import { request } from '../lib/api';
import type { useWorkflowCommand } from '../lib/useWorkflowCommand';
import type { FreightConfirmation, ShippingOrder } from '../lib/workflowTypes';

export function FreightEditor({ orderId, supplierId, onRecover, review, command, onClose, onSaved }: { orderId: string; supplierId?: string; onRecover?: () => Promise<void>; review?: { id: string; action: 'confirm' | 'reject' }; command: ReturnType<typeof useWorkflowCommand>; onClose: () => void; onSaved: () => void }) {
  const [order, setOrder] = useState<ShippingOrder | null>(null); const [confirmation, setConfirmation] = useState<FreightConfirmation>(); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [form] = Form.useForm<{ amount: string; reason: string }>(); const { message } = App.useApp();
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    request<ShippingOrder>(`/supplier-orders/${orderId}`, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (supplierId && value.supplierId !== supplierId) throw new Error('订单不属于当前供应商。');
      if (value.id !== orderId || ['REJECTED', 'CANCELED'].includes(value.status)) throw new Error('订单状态已变更，不能处理运费。');
      if (!review && value.requiresFreightSnapshot === false) throw new Error('此订单不允许申请运费。');
      const current = value.freightConfirmations?.find(row => row.id === review?.id);
      if (review && (!current || current.status !== 'PENDING')) throw new Error('运费申请状态已变更，请关闭后刷新。');
      setOrder(value); setConfirmation(current); form.setFieldsValue({ amount: current?.amount || '0.00', reason: '' });
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [orderId, supplierId, review?.id, form]);
  const title = !review ? '申请运费' : review.action === 'confirm' ? '确认运费' : '驳回运费';
  return <Modal open zIndex={1200} title={title} width={520} maskClosable={false} closable={!command.busy} onCancel={() => { if (!command.busy) onClose(); }} footer={<div className="actions workflow-actions"><Button disabled={command.busy} onClick={onClose}>取消</Button>
    <Popconfirm zIndex={1400} title={`确认${title}？`} disabled={loading || !order || command.blocked} onConfirm={async () => {
      try {
        const values = await form.validateFields(); if (!order || command.blocked) return;
        const reason = values.reason?.trim();
        const body = review ? { expectedVersion: confirmation!.version, ...(reason ? { reason } : {}) } : { expectedVersion: order.version, amount: values.amount, reason };
        if (await command.submit({ path: review ? `/freight-confirmations/${review.id}/${review.action}` : `/supplier-orders/${order.id}/freight-confirmations`, method: 'POST', label: title, body })) { message.success('运费处理已确认'); onSaved(); }
      } catch (failure) { if (!('errorFields' in (failure as object))) setError((failure as Error).message); }
    }}><Button type="primary" icon={<Check size={16} />} loading={command.busy} disabled={loading || !order || command.blocked}>确认提交</Button></Popconfirm>
  </div>}>
    {(error || command.error) && <Alert type="error" showIcon title={error || command.error} />}
    {command.pending && supplierId && onRecover && <Alert type="warning" showIcon title={`待确认提交：${command.pending.label}`} action={<Button loading={command.busy} onClick={onRecover}>恢复原提交</Button>} />}
    {command.pending && !supplierId && <Alert type="warning" showIcon title={`待确认提交：${command.pending.label}`} action={<Button loading={command.busy} onClick={async () => { if (await command.recover()) onSaved(); }}>恢复原提交</Button>} />}
    {loading ? <Spin /> : order && <Form form={form} layout="vertical" className="compact-form" disabled={command.blocked}>
      <Form.Item label="运费金额" name="amount" rules={[{ validator: async (_, value) => { if (typeof value !== 'string' || !/^\d{1,14}(\.\d{1,2})?$/.test(value) || (!review && !/[1-9]/.test(value))) throw new Error('运费须为正数，最多2位小数'); } }]}><InputNumber stringMode controls={false} disabled={Boolean(review) || order.requiresFreightSnapshot === false || command.blocked} style={{ width: '100%' }} /></Form.Item>
      {review && <p>申请原因：{confirmation?.reason}</p>}
      <Form.Item label={review ? '审核备注' : '申请原因'} name="reason" rules={[{ required: !review, whitespace: true, max: 300, message: '原因最多300字，申请运费时必填' }]}><Input.TextArea rows={2} maxLength={300} /></Form.Item>
    </Form>}
  </Modal>;
}
