import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, Modal, Result, Select, Table, Tooltip } from 'antd';
import { Check, Eye, Plus } from 'lucide-react';
import { hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { useWorkflowCommand } from '../lib/useWorkflowCommand';
import { ListPage } from '../components/ListPage';

type Adjustment = { id: string; type: string; direction: string; storeId: string; supplierId: string; supplierOrderNo: string; originalPeriodKey: string; actualPeriodKey: string; adjustmentAmount: string; payableAmount: string; pendingReturnOrOffsetAmount: string; processingStatus: string; sourceRevision: number; sourceReturnId?: string; disposalCreditItemId?: string; offsetTargetItemId?: string; lines?: { orderItemId: string; productName: string; quantity: string; supplyAdjustmentAmount: string }[]; disposal?: { disposalId: string; disposalNo: string; version: number; status: string; amount: string } | null };
type Disposal = { id: string; disposalNo: string; direction: string; storeId: string | null; supplierId: string | null; method: string; amount: string; businessDate: string; status: string; version: number; reason?: string; items: { id: string; targetSupplierOrderNo?: string | null; amount: string }[] };
const names: Record<string, string> = { RETURN_SHORTAGE: '退货短缺', PRICE_CHANGE: '价格变动', ACCEPTED_SHORTAGE: '接受短缺', PERMANENT_REDUCTION: '永久减量', FREIGHT_CHANGE: '运费变动', ORDER_REJECTION: '订单拒绝', STORE_RECEIVABLE_DECREASE: '门店应收减少', STORE_RECEIVABLE_INCREASE: '门店应收增加', SUPPLIER_PAYABLE_DECREASE: '供应商应付减少', SUPPLIER_PAYABLE_INCREASE: '供应商应付增加', PENDING_DISPOSAL: '待处置', DISPOSED: '已处置', PENDING: '待确认', CONFIRMED: '已确认', OFFSET: '抵扣', OFFLINE_RETURN: '线下返还', COMPANY_TO_STORE: '公司返还门店', SUPPLIER_TO_COMPANY: '供应商返还公司' };
const positive = (value: string) => /^\d+(\.\d+)?$/.test(value) && /[1-9]/.test(value);
const fingerprint = (value: Adjustment) => JSON.stringify([value.id, value.storeId, value.supplierId, value.direction, value.sourceRevision, value.adjustmentAmount, value.pendingReturnOrOffsetAmount, value.payableAmount, value.disposal, value.sourceReturnId, value.disposalCreditItemId, value.offsetTargetItemId]);
export default function SettlementDifferences({ user }: { user: User }) {
  const scoped = ['STORE', 'STORE_FINANCE'].includes(user.scope?.type || '') || (!hasRole(user, 'ADMIN', 'HQ_FINANCE') && hasRole(user, 'STORE', 'STORE_FINANCE'));
  const supplier = user.scope?.type === 'SUPPLIER' || (!scoped && !hasRole(user, 'ADMIN', 'HQ_FINANCE') && hasRole(user, 'SUPPLIER'));
  if (supplier && (!hasRole(user, 'SUPPLIER') || !user.scope?.supplierId)) return <Result status="warning" title="尚未绑定供应商，无法查看结算差异" />;
  if (scoped && !user.scope?.storeId) return <Result status="warning" title="尚未绑定门店，无法查看结算差异" />;
  if (!scoped && !supplier && !hasRole(user, 'ADMIN', 'HQ_FINANCE')) return <Result status="403" title="无权访问此页面" />;
  return <Workspace key={`${user.id}:${supplier ? user.scope?.supplierId : scoped ? user.scope?.storeId : 'central'}`} user={user} scoped={scoped && !supplier} supplier={supplier} />;
}
function Workspace({ user, scoped, supplier }: { user: User; scoped: boolean; supplier: boolean }) {
  const list = useRows<Adjustment>(`/adjustments${supplier ? `?supplierId=${encodeURIComponent(user.scope!.supplierId!)}` : scoped ? `?storeId=${encodeURIComponent(user.scope!.storeId!)}` : ''}`);
  const command = useWorkflowCommand(user.id); const [detail, setDetail] = useState<Adjustment>(); const [disposal, setDisposal] = useState<Disposal>();
  const [editing, setEditing] = useState(false); const [checking, setChecking] = useState(false); const [error, setError] = useState(''); const [form] = Form.useForm();
  const method = Form.useWatch('method', form); const lock = useRef(false); const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; }, []);
  const inScope = (row: Adjustment) => supplier ? row.supplierId === user.scope?.supplierId && row.direction.startsWith('SUPPLIER_') : !scoped || row.storeId === user.scope?.storeId && row.direction.startsWith('STORE_');
  const canConfirm = (row: Disposal) => !supplier && row.status === 'PENDING' && Number.isInteger(row.version) && (scoped ? row.storeId === user.scope?.storeId && row.direction === 'COMPANY_TO_STORE' : row.direction === 'SUPPLIER_TO_COMPANY');
  const canCreate = (row: Adjustment) => !supplier && !scoped && !row.disposal && positive(row.pendingReturnOrOffsetAmount) && Boolean(row.sourceReturnId || row.disposalCreditItemId);
  const targets = list.rows.filter(row => detail && row.id !== detail.id && row.storeId === detail.storeId && row.supplierId === detail.supplierId && row.direction.split('_')[0] === detail.direction.split('_')[0] && positive(row.adjustmentAmount) && positive(row.payableAmount) && row.offsetTargetItemId);
  const blocked = command.blocked || checking;
  async function read(id: string) { const value = await request<Adjustment>(`/adjustments/${encodeURIComponent(id)}`); if (value.id !== id || !inScope(value)) throw new Error('结算差异不在当前权限范围'); return value; }
  async function readDisposal(id: string) { const value = await request<Disposal>(`/difference-disposals/${encodeURIComponent(id)}`); if (value.id !== id || supplier && (value.supplierId !== user.scope?.supplierId || value.direction !== 'SUPPLIER_TO_COMPANY') || scoped && (value.storeId !== user.scope?.storeId || value.direction !== 'COMPANY_TO_STORE')) throw new Error('处置单不在当前权限范围'); return value; }
  async function open(id: string) {
    const n = ++sequence.current; setChecking(true); setError('');
    try { const value = await read(id); const action = value.disposal ? await readDisposal(value.disposal.disposalId) : undefined; if (n !== sequence.current) return; if (action && (action.storeId !== value.storeId || action.supplierId !== value.supplierId)) throw new Error('处置单与差异归属不匹配'); setDetail(value); setDisposal(action); setEditing(false); }
    catch (failure) { if (n === sequence.current) setError((failure as Error).message); } finally { if (n === sequence.current) setChecking(false); }
  }
  async function submit() {
    if (supplier || blocked || lock.current || !detail) return; lock.current = true; setChecking(true); setError('');
    try {
      const values = await form.validateFields(); const fresh = await read(detail.id);
      if (fingerprint(fresh) !== fingerprint(detail) || !canCreate(fresh)) { setDetail(fresh); setEditing(false); throw new Error('差异金额或处置状态已变化，请重新读取并核对。'); }
      if (values.method === 'OFFSET') {
        const target = targets.find(row => row.offsetTargetItemId === values.target); if (!target) throw new Error('请选择有效抵扣目标。');
        const latest = await read(target.id); if (fingerprint(latest) !== fingerprint(target)) { list.reload(); throw new Error('抵扣目标已变化，请刷新后重新选择。'); }
      }
      if (await command.submit({ path: '/difference-disposals', method: 'POST', label: '登记差额处置', body: { method: values.method, creditItemIds: [fresh.sourceReturnId || fresh.disposalCreditItemId!], ...(values.method === 'OFFSET' ? { targetDebitItemIds: [values.target] } : {}), amount: fresh.pendingReturnOrOffsetAmount, businessDate: values.businessDate, reason: values.reason.trim() } })) { setDetail(undefined); setEditing(false); list.reload(); }
      else { setEditing(false); setDetail(undefined); list.reload(); }
    } catch (failure) { if (!('errorFields' in (failure as object))) setError((failure as Error).message); } finally { lock.current = false; setChecking(false); }
  }
  async function confirm() {
    if (blocked || lock.current || !disposal || !canConfirm(disposal)) return; lock.current = true; setChecking(true); setError('');
    try { const fresh = await readDisposal(disposal.id); if (!canConfirm(fresh) || fresh.version !== disposal.version || fresh.amount !== disposal.amount) { setDisposal(fresh); throw new Error('处置单已变化，请重新核对。'); }
      if (await command.submit({ path: `/difference-disposals/${fresh.id}/confirm`, method: 'POST', label: '确认差额处置', body: { expectedVersion: fresh.version } })) { setDetail(undefined); setDisposal(undefined); list.reload(); } else { setDetail(undefined); setDisposal(undefined); list.reload(); }
    } catch (failure) { setError((failure as Error).message); } finally { lock.current = false; setChecking(false); }
  }
  const recoverable = !supplier && (command.pending?.path === '/difference-disposals' && !scoped || /^\/difference-disposals\/[0-9a-f-]{36}\/confirm$/.test(command.pending?.path || ''));
  return <>
    {(error || command.error) && <Alert type="error" showIcon title={error || command.error} />}
    {command.pending && <Alert type="warning" showIcon title={`存在待确认提交：${command.pending.label}`} action={<Button disabled={!recoverable || checking} loading={command.busy} onClick={async () => { if (!recoverable || !command.pending || lock.current) return; lock.current = true; setChecking(true); try { if (command.pending.path !== '/difference-disposals') { const id = command.pending.path.split('/')[2]; const original = await readDisposal(id); if (scoped && original.direction !== 'COMPANY_TO_STORE' || !scoped && original.direction !== 'SUPPLIER_TO_COMPANY') throw new Error('原处置单不属于当前收款方'); } if (await command.recover()) list.reload(); } catch (failure) { setError((failure as Error).message); } finally { lock.current = false; setChecking(false); } }}>恢复原提交</Button>} />}
    <ListPage title="结算差异" rows={list.rows.filter(inScope).map(row => ({ ...row, name: row.supplierOrderNo }))} loading={list.loading || checking} error={list.error} reload={list.reload} filters={[{ key: 'processingStatus', label: '处置状态', options: ['PENDING_DISPOSAL', 'DISPOSED'].map(value => ({ value, label: names[value] })) }, { key: 'type', label: '差异类型', options: ['RETURN_SHORTAGE', 'PRICE_CHANGE', 'ACCEPTED_SHORTAGE', 'PERMANENT_REDUCTION', 'FREIGHT_CHANGE', 'ORDER_REJECTION'].map(value => ({ value, label: names[value] })) }]} columns={[
      { title: '供应商订单', dataIndex: 'supplierOrderNo', width: 190 }, { title: '差异类型', dataIndex: 'type', render: value => names[value] || value }, { title: '方向', dataIndex: 'direction', render: value => names[value] || value },
      { title: '原账期 / 记账账期', render: (_, row) => <>{row.originalPeriodKey}<small>{row.actualPeriodKey}</small></> }, { title: '差额', dataIndex: 'adjustmentAmount', align: 'right' }, { title: '待返还 / 抵扣', dataIndex: 'pendingReturnOrOffsetAmount', align: 'right' }, { title: '状态', dataIndex: 'processingStatus', render: value => names[value] || value },
      { title: '操作', fixed: 'right', width: 60, render: (_, row) => <Tooltip title="查看差异"><Button type="text" aria-label={`查看差异${row.id}`} icon={<Eye size={16} />} disabled={checking} onClick={() => open(row.id)} /></Tooltip> },
    ]} />
    <Modal open={Boolean(detail)} title="结算差异明细" width={780} onCancel={() => { if (!checking && !command.busy) { sequence.current++; setDetail(undefined); setDisposal(undefined); } }} maskClosable={false} closable={!checking && !command.busy} keyboard={!checking && !command.busy} footer={detail && <div className="actions workflow-actions">
      {canCreate(detail) && <Button type="primary" icon={<Plus size={16} />} disabled={blocked} onClick={() => { setError(''); form.resetFields(); form.setFieldsValue({ method: 'OFFLINE_RETURN', businessDate: new Date().toLocaleDateString('sv-SE') }); setEditing(true); }}>登记处置</Button>}
      {disposal && canConfirm(disposal) && <Button type="primary" icon={<Check size={16} />} disabled={blocked} onClick={confirm}>确认返还</Button>}
    </div>}>
      {detail && <><Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[{ key: 'order', label: '订单', children: detail.supplierOrderNo }, { key: 'direction', label: '方向', children: names[detail.direction] }, { key: 'period', label: '原账期', children: detail.originalPeriodKey }, { key: 'actual', label: '记账账期', children: detail.actualPeriodKey }, { key: 'amount', label: '差额', children: detail.adjustmentAmount }, { key: 'pending', label: '待返还 / 抵扣', children: detail.pendingReturnOrOffsetAmount }]} />
        <Table size="small" rowKey="orderItemId" pagination={false} scroll={{ x: 450 }} dataSource={detail.lines || []} columns={[{ title: '商品', dataIndex: 'productName' }, { title: '数量', dataIndex: 'quantity' }, ...(!scoped ? [{ title: '供货差额', dataIndex: 'supplyAdjustmentAmount' }] : [])]} />
        {disposal && <section className="price-band"><h2>差额处置单</h2><Descriptions size="small" column={1} items={[{ key: 'no', label: '单号', children: disposal.disposalNo }, { key: 'method', label: '方式', children: names[disposal.method] }, { key: 'direction', label: '方向', children: names[disposal.direction] }, { key: 'status', label: '状态', children: names[disposal.status] }, { key: 'amount', label: '金额', children: disposal.amount }, { key: 'date', label: '业务日期', children: disposal.businessDate.slice(0, 10) }, { key: 'reason', label: '原因', children: disposal.reason || '-' }]} /><Table size="small" rowKey="id" pagination={false} dataSource={disposal.items} columns={[{ title: '抵扣订单', dataIndex: 'targetSupplierOrderNo', render: value => value || '-' }, { title: '金额', dataIndex: 'amount' }]} /></section>}
      </>}
    </Modal>
    <Modal open={editing} zIndex={1400} title="登记差额处置" width={520} maskClosable={false} keyboard={!checking && !command.busy} closable={!checking && !command.busy} onCancel={() => { if (!checking && !command.busy) setEditing(false); }} footer={<Button type="primary" icon={<Check size={16} />} loading={checking || command.busy} disabled={blocked} onClick={submit}>确认登记</Button>}>
      {error && <Alert type="error" title={error} />}
      <Descriptions size="small" items={[{ key: 'amount', label: '核定金额', children: detail?.pendingReturnOrOffsetAmount }]} />
      <Form form={form} layout="vertical" className="compact-form" disabled={blocked}>
        <Form.Item label="处置方式" name="method" rules={[{ required: true }]}><Select aria-label="处置方式" options={[{ value: 'OFFLINE_RETURN', label: '线下返还' }, { value: 'OFFSET', label: '抵扣', disabled: !targets.length }]} /></Form.Item>
        {method === 'OFFSET' && <Form.Item label="抵扣目标" name="target" rules={[{ required: true, message: '请选择抵扣目标' }]}><Select aria-label="抵扣目标" options={targets.map(row => ({ value: row.offsetTargetItemId!, label: `${row.supplierOrderNo} · 可抵扣 ${row.payableAmount}` }))} /></Form.Item>}
        <Form.Item label="业务日期" name="businessDate" rules={[{ required: true, message: '请选择业务日期' }]}><Input type="date" /></Form.Item>
        <Form.Item label="处置原因" name="reason" rules={[{ required: true, whitespace: true, max: 300, message: '请输入处置原因，最多300字' }]}><Input.TextArea rows={2} maxLength={300} /></Form.Item>
      </Form>
    </Modal>
  </>;
}
