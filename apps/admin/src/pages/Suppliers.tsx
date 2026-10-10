import { useRef, useState } from 'react';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Switch, Table, Tabs, Tag, Tooltip, Tree } from 'antd';
import { EyeOff, Link2, PackageCheck, Pencil, Save, Trash2 } from 'lucide-react';
import { ListPage } from '../components/ListPage';
import { hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { statusOptions } from './Stores';
import './Suppliers.css';

interface Supplier { id: string; name: string; code: string; version: number; status: string; isArchived: boolean; contactName: string; contactPhone: string; deliveryMode: string; defaultSettlementMode: string; defaultSettlementCycle: string; [key: string]: unknown }
interface Product { id: string; name: string; sku: string | null; isActive: boolean; categoryId: string; baseUnitId: string; specification: string | null; defaultSalesPrice: string | null }
interface ProductPrice { productId: string; supplyPrice: string; expectedVersionId: string | null }
interface Links { productIds: string[]; version: number; prices?: ProductPrice[] }
interface ManagedProduct { id: string; productActive: boolean; supplyEnabled: boolean; version: number }
const choices = (values: Record<string, string>) => Object.entries(values).map(([value, label]) => ({ value, label }));
const delivery = choices({ SELF: '自配送', LOGISTICS: '物流' });
const settlement = choices({ STORED_VALUE: '储值余额', CREDIT: '挂账', SUPPLIER_TERM: '供应商账期结算', COMPANY_TERM: '公司账期结算' });
const cycle = choices({ IMMEDIATE: '现结', WEEKLY: '周结', HALF_MONTHLY: '半月结', MONTHLY: '月结' });
const supplierTypes = choices({ HEADQUARTERS: '总部对接', DIRECT: '直送门店' });
const fields = [['name', '供应商名称', 200], ['contactName', '业务联系人', 120], ['contactPhone', '业务联系号码', 32], ['deliveryContactPhone', '配送联系号码', 32], ['address', '地址', 300], ['bankName', '开户行', 200], ['bankAccountName', '开户名', 200], ['bankAccount', '银行账户', 80], ['taxpayerId', '纳税人识别号', 80], ['invoiceTitle', '发票抬头', 200]] as const;
export default function Suppliers({ user }: { user: User }) {
  const data = useRows<Supplier>('/suppliers'); const products = useRows<Product>('/products'); const writable = hasRole(user, 'ADMIN', 'PURCHASER');
  const categories = useRows<{ id: string; name: string; parentId: string | null }>('/categories'); const units = useRows<{ id: string; name: string }>('/units');
  const [removals, setRemovals] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState<string>(); const [productSearch, setProductSearch] = useState('');
  const [editing, setEditing] = useState<Supplier | null | undefined>(); const [linking, setLinking] = useState<Supplier | null>(null);
  const [links, setLinks] = useState<Links | null>(null); const [selected, setSelected] = useState<string[]>([]);
  const [managed, setManaged] = useState<Record<string, ManagedProduct>>({});
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false); const lock = useRef(false); const [error, setError] = useState('');
  const linkRequest = useRef(0);
  const [form] = Form.useForm(); const { message, modal } = App.useApp();
  const settlementMode = Form.useWatch('defaultSettlementMode', form);
  const needsCycle = ['SUPPLIER_TERM', 'COMPANY_TERM'].includes(settlementMode);
  const edit = (row: Supplier | null) => { form.resetFields(); form.setFieldsValue(row || { deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY', status: 'ACTIVE', requiresFreight: false }); setEditing(row); setError(''); };
  const save = async () => {
    if (lock.current) return; const values = await form.validateFields().catch(() => null); if (!values) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const body = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
      delete body.code;
      if (!needsCycle) delete body.defaultSettlementCycle;
      for (const key of ['contactName', 'contactPhone', 'deliveryContactPhone', 'address', 'bankName', 'bankAccountName', 'bankAccount', 'taxpayerId', 'invoiceTitle']) body[key] = body[key] || null;
      for (const key of ['supplierType', 'remark', 'settlementCycleDescription']) body[key] = body[key] || null;
      await request(`/suppliers${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: { ...body, ...(editing ? { expectedVersion: editing.version } : {}) } });
      setEditing(undefined); data.reload(); message.success('供应商已保存');
    } catch (failure) { setError((failure as Error).message); } finally { lock.current = false; setSaving(false); }
  };
  const openLinks = async (row: Supplier) => {
    const generation = ++linkRequest.current;
    setLinking(row); setLinks(null); setSelected([]); setManaged({}); setPriceDrafts({}); setError('');
    setCategory(undefined); setProductSearch(''); setAdding(false); setRemovals([]);
    try {
      const [result, statuses] = await Promise.all([
        request<Links>(`/suppliers/${row.id}/products`),
        request<{ items: ManagedProduct[] }>(`/suppliers/${row.id}/managed-products`),
      ]);
      if (!Array.isArray(result.prices)) throw new Error('商品价格接口尚未更新，请重启本地 API 服务后重试');
      if (generation === linkRequest.current) { setLinks(result); setSelected(result.productIds); setManaged(Object.fromEntries(statuses.items.map(item => [item.id, item]))); }
    }
    catch (failure) { if (generation === linkRequest.current) setError((failure as Error).message); }
  };
  const saveLinks = async () => {
    if (lock.current || !links || !linking || !dirty) return; lock.current = true; setSaving(true); setError('');
    try {
      const result = await request<Links>(`/suppliers/${linking.id}/products`, { method: 'PUT', body: { expectedVersion: links.version, productIds: selected, prices: changedPrices } });
      const statuses = await request<{ items: ManagedProduct[] }>(`/suppliers/${linking.id}/managed-products`);
      setLinks(result); setSelected(result.productIds); setManaged(Object.fromEntries(statuses.items.map(item => [item.id, item]))); setPriceDrafts({}); setRemovals([]);
      data.reload(); products.reload(); message.success('商品及供货价已保存');
    }
    catch (failure) { setError((failure as Error).message); } finally { lock.current = false; setSaving(false); }
  };
  const changeListing = async (row: Product) => {
    if (!linking || !managed[row.id] || lock.current) return;
    const current = managed[row.id]!; const supplyEnabled = !current.supplyEnabled;
    lock.current = true; setSaving(true); setError('');
    try {
      const updated = await request<ManagedProduct>(`/suppliers/${linking.id}/managed-products/${row.id}`, { method: 'PATCH', body: { supplyEnabled, expectedVersion: current.version } });
      setManaged(items => ({ ...items, [row.id]: updated }));
      message.success(supplyEnabled ? '商品已上架' : '商品已下架');
    } catch (failure) { setError((failure as Error).message); }
    finally { lock.current = false; setSaving(false); }
  };
  const productColumns = [
    { title: '商品名称', dataIndex: 'name', width: 220 },
    { title: '分类', width: 140, render: (_: unknown, row: Product) => categories.rows.find(item => item.id === row.categoryId)?.name || '-' },
    { title: '规格', dataIndex: 'specification', width: 160 },
    { title: '单位', width: 90, render: (_: unknown, row: Product) => units.rows.find(item => item.id === row.baseUnitId)?.name || '-' },
    { title: '销售价格', width: 140, align: 'right' as const, render: (_: unknown, row: Product) => row.defaultSalesPrice == null ? '-' : `¥${Number(row.defaultSalesPrice).toFixed(2)}` },
    ...(!adding ? [{ title: '供货价', width: 150, render: (_: unknown, row: Product) => {
      const saved = links?.prices?.find(price => price.productId === row.id);
      const value = priceDrafts[row.id] ?? saved?.supplyPrice ?? row.defaultSalesPrice ?? undefined;
      return writable ? <InputNumber aria-label={`${row.name}供货价`} stringMode min="0" max="9999999999.99" precision={2} step="0.01" prefix="¥" style={{ width: '100%' }} placeholder="未设置" value={value} disabled={saving || !links || !selected.includes(row.id)} onChange={next => setPriceDrafts(current => { const updated = { ...current }; if (next === null) delete updated[row.id]; else updated[row.id] = String(next); return updated; })} /> : value === undefined ? '-' : `¥${Number(value).toFixed(2)}`;
    } }] : []),
    ...(!adding ? [{ title: '供货状态', width: 100, render: (_: unknown, row: Product) => !row.isActive ? <Tag>商品已停用</Tag> : managed[row.id]?.supplyEnabled ? <Tag color="success">已上架</Tag> : <Tag>已下架</Tag> }] : []),
  ];
  const changedPrices: ProductPrice[] = selected.flatMap(productId => {
    const saved = links?.prices?.find(price => price.productId === productId);
    const value = priceDrafts[productId] ?? (saved ? undefined : products.rows.find(product => product.id === productId)?.defaultSalesPrice);
    return value == null || Number(value) === Number(saved?.supplyPrice ?? NaN) ? [] : [{ productId, supplyPrice: Number(value).toFixed(2), expectedVersionId: saved?.expectedVersionId ?? null }];
  });
  const dirty = Boolean(links && (changedPrices.length || selected.length !== links.productIds.length || selected.some(id => !links.productIds.includes(id))));
  const categoryIds = (id: string): string[] => [id, ...categories.rows.filter(row => row.parentId === id).map(row => row.id)];
  const matching = (row: Product) => (!category || categoryIds(category).includes(row.categoryId)) && `${row.name} ${row.sku || ''}`.toLocaleLowerCase().includes(productSearch.trim().toLocaleLowerCase());
  const availableProduct = (row: Product) => row.isActive && !links?.productIds.includes(row.id);
  const categoryNodes = (parentId: string | null): { key: string; title: string; children?: { key: string; title: string }[] }[] => categories.rows.filter(row => row.parentId === parentId).map(row => ({ key: row.id, title: `${row.name} (${products.rows.filter(product => (adding ? availableProduct(product) : selected.includes(product.id)) && categoryIds(row.id).includes(product.categoryId)).length})`, ...(parentId === null ? { children: categoryNodes(row.id) } : {}) }));
  const leaveLinks = () => {
    const leave = () => { linkRequest.current++; setLinking(null); setError(''); };
    if (dirty) modal.confirm({ title: '放弃未保存的商品配置？', okText: '放弃', cancelText: '继续编辑', onOk: leave });
    else leave();
  };
  return <>
    <ListPage title="供应商管理" searchPlaceholder="供应商名称、联系人" {...data} rows={data.rows.filter(row => !row.isArchived)} create={writable ? () => edit(null) : undefined} filters={[{ key: 'status', label: '状态', options: statusOptions }, { key: 'supplierType', label: '供应商类别', options: supplierTypes }]} columns={[
      { title: '供应商名称', dataIndex: 'name', width: 320 },
      { title: '供应商类别', dataIndex: 'supplierType', width: 180, render: value => supplierTypes.find(item => item.value === value)?.label || '-' },
      { title: '结算周期', dataIndex: 'defaultSettlementCycle', width: 180, render: (value, row) => ['SUPPLIER_TERM', 'COMPANY_TERM'].includes(row.defaultSettlementMode) ? cycle.find(item => item.value === value)?.label || value || '-' : '-' },
      { title: '操作', fixed: 'right', width: 120, render: (_, row) => <div className="row-actions">
        <Tooltip title={writable ? '编辑' : '查看'}><Button type="text" aria-label={`${writable ? '编辑' : '查看'}${row.name}`} disabled={row.isArchived} icon={<Pencil size={16} />} onClick={() => edit(row)} /></Tooltip>
        <Tooltip title="关联商品"><Button type="text" aria-label={`关联商品${row.name}`} disabled={row.isArchived} icon={<Link2 size={16} />} onClick={() => openLinks(row)} /></Tooltip>
        {writable && <Popconfirm title="删除供应商？" description="删除后解除商品及模板关联，历史订单不受影响，仍显示该供应商。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={async () => {
          try { await request(`/suppliers/${row.id}/archive`, { method: 'POST', body: { expectedVersion: row.version } }); data.reload(); message.success('供应商已删除'); }
          catch (failure) { message.error((failure as Error).message); }
        }}><Tooltip title="删除供应商" styles={{ root: { pointerEvents: 'none' } }}><Button type="text" danger disabled={row.isArchived} aria-label={`删除${row.name}`} icon={<Trash2 size={16} />} /></Tooltip></Popconfirm>}
      </div> },
    ]} />
    <Modal title={`管理商品 · ${linking?.name || ''}`} open={Boolean(linking)} width={1100} className="supplier-products-modal" maskClosable={false} closable={!saving} keyboard={!saving} onCancel={() => { if (!saving) leaveLinks(); }} footer={<div className="supplier-products-footer"><span>已供 {selected.length} 件{dirty && ` · 待新增 ${selected.filter(id => !links?.productIds.includes(id)).length} 件 · 待移除 ${links?.productIds.filter(id => !selected.includes(id)).length || 0} 件`}</span><div className="actions"><Button disabled={saving} onClick={leaveLinks}>取消</Button>{writable && <Button type="primary" icon={<Save size={16} />} loading={saving} disabled={!dirty || !links || products.loading || Boolean(products.error)} onClick={saveLinks}>保存修改</Button>}</div></div>}>
      {(error || products.error || categories.error || units.error) && <Alert type="error" showIcon title={error || products.error || categories.error || units.error} action={<Button disabled={saving} onClick={() => { products.reload(); categories.reload(); units.reload(); if (!links && linking) void openLinks(linking); }}>重试</Button>} />}
      <Tabs className="supplier-products-views" activeKey={adding ? 'available' : 'linked'} onChange={key => { setAdding(key === 'available'); setCategory(undefined); setProductSearch(''); setRemovals([]); }} items={[{ key: 'linked', label: `已供商品 (${selected.length})` }, ...(writable ? [{ key: 'available', label: `待添加商品 (${products.rows.filter(row => availableProduct(row)).length})` }] : [])]} />
      <div className="supplier-products-layout">
        <aside><strong>商品分类</strong><Tree titleRender={node => <Tooltip title={String(node.title)}><span className="supplier-category-label">{String(node.title)}</span></Tooltip>} blockNode defaultExpandAll selectedKeys={[category || 'all']} onSelect={keys => { setCategory(keys[0] === 'all' || !keys.length ? undefined : String(keys[0])); }} treeData={[{ key: 'all', title: `全部商品 (${adding ? products.rows.filter(row => availableProduct(row)).length : selected.length})` }, ...categoryNodes(null)]} /></aside>
        <div className="supplier-products-main">
          <div className="supplier-products-toolbar"><Input aria-label="搜索供应商品" placeholder="商品名称、货号" value={productSearch} onChange={event => setProductSearch(event.target.value)} allowClear /><div className="actions">{writable && !adding && <Button disabled={!removals.length || saving || !links} danger icon={<Trash2 size={16} />} onClick={() => { setSelected(current => current.filter(id => !removals.includes(id))); setRemovals([]); }}>移除所选{removals.length ? ` (${removals.length})` : ''}</Button>}</div></div>
          <Table<Product> key={`${adding}-${category || 'all'}-${productSearch}`} rowKey="id" size="small" loading={!links && !error || products.loading} scroll={{ x: 820, y: 420 }} locale={{ emptyText: adding ? '暂无可添加商品' : '暂无供应商品' }} dataSource={products.rows.filter(row => (adding ? availableProduct(row) : selected.includes(row.id)) && matching(row))} rowSelection={writable ? { selectedRowKeys: adding ? selected.filter(id => !links?.productIds.includes(id)) : removals, preserveSelectedRowKeys: true, onChange: keys => { if (adding) setSelected(current => [...current.filter(id => links?.productIds.includes(id)), ...keys.map(String)]); else setRemovals(keys.map(String)); }, getCheckboxProps: () => ({ disabled: saving || !links }) } : undefined} columns={[...productColumns, ...(adding ? [{ title: '供应状态', width: 90, render: (_: unknown, row: Product) => selected.includes(row.id) ? <Tag color="processing">待新增</Tag> : '-' }] : writable ? [{ title: '操作', fixed: 'right' as const, width: 150, render: (_: unknown, row: Product) => <div className="row-actions">{managed[row.id]?.supplyEnabled ? <Popconfirm title={`下架“${row.name}”？`} description="门店将不能再向当前供应商新订购此商品，历史订单不受影响。" okText="确认下架" cancelText="取消" onConfirm={() => changeListing(row)}><Tooltip title="下架"><Button type="text" danger aria-label={`下架${row.name}`} disabled={saving || !links || !row.isActive} icon={<EyeOff size={15} />} /></Tooltip></Popconfirm> : <Tooltip title="上架"><Button type="text" aria-label={`上架${row.name}`} disabled={saving || !links || !row.isActive} icon={<PackageCheck size={15} />} onClick={() => changeListing(row)} /></Tooltip>}<Tooltip title="移除关联"><Button type="text" danger aria-label={`移除${row.name}`} disabled={saving || !links} icon={<Trash2 size={15} />} onClick={() => { setSelected(current => current.filter(id => id !== row.id)); setRemovals(current => current.filter(id => id !== row.id)); }} /></Tooltip></div> }] : [])]} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: total => `共 ${total} 条` }} />
        </div>
      </div>
    </Modal>
    <Modal title={`${writable ? editing ? '编辑' : '新增' : '查看'}供应商`} open={editing !== undefined} width={720} onOk={save} okText="保存" cancelText="取消"
      footer={!writable ? null : undefined} confirmLoading={saving} closable={!saving} maskClosable={!saving} keyboard={!saving} onCancel={() => { if (!saving) setEditing(undefined); }}>
      {error && <Alert type="error" title={error} showIcon />}
      <Form form={form} layout="vertical" disabled={!writable || saving} className="compact-form"><div className="form-grid">
        {fields.slice(0, 3).map(([key, label, max]) => <Form.Item key={key} name={key} label={label} rules={[{ required: key === 'name', whitespace: key === 'name', message: `请填写${label}` }]}><Input maxLength={max} /></Form.Item>)}
        <Form.Item name="deliveryMode" label="配送方式" rules={[{ required: true }]}><Select options={delivery} /></Form.Item>
        <Form.Item name="defaultSettlementMode" label="结算方式" rules={[{ required: true }]}><Select options={settlement} /></Form.Item>
        {needsCycle && <Form.Item name="defaultSettlementCycle" label="结算周期" rules={[{ required: true }]}><Select options={cycle} /></Form.Item>}
        <Form.Item name="requiresFreight" label="是否需要运费" valuePropName="checked"><Switch checkedChildren="是" unCheckedChildren="否" /></Form.Item>
        {fields.slice(3).map(([key, label, max]) => <Form.Item key={key} name={key} label={label} ><Input maxLength={max} /></Form.Item>)}
        <Form.Item name="remark" label="备注"><Input.TextArea maxLength={500} rows={2} /></Form.Item>
        <Form.Item name="supplierType" label="供应商类型"><Select allowClear options={supplierTypes} /></Form.Item>
        {editing && <Form.Item name="status" label="状态"><Select options={statusOptions} /></Form.Item>}
        <Form.Item name="settlementCycleDescription" label="结算说明"><Input.TextArea maxLength={500} rows={2} /></Form.Item>
      </div></Form>
    </Modal>
  </>;
}
