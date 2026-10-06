import { useRef, useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Popconfirm, Select, Switch, Tooltip } from 'antd';
import { Archive, Link2, Pencil } from 'lucide-react';
import { ListPage } from '../components/ListPage';
import { hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { Status, statusOptions } from './Stores';

interface Supplier { id: string; name: string; code: string; version: number; status: string; isArchived: boolean; contactName: string; contactPhone: string; deliveryMode: string; defaultSettlementMode: string; defaultSettlementCycle: string; [key: string]: unknown }
interface Product { id: string; name: string; sku: string | null; isActive: boolean }
interface Links { productIds: string[]; version: number }
const choices = (values: Record<string, string>) => Object.entries(values).map(([value, label]) => ({ value, label }));
const delivery = choices({ SELF: '供应商自送', LOGISTICS: '物流配送' });
const settlement = choices({ STORED_VALUE: '储值支付', CREDIT: '挂账', SUPPLIER_TERM: '供应商账期', COMPANY_TERM: '公司账期' });
const cycle = choices({ IMMEDIATE: '即时', WEEKLY: '每周', HALF_MONTHLY: '半月', MONTHLY: '每月' });
const fields = [['name', '供应商名称', 200], ['contactName', '联系人', 120], ['contactPhone', '联系电话', 32], ['address', '地址', 300], ['bankName', '开户银行', 200], ['bankAccountName', '开户户名', 200], ['bankAccount', '银行账号', 80], ['taxpayerId', '纳税人识别号', 80], ['invoiceTitle', '发票抬头', 200]] as const;
export default function Suppliers({ user }: { user: User }) {
  const data = useRows<Supplier>('/suppliers'); const products = useRows<Product>('/products'); const writable = hasRole(user, 'ADMIN', 'PURCHASER');
  const [editing, setEditing] = useState<Supplier | null | undefined>(); const [linking, setLinking] = useState<Supplier | null>(null);
  const [links, setLinks] = useState<Links | null>(null); const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false); const lock = useRef(false); const [error, setError] = useState('');
  const linkRequest = useRef(0);
  const [form] = Form.useForm(); const { message } = App.useApp();
  const edit = (row: Supplier | null) => { form.resetFields(); form.setFieldsValue(row || { deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY', status: 'ACTIVE', requiresFreight: false }); setEditing(row); setError(''); };
  const save = async () => {
    if (lock.current) return; const values = await form.validateFields().catch(() => null); if (!values) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const body = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
      delete body.code; if (!editing) body.code = values.code.trim();
      for (const key of ['supplierType', 'remark', 'settlementCycleDescription']) body[key] = body[key] || null;
      await request(`/suppliers${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: { ...body, ...(editing ? { expectedVersion: editing.version } : {}) } });
      setEditing(undefined); data.reload(); message.success('供应商已保存');
    } catch (failure) { setError((failure as Error).message); } finally { lock.current = false; setSaving(false); }
  };
  const openLinks = async (row: Supplier) => {
    const generation = ++linkRequest.current;
    setLinking(row); setLinks(null); setError('');
    try { const result = await request<Links>(`/suppliers/${row.id}/products`); if (generation === linkRequest.current) { setLinks(result); setSelected(result.productIds); } }
    catch (failure) { if (generation === linkRequest.current) setError((failure as Error).message); }
  };
  return <>
    <ListPage title="供应商管理" {...data} create={writable ? () => edit(null) : undefined} filters={[{ key: 'status', label: '状态', options: statusOptions }]} columns={[
      { title: '供应商名称', dataIndex: 'name', width: 220 }, { title: '编码', dataIndex: 'code', width: 150 },
      { title: '联系人', dataIndex: 'contactName', width: 110 }, { title: '联系电话', dataIndex: 'contactPhone', width: 140 },
      { title: '配送方式', dataIndex: 'deliveryMode', width: 120, render: value => delivery.find(item => item.value === value)?.label || value },
      { title: '结算方式', dataIndex: 'defaultSettlementMode', width: 130, render: value => settlement.find(item => item.value === value)?.label || value },
      { title: '状态', width: 90, render: (_, row) => row.isArchived ? '已归档' : <Status value={row.status} /> },
      { title: '操作', fixed: 'right', width: 120, render: (_, row) => <div className="row-actions">
        <Tooltip title={writable ? '编辑' : '查看'}><Button type="text" aria-label={`${writable ? '编辑' : '查看'}${row.name}`} disabled={row.isArchived} icon={<Pencil size={16} />} onClick={() => edit(row)} /></Tooltip>
        <Tooltip title="关联商品"><Button type="text" aria-label={`关联商品${row.name}`} disabled={row.isArchived} icon={<Link2 size={16} />} onClick={() => openLinks(row)} /></Tooltip>
        {writable && <Popconfirm title="归档供应商？" description="将停用并移除商品、模板关联，历史订单保留。" onConfirm={async () => {
          try { await request(`/suppliers/${row.id}/archive`, { method: 'POST', body: { expectedVersion: row.version } }); data.reload(); message.success('供应商已归档'); }
          catch (failure) { message.error((failure as Error).message); }
        }}><Tooltip title="归档"><Button type="text" danger disabled={row.isArchived} aria-label={`归档${row.name}`} icon={<Archive size={16} />} /></Tooltip></Popconfirm>}
      </div> },
    ]} />
    <Modal title={`${writable ? editing ? '编辑' : '新增' : '查看'}供应商`} open={editing !== undefined} width={720} onOk={save} okText="保存" cancelText="取消"
      footer={!writable ? null : undefined} confirmLoading={saving} closable={!saving} maskClosable={!saving} keyboard={!saving} onCancel={() => { if (!saving) setEditing(undefined); }}>
      {error && <Alert type="error" title={error} showIcon />}
      <Form form={form} layout="vertical" disabled={!writable || saving} className="compact-form"><div className="form-grid">
        <Form.Item name="code" label="编码" rules={[{ required: true, whitespace: true, message: '请填写编码' }]}><Input disabled={Boolean(editing)} maxLength={80} /></Form.Item>
        {fields.map(([key, label, max]) => <Form.Item key={key} name={key} label={label} rules={[{ required: true, whitespace: true, message: `请填写${label}` }]}><Input maxLength={max} /></Form.Item>)}
        <Form.Item name="deliveryMode" label="配送方式" rules={[{ required: true }]}><Select options={delivery} /></Form.Item>
        <Form.Item name="defaultSettlementMode" label="默认结算方式" rules={[{ required: true }]}><Select options={settlement} /></Form.Item>
        <Form.Item name="defaultSettlementCycle" label="结算周期" rules={[{ required: true }]}><Select options={cycle} /></Form.Item>
        <Form.Item name="supplierType" label="供应商类型"><Select allowClear options={choices({ HEADQUARTERS: '总部供应商', DIRECT: '直供供应商' })} /></Form.Item>
        <Form.Item name="requiresFreight" label="需确认运费" valuePropName="checked"><Switch /></Form.Item>
        {editing && <Form.Item name="status" label="状态"><Select options={statusOptions} /></Form.Item>}
        <Form.Item name="settlementCycleDescription" label="结算说明"><Input.TextArea maxLength={500} rows={2} /></Form.Item>
        <Form.Item name="remark" label="备注"><Input.TextArea maxLength={500} rows={2} /></Form.Item>
      </div></Form>
    </Modal>
    <Modal title={`关联商品 · ${linking?.name || ''}`} open={Boolean(linking)} width={640} okText="保存" cancelText="关闭" confirmLoading={saving}
      footer={!writable ? null : undefined} okButtonProps={{ disabled: !links || Boolean(products.error) || products.loading }} onCancel={() => { if (!saving) { linkRequest.current++; setLinking(null); } }} closable={!saving} maskClosable={!saving} keyboard={!saving} onOk={async () => {
        if (lock.current || !links || !linking) return; lock.current = true; setSaving(true); setError('');
        try { await request(`/suppliers/${linking.id}/products`, { method: 'PUT', body: { expectedVersion: links.version, productIds: selected } }); setLinking(null); data.reload(); message.success('商品关联已保存'); }
        catch (failure) { setError((failure as Error).message); } finally { lock.current = false; setSaving(false); }
      }}>
      {(error || products.error) && <Alert type="error" title={error || products.error} showIcon />}
      <Select mode="multiple" style={{ width: '100%' }} aria-label="供应商品" disabled={!writable || saving || !links} loading={!links || products.loading} value={selected} onChange={setSelected} optionFilterProp="label"
        options={products.rows.filter(row => row.isActive || selected.includes(row.id)).map(row => ({ value: row.id, label: `${row.name}${row.sku ? ` (${row.sku})` : ''}` }))} />
      {!links && error && linking && <Button onClick={() => openLinks(linking)}>重试</Button>}
    </Modal>
  </>;
}
