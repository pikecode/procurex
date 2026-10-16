import { useEffect, useState } from 'react';
import { Alert, App, Button, Descriptions, Input, Modal, Popconfirm, Spin, Table, Tag } from 'antd';
import { Check, Eye, Undo2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ListPage } from '../components/ListPage';
import { request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { useWorkflowCommand, canRecoverWorkflow } from '../lib/useWorkflowCommand';
import { workflowTime } from '../lib/workflowTypes';
import { money } from '../lib/money';

type Funds = { required: string; available: string; shortfall: string };
type Review = { id: string; requestNo: string; storeId: string; status: string; version: number; salesGoodsAmount: string;
  procurementConfirmedAt: string; financeReturnedReason?: string; funding: { canConfirm: boolean; stored: Funds; credit: Funds };
  items: { id: string; productName: string; quantity: string; salesUnitPrice: string; salesLineAmount: string }[];
  settlementGroups: { supplierId: string; supplierName: string; mode: string; cycle: string; amount: string }[] };
const modes: Record<string, string> = { STORED_VALUE: '储值', CREDIT: '挂账', SUPPLIER_TERM: '供应商账期', COMPANY_TERM: '公司账期' };
const cycles: Record<string, string> = { IMMEDIATE: '现结', WEEKLY: '周结', SEMIMONTHLY: '半月结', HALF_MONTHLY: '半月结', MONTHLY: '月结' };

export default function FinanceReview({ user }: { user: User }) {
  const list = useRows<Review>('/purchase-requests?status=PENDING_FINANCE');
  const stores = useRows<{ id: string; name: string }>('/stores');
  const [selected, setSelected] = useState<string>(); const [detail, setDetail] = useState<Review>();
  const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); const [returning, setReturning] = useState(false); const [reason, setReason] = useState('');
  const command = useWorkflowCommand(user.id); const { message } = App.useApp();
  const storeName = (id: string) => stores.rows.find(store => store.id === id)?.name || id;
  const reload = () => { list.reload(); setRevision(value => value + 1); };
  useEffect(() => {
    setDetail(undefined); setError(''); setReturning(false); setReason('');
    if (!selected) return;
    const controller = new AbortController(); setLoading(true);
    request<Review>(`/purchase-requests/${selected}/finance-review`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setDetail(value); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected, revision]);
  async function decide(action: 'approve' | 'return') {
    if (!detail || command.blocked || (action === 'return' && !reason.trim())) return;
    const ok = await command.submit({ path: `/purchase-requests/${detail.id}/finance-${action}`, method: 'POST',
      label: action === 'approve' ? '财务审核通过' : '退回采购', body: { expectedVersion: detail.version, ...(action === 'return' ? { reason: reason.trim() } : {}) } });
    if (ok) { setSelected(undefined); reload(); message.success(action === 'approve' ? '审核通过，供应商订单已生成' : '已退回采购'); }
    else setRevision(value => value + 1);
  }
  const notices = <>{command.error && <Alert type="error" showIcon title={command.error} />}{command.pending && <Alert type="warning" title={`待确认：${command.pending.label}`} action={<Button loading={command.busy} disabled={!canRecoverWorkflow(user, command.pending.path)} onClick={async () => { if (await command.recover()) { setSelected(undefined); reload(); } }}>核对提交结果</Button>} />}</>;
  return <>
    {!selected && notices}
    <ListPage title="下货单财务审核" rows={list.rows.map(row => ({ ...row, name: `${storeName(row.storeId)} ${row.requestNo}`, storeName: storeName(row.storeId) }))}
      loading={list.loading} error={list.error || stores.error} reload={reload}
      columns={[{ title: '下货单号', dataIndex: 'requestNo', width: 230 }, { title: '门店', dataIndex: 'storeName', width: 180 },
        { title: '销售金额', dataIndex: 'salesGoodsAmount', width: 130, render: money }, { title: '采购确认时间', dataIndex: 'procurementConfirmedAt', width: 180, render: workflowTime },
        { title: '操作', width: 110, fixed: 'right', render: (_, row) => <Button icon={<Eye size={15} />} onClick={() => setSelected(row.id)}>审核</Button> }]} />
    <Modal title="下货单财务审核" open={Boolean(selected)} onCancel={() => { if (!command.busy) setSelected(undefined); }} width={1000} footer={null} destroyOnHidden>
      {notices}{error && <Alert type="error" title={error} action={<Button onClick={reload}>重试</Button>} />}{loading ? <Spin /> : detail && <>
        <Descriptions size="small" items={[{ key: 'store', label: '门店', children: storeName(detail.storeId) }, { key: 'no', label: '下货单号', children: detail.requestNo },
          { key: 'amount', label: '销售金额', children: money(detail.salesGoodsAmount) }]} />
        <Table size="small" rowKey="name" pagination={false} dataSource={[{ name: '储值', ...detail.funding.stored }, { name: '挂账', ...detail.funding.credit }]}
          columns={[{ title: '资金类型', dataIndex: 'name' }, { title: '本单所需', dataIndex: 'required', render: money }, { title: '本单可用（含已占用）', dataIndex: 'available', render: money },
            { title: '缺口', dataIndex: 'shortfall', render: value => <Tag color={Number(value) > 0 ? 'orange' : 'green'}>{money(value)}</Tag> }]} />
        {!detail.funding.canConfirm && <Alert type="warning" showIcon title="资金不足，补足储值或挂账额度后可审核通过" action={<Link to="/store-finance">门店财务</Link>} />}
        <Table size="small" rowKey="supplierId" pagination={false} dataSource={detail.settlementGroups} columns={[{ title: '供应商', dataIndex: 'supplierName' }, { title: '结算方式', dataIndex: 'mode', render: value => modes[value] || value },
          { title: '结算周期', dataIndex: 'cycle', render: value => cycles[value] || value }, { title: '销售金额', dataIndex: 'amount', render: money }]} />
        <Table size="small" rowKey="id" pagination={{ defaultPageSize: 10 }} dataSource={detail.items} columns={[{ title: '商品', dataIndex: 'productName' }, { title: '数量', dataIndex: 'quantity', render: value => Number(value) },
          { title: '销售单价', dataIndex: 'salesUnitPrice', render: money }, { title: '销售金额', dataIndex: 'salesLineAmount', render: money }]} />
        {returning && <Input.TextArea value={reason} maxLength={300} rows={2} onChange={event => setReason(event.target.value)} placeholder="退回原因（必填）" disabled={command.busy} />}
        {detail.status === 'PENDING_FINANCE' && <div className="actions workflow-actions"><Button disabled={command.busy} onClick={reload}>刷新资金</Button>
          {returning ? <><Button disabled={command.busy} onClick={() => setReturning(false)}>取消退回</Button><Button danger icon={<Undo2 size={15} />} disabled={command.blocked || !reason.trim()} onClick={() => decide('return')}>确认退回采购</Button></>
            : <><Button icon={<Undo2 size={15} />} disabled={command.blocked} onClick={() => setReturning(true)}>退回采购</Button><Popconfirm title="审核通过并生成供应商订单？" onConfirm={() => decide('approve')}><Button type="primary" icon={<Check size={15} />} disabled={command.blocked || !detail.funding.canConfirm}>通过并生成订单</Button></Popconfirm></>}
        </div>}
      </>}
    </Modal>
  </>;
}
