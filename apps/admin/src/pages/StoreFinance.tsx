import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Grid, Input, Modal, Result, Select, Spin, Table, Tabs, Tooltip, Tree } from 'antd';
import { Check, FileText, History, Pencil, Receipt, Settings2, Wallet } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ListPage } from '../components/ListPage';
import { PrivateEvidence } from '../components/PrivateEvidence';
import { hasRole, request, type User } from '../lib/api';
import { type AccountDocument, type CreditItem, type FinanceStore, type Ledger, type StoreAccount } from '../lib/financeTypes';
import { useWorkflowCommand } from '../lib/useWorkflowCommand';
import { workflowTime } from '../lib/workflowTypes';
import { StoreFinanceEditor } from './StoreFinanceEditor';
import { AccountHistoryEvidence } from './AccountHistoryEvidence';
import './StoreFinance.css';

const money = (value: unknown) => {
  if (value === null || value === undefined) return '历史未核定';
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  return match ? `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(match[3] || '').padEnd(2, '0')}` : String(value);
};
const cents = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); };
const centsAmount = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;

type Movement = { id: string; occurredAt: string; kind: string; amount: string; outstandingAfter: string; sourceType: string; sourceId: string; supplierOrderNo?: string | null };
type HistoryRow = { id: string; occurredAt: string; amount: string; note: string; kind: string; documentId?: string; documentKind?: 'RECHARGE' | 'CLEARING' };
export default function StoreFinance({ user }: { user: User }) {
  const screens = Grid.useBreakpoint();
  const scoped = ['STORE', 'STORE_FINANCE'].includes(user.scope?.type || '') || !hasRole(user, 'ADMIN', 'HQ_FINANCE');
  const writable = !scoped && hasRole(user, 'ADMIN', 'HQ_FINANCE'); const [params, setParams] = useSearchParams();
  const storeId = scoped ? user.scope?.storeId : params.get('store'); const [rows, setRows] = useState<FinanceStore[]>([]);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  const [groupSearch, setGroupSearch] = useState('');
  const groupKey = params.get('group') || 'all';
  const groupChoices = [{ value: 'all', label: `全部门店 (${rows.length})` }, { value: 'ungrouped', label: `未分组 (${rows.filter(row => !row.groupName).length})` },
    ...[...new Set(rows.map(row => row.groupName).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, 'zh-CN')).map(name => ({ value: `name:${name}`, label: `${name} (${rows.filter(row => row.groupName === name).length})` }))];
  const groupedRows = rows.filter(row => groupKey === 'all' || (groupKey === 'ungrouped' ? !row.groupName : `name:${row.groupName}` === groupKey));
  const changeGroup = (value: string) => setParams(current => { const next = new URLSearchParams(current); if (value === 'all') next.delete('group'); else next.set('group', value); next.delete('store'); return next; });
  const action = writable ? params.get('action') : null;
  const directMode = action === 'credit' || action === 'recharge' ? action : null;
  const clearingWorkspace = action === 'clearing';
  const openAccount = (id?: string, operation?: 'credit' | 'recharge' | 'clearing' | 'history') => setParams(current => { const next = new URLSearchParams(current); if (id) next.set('store', id); else next.delete('store'); if (operation) next.set('action', operation); else next.delete('action'); return next; });
  const [account, setAccount] = useState<StoreAccount | null>(null); const [ledgers, setLedgers] = useState<Ledger[]>([]); const [credit, setCredit] = useState<CreditItem[]>([]); const [movements, setMovements] = useState<Movement[]>([]);
  const [detailLoading, setDetailLoading] = useState(false); const [detailError, setDetailError] = useState('');
  const [ids, setIds] = useState<string[]>([]); const [creditSearch, setCreditSearch] = useState(''); const [supplier, setSupplier] = useState<string>();
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [historyFrom, setHistoryFrom] = useState(''); const [historyTo, setHistoryTo] = useState(''); const [historySearch, setHistorySearch] = useState('');
  const [accountTab, setAccountTab] = useState('credit');
  useEffect(() => { setAccountTab(action === 'history' ? 'recharge-history' : 'credit'); }, [storeId, action]);
  const [mode, setMode] = useState<'recharge' | 'credit' | 'clearing' | null>(null); const [document, setDocument] = useState<AccountDocument | null>(null); const [documentTarget, setDocumentTarget] = useState<{ id: string; kind: 'RECHARGE' | 'CLEARING' } | null>(null); const [documentError, setDocumentError] = useState(''); const [documentLoading, setDocumentLoading] = useState(false);
  const command = useWorkflowCommand(user.id);
  useEffect(() => {
    if (scoped) return; const controller = new AbortController(); setLoading(true); setError('');
    request<FinanceStore[]>('/stores/finance-overview', { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setRows(value); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [scoped, revision]);
  useEffect(() => {
    const controller = new AbortController(); setAccount(null); setLedgers([]); setCredit([]); setMovements([]); setIds([]); setMode(null); setDocumentTarget(null); setDetailError(''); setCreditSearch(''); setSupplier(undefined); setFrom(''); setTo(''); setHistoryFrom(''); setHistoryTo(''); setHistorySearch('');
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
  const selectedTotal = centsAmount(credit.filter(row => ids.includes(row.fundingAllocationId)).reduce((total, row) => total + cents(row.creditOutstanding), 0n));
  const clearingHistory = new Map<string, HistoryRow>();
  for (const row of movements.filter(item => item.kind === 'CLEARING' && item.sourceType === 'CLEARING')) {
    const previous = clearingHistory.get(row.sourceId);
    clearingHistory.set(row.sourceId, { id: row.sourceId, occurredAt: row.occurredAt, kind: '还款销账', amount: centsAmount(cents(previous?.amount || '0') + cents(row.amount)), note: '', documentId: row.sourceId, documentKind: 'CLEARING' });
  }
  const historyTable = (records: HistoryRow[], tab: string) => {
    const filtered = records.filter(row => { const date = new Date(row.occurredAt).toLocaleDateString('sv-SE'); return (!historyFrom || date >= historyFrom) && (!historyTo || date <= historyTo) && `${row.kind} ${row.note}`.includes(historySearch.trim()); });
    return <><div className="filter-bar"><Input aria-label="搜索账户历史" placeholder="订单、备注、类型" value={historySearch} allowClear onChange={event => setHistorySearch(event.target.value)} /><Input type="date" aria-label="历史开始日期" value={historyFrom} onChange={event => setHistoryFrom(event.target.value)} /><Input type="date" aria-label="历史结束日期" value={historyTo} onChange={event => setHistoryTo(event.target.value)} /><Button onClick={() => { setHistorySearch(''); setHistoryFrom(''); setHistoryTo(''); }}>重置</Button></div>{historyFrom && historyTo && historyFrom > historyTo && <Alert type="warning" title="开始日期不能晚于结束日期" />}<Table<HistoryRow> rowKey="id" size="small" scroll={{ x: 650 }} dataSource={filtered} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: total => `共 ${total} 条` }} columns={[{ title: '发生日期', dataIndex: 'occurredAt', render: workflowTime }, { title: '类型', dataIndex: 'kind' }, { title: '金额', dataIndex: 'amount', align: 'right', render: money }, { title: '订单 / 备注', dataIndex: 'note', render: value => value || '-' }, ...(tab !== 'credit-history' ? [{ title: '凭证', width: 170, render: (_: unknown, row: HistoryRow) => row.documentId && row.documentKind && storeId ? <div className="finance-history-evidence"><AccountHistoryEvidence storeId={storeId} documentId={row.documentId} kind={row.documentKind} active={accountTab === tab} /></div> : '-' }] : []), { title: '操作', width: 64, render: (_, row) => row.documentId && row.documentKind ? <Tooltip title="单据与凭证"><Button type="text" aria-label="单据与凭证" icon={<FileText size={16} />} onClick={() => setDocumentTarget({ id: row.documentId!, kind: row.documentKind! })} /></Tooltip> : '-' }]} /></>;
  };
  const accountContent = <div className="store-finance-account">
    {!mode && recovery}{!mode && command.error && <Alert type="error" title={command.error} />}
    {detailError && <Alert type="error" title={detailError} action={<Button onClick={refresh}>重试</Button>} />}
    {detailLoading ? <Spin /> : account && <>
      {!clearingWorkspace && <div className="store-finance-balances">{[
        { title: '挂账账户', items: [['未销账金额', account.creditUsed], ['剩余额度', account.creditAvailable], ['挂账额度', account.creditLimit], ['累计挂账', account.creditCumulative]], action: writable && <Button size="small" icon={<Pencil size={14} />} disabled={command.blocked || Boolean(mode)} onClick={() => { command.clearError(); setMode('credit'); }}>调整额度</Button> },
        { title: '储值账户', items: [['可用储值', account.availableBalance], ['储值余额', account.balance], ['储值预占', account.reservedBalance]], action: writable && <Button size="small" type="primary" icon={<Wallet size={14} />} disabled={command.blocked || Boolean(mode)} onClick={() => { command.clearError(); setMode('recharge'); }}>充值</Button> },
      ].map(section => <section className="store-finance-balance" key={section.title}><div className="store-finance-balance-heading"><h2>{section.title}</h2>{section.action}</div><dl>{section.items.map(([label, value], index) => <div key={label} className={index === 0 ? 'primary-amount' : ''}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl></section>)}</div>}
      {clearingWorkspace && <Descriptions size="small" items={[{ key: 'used', label: '挂账未销账金额', children: money(account.creditUsed) }]} />}
      {!clearingWorkspace && <Select className="finance-history-mobile" aria-label="选择账户记录" value={accountTab} onChange={setAccountTab} options={[{ value: 'recharge-history', label: '充值历史' }, { value: 'credit-history', label: '挂账历史' }, { value: 'clearing-history', label: '销账历史' }, { value: 'credit', label: '未销账明细' }, { value: 'ledgers', label: '储值流水' }, { value: 'movements', label: '挂账发生流水' }]} />}
      <Tabs className={!clearingWorkspace ? 'finance-account-tabs' : ''} activeKey={accountTab} onChange={setAccountTab} items={[
        { key: 'recharge-history', label: '充值历史', children: historyTable(ledgers.filter(row => row.sourceType === 'RECHARGE').map(row => ({ id: row.id, occurredAt: row.occurredAt, amount: row.amount, note: row.note || '', kind: '门店充值', documentId: row.sourceId, documentKind: 'RECHARGE' })), 'recharge-history') },
        { key: 'credit-history', label: '挂账历史', children: historyTable(movements.filter(row => row.kind !== 'CLEARING').map(row => ({ id: row.id, occurredAt: row.occurredAt, amount: row.amount, note: row.supplierOrderNo || '', kind: row.kind === 'BOOKING' ? '新增挂账' : '释放挂账' })), 'credit-history') },
        { key: 'clearing-history', label: '销账历史', children: historyTable([...clearingHistory.values()], 'clearing-history') },
        { key: 'credit', label: '未销账明细', children: <><div className="filter-bar"><Input aria-label="筛选挂账订单" placeholder="订单、供应商" value={creditSearch} allowClear onChange={event => setCreditSearch(event.target.value)} /><Input type="date" aria-label="挂账开始日期" value={from} onChange={event => setFrom(event.target.value)} /><Input type="date" aria-label="挂账结束日期" value={to} onChange={event => setTo(event.target.value)} /><Select aria-label="筛选挂账供应商" placeholder="供应商" allowClear value={supplier} options={[...new Set(credit.map(row => row.supplierName).filter(Boolean))].map(value => ({ value: value!, label: value! }))} onChange={setSupplier} />{writable && <Button type="primary" icon={<Check size={16} />} disabled={!ids.length || command.blocked || Boolean(mode)} onClick={() => { command.clearError(); setMode('clearing'); }}>销账核对（{ids.length}）</Button>}</div>
          {from && to && from > to && <Alert type="warning" showIcon title="开始日期不能晚于结束日期" />}
          <div className="store-finance-selection"><span>共 {filteredCredit.length} 笔{writable && ` · 已选 ${ids.length} 笔`}</span>{writable && <strong>销账金额：{money(selectedTotal)}</strong>}<div className="actions">{writable && <Button size="small" disabled={command.blocked || Boolean(mode) || !filteredCredit.length || Boolean(from && to && from > to)} onClick={() => setIds([...new Set([...ids, ...filteredCredit.filter(row => /[1-9]/.test(row.creditOutstanding)).map(row => row.fundingAllocationId)])])}>选择全部筛选结果</Button>}<Button size="small" onClick={() => { setCreditSearch(''); setSupplier(undefined); setFrom(''); setTo(''); }}>重置筛选</Button>{ids.length > 0 && <Button size="small" type="link" onClick={() => setIds([])}>清空选择</Button>}</div></div>
          <Table rowKey="fundingAllocationId" size="small" scroll={{ x: 650 }} dataSource={filteredCredit} rowSelection={writable ? { selectedRowKeys: ids, preserveSelectedRowKeys: true, onChange: keys => setIds(keys.map(String)), getCheckboxProps: row => ({ disabled: command.blocked || Boolean(mode) || !/[1-9]/.test(row.creditOutstanding) }) } : undefined} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: total => `共 ${total} 条` }} columns={[{ title: '订单', dataIndex: 'supplierOrderNo' }, { title: '供应商', dataIndex: 'supplierName' }, { title: '发生时间', dataIndex: 'occurredAt', render: workflowTime }, { title: '未销账金额', dataIndex: 'creditOutstanding', align: 'right', render: money }]} /></> },
        { key: 'ledgers', label: '储值流水', children: <Table rowKey="id" size="small" scroll={{ x: 700 }} dataSource={ledgers} pagination={{ defaultPageSize: 10, showSizeChanger: true }} columns={[{ title: '时间', dataIndex: 'occurredAt', render: workflowTime }, { title: '方向', dataIndex: 'direction', render: value => value === 'CREDIT' ? '增加' : '扣减' }, { title: '金额', dataIndex: 'amount', align: 'right', render: money }, { title: '余额', dataIndex: 'balanceAfter', align: 'right', render: money }, { title: '备注', dataIndex: 'note' }, { title: '凭证', width: 170, render: (_, row) => ['RECHARGE', 'CLEARING'].includes(row.sourceType) && storeId ? <div className="finance-history-evidence"><AccountHistoryEvidence storeId={storeId} documentId={row.sourceId} kind={row.sourceType as 'RECHARGE' | 'CLEARING'} active={accountTab === 'ledgers'} /></div> : '-' }, { title: '单据', width: 64, render: (_, row) => ['RECHARGE', 'CLEARING'].includes(row.sourceType) ? <Tooltip title="查看单据与凭证"><Button aria-label={`查看单据${row.id}`} type="text" icon={<FileText size={16} />} onClick={() => setDocumentTarget({ id: row.sourceId, kind: row.sourceType as 'RECHARGE' | 'CLEARING' })} /></Tooltip> : '-' }]} /> },
        { key: 'movements', label: '挂账发生流水', children: <Table rowKey="id" size="small" scroll={{ x: 650 }} dataSource={movements} pagination={{ defaultPageSize: 10, showSizeChanger: true }} columns={[{ title: '时间', dataIndex: 'occurredAt', render: workflowTime }, { title: '类型', dataIndex: 'kind', render: value => ({ BOOKING: '新增挂账', RELEASE: '释放挂账', CLEARING: '还款销账' } as Record<string, string>)[value] || value }, { title: '发生金额', dataIndex: 'amount' }, { title: '明细剩余挂账', dataIndex: 'outstandingAfter' }, { title: '单据', render: (_, row) => row.sourceType === 'CLEARING' ? <Tooltip title="查看销账单据"><Button type="text" aria-label={`查看单据${row.id}`} icon={<FileText size={16} />} onClick={() => setDocumentTarget({ id: row.sourceId, kind: 'CLEARING' })} /></Tooltip> : '-' }]} /> },
      ].filter(tab => !clearingWorkspace || tab.key === 'credit')} />
    </>}
  </div>;
  return <>
    {!scoped && <div className="store-finance-workspace"><aside className="finance-group-panel"><strong>门店分组</strong><Input.Search aria-label="搜索财务门店分组" placeholder="分组名称" allowClear value={groupSearch} onChange={event => setGroupSearch(event.target.value)} /><Tree blockNode selectedKeys={[groupKey]} onSelect={keys => { if (keys.length) changeGroup(String(keys[0])); }} treeData={groupChoices.filter(choice => ['all', 'ungrouped'].includes(choice.value) || choice.label.includes(groupSearch.trim())).map(choice => ({ key: choice.value, title: choice.label }))} /></aside><div className="store-finance-page"><Select className="finance-group-mobile" aria-label="选择财务门店分组" showSearch optionFilterProp="label" value={groupKey} options={groupChoices} onChange={changeGroup} />{!storeId && recovery}<ListPage key={groupKey} title="门店财务" searchPlaceholder="门店名称" rows={groupedRows} loading={loading} error={error} reload={refresh} columns={[
      { title: '门店名称', dataIndex: 'name', width: 140, render: (name, row) => <Button className="store-finance-store-link" type="link" onClick={() => openAccount(row.id)}>{name}</Button> },
      ...([['creditUsed', '挂账未销账金额'], ['creditCumulative', '累计挂账金额'], ['creditAvailable', '挂账剩余额度'], ['balance', '门店储值余额']].map(([key, title]) => ({ title, width: 125, align: 'right' as const, render: (_: unknown, row: FinanceStore) => <span className={`store-finance-money ${key === 'creditUsed' ? 'outstanding-amount' : ''}`}>{money(row.account[key as keyof StoreAccount])}</span> }))),
      { title: '操作', width: writable ? screens.md ? 160 : 100 : 64, fixed: 'right', render: (_, row) => writable ? <div className="finance-row-actions"><Tooltip title="挂账额度设置"><Button type="text" aria-label="挂账额度设置" icon={<Settings2 size={16} />} disabled={command.blocked} onClick={() => openAccount(row.id, 'credit')} /></Tooltip><Tooltip title="门店销账"><Button type="text" aria-label="门店销账" icon={<Receipt size={16} />} disabled={command.blocked} onClick={() => openAccount(row.id, 'clearing')} /></Tooltip><Tooltip title="门店充值"><Button type="text" aria-label="门店充值" icon={<Wallet size={16} />} disabled={command.blocked} onClick={() => openAccount(row.id, 'recharge')} /></Tooltip><Tooltip title="账户历史"><Button type="text" aria-label="账户历史" icon={<History size={16} />} onClick={() => openAccount(row.id, 'history')} /></Tooltip></div> : <Tooltip title="账户历史"><Button type="text" aria-label={`账户${row.name}`} icon={<History size={16} />} onClick={() => openAccount(row.id, 'history')} /></Tooltip> },
    ]} /></div></div>}
    {scoped ? <section className="list-page"><div className="page-heading"><h1>门店账户</h1><Button onClick={refresh}>刷新</Button></div>{accountContent}</section> : <Modal open={Boolean(storeId) && !directMode} title={`${rows.find(row => row.id === storeId)?.name || '门店'} · ${clearingWorkspace ? '门店销账' : '账户'}`} width={1050} footer={null} maskClosable={false} closable={!mode && !documentTarget && !command.busy} onCancel={() => { if (!mode && !documentTarget && !command.busy) openAccount(); }}>{accountContent}</Modal>}
    <Modal open={Boolean(documentTarget)} zIndex={1600} title="账户单据" width={650} footer={null} onCancel={() => setDocumentTarget(null)}>{documentError && <Alert type="error" title={documentError} />}{documentLoading ? <Spin /> : document && <><Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[['no', '单据号', document.documentNo], ['amount', '金额', document.amount], ['date', '业务日期', document.businessDate], ['operator', '操作人', document.operatorName || '-'], ['remark', '备注', document.remark || '-']].map(([key, label, children]) => ({ key, label, children }))} /><PrivateEvidence files={document.evidenceFiles || []} /></>}</Modal>
    {(directMode || mode) && storeId && writable && <StoreFinanceEditor storeId={storeId} storeName={rows.find(row => row.id === storeId)?.name} creditItems={credit} mode={(directMode || mode)!} ids={ids} command={command} onClose={() => { setMode(null); if (directMode) openAccount(); }} onSaved={() => { setMode(null); if (directMode) openAccount(); refresh(); }} />}
  </>;
}
