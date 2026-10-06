import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, App, Button, Descriptions, Form, Input, Modal, Popconfirm, Result, Select, Spin } from 'antd';
import { Check, Eye, RotateCcw } from 'lucide-react';
import { ListPage } from '../components/ListPage';
import { PrivateEvidence, type EvidenceFile } from '../components/PrivateEvidence';
import { hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { canRecoverWorkflow, useWorkflowCommand } from '../lib/useWorkflowCommand';

type Discrepancy = { id: string; status: string; missingQuantity: string; productName?: string; supplierOrderNo?: string; supplierOrderId?: string; shipmentNo?: string; shippedQuantity?: string; receivedQuantity?: string; version: number; evidenceFiles?: EvidenceFile[]; replenishmentGap?: { remainingQuantity: string; status: string } | null; returnRecord?: { reason: string | null } | null };
const statusName = (status: string) => ({ OPEN: '待处理', REPLENISH_PENDING: '待补发', RESOLVED: '已处理', SUPERSEDED: '已被修订替代' }[status] || status);
const actions = [{ value: 'ACCEPT', label: '接受短缺' }, { value: 'REPLENISH', label: '安排补发' }, { value: 'RETURN', label: '退回收货修订' }];
export default function Discrepancies({ user }: { user: User }) {
  if (user.scope?.type === 'SUPPLIER' && (!hasRole(user, 'SUPPLIER') || !user.scope.supplierId)) return <Result status="403" title="供应商账号尚未绑定供应商" />;
  if (!hasRole(user, 'ADMIN', 'SUPPLIER')) return <Result status="403" title="无权访问此页面" />;
  if (hasRole(user, 'SUPPLIER') && !hasRole(user, 'ADMIN') && !user.scope?.supplierId) return <Result status="403" title="供应商账号尚未绑定供应商" />;
  return <Workspace key={`${user.id}:${user.scope?.supplierId || 'central'}`} user={user} />;
}
function Workspace({ user }: { user: User }) {
  const rows = useRows<Discrepancy>('/discrepancies'); const [params, setParams] = useSearchParams(); const id = params.get('discrepancy');
  const [detail, setDetail] = useState<Discrepancy | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  const [form] = Form.useForm<{ action: string; reason: string }>(); const command = useWorkflowCommand(user.id); const { message } = App.useApp(); const supplier = user.scope?.type === 'SUPPLIER' || !hasRole(user, 'ADMIN'); const writable = hasRole(user, 'ADMIN', 'SUPPLIER');
  async function checkOwner(value: Discrepancy, signal?: AbortSignal) {
    if (!supplier) return;
    if (!value.supplierOrderId) throw new Error('差异缺少订单归属，不能操作。');
    const order = await request<{ id: string; supplierId: string }>(`/supplier-orders/${value.supplierOrderId}`, { signal });
    if (order.id !== value.supplierOrderId || order.supplierId !== user.scope?.supplierId) throw new Error('差异不属于当前供应商。');
  }
  const reload = () => { rows.reload(); setRevision(value => value + 1); };
  useEffect(() => {
    const controller = new AbortController(); setDetail(null); setError(''); form.resetFields();
    if (!id) { setLoading(false); return; } setLoading(true);
    request<Discrepancy>(`/discrepancies/${id}`, { signal: controller.signal }).then(async value => { if (value.id !== id || !Number.isInteger(value.version)) throw new Error('差异详情不完整，请重新读取。'); await checkOwner(value, controller.signal); if (!controller.signal.aborted) setDetail(value); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, revision, form]);
  const recoverable = command.pending && (supplier ? /^\/discrepancies\/[0-9a-f-]{36}\/resolve$/.test(command.pending.path) : canRecoverWorkflow(user, command.pending.path));
  const recovery = command.pending && <Alert type="warning" showIcon title={`存在待确认提交：${command.pending.label}`} action={<Button disabled={!recoverable} loading={command.busy} onClick={async () => {
    if (!command.pending || !recoverable) return;
    try { if (supplier) { const value = await request<Discrepancy>(`/discrepancies/${command.pending.path.split('/')[2]}`); if (value.id !== command.pending.path.split('/')[2]) throw new Error('差异归属异常。'); await checkOwner(value); }
      if (await command.recover()) { reload(); message.success('原提交已确认'); }
    } catch (failure) { setError((failure as Error).message); }
  }}>恢复原提交</Button>} />;
  return <>
    {!id && recovery}{!id && (error || command.error) && <Alert type="error" showIcon title={error || command.error} />}
    <ListPage title="收货差异" {...rows} rows={rows.rows.map(row => ({ ...row, name: row.productName || row.supplierOrderNo || row.id }))} reload={reload} filters={[{ key: 'status', label: '差异状态', options: ['OPEN', 'REPLENISH_PENDING'].map(value => ({ value, label: statusName(value) })) }]} columns={[{ title: '商品', dataIndex: 'productName', width: 210 }, { title: '供应商订单', dataIndex: 'supplierOrderNo', width: 220 }, { title: '短缺数量', dataIndex: 'missingQuantity', width: 110 }, { title: '状态', dataIndex: 'status', render: statusName, width: 100 }, { title: '操作', width: 70, fixed: 'right', render: (_, row) => <Button type="text" aria-label={`查看差异${row.id}`} icon={<Eye size={16} />} onClick={() => setParams({ discrepancy: row.id })} /> }]} />
    <Modal title="收货差异" width={650} open={Boolean(id)} footer={null} maskClosable={!command.busy} closable={!command.busy} onCancel={() => { if (!command.busy) setParams({}); }}>
      {recovery}{(error || command.error) && <Alert type="error" showIcon title={error || command.error} />}
      {loading ? <Spin /> : detail && <>
        <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[{ key: 'product', label: '商品', children: detail.productName }, { key: 'status', label: '状态', children: statusName(detail.status) }, { key: 'shipment', label: '发货单', children: detail.shipmentNo }, { key: 'shipped', label: '发货数量', children: detail.shippedQuantity }, { key: 'received', label: '收货数量', children: detail.receivedQuantity }, { key: 'missing', label: '短缺数量', children: detail.missingQuantity }, ...(detail.replenishmentGap ? [{ key: 'gap', label: '待补发数量', children: detail.replenishmentGap.remainingQuantity }] : [])]} />
        {!!detail.evidenceFiles?.length && <section className="price-band"><h2>收货凭证</h2><PrivateEvidence files={detail.evidenceFiles} /></section>}
        {writable && detail.status === 'OPEN' && <Form form={form} layout="vertical" className="compact-form" disabled={command.blocked}>
          <Form.Item name="action" label="处理方式" rules={[{ required: true, message: '请选择处理方式' }]}><Select options={actions} /></Form.Item>
          <Form.Item name="reason" label="处理原因" rules={[{ required: true, whitespace: true, max: 300, message: '请填写处理原因，最多300字' }]}><Input.TextArea rows={2} maxLength={300} /></Form.Item>
          <Popconfirm key={revision} title="确认处理差异？接受短缺将按服务端规则调整金额，补发将建立缺口，退回允许门店修订收货。" disabled={command.blocked} onConfirm={async () => {
            if (command.blocked) return;
            try { const values = await form.validateFields(); await checkOwner(detail); if (await command.submit({ path: `/discrepancies/${detail.id}/resolve`, method: 'POST', label: '处理收货差异', body: { expectedVersion: detail.version, action: values.action, reason: values.reason.trim() } })) { reload(); message.success('差异处理已确认'); } } catch (failure) { if (!('errorFields' in (failure as object))) setError((failure as Error).message); }
          }}><Button type="primary" disabled={command.blocked} loading={command.busy} icon={<Check size={16} />}>确认处理</Button></Popconfirm>
        </Form>}
        <div className="actions workflow-actions"><Button aria-label="重新读取差异" disabled={command.blocked} icon={<RotateCcw size={16} />} onClick={() => { command.clearError(); reload(); }} />{detail.supplierOrderId && <Link to={`/supplier-orders?order=${detail.supplierOrderId}`}><Button icon={<Eye size={16} />}>供应商订单</Button></Link>}</div>
      </>}
    </Modal>
  </>;
}
