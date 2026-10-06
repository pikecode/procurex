import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Input, Modal, Result, Select, Spin, Table, Tabs, Tooltip } from 'antd';
import { Check, Eye, FileText, Pencil, Wallet } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ListPage } from '../components/ListPage';
import { PrivateEvidence } from '../components/PrivateEvidence';
import { hasRole, request, type User } from '../lib/api';
import { type AccountDocument, type CreditItem, type FinanceStore, type Ledger, type StoreAccount } from '../lib/financeTypes';
import { useWorkflowCommand } from '../lib/useWorkflowCommand';
import { workflowTime } from '../lib/workflowTypes';
import { StoreFinanceEditor } from './StoreFinanceEditor';

type Movement = { id: string; occurredAt: string; kind: string; amount: string; outstandingAfter: string; sourceType: string; sourceId: string };
export default function StoreFinance({ user }: { user: User }) {
  const scoped = ['STORE', 'STORE_FINANCE'].includes(user.scope?.type || '') || !hasRole(user, 'ADMIN', 'HQ_FINANCE');
  const writable = !scoped && hasRole(user, 'ADMIN', 'HQ_FINANCE'); const [params, setParams] = useSearchParams();
  const storeId = scoped ? user.scope?.storeId : params.get('store'); const [rows, setRows] = useState<FinanceStore[]>([]);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  const [account, setAccount] = useState<StoreAccount | null>(null); const [ledgers, setLedgers] = useState<Ledger[]>([]); const [credit, setCredit] = useState<CreditItem[]>([]); const [movements, setMovements] = useState<Movement[]>([]);
  const [detailLoading, setDetailLoading] = useState(false); const [detailError, setDetailError] = useState('');
  const [ids, setIds] = useState<string[]>([]); const [creditSearch, setCreditSearch] = useState(''); const [supplier, setSupplier] = useState<string>();
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [mode, setMode] = useState<'recharge' | 'credit' | 'clearing' | null>(null); const [document, setDocument] = useState<AccountDocument | null>(null); const [documentTarget, setDocumentTarget] = useState<{ id: string; kind: 'RECHARGE' | 'CLEARING' } | null>(null); const [documentError, setDocumentError] = useState(''); const [documentLoading, setDocumentLoading] = useState(false);
  const command = useWorkflowCommand(user.id);
  useEffect(() => {
    if (scoped) return; const controller = new AbortController(); setLoading(true); setError('');
    request<FinanceStore[]>('/stores/finance-overview', { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setRows(value); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [scoped, revision]);
  useEffect(() => {
    const controller = new AbortController(); setAccount(null); setLedgers([]); setCredit([]); setMovements([]); setIds([]); setMode(null); setDocumentTarget(null); setDetailError(''); setCreditSearch(''); setSupplier(undefined); setFrom(''); setTo('');
    if (!storeId) { setDetailLoading(false); return; } setDetailLoading(true);
    const load = async () => { const value = await request<StoreAccount>(`/stores/${storeId}/account`, { signal: controller.signal });
      if (value.storeId !== storeId) throw new Error('账户门店范围不匹配。');
      const ledgerRows = await request<Ledger[]>(`/stores/${storeId}/ledgers`, { signal: controller.signal });
      const creditRows = await request<CreditItem[]>(`/stores/${storeId}/credit-items`, { signal: controller.signal });
      const movementRows = await request<Movement[]>(`/stores/${storeId}/credit-movements`, { signal: controller.signal });
      if (!controller.signal.aborted) { setAccount(value); setLedgers(ledgerRows); setCredit(creditRows); setMovements(movementRows); }
    };
    load().catch(failure => { if (!controller.signal.aborted) setDetailError(failure.message); }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [storeId, revision]);
  useEffect(() => {
    const controller = new AbortController(); setDocument(null); setDocumentError(''); if (!documentTarget || !storeId) return; setDocumentLoading(true);
    request<AccountDocument>(`/stores/${storeId}/${documentTarget.kind === 'RECHARGE' ? 'recharges' : 'clearings'}/${documentTarget.id}`, { signal: controller.signal }).then(value => {
      if (value.storeId !== storeId || value.id !== documentTarget.id || value.kind !== documentTarget.kind) throw new Error('账户单据范围不匹配。'); if (!controller.signal.aborted) setDocument(value);
    }).catch(failure => { if (!controller.signal.aborted) setDocumentError(failure.message); }).finally(() => { if (!controller.signal.aborted) setDocumentLoading(false); }); return () => controller.abort();
  }, [documentTarget, storeId]);
  if (scoped && !storeId) return <Result status="warning" title="尚未绑定门店，无法查看账户" />;
  const refresh = () => setRevision(value => value + 1);
  const recoverable = writable && Boolean(command.pending && /^\/stores\/[0-9a-f-]{36}\/(recharges|clearings|credit-limit)$/.test(command.pending.path));
  const recovery = command.pending && <Alert type="warning" showIcon title={`存在待确认提交：${command.pending.label}`} action={<Button disabled={!recoverable} loading={command.busy} onClick={async () => { if (recoverable && await command.recover()) { setMode(null); refresh(); } }}>恢复原提交</Button>} />;
  const filteredCredit = credit.filter(row => { const date = new Date(row.occurredAt).toLocaleDateString('sv-SE'); return (!from || date >= from) && (!to || date <= to) && (!supplier || row.supplierName === supplier) && `${row.supplierName || ''} ${row.supplierOrderNo || ''}`.includes(creditSearch.trim()); });
  const accountContent = <>
    {!mode && recovery}{!mode && command.error && <Alert type="error" title={command.error} />}
    {detailError && <Alert type="error" title={detailError} action={<Button onClick={refresh}>重试</Button>} />}
    {detailLoading ? <Spin /> : account && <>
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={[
        ['balance', '储值余额', account.balance], ['reserved', '储值预占', account.reservedBalance], ['available', '可用储值', account.availableBalance],
        ['limit', '挂账额度', account.creditLimit], ['used', '未销账金额', account.creditUsed], ['cumulative', '累计挂账', account.creditCumulative ?? '历史未核定'], ['credit', '挂账剩余额度', account.creditAvailable],
      ].map(([key, label, children]) => ({ key, label, children }))} />
      {writable && <div className="actions workflow-actions"><Button icon={<Wallet size={16} />} disabled={command.blocked || Boolean(mode)} onClick={() => { command.clearError(); setMode('recharge'); }}>充值</Button><Button icon={<Pencil size={16} />} disabled={command.blocked || Boolean(mode)} onClick={() => { command.clearError(); setMode('credit'); }}>调整额度</Button></div>}
      <Tabs items={[
        { key: 'credit', label: '未销账明细', children: <><div className="filter-bar"><Input aria-label="筛选挂账订单" placeholder="订单、供应商" value={creditSearch} allowClear onChange={event => setCreditSearch(event.target.value)} /><Input type="date" aria-label="挂账开始日期" value={from} onChange={event => setFrom(event.target.value)} /><Input type="date" aria-label="挂账结束日期" value={to} onChange={event => setTo(event.target.value)} /><Select aria-label="筛选挂账供应商" placeholder="供应商" allowClear value={supplier} options={[...new Set(credit.map(row => row.supplierName).filter(Boolean))].map(value => ({ value: value!, label: value! }))} onChange={setSupplier} />{writable && <Button type="primary" icon={<Check size={16} />} disabled={!ids.length || command.blocked || Boolean(mode)} onClick={() => { command.clearError(); setMode('clearing'); }}>销账核对（{ids.length}）</Button>}</div>
          <Table rowKey="fundingAllocationId" size="small" scroll={{ x: 650 }} dataSource={filteredCredit} rowSelection={writable ? { selectedRowKeys: ids, onChange: keys => setIds(keys.map(String)), getCheckboxProps: row => ({ disabled: command.blocked || Boolean(mode) || !/[1-9]/.test(row.creditOutstanding) }) } : undefined} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }} columns={[{ title: '订单', dataIndex: 'supplierOrderNo' }, { title: '供应商', dataIndex: 'supplierName' }, { title: '发生时间', dataIndex: 'occurredAt', render: workflowTime }, { title: '未销账金额', dataIndex: 'creditOutstanding' }]} /></> },
        { key: 'ledgers', label: '储值流水', children: <Table rowKey="id" size="small" scroll={{ x: 700 }} dataSource={ledgers} pagination={{ defaultPageSize: 10, showSizeChanger: true }} columns={[{ title: '时间', dataIndex: 'occurredAt', render: workflowTime }, { title: '方向', dataIndex: 'direction', render: value => value === 'CREDIT' ? '增加' : '扣减' }, { title: '金额', dataIndex: 'amount' }, { title: '余额', dataIndex: 'balanceAfter' }, { title: '备注', dataIndex: 'note' }, { title: '单据', render: (_, row) => ['RECHARGE', 'CLEARING'].includes(row.sourceType) ? <Tooltip title="查看单据与凭证"><Button aria-label={`查看单据${row.id}`} type="text" icon={<FileText size={16} />} onClick={() => setDocumentTarget({ id: row.sourceId, kind: row.sourceType as 'RECHARGE' | 'CLEARING' })} /></Tooltip> : '-' }]} /> },
        { key: 'movements', label: '挂账发生流水', children: <Table rowKey="id" size="small" scroll={{ x: 650 }} dataSource={movements} pagination={{ defaultPageSize: 10, showSizeChanger: true }} columns={[{ title: '时间', dataIndex: 'occurredAt', render: workflowTime }, { title: '类型', dataIndex: 'kind', render: value => ({ BOOKING: '新增挂账', RELEASE: '释放挂账', CLEARING: '还款销账' } as Record<string, string>)[value] || value }, { title: '发生金额', dataIndex: 'amount' }, { title: '明细剩余挂账', dataIndex: 'outstandingAfter' }, { title: '单据', render: (_, row) => row.sourceType === 'CLEARING' ? <Tooltip title="查看销账单据"><Button type="text" aria-label={`查看单据${row.id}`} icon={<FileText size={16} />} onClick={() => setDocumentTarget({ id: row.sourceId, kind: 'CLEARING' })} /></Tooltip> : '-' }]} /> },
      ]} />
    </>}
  </>;
  return <>
    {!scoped && <>{!storeId && recovery}<ListPage title="门店财务" rows={rows} loading={loading} error={error} reload={refresh} filters={[{ key: 'groupName', label: '门店分组', options: [...new Set(rows.map(row => row.groupName).filter(Boolean))].map(value => ({ value: value!, label: value! })) }]} columns={[
      { title: '门店', dataIndex: 'name', width: 170 }, { title: '分组', dataIndex: 'groupName', width: 110 }, ...([['creditLimit', '挂账额度'], ['creditUsed', '未销账'], ['creditCumulative', '累计挂账'], ['creditAvailable', '剩余额度'], ['balance', '储值余额'], ['reservedBalance', '预占'], ['availableBalance', '可用储值']].map(([key, title]) => ({ title, width: 110, render: (_: unknown, row: FinanceStore) => row.account[key as keyof StoreAccount] ?? '历史未核定' }))),
      { title: '操作', width: 60, fixed: 'right', render: (_, row) => <Tooltip title="查看门店账户"><Button type="text" aria-label={`账户${row.name}`} icon={<Eye size={16} />} onClick={() => setParams({ store: row.id })} /></Tooltip> },
    ]} /></>}
    {scoped ? <section className="list-page"><div className="page-heading"><h1>门店账户</h1><Button onClick={refresh}>刷新</Button></div>{accountContent}</section> : <Modal open={Boolean(storeId)} title={`${rows.find(row => row.id === storeId)?.name || '门店'} · 账户`} width={1050} footer={null} maskClosable={false} closable={!mode && !documentTarget && !command.busy} onCancel={() => { if (!mode && !documentTarget && !command.busy) setParams({}); }}>{accountContent}</Modal>}
    <Modal open={Boolean(documentTarget)} zIndex={1600} title="账户单据" width={650} footer={null} onCancel={() => setDocumentTarget(null)}>{documentError && <Alert type="error" title={documentError} />}{documentLoading ? <Spin /> : document && <><Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[['no', '单据号', document.documentNo], ['amount', '金额', document.amount], ['date', '业务日期', document.businessDate], ['operator', '操作人', document.operatorName || '-'], ['remark', '备注', document.remark || '-']].map(([key, label, children]) => ({ key, label, children }))} /><PrivateEvidence files={document.evidenceFiles || []} /></>}</Modal>
    {mode && storeId && writable && <StoreFinanceEditor storeId={storeId} mode={mode} ids={ids} command={command} onClose={() => setMode(null)} onSaved={() => { setMode(null); refresh(); }} />}
  </>;
}
