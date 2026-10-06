import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, Result, Select, Table, Tabs, Tag, Tooltip } from 'antd';
import type { TableColumnsType } from 'antd';
import { Download, RotateCcw, Search } from 'lucide-react';
import { getSession, hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';

type Kind = 'order-amounts' | 'product-quantities' | 'profit';
type Filters = { from?: string; to?: string; storeId?: string; supplierId?: string; productId?: string };
type Row = { month?: string; orderCount?: number; supplierOrderId?: string; storeId?: string; supplierId?: string; productId?: string; productName?: string; unit?: string; quantity?: string; completedAt?: string; firstShippedAt?: string; goodsAmount?: string; freightAmount?: string; totalAmount?: string; salesGoodsAmount?: string; supplyGoodsAmount?: string; profit?: string };
type Report = { asOf: string; dateBasis: string; amountBasis?: string; months?: Row[]; orders?: Row[]; products?: Row[]; rows?: Row[]; totals?: { salesGoodsAmount: string; supplyGoodsAmount: string; profit: string; freightAmount: string } };
type Job = { jobId: string; reportType: Kind; status: string; createdAt: string; expiresAt: string; error?: string | null };
type Lookup = { id: string; name: string };
type Snapshot = { kind: Kind; filters: Filters; data: Report };
const titles: Record<Kind, string> = { 'order-amounts': '订货金额', 'product-quantities': '商品数量', profit: '经营差额' };
const statuses: Record<string, string> = { QUEUED: '排队中', PROCESSING: '生成中', READY: '可下载', FAILED: '失败' };
const localDate = () => new Date().toLocaleDateString('sv-SE');
function validateRange(filters: Filters, kind: Kind) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (Boolean(filters.from) !== Boolean(filters.to) || filters.from && filters.to && (!valid(filters.from) || !valid(filters.to) || filters.from > filters.to) || kind === 'product-quantities' && (!filters.from || !filters.to)) throw new Error('请选择完整有效的起止日期，开始日期不能晚于结束日期。');
  if (kind === 'product-quantities' && filters.from && filters.to) { const end = new Date(`${filters.from}T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 3); if (filters.to > end.toISOString().slice(0, 10)) throw new Error('商品数量查询区间不能超过三个月。'); }
}
export default function Reports({ user }: { user: User }) {
  const scoped = ['STORE', 'STORE_FINANCE'].includes(user.scope?.type || '') || (!hasRole(user, 'ADMIN', 'HQ_FINANCE', 'PURCHASER') && hasRole(user, 'STORE', 'STORE_FINANCE'));
  const supplier = user.scope?.type === 'SUPPLIER' || (!scoped && !hasRole(user, 'ADMIN', 'HQ_FINANCE', 'PURCHASER') && hasRole(user, 'SUPPLIER'));
  if (supplier && (!hasRole(user, 'SUPPLIER') || !user.scope?.supplierId)) return <Result status="warning" title="尚未绑定供应商，无法查看报表" />;
  if (scoped && !user.scope?.storeId) return <Result status="warning" title="尚未绑定门店，无法查看报表" />;
  if (!scoped && !supplier && !hasRole(user, 'ADMIN', 'HQ_FINANCE', 'PURCHASER')) return <Result status="403" title="无权访问此页面" />;
  return <Workspace key={`${user.id}:${supplier ? user.scope?.supplierId : scoped ? user.scope?.storeId : 'central'}`} user={user} scoped={scoped || supplier} supplier={supplier} />;
}
function Workspace({ user, scoped, supplier }: { user: User; scoped: boolean; supplier: boolean }) {
  const [kind, setKind] = useState<Kind>('order-amounts'); const [form] = Form.useForm<Filters>(); const [snapshot, setSnapshot] = useState<Snapshot>();
  const [dirty, setDirty] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [exporting, setExporting] = useState(false);
  const [lookups, setLookups] = useState<{ stores: Lookup[]; suppliers: Lookup[]; products: Lookup[] }>({ stores: [], suppliers: [], products: [] });
  const [pageSize, setPageSize] = useState(10); const [page, setPage] = useState(1); const [orderDetail, setOrderDetail] = useState(false);
  const jobs = useRows<Job>('/exports'); const sequence = useRef(0); const controller = useRef<AbortController | null>(null); const exportLock = useRef(false); const alive = useRef(true);
  const unknownKey = `procurex-admin-export-unknown-v1:${user.id}`; const [unknown, setUnknown] = useState(() => { try { return Boolean(localStorage.getItem(unknownKey)); } catch { return true; } });
  const defaults = { from: `${localDate().slice(0, 7)}-01`, to: localDate() };
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (scoped) return; const cancel = new AbortController();
    Promise.all([request<Lookup[]>('/stores', { signal: cancel.signal }), request<Lookup[]>('/suppliers', { signal: cancel.signal }), request<Lookup[]>('/products', { signal: cancel.signal })])
      .then(([stores, suppliers, products]) => { if (!cancel.signal.aborted) setLookups({ stores, suppliers, products }); }).catch(failure => { if (!cancel.signal.aborted) setError((failure as Error).message); });
    return () => cancel.abort();
  }, [scoped]);
  const polling = jobs.rows.some(row => ['QUEUED', 'PROCESSING'].includes(row.status));
  useEffect(() => { if (!polling) return; const timer = setInterval(jobs.reload, 3000); return () => clearInterval(timer); }, [polling, jobs.reload]);
  async function query() {
    const n = ++sequence.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setLoading(true); setError(''); setSnapshot(undefined);
    try { const values = await form.validateFields(); const filters: Filters = Object.fromEntries(Object.entries(values).filter(([, value]) => Boolean(value)));
      if (supplier) { delete filters.storeId; delete filters.productId; filters.supplierId = user.scope!.supplierId!; }
      else if (scoped) { delete filters.supplierId; delete filters.productId; filters.storeId = user.scope!.storeId!; }
      if (kind === 'order-amounts') delete filters.productId;
      validateRange(filters, kind); const params = new URLSearchParams(filters as Record<string, string>);
      const data = await request<Report>(`/reports/${kind}?${params}`, { signal: abort.signal });
      if (!alive.current || n !== sequence.current) return;
      if (supplier && ((data.orders || []).some(row => row.supplierId !== user.scope?.supplierId) || kind === 'order-amounts' && data.amountBasis !== 'SUPPLY')) throw new Error('报表不在当前供应商范围或不是供货金额口径');
      if (scoped && !supplier && (data.orders || []).some(row => row.storeId !== user.scope?.storeId)) throw new Error('报表明细不在当前门店范围');
      setSnapshot({ kind, filters, data }); setDirty(false); setPage(1);
    } catch (failure) { if (alive.current && n === sequence.current && !abort.signal.aborted && !('errorFields' in (failure as object))) setError((failure as Error).message); }
    finally { if (alive.current && n === sequence.current) setLoading(false); }
  }
  async function exportReport() {
    if (!snapshot || dirty || loading || exporting || unknown || exportLock.current) return; exportLock.current = true; setExporting(true); setError('');
    try {
      localStorage.setItem(unknownKey, JSON.stringify({ reportType: snapshot.kind, filters: snapshot.filters, requestedAt: new Date().toISOString() })); setUnknown(true);
      await request('/exports', { method: 'POST', body: { reportType: snapshot.kind, filters: snapshot.filters } });
      localStorage.removeItem(unknownKey); if (alive.current) { setUnknown(false); jobs.reload(); }
    } catch (failure) { if (alive.current) { setError((failure as Error).message); jobs.reload(); } }
    finally { exportLock.current = false; if (alive.current) setExporting(false); }
  }
  async function jobAction(job: Job, retry: boolean) {
    if (exportLock.current || exporting || retry && unknown) return; exportLock.current = true; setExporting(true); setError('');
    try {
      const fresh = await request<Job>(`/exports/${job.jobId}`); if (fresh.jobId !== job.jobId || fresh.reportType === 'profit' && scoped || fresh.expiresAt && Date.parse(fresh.expiresAt) <= Date.now() || fresh.status !== (retry ? 'FAILED' : 'READY')) throw new Error('导出状态已变化或已过期，请刷新任务列表。');
      if (retry) { localStorage.setItem(unknownKey, JSON.stringify({ retryJobId: job.jobId })); setUnknown(true); await request(`/exports/${job.jobId}/retry`, { method: 'POST' }); localStorage.removeItem(unknownKey); if (alive.current) setUnknown(false); }
      else {
        const session = getSession(); if (!session) throw new Error('登录已失效');
        const response = await fetch(`/api/v1/exports/${job.jobId}/download`, { headers: { Authorization: `Bearer ${session.accessToken}` }, signal: AbortSignal.timeout(15000) });
        if (getSession()?.accessToken !== session.accessToken || !response.ok || !response.headers.get('content-type')?.includes('text/csv')) throw new Error('导出下载失败，请重新登录或刷新任务状态。');
        const blob = await response.blob(); if (!blob.size) throw new Error('导出文件为空'); if (!alive.current) return;
        const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `procurex-${job.jobId}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (failure) { if (alive.current) setError((failure as Error).message); }
    finally { exportLock.current = false; if (alive.current) { setExporting(false); jobs.reload(); } }
  }
  const shown = snapshot?.data; const rows = snapshot?.kind === 'order-amounts' ? (orderDetail ? shown?.orders : shown?.months) || [] : snapshot?.kind === 'product-quantities' ? shown?.products || [] : shown?.rows || [];
  const date = (value: string) => value ? new Date(value).toLocaleString('zh-CN') : '-';
  const moneyColumns = (fields: [string, keyof Row][]): TableColumnsType<Row> => fields.map(([title, dataIndex]) => ({ title, dataIndex, align: 'right', width: 120 }));
  const columns: TableColumnsType<Row> = snapshot?.kind === 'product-quantities' ? [{ title: '商品', dataIndex: 'productName' }, { title: '基础单位', dataIndex: 'unit' }, { title: '实收数量', dataIndex: 'quantity', align: 'right' }]
    : snapshot?.kind === 'profit' ? [{ title: '首次发货', dataIndex: 'firstShippedAt', render: date, width: 160 }, { title: '商品', dataIndex: 'productName' }, { title: '订单', dataIndex: 'supplierOrderId', width: 180 }, { title: '数量', render: (_, row) => `${row.quantity} ${row.unit}` }, ...moneyColumns([['销售商品额', 'salesGoodsAmount'], ['供货商品额', 'supplyGoodsAmount'], ['经营差额', 'profit']])]
      : [...(orderDetail ? [{ title: '完成日期', dataIndex: 'completedAt', render: date, width: 160 }, { title: '订单', dataIndex: 'supplierOrderId', width: 190 }] : [{ title: '月份', dataIndex: 'month' }, { title: '完成订单', dataIndex: 'orderCount' }]), ...moneyColumns([['商品金额', 'goodsAmount'], ['运费', 'freightAmount'], ['合计', 'totalAmount']])];
  return <section className="list-page">
    <div className="page-heading"><h1>业务报表</h1><Button icon={<Download size={16} />} disabled={!snapshot || dirty || loading || unknown || exporting} loading={exporting} onClick={exportReport}>导出 CSV</Button></div>
    {(error || jobs.error) && <Alert type="error" showIcon title={error || jobs.error} />}
    {unknown && <Alert type="warning" showIcon title="导出提交结果待核对，请先刷新任务列表，避免重复生成。" action={<Button disabled={exporting || jobs.loading || Boolean(jobs.error)} onClick={() => { try { localStorage.removeItem(unknownKey); setUnknown(false); } catch { setError('无法清理导出记录，请核查浏览器存储。'); } }}>已核对导出记录</Button>} />}
    <Tabs activeKey={kind} onChange={value => { sequence.current++; controller.current?.abort(); setKind(value as Kind); setSnapshot(undefined); setLoading(false); setError(''); setPage(1); setOrderDetail(false); }} items={(['order-amounts', 'product-quantities', ...(!scoped ? ['profit'] : [])] as Kind[]).map(key => ({ key, label: titles[key] }))} />
    <Form form={form} initialValues={defaults} layout="vertical" className="report-filters compact-form" onValuesChange={() => setDirty(true)} onFinish={query} disabled={loading}>
      <Form.Item label="开始日期" name="from"><Input type="date" /></Form.Item><Form.Item label="结束日期" name="to"><Input type="date" /></Form.Item>
      {!scoped && <><Form.Item label="门店" name="storeId"><Select aria-label="门店筛选" allowClear showSearch optionFilterProp="label" options={lookups.stores.map(row => ({ value: row.id, label: row.name }))} /></Form.Item><Form.Item label="供应商" name="supplierId"><Select aria-label="供应商筛选" allowClear showSearch optionFilterProp="label" options={lookups.suppliers.map(row => ({ value: row.id, label: row.name }))} /></Form.Item>{kind !== 'order-amounts' && <Form.Item label="商品" name="productId"><Select aria-label="商品筛选" allowClear showSearch optionFilterProp="label" options={lookups.products.map(row => ({ value: row.id, label: row.name }))} /></Form.Item>}</>}
      <div className="actions"><Button type="primary" htmlType="submit" icon={<Search size={16} />} loading={loading}>查询</Button><Tooltip title="重置筛选"><Button aria-label="重置报表筛选" icon={<RotateCcw size={16} />} onClick={() => { form.resetFields(); setDirty(true); setSnapshot(undefined); }} /></Tooltip></div>
    </Form>
    {snapshot && <><Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[{ key: 'basis', label: '统计日期', children: shown?.dateBasis === 'firstShippedAt' ? '首次发货日期' : '订单完成日期' }, { key: 'asof', label: '数据时间', children: date(shown!.asOf) }, ...(supplier && snapshot.kind === 'order-amounts' ? [{ key: 'amount-basis', label: '金额口径', children: '供货金额' }] : []), ...(!scoped && shown?.totals ? Object.entries(shown.totals).map(([key, value]) => ({ key, label: ({ salesGoodsAmount: '销售商品额', supplyGoodsAmount: '供货商品额', profit: '经营差额', freightAmount: '运费（单列）' } as Record<string, string>)[key], children: value })) : [])]} />
      {snapshot.kind === 'order-amounts' && <Tabs activeKey={orderDetail ? 'orders' : 'months'} onChange={value => { setOrderDetail(value === 'orders'); setPage(1); }} items={[{ key: 'months', label: '月度汇总' }, { key: 'orders', label: '订单明细' }]} />}
    </>}
    <Table<Row> size="small" rowKey={row => `${row.month || row.supplierOrderId || ''}:${row.productId || ''}`} columns={columns} dataSource={rows} loading={loading} scroll={{ x: snapshot?.kind === 'profit' ? 1000 : 650 }} pagination={{ current: page, pageSize, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: total => `共 ${total} 条`, onChange: (p, size) => { setPage(size === pageSize ? p : 1); setPageSize(size); } }} />
    <section className="price-band"><div className="page-heading"><h2>导出记录</h2><Tooltip title="刷新导出记录"><Button aria-label="刷新导出记录" icon={<RotateCcw size={16} />} loading={jobs.loading} onClick={jobs.reload} /></Tooltip></div>
      <Table<Job> size="small" rowKey="jobId" dataSource={jobs.rows.filter(row => !scoped || row.reportType !== 'profit')} loading={jobs.loading} scroll={{ x: 700 }} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: total => `共 ${total} 条` }} columns={[
        { title: '报表', dataIndex: 'reportType', render: (value: Kind) => titles[value] || value }, { title: '创建时间', dataIndex: 'createdAt', render: date }, { title: '有效期至', dataIndex: 'expiresAt', render: date },
        { title: '状态', render: (_, row) => <><Tag color={row.status === 'READY' ? 'green' : row.status === 'FAILED' ? 'red' : 'default'}>{Date.parse(row.expiresAt) <= Date.now() ? '已过期' : statuses[row.status] || row.status}</Tag>{row.error && <small>{row.error}</small>}</> },
        { title: '操作', width: 65, fixed: 'right', render: (_, row) => Date.parse(row.expiresAt) > Date.now() && ['READY', 'FAILED'].includes(row.status) && <Tooltip title={row.status === 'READY' ? '下载 CSV' : '重新生成'}><Button type="text" aria-label={`${row.status === 'READY' ? '下载' : '重试'}导出${row.jobId}`} disabled={exporting || row.status === 'FAILED' && unknown} icon={row.status === 'READY' ? <Download size={16} /> : <RotateCcw size={16} />} onClick={() => jobAction(row, row.status === 'FAILED')} /></Tooltip> },
      ]} />
    </section>
  </section>;
}
