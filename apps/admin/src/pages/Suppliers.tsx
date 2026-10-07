import { useRef, useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Popconfirm, Select, Switch, Table, Tooltip } from 'antd';
import { Archive, ArrowLeft, Link2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { ListPage } from '../components/ListPage';
import { hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { statusOptions } from './Stores';

interface Supplier { id: string; name: string; code: string; version: number; status: string; isArchived: boolean; contactName: string; contactPhone: string; deliveryMode: string; defaultSettlementMode: string; defaultSettlementCycle: string; [key: string]: unknown }
interface Product { id: string; name: string; sku: string | null; isActive: boolean; categoryId: string; baseUnitId: string; specification: string | null }
interface Links { productIds: string[]; version: number }
const choices = (values: Record<string, string>) => Object.entries(values).map(([value, label]) => ({ value, label }));
const delivery = choices({ SELF: '自配送', LOGISTICS: '物流' });
const settlement = choices({ STORED_VALUE: '储值余额', CREDIT: '挂账', SUPPLIER_TERM: '供应商账期结算', COMPANY_TERM: '公司账期结算' });
const cycle = choices({ IMMEDIATE: '现结', WEEKLY: '周结', HALF_MONTHLY: '半月结', MONTHLY: '月结' });
const supplierTypes = choices({ HEADQUARTERS: '总部对接', DIRECT: '直送门店' });
const fields = [['name', '供应商名称', 200], ['contactName', '联系人', 120], ['contactPhone', '手机号', 32], ['address', '地址', 300], ['bankName', '开户行', 200], ['bankAccountName', '开户名', 200], ['bankAccount', '银行账户', 80], ['taxpayerId', '纳税人识别号', 80], ['invoiceTitle', '发票抬头', 200]] as const;
export default function Suppliers({ user }: { user: User }) {
  const data = useRows<Supplier>('/suppliers'); const products = useRows<Product>('/products'); const writable = hasRole(user, 'ADMIN', 'PURCHASER');
  const categories = useRows<{ id: string; name: string }>('/categories'); const units = useRows<{ id: string; name: string }>('/units');
  const [adding, setAdding] = useState(false); const [candidates, setCandidates] = useState<string[]>([]);
  const [category, setCategory] = useState<string>(); const [productSearch, setProductSearch] = useState('');
  const [editing, setEditing] = useState<Supplier | null | undefined>(); const [linking, setLinking] = useState<Supplier | null>(null);
  const [links, setLinks] = useState<Links | null>(null); const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false); const lock = useRef(false); const [error, setError] = useState('');
  const linkRequest = useRef(0);
  const [form] = Form.useForm(); const { message, modal } = App.useApp();
  const edit = (row: Supplier | null) => { form.resetFields(); form.setFieldsValue(row || { deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY', status: 'ACTIVE', requiresFreight: false }); setEditing(row); setError(''); };
  const save = async () => {
    if (lock.current) return; const values = await form.validateFields().catch(() => null); if (!values) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const body = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
      delete body.code;
      for (const key of ['supplierType', 'remark', 'settlementCycleDescription']) body[key] = body[key] || null;
      await request(`/suppliers${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: { ...body, ...(editing ? { expectedVersion: editing.version } : {}) } });
      setEditing(undefined); data.reload(); message.success('供应商已保存');
    } catch (failure) { setError((failure as Error).message); } finally { lock.current = false; setSaving(false); }
  };
  const openLinks = async (row: Supplier) => {
    const generation = ++linkRequest.current;
    setLinking(row); setLinks(null); setError('');
    setCategory(undefined); setProductSearch(''); setAdding(false); setCandidates([]);
    try { const result = await request<Links>(`/suppliers/${row.id}/products`); if (generation === linkRequest.current) { setLinks(result); setSelected(result.productIds); } }
    catch (failure) { if (generation === linkRequest.current) setError((failure as Error).message); }
  };
  const saveLinks = async () => {
    if (lock.current || !links || !linking) return; lock.current = true; setSaving(true); setError('');
    try { const result = await request<Links>(`/suppliers/${linking.id}/products`, { method: 'PUT', body: { expectedVersion: links.version, productIds: selected } }); setLinks(result); data.reload(); message.success('商品关联已保存'); }
    catch (failure) { setError((failure as Error).message); } finally { lock.current = false; setSaving(false); }
  };
  const productColumns = [
    { title: '商品名称', dataIndex: 'name', width: 220 },
    { title: '分类', width: 140, render: (_: unknown, row: Product) => categories.rows.find(item => item.id === row.categoryId)?.name || '-' },
    { title: '规格', dataIndex: 'specification', width: 160 },
    { title: '单位', width: 90, render: (_: unknown, row: Product) => units.rows.find(item => item.id === row.baseUnitId)?.name || '-' },
    { title: '状态', width: 80, render: (_: unknown, row: Product) => row.isActive ? '启用' : '停用' },
  ];
  const matching = (row: Product) => (!category || row.categoryId === category) && `${row.name} ${row.sku || ''}`.toLocaleLowerCase().includes(productSearch.trim().toLocaleLowerCase());
  const leaveLinks = () => {
    const leave = () => { linkRequest.current++; setLinking(null); setError(''); };
    if (links && (selected.length !== links.productIds.length || selected.some(id => !links.productIds.includes(id)))) modal.confirm({ title: '放弃未保存的商品配置？', okText: '放弃', cancelText: '继续编辑', onOk: leave });
    else leave();
  };
  return <>
    {!linking && <ListPage title="供应商管理" searchPlaceholder="供应商名称、联系人" {...data} create={writable ? () => edit(null) : undefined} filters={[{ key: 'status', label: '状态', options: statusOptions }, { key: 'supplierType', label: '供应商类别', options: supplierTypes }]} columns={[
      { title: '供应商名称', dataIndex: 'name', width: 320 },
      { title: '供应商类别', dataIndex: 'supplierType', width: 180, render: value => supplierTypes.find(item => item.value === value)?.label || '-' },
      { title: '结算周期', dataIndex: 'defaultSettlementCycle', width: 180, render: value => cycle.find(item => item.value === value)?.label || value || '-' },
      { title: '操作', fixed: 'right', width: 120, render: (_, row) => <div className="row-actions">
        <Tooltip title={writable ? '编辑' : '查看'}><Button type="text" aria-label={`${writable ? '编辑' : '查看'}${row.name}`} disabled={row.isArchived} icon={<Pencil size={16} />} onClick={() => edit(row)} /></Tooltip>
        <Tooltip title="关联商品"><Button type="text" aria-label={`关联商品${row.name}`} disabled={row.isArchived} icon={<Link2 size={16} />} onClick={() => openLinks(row)} /></Tooltip>
        {writable && <Popconfirm title="归档供应商？" description="将停用并移除商品、模板关联，历史订单保留。" onConfirm={async () => {
          try { await request(`/suppliers/${row.id}/archive`, { method: 'POST', body: { expectedVersion: row.version } }); data.reload(); message.success('供应商已归档'); }
          catch (failure) { message.error((failure as Error).message); }
        }}><Tooltip title="归档"><Button type="text" danger disabled={row.isArchived} aria-label={`归档${row.name}`} icon={<Archive size={16} />} /></Tooltip></Popconfirm>}
      </div> },
    ]} />}
    {linking && <section className="list-page">
      <div className="page-heading"><div className="actions"><Tooltip title="返回供应商列表"><Button aria-label="返回供应商列表" icon={<ArrowLeft size={16} />} disabled={saving} onClick={leaveLinks} /></Tooltip><h1>供应商品配置 · {linking.name}</h1></div>
        {writable && <div className="actions"><Button icon={<Plus size={16} />} disabled={!links || saving || products.loading || Boolean(products.error)} onClick={() => { setCandidates([]); setAdding(true); }}>添加商品</Button><Button type="primary" icon={<Save size={16} />} loading={saving} disabled={!links || products.loading || Boolean(products.error)} onClick={saveLinks}>保存</Button></div>}
      </div>
      <div className="filter-bar"><Select aria-label="商品分类" placeholder="商品分类" allowClear value={category} onChange={setCategory} options={categories.rows.map(row => ({ value: row.id, label: row.name }))} /><Input aria-label="搜索供应商品" placeholder="商品名称、编号" value={productSearch} onChange={event => setProductSearch(event.target.value)} allowClear /></div>
      {(error || products.error || categories.error || units.error) && <Alert type="error" showIcon title={error || products.error || categories.error || units.error} action={<Button onClick={() => { products.reload(); categories.reload(); units.reload(); void openLinks(linking); }}>重试</Button>} />}
      <Table<Product> rowKey="id" size="small" loading={!links && !error || products.loading} scroll={{ x: 750 }} dataSource={products.rows.filter(row => selected.includes(row.id) && matching(row))} columns={[...productColumns, ...(writable ? [{ title: '操作', width: 80, render: (_: unknown, row: Product) => <Tooltip title="移除商品"><Button type="text" danger aria-label={`移除${row.name}`} disabled={saving} icon={<Trash2 size={16} />} onClick={() => setSelected(current => current.filter(id => id !== row.id))} /></Tooltip> }] : [])]} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: total => `共 ${total} 条` }} />
    </section>}
    <Modal title={`${writable ? editing ? '编辑' : '新增' : '查看'}供应商`} open={editing !== undefined} width={720} onOk={save} okText="保存" cancelText="取消"
      footer={!writable ? null : undefined} confirmLoading={saving} closable={!saving} maskClosable={!saving} keyboard={!saving} onCancel={() => { if (!saving) setEditing(undefined); }}>
      {error && <Alert type="error" title={error} showIcon />}
      <Form form={form} layout="vertical" disabled={!writable || saving} className="compact-form"><div className="form-grid">
        {fields.slice(0, 3).map(([key, label, max]) => <Form.Item key={key} name={key} label={label} rules={[{ required: true, whitespace: true, message: `请填写${label}` }]}><Input maxLength={max} /></Form.Item>)}
        <Form.Item name="deliveryMode" label="配送方式" rules={[{ required: true }]}><Select options={delivery} /></Form.Item>
        <Form.Item name="defaultSettlementMode" label="结算方式" rules={[{ required: true }]}><Select options={settlement} /></Form.Item>
        <Form.Item name="defaultSettlementCycle" label="结算周期" rules={[{ required: true }]}><Select options={cycle} /></Form.Item>
        <Form.Item name="requiresFreight" label="是否需要运费" valuePropName="checked"><Switch checkedChildren="是" unCheckedChildren="否" /></Form.Item>
        {fields.slice(3).map(([key, label, max]) => <Form.Item key={key} name={key} label={label} rules={[{ required: true, whitespace: true, message: `请填写${label}` }]}><Input maxLength={max} /></Form.Item>)}
        <Form.Item name="remark" label="备注"><Input.TextArea maxLength={500} rows={2} /></Form.Item>
        <Form.Item name="supplierType" label="供应商类型"><Select allowClear options={supplierTypes} /></Form.Item>
        {editing && <Form.Item name="status" label="状态"><Select options={statusOptions} /></Form.Item>}
        <Form.Item name="settlementCycleDescription" label="结算说明"><Input.TextArea maxLength={500} rows={2} /></Form.Item>
      </div></Form>
    </Modal>
    <Modal title="添加供应商品" open={adding} width={800} okText="添加" cancelText="取消" okButtonProps={{ disabled: !candidates.length }} onCancel={() => setAdding(false)} onOk={() => { setSelected(current => [...new Set([...current, ...candidates])]); setAdding(false); }}>
      <div className="filter-bar"><Select aria-label="筛选商品分类" placeholder="商品分类" allowClear value={category} onChange={setCategory} options={categories.rows.map(row => ({ value: row.id, label: row.name }))} /><Input aria-label="搜索待添加商品" placeholder="商品名称、编号" value={productSearch} onChange={event => setProductSearch(event.target.value)} allowClear /></div>
      <Table<Product> rowKey="id" size="small" scroll={{ x: 690 }} columns={productColumns} dataSource={products.rows.filter(row => row.isActive && !selected.includes(row.id) && matching(row))} rowSelection={{ selectedRowKeys: candidates, onChange: keys => setCandidates(keys as string[]), preserveSelectedRowKeys: true }} pagination={{ defaultPageSize: 10, showSizeChanger: true }} />
    </Modal>
  </>;
}
