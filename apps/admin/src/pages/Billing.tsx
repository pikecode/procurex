import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, Modal, Result, Select, Table, Tabs, Tooltip } from 'antd';
import { Eye, Check, Plus } from 'lucide-react';
import { hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { useWorkflowCommand } from '../lib/useWorkflowCommand';
import { ListPage } from '../components/ListPage';
import { AccountEvidenceUpload } from '../components/AccountEvidenceUpload';
import { PrivateEvidence, type EvidenceFile } from '../components/PrivateEvidence';

type Line = { settlementItemId: string; supplierOrderNo?: string; supplierOrderId?: string; totalAmount?: string; amount?: string; goodsAmount?: string; freightAmount?: string };
type Statement = { id: string; supplierId?: string; storeId?: string; storeName?: string; periodKey: string; periodStart: string; periodEndExclusive: string; settlementStatus: string; totalAmount: string; payableAmount: string; pendingPaymentAmount: string; confirmedPaidAmount: string; lines?: Line[]; adjustmentItems?: Line[] };
type Payment = { id: string; supplierId?: string | null; storeId?: string | null; paymentNo: string; status: string; direction: string; channel: string; amount: string; businessDate: string; version: number; remark?: string; rejectedReason?: string; cancelledReason?: string; allocations: { id: string; supplierOrderNo?: string; supplierOrderId: string; amount: string; state: string }[]; evidenceFiles?: EvidenceFile[] };
type Preview = { direction: string; channel: string; storeId: string | null; supplierId: string | null; totalPayableAmount: string; blockedItems: { settlementItemId: string; code: string }[]; items: { settlementItemId: string; storeId?: string; supplierOrderNo: string; sourceVersion: number; payableAmount: string; pendingPaymentAmount: string; confirmedPaidAmount: string }[] };
const states: Record<string, string> = { OPEN: '未结清', SETTLED: '已结清', PENDING: '待确认', CONFIRMED: '已确认', REJECTED: '已驳回', CANCELLED: '已撤销', ACTIVE: '有效', RELEASED: '已释放' };
const directions: Record<string, string> = { STORE_TO_COMPANY: '门店向公司', COMPANY_TO_SUPPLIER: '公司向供应商', STORE_TO_SUPPLIER: '门店向供应商' };
function signature(p: Preview) { return JSON.stringify([p.direction, p.channel, p.storeId, p.supplierId, p.totalPayableAmount, p.blockedItems.map(i => [i.settlementItemId, i.code]).sort(), p.items.map(i => [i.settlementItemId, i.sourceVersion, i.payableAmount, i.pendingPaymentAmount, i.confirmedPaidAmount]).sort()]); }
export default function Billing({ user }: { user: User }) {
  const scoped = ['STORE', 'STORE_FINANCE'].includes(user.scope?.type || '') || (!hasRole(user, 'ADMIN', 'HQ_FINANCE') && hasRole(user, 'STORE', 'STORE_FINANCE'));
  const supplier = user.scope?.type === 'SUPPLIER' || (!scoped && !hasRole(user, 'ADMIN', 'HQ_FINANCE') && hasRole(user, 'SUPPLIER'));
  if (supplier && (!hasRole(user, 'SUPPLIER') || !user.scope?.supplierId)) return <Result status="warning" title="尚未绑定供应商，无法查看账单" />;
  if (scoped && !user.scope?.storeId) return <Result status="warning" title="尚未绑定门店，无法查看账单" />;
  if (!scoped && !supplier && !hasRole(user, 'ADMIN', 'HQ_FINANCE')) return <Result status="403" title="无权访问此页面" />;
  return <BillingWorkspace key={`${user.id}:${supplier ? user.scope?.supplierId : scoped ? user.scope?.storeId : 'central'}`} user={user} scoped={scoped && !supplier} supplier={supplier} />;
}
function BillingWorkspace({ user, scoped, supplier }: { user: User; scoped: boolean; supplier: boolean }) {
  const [tab, setTab] = useState(scoped ? 'store' : 'supplier'); const basePath = tab === 'payments' ? '/payment-records' : tab === 'store' ? '/store-statements' : tab === 'direct' ? '/direct-statements' : tab === 'supplier-store' ? '/supplier-store-statements' : '/supplier-statements';
  const path = `${basePath}${supplier ? `?supplierId=${encodeURIComponent(user.scope!.supplierId!)}` : scoped ? `?storeId=${encodeURIComponent(user.scope!.storeId!)}` : ''}`;
  const list = useRows<Statement | Payment>(path); const command = useWorkflowCommand(user.id);
  const inScope = (value: Statement | Payment) => supplier ? value.supplierId === user.scope?.supplierId && (!('direction' in value) || ['COMPANY_TO_SUPPLIER', 'STORE_TO_SUPPLIER'].includes(value.direction)) : !scoped || value.storeId === user.scope?.storeId && (!('direction' in value) || ['STORE_TO_COMPANY', 'STORE_TO_SUPPLIER'].includes(value.direction));
  const decisions = supplier ? [{ value: 'confirm', label: '确认收款' }, { value: 'reject', label: '驳回付款' }] : scoped ? [{ value: 'cancel', label: '撤销登记' }] : [{ value: 'confirm', label: '确认收款' }, { value: 'reject', label: '驳回付款' }, { value: 'cancel', label: '撤销登记' }];
  const canRecover = Boolean(supplier ? /^\/payment-records\/[0-9a-f-]{36}\/(confirm|reject)$/.test(command.pending?.path || '') : command.pending?.path.startsWith('/payment-records') && (!scoped || command.pending.path === '/payment-records' && ['STORE_TO_COMPANY', 'STORE_TO_SUPPLIER'].includes(String(command.pending.body.direction)) || /^\/payment-records\/[0-9a-f-]{36}\/cancel$/.test(command.pending.path)));
  const [statement, setStatement] = useState<Statement>(); const [payment, setPayment] = useState<Payment>();
  const [ids, setIds] = useState<string[]>([]); const [preview, setPreview] = useState<Preview>(); const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [uploading, setUploading] = useState(false); const [checking, setChecking] = useState(false); const [error, setError] = useState('');
  const [decision, setDecision] = useState<string>(); const [form] = Form.useForm(); const [actionForm] = Form.useForm();
  const seq = useRef(0); const lock = useRef(false); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; seq.current++; }; }, []);
  const blocked = command.blocked || uploading || checking;
  async function open(id: string) { const n = ++seq.current; setError(''); setChecking(true);
    try { const value = await request<Statement | Payment>(`${basePath}/${encodeURIComponent(id)}`); if (!mounted.current || n !== seq.current) return;
      if (value.id !== id || !inScope(value)) throw new Error(supplier ? '读取的单据不匹配或不在当前供应商范围' : '读取的单据不匹配或不在当前门店范围');
      setIds([]); setDecision(undefined); actionForm.resetFields(); if (tab === 'payments') setPayment(value as Payment); else setStatement(value as Statement);
    } catch (e) { if (mounted.current && n === seq.current) setError((e as Error).message); } finally { if (mounted.current && n === seq.current) setChecking(false); }
  }
  async function readPreview() { const p = await request<Preview>('/payment-records/preview', { method: 'POST', body: { settlementItemIds: ids } });
    if (scoped && (p.storeId !== user.scope?.storeId || !['STORE_TO_COMPANY', 'STORE_TO_SUPPLIER'].includes(p.direction) || p.items.some(i => i.storeId !== user.scope?.storeId))) throw new Error('付款预览不在当前门店范围');
    if (p.blockedItems.length || p.items.length !== ids.length || new Set(p.items.map(i => i.settlementItemId)).size !== ids.length || p.items.some(i => !ids.includes(i.settlementItemId) || !Number.isInteger(i.sourceVersion) || !/^\d+\.\d{2}$/.test(i.payableAmount) || !/[1-9]/.test(i.payableAmount))) throw new Error('所选结算项不可登记付款，请刷新账单后重新选择'); return p;
  }
  async function prepare() { if (supplier || lock.current || blocked || !ids.length) return; lock.current = true; setChecking(true); setError('');
    try { const p = await readPreview(); setPreview(p); setFiles([]); form.resetFields(); form.setFieldsValue({ businessDate: new Date().toLocaleDateString('sv-SE') }); } catch (e) { setError((e as Error).message); } finally { lock.current = false; setChecking(false); }
  }
  function saved() { setPreview(undefined); setPayment(undefined); setStatement(undefined); setDecision(undefined); setIds([]); list.reload(); }
  async function register() { if (supplier || lock.current || blocked || !preview) return; lock.current = true; setChecking(true); setError('');
    try { const data = await form.validateFields(); if (!files.length) throw new Error('请上传付款凭证'); const fresh = await readPreview();
      if (signature(fresh) !== signature(preview)) { setPreview(fresh); throw new Error('结算金额或版本已变化，请重新核对后提交'); }
      if (await command.submit({ path: '/payment-records', method: 'POST', label: '登记付款', body: { direction: preview.direction, businessDate: data.businessDate, ...(data.remark?.trim() ? { remark: data.remark.trim() } : {}), evidenceFileIds: files.map(f => f.id), items: preview.items.map(i => ({ settlementItemId: i.settlementItemId, expectedVersion: i.sourceVersion, expectedAmount: i.payableAmount })) } })) saved();
    } catch (e) { if (e instanceof Error) setError(e.message); } finally { lock.current = false; setChecking(false); }
  }
  async function process() { if (lock.current || blocked || !payment || !decision || !decisions.some(i => i.value === decision) || !inScope(payment) || payment.status !== 'PENDING') return; lock.current = true; setChecking(true); setError('');
    try { const data = await actionForm.validateFields();
      if (supplier) { const fresh = await request<Payment>(`/payment-records/${payment.id}`);
        if (fresh.id !== payment.id || !inScope(fresh)) { setPayment(undefined); throw new Error('付款不在当前供应商范围，不能处理'); }
        if (fresh.status !== 'PENDING' || fresh.version !== payment.version || fresh.amount !== payment.amount || fresh.direction !== payment.direction || fresh.storeId !== payment.storeId || JSON.stringify(fresh.allocations) !== JSON.stringify(payment.allocations)) { setPayment(fresh); setDecision(undefined); throw new Error('付款金额、版本或状态已变化，请重新核对'); }
      }
      if (await command.submit({ path: `/payment-records/${payment.id}/${decision}`, method: 'POST', label: '处理付款', body: { expectedVersion: payment.version, ...(decision !== 'confirm' ? { reason: data.reason.trim() } : {}) } })) saved();
    } catch (e) { if (e instanceof Error) setError(e.message); } finally { lock.current = false; setChecking(false); }
  }
  async function recover() {
    if (!canRecover || checking || uploading || lock.current || !command.pending) return; lock.current = true; setChecking(true); setError('');
    try {
      if ((scoped || supplier) && command.pending.path !== '/payment-records') { const target = command.pending.path.slice(0, command.pending.path.lastIndexOf('/')); const value = await request<Payment>(target); if (value.id !== target.split('/').at(-1) || !inScope(value)) throw new Error(supplier ? '原付款不在当前供应商范围，不能恢复' : '原付款登记不在当前门店范围，不能恢复'); }
      if (await command.recover()) saved();
    } catch (e) { setError((e as Error).message); } finally { lock.current = false; setChecking(false); }
  }
  const notice = <>{(error || command.error) && <Alert type="error" showIcon title={error || command.error} />}{command.pending && <Alert type="warning" title="付款提交结果尚未确认" action={canRecover ? <Button disabled={checking || uploading} loading={command.busy} onClick={recover}>查询提交结果</Button> : undefined} />}</>;
  const lines = [...(statement?.lines || []), ...(statement?.adjustmentItems || [])];
  return <>
    <Tabs activeKey={tab} onChange={value => { seq.current++; setChecking(false); setError(''); setTab(value); }} items={[...(!scoped ? [{ key: 'supplier', label: '供应商账单' }, { key: 'supplier-store', label: '供应商门店账单' }] : []), ...(!supplier ? [{ key: 'store', label: '门店账单' }] : []), { key: 'direct', label: '直付账单' }, { key: 'payments', label: '付款记录' }]} />
    {!statement && !payment && notice}
    <ListPage key={tab} title={tab === 'payments' ? '付款记录' : '账单查询'} rows={list.rows.filter(inScope).map(row => ({ ...row, name: 'paymentNo' in row ? row.paymentNo : `${row.storeName ? `${row.storeName} · ` : ''}${row.periodKey}`, status: 'status' in row ? row.status : row.settlementStatus }))} loading={list.loading || checking} error={list.error} reload={list.reload}
      filters={[{ key: 'status', label: '结算状态', options: (tab === 'payments' ? ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'] : ['OPEN', 'SETTLED']).map(value => ({ value, label: states[value] })) }]}
      columns={tab === 'payments' ? [{ title: '付款编号', dataIndex: 'name' }, { title: '方向', dataIndex: 'direction', render: value => directions[value] || value }, { title: '日期', dataIndex: 'businessDate' }, { title: '金额', dataIndex: 'amount' }, { title: '状态', dataIndex: 'status', render: value => states[value] || value }, { title: '操作', render: (_, row) => <Tooltip title="付款详情"><Button aria-label="付款详情" icon={<Eye size={16} />} onClick={() => open(row.id)} /></Tooltip> }] : [{ title: '账期', dataIndex: 'name' }, { title: '总额', dataIndex: 'totalAmount' }, { title: '待付', dataIndex: 'payableAmount' }, { title: '待确认', dataIndex: 'pendingPaymentAmount' }, { title: '已付', dataIndex: 'confirmedPaidAmount' }, { title: '状态', dataIndex: 'status', render: value => states[value] || value }, { title: '操作', render: (_, row) => <Tooltip title="账单详情"><Button aria-label="账单详情" icon={<Eye size={16} />} onClick={() => open(row.id)} /></Tooltip> }]} />
    <Modal title="账单明细" open={Boolean(statement)} width={1000} footer={null} closable={!blocked} keyboard={!blocked} maskClosable={false} onCancel={() => { setStatement(undefined); setIds([]); }}>
      {!preview && notice}<Descriptions size="small" column={2} items={[{ key: 'period', label: '账期', children: statement?.periodKey }, { key: 'amount', label: '待付金额', children: statement?.payableAmount }, { key: 'pending', label: '待确认付款', children: statement?.pendingPaymentAmount }, { key: 'paid', label: '已确认付款', children: statement?.confirmedPaidAmount }]} />
      {!supplier && <div className="actions workflow-actions"><Button type="primary" icon={<Plus size={16} />} disabled={blocked || !ids.length} onClick={prepare}>登记付款（{ids.length}）</Button></div>}
      <Table rowKey="settlementItemId" size="small" scroll={{ x: 600 }} dataSource={lines} rowSelection={supplier ? undefined : { selectedRowKeys: ids, onChange: keys => setIds(keys.map(String)), getCheckboxProps: () => ({ disabled: blocked || Boolean(preview) }) }} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }} columns={[{ title: '订单', render: (_, row) => row.supplierOrderNo || row.supplierOrderId || '价格调整' }, { title: '商品金额', dataIndex: 'goodsAmount' }, { title: '运费', dataIndex: 'freightAmount' }, { title: '结算金额', render: (_, row) => row.totalAmount || row.amount }]} />
    </Modal>
    <Modal title="付款登记" open={Boolean(preview)} width={720} zIndex={1400} footer={null} closable={!blocked} keyboard={!blocked} maskClosable={false} onCancel={() => setPreview(undefined)}>
      {notice}<Descriptions size="small" items={[{ key: 'direction', label: '方向', children: directions[preview?.direction || ''] }, { key: 'amount', label: '本次付款', children: preview?.totalPayableAmount }]} />
      <Table rowKey="settlementItemId" size="small" dataSource={preview?.items || []} pagination={false} columns={[{ title: '订单', dataIndex: 'supplierOrderNo' }, { title: '本次金额', dataIndex: 'payableAmount' }]} />
      <Form form={form} layout="vertical" className="compact-form finance-form" disabled={blocked} onFinish={register}>
        <Form.Item name="businessDate" label="付款日期" rules={[{ required: true, message: '请选择付款日期' }]}><Input type="date" /></Form.Item><Form.Item name="remark" label="备注"><Input maxLength={300} /></Form.Item>
      </Form><AccountEvidenceUpload purpose="PAYMENT" files={files} onChange={setFiles} uploading={uploading} onUploading={setUploading} disabled={blocked} onError={setError} />
      <div className="actions workflow-actions"><Button disabled={blocked} onClick={() => setPreview(undefined)}>取消</Button><Button type="primary" icon={<Check size={16} />} disabled={blocked || !files.length} loading={checking || command.busy} onClick={register}>确认登记</Button></div>
    </Modal>
    <Modal title="付款详情" open={Boolean(payment)} width={850} footer={null} closable={!blocked} keyboard={!blocked} maskClosable={false} onCancel={() => { setPayment(undefined); setDecision(undefined); }}>
      {notice}<Descriptions size="small" column={2} items={[{ key: 'no', label: '编号', children: payment?.paymentNo }, { key: 'state', label: '状态', children: states[payment?.status || ''] }, { key: 'amount', label: '金额', children: payment?.amount }, { key: 'direction', label: '方向', children: directions[payment?.direction || ''] }, { key: 'date', label: '日期', children: payment?.businessDate }, { key: 'note', label: '备注 / 原因', children: payment?.rejectedReason || payment?.cancelledReason || payment?.remark || '-' }]} />
      <PrivateEvidence files={payment?.evidenceFiles || []} /><Table rowKey="id" size="small" scroll={{ x: 500 }} dataSource={payment?.allocations || []} pagination={{ defaultPageSize: 10 }} columns={[{ title: '订单', render: (_, row) => row.supplierOrderNo || row.supplierOrderId }, { title: '登记金额', dataIndex: 'amount' }, { title: '分配状态', dataIndex: 'state', render: value => states[value] || value }]} />
      {payment?.status === 'PENDING' && <Form form={actionForm} layout="vertical" disabled={blocked} onFinish={process}>
        <Form.Item label="处理方式"><Select aria-label="付款处理方式" value={decision} onChange={value => { setDecision(value); actionForm.resetFields(); }} options={decisions} /></Form.Item>
        {decision && decision !== 'confirm' && <Form.Item name="reason" label="处理原因" rules={[{ required: true, whitespace: true, message: '请填写原因' }]}><Input maxLength={300} /></Form.Item>}
        <Button type="primary" icon={<Check size={16} />} htmlType="submit" disabled={blocked || !decision} loading={command.busy}>确认处理</Button>
      </Form>}
    </Modal>
  </>;
}
