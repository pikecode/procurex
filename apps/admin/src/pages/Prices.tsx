import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Descriptions, Form, Input, InputNumber, Popconfirm, Select, Table, Tooltip } from 'antd';
import { Check, Eye, Play, RotateCcw } from 'lucide-react';
import { ApiError, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { decimalRule, namedOptions, type CatalogProduct, type CatalogSupplier, type Template, type TemplateDetail } from '../lib/catalogTypes';
import { clearPriceCommand, executePriceCommand, isDefinitePriceRejection, keepPriceCommand, readPriceCommand, type PendingPriceCommand } from '../lib/priceCommands';

interface Quote { scopeId: string; versionId: string; productId: string; supplierId: string; templateId: string | null; salesPrice: string; supplyPrice: string; effectiveAt: string; reason: string; revision: number; runId?: string }
interface Impact { scopeId: string | null; affectedOrderCount: number; salesDelta: string; supplyDelta: string; orders: { supplierOrderId: string; supplierOrderNo: string; salesDelta: string; supplyDelta: string }[] }
interface Job { id: string; status: string; affectedOrderCount: number; salesDelta: string; supplyDelta: string; orders: { supplierOrderId: string; status: string; salesDelta: string; supplyDelta: string }[] }
interface Adjustment { id: string; supplierOrderId: string; previousSalesPrice: string; newSalesPrice: string; previousSupplyPrice: string; newSupplyPrice: string; salesDelta: string; supplyDelta: string }
interface Submission { id: string; action: string; status: string; resourceType: string | null; resourceId: string | null; startedAt: string; errorCode: string | null; stale: boolean }
const statuses: Record<string, string> = { PENDING: '待执行', PROCESSING: '处理中', SUCCEEDED: '已完成', FAILED: '失败' };
const time = (value: string) => new Date(value).toLocaleString('zh-CN');
const initialTime = () => { const date = new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
export default function Prices({ user }: { user: User }) {
  const products = useRows<CatalogProduct>('/products'); const suppliers = useRows<CatalogSupplier>('/suppliers'); const templates = useRows<Template>('/templates'); const submissions = useRows<Submission>('/commands?limit=100');
  const [form] = Form.useForm(); const templateId = Form.useWatch('templateId', form); const productId = Form.useWatch('productId', form);
  const [template, setTemplate] = useState<TemplateDetail | null>(null); const [templateLoading, setTemplateLoading] = useState(false); const [templateError, setTemplateError] = useState('');
  const [impact, setImpact] = useState<Impact | null>(null); const [fingerprint, setFingerprint] = useState(''); const [versions, setVersions] = useState<Quote[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [pending, setPending] = useState<PendingPriceCommand | null>(null); const [storageError, setStorageError] = useState('');
  const [job, setJob] = useState<Job | null>(null); const [jobInput, setJobInput] = useState(''); const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const lock = useRef(false); const sequence = useRef(0); const jobSequence = useRef(0); const { message } = App.useApp();
  const referencesError = products.error || suppliers.error || templates.error || templateError;
  useEffect(() => {
    try { setPending(readPriceCommand(user.id)); } catch (failure) { setStorageError((failure as Error).message); }
    try { setJobInput(localStorage.getItem(`procurex-admin-price-job:${user.id}`) || ''); } catch { /* Job ID can also be entered manually. */ }
  }, [user.id]);
  useEffect(() => {
    const controller = new AbortController(); setTemplate(null); setTemplateError(''); setTemplateLoading(Boolean(templateId));
    if (templateId) request<TemplateDetail>(`/templates/${templateId}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setTemplate(value); })
      .catch(failure => { if (!controller.signal.aborted) setTemplateError(failure.message); }).finally(() => { if (!controller.signal.aborted) setTemplateLoading(false); });
    return () => controller.abort();
  }, [templateId]);
  const invalidate = () => { sequence.current++; setImpact(null); setFingerprint(''); };
  const draft = (values: Record<string, unknown>) => ({ ...(values.templateId ? { templateId: values.templateId } : {}), productId: values.productId, supplierId: values.supplierId,
    salesPrice: values.salesPrice, supplyPrice: values.supplyPrice, effectiveAt: new Date(values.effectiveAt as string).toISOString(), reason: (values.reason as string).trim() });
  const loadVersions = async (scopeId: string) => setVersions(await request<Quote[]>(`/price-scopes/${scopeId}/versions`));
  const readQuote = async () => {
    const values = await form.validateFields(['productId', 'supplierId', 'effectiveAt']).catch(() => null); if (!values || lock.current) return;
    const revision = ++sequence.current; lock.current = true; setBusy(true); setError(''); setImpact(null); setFingerprint('');
    try {
      const quote = await request<Quote>('/prices/quote', { method: 'POST', body: { productId: values.productId, supplierId: values.supplierId,
        ...(templateId ? { templateId } : {}), effectiveAt: new Date(values.effectiveAt).toISOString() } });
      if (revision !== sequence.current) return;
      const initial = template?.items.find(item => item.productId === values.productId)?.initialSalesPrice;
      form.setFieldsValue({ salesPrice: templateId && !quote.templateId ? initial ?? quote.salesPrice : quote.salesPrice, supplyPrice: quote.supplyPrice });
      await loadVersions(quote.scopeId);
    } catch (failure) {
      if (revision !== sequence.current) return;
      if (failure instanceof ApiError && failure.code === 'PRICE_VERSION_NOT_FOUND') {
        setVersions([]); form.setFieldsValue({ salesPrice: products.rows.find(row => row.id === values.productId)?.defaultSalesPrice ?? undefined, supplyPrice: undefined });
      }
      setError((failure as Error).message);
    } finally { lock.current = false; setBusy(false); }
  };
  const preview = async () => {
    const values = await form.validateFields().catch(() => null); if (!values || lock.current || pending) return;
    const body = draft(values); const signature = JSON.stringify(body); const revision = ++sequence.current;
    lock.current = true; setBusy(true); setError(''); setImpact(null); setFingerprint('');
    try {
      const result = await request<Impact>('/prices/impact-preview', { method: 'POST', body });
      if (revision !== sequence.current) return; setImpact(result); setFingerprint(signature);
      if (result.scopeId) await loadVersions(result.scopeId); else setVersions([]);
    } catch (failure) { if (revision === sequence.current) setError((failure as Error).message); }
    finally { lock.current = false; setBusy(false); }
  };
  const showJob = async (id: string) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) { setError('请输入有效的任务ID'); return; }
    const revision = ++jobSequence.current; setError('');
    try {
      const [result, changes] = await Promise.all([request<Job>(`/jobs/${id}`), request<Adjustment[]>(`/jobs/${id}/adjustments`)]);
      if (revision !== jobSequence.current) return; setJob(result); setAdjustments(changes); setJobInput(id);
      try { localStorage.setItem(`procurex-admin-price-job:${user.id}`, id); } catch { /* Job remains available in this page. */ }
    } catch (failure) { if (revision === jobSequence.current) setError((failure as Error).message); }
  };
  const execute = async (command: PendingPriceCommand) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    let completed = false;
    try {
      // Persist before issuing a mutation, including the exact body and original key.
      keepPriceCommand(user.id, command); setPending(command);
      const result = await executePriceCommand<Quote | Job>(command);
      clearPriceCommand(user.id); setPending(null); completed = true; invalidate(); submissions.reload();
      if (command.path === '/price-changes') {
        const quote = result as Quote; message.success('价格已发布');
        await loadVersions(quote.scopeId); if (quote.runId) await showJob(quote.runId);
      } else { message.success('订单重算已完成'); await showJob((result as Job).id); }
    } catch (failure) {
      if (!completed && isDefinitePriceRejection(failure)) {
        try { clearPriceCommand(user.id); setPending(null); invalidate(); submissions.reload(); } catch { setStorageError('提交记录清理失败，请核查原提交记录。'); }
      }
      setError((failure as Error).message);
    } finally { lock.current = false; setBusy(false); }
  };
  const publish = async () => {
    if (lock.current || pending || !impact || !fingerprint || storageError) return;
    const values = await form.validateFields().catch(() => null); if (!values) return;
    const body = draft(values); if (JSON.stringify(body) !== fingerprint) { invalidate(); return; }
    await execute({ key: crypto.randomUUID(), path: '/price-changes', body, createdAt: new Date().toISOString() });
  };
  const restrictedProducts = templateId ? products.rows.filter(row => template?.items.some(item => item.productId === row.id && item.isEnabled)) : products.rows;
  const restrictedSuppliers = suppliers.rows.filter(row => !row.isArchived && (!templateId || template?.items.find(item => item.productId === productId)?.suppliers.some(link => link.supplierId === row.id)));
  return <section className="price-page">
    <div className="page-heading"><h1>价格管理</h1><Tooltip title="刷新基础资料"><Button aria-label="刷新基础资料" icon={<RotateCcw size={16} />} onClick={() => { invalidate(); products.reload(); suppliers.reload(); templates.reload(); submissions.reload(); }} disabled={busy} /></Tooltip></div>
    {(error || referencesError || storageError) && <Alert type="error" title={error || referencesError || storageError} showIcon />}
    {pending && <Alert type="warning" title="存在待确认的价格提交" description={`${pending.path === '/price-changes' ? '价格发布' : '订单重算'} · ${time(pending.createdAt)}`} showIcon
      action={<Button loading={busy} onClick={() => execute(pending)}>恢复原提交</Button>} />}
    <Form form={form} layout="vertical" className="compact-form" initialValues={{ templateId: '', effectiveAt: initialTime() }} disabled={busy || Boolean(pending) || Boolean(storageError)} onValuesChange={changed => {
      invalidate();
      if (['templateId', 'productId', 'supplierId', 'effectiveAt'].some(key => Object.hasOwn(changed, key))) {
        form.setFieldsValue({ salesPrice: undefined, supplyPrice: undefined }); setVersions([]);
        if (Object.hasOwn(changed, 'templateId')) form.setFieldsValue({ productId: undefined, supplierId: undefined });
        else if (Object.hasOwn(changed, 'productId') && templateId) form.setFieldValue('supplierId', undefined);
      }
    }}>
      <div className="price-grid">
        <Form.Item name="templateId" label="价格范围"><Select options={[{ value: '', label: '共享价格' }, ...namedOptions(templates.rows.filter(row => !row.isArchived))]} /></Form.Item>
        <Form.Item name="productId" label="商品" rules={[{ required: true, message: '请选择商品' }]}><Select showSearch optionFilterProp="label" options={namedOptions(restrictedProducts)} loading={templateLoading || products.loading} /></Form.Item>
        <Form.Item name="supplierId" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}><Select showSearch optionFilterProp="label" options={namedOptions(restrictedSuppliers)} /></Form.Item>
        <Form.Item name="salesPrice" label="销售单价" rules={[decimalRule('销售单价')]}><InputNumber stringMode min="0" precision={6} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="supplyPrice" label="供货单价" rules={[decimalRule('供货单价')]}><InputNumber stringMode min="0" precision={6} readOnly={Boolean(templateId)} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="effectiveAt" label="生效时间" rules={[{ required: true, message: '请选择生效时间' }]}><Input type="datetime-local" /></Form.Item>
        <Form.Item name="reason" label="改价原因" className="full-width" rules={[{ required: true, whitespace: true, message: '请填写改价原因' }]}><Input maxLength={500} /></Form.Item>
      </div>
      <div className="actions price-actions"><Button icon={<RotateCcw size={16} />} onClick={readQuote} disabled={busy || Boolean(pending) || Boolean(storageError) || Boolean(referencesError) || templateLoading}>读取当前价格</Button>
        <Button icon={<Eye size={16} />} onClick={preview} disabled={busy || Boolean(pending) || Boolean(storageError) || Boolean(referencesError) || templateLoading}>预览影响</Button>
        <Popconfirm title="确认发布本次价格？" description="以当前预览参数发布价格，并可能创建订单重算任务。" onConfirm={publish} disabled={!impact || busy || Boolean(pending)}>
          <Button type="primary" icon={<Check size={16} />} disabled={!impact || busy || Boolean(pending) || Boolean(storageError)}>确认发布</Button>
        </Popconfirm>
      </div>
    </Form>
    {impact && <section className="price-band"><h2>影响预览</h2><Descriptions size="small" column={{ xs: 1, sm: 3 }} items={[
      { key: 'orders', label: '影响订单', children: `${impact.affectedOrderCount} 笔` }, { key: 'sales', label: '销售额差额', children: impact.salesDelta }, { key: 'supply', label: '供货额差额', children: impact.supplyDelta },
    ]} /><Table size="small" rowKey="supplierOrderId" dataSource={impact.orders} scroll={{ x: 550 }} pagination={{ defaultPageSize: 10 }} columns={[
      { title: '订单编号', dataIndex: 'supplierOrderNo' }, { title: '销售额差额', dataIndex: 'salesDelta', align: 'right' }, { title: '供货额差额', dataIndex: 'supplyDelta', align: 'right' },
    ]} /></section>}
    {versions.length > 0 && <section className="price-band"><h2>价格版本</h2><Table size="small" rowKey="versionId" dataSource={versions} scroll={{ x: 700 }} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }} columns={[
      { title: '版本', dataIndex: 'revision', width: 75 }, { title: '销售单价', dataIndex: 'salesPrice', align: 'right' }, { title: '供货单价', dataIndex: 'supplyPrice', align: 'right' },
      { title: '生效时间', dataIndex: 'effectiveAt', render: time }, { title: '原因', dataIndex: 'reason' },
    ]} /></section>}
    <section className="price-band"><h2>订单重算任务</h2><div className="job-toolbar"><Input aria-label="重算任务ID" placeholder="任务ID" value={jobInput} onChange={event => setJobInput(event.target.value.trim())} />
      <Button icon={<RotateCcw size={16} />} onClick={() => showJob(jobInput)}>查询任务</Button>
      {job?.status === 'PENDING' && <Popconfirm title="确认执行订单重算？" onConfirm={() => execute({ key: crypto.randomUUID(), path: `/jobs/${job.id}/process`, body: {}, createdAt: new Date().toISOString() })} disabled={busy || Boolean(pending) || Boolean(storageError)}>
        <Button icon={<Play size={16} />} disabled={busy || Boolean(pending) || Boolean(storageError)}>执行订单重算</Button>
      </Popconfirm>}
    </div>
      {job && <><Descriptions size="small" column={{ xs: 1, sm: 4 }} items={[
        { key: 'status', label: '状态', children: statuses[job.status] || job.status }, { key: 'count', label: '影响订单', children: job.affectedOrderCount }, { key: 'sales', label: '销售差额', children: job.salesDelta }, { key: 'supply', label: '供货差额', children: job.supplyDelta },
      ]} /><Table size="small" rowKey="supplierOrderId" dataSource={job.orders} scroll={{ x: 600 }} pagination={{ defaultPageSize: 10 }} columns={[
        { title: '订单ID', dataIndex: 'supplierOrderId' }, { title: '状态', dataIndex: 'status', render: value => statuses[value] || value }, { title: '销售差额', dataIndex: 'salesDelta', align: 'right' }, { title: '供货差额', dataIndex: 'supplyDelta', align: 'right' },
      ]} /></>}
      {adjustments.length > 0 && <Table size="small" rowKey="id" dataSource={adjustments} scroll={{ x: 900 }} pagination={{ defaultPageSize: 10 }} columns={[
        { title: '订单ID', dataIndex: 'supplierOrderId' }, { title: '原销售价', dataIndex: 'previousSalesPrice', align: 'right' }, { title: '新销售价', dataIndex: 'newSalesPrice', align: 'right' },
        { title: '原供货价', dataIndex: 'previousSupplyPrice', align: 'right' }, { title: '新供货价', dataIndex: 'newSupplyPrice', align: 'right' }, { title: '销售差额', dataIndex: 'salesDelta', align: 'right' }, { title: '供货差额', dataIndex: 'supplyDelta', align: 'right' },
      ]} />}
    </section>
    <section className="price-band"><div className="page-heading"><h2>最近价格提交</h2><Button aria-label="刷新价格提交" icon={<RotateCcw size={16} />} onClick={submissions.reload} /></div>
      {submissions.error && <Alert type="error" title={submissions.error} showIcon />}
      <Table size="small" rowKey="id" loading={submissions.loading} scroll={{ x: 700 }} dataSource={submissions.rows.filter(row => ['price.publish', 'price.process'].includes(row.action))} pagination={{ defaultPageSize: 10 }} columns={[
        { title: '提交时间', dataIndex: 'startedAt', render: time }, { title: '操作', dataIndex: 'action', render: value => value === 'price.publish' ? '价格发布' : '订单重算' },
        { title: '状态', render: (_, row) => `${statuses[row.status] || row.status}${row.stale ? ' · 待核查' : ''}` }, { title: '错误码', dataIndex: 'errorCode' },
        { title: '任务', render: (_, row) => row.resourceType === 'PriceChangeRun' && row.resourceId ? <Button type="link" onClick={() => showJob(row.resourceId!)}>查看任务</Button> : '-' },
      ]} />
    </section>
  </section>;
}
