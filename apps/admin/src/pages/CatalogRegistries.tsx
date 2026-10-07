import { useRef, useState } from 'react';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Tooltip } from 'antd';
import { Pencil, Trash2 } from 'lucide-react';
import { ListPage } from '../components/ListPage';
import { CategoryTree } from '../components/CategoryTree';
import { hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';

type Kind = 'categories' | 'brands' | 'units';
interface Row { id: string; name: string; code?: string; parentId?: string | null; sortOrder?: number; version: number }
const titles = { categories: '商品分类', brands: '品牌管理', units: '单位管理' };
export default function CatalogRegistries({ kind, user }: { kind: Kind; user: User }) {
  const data = useRows<Row>(`/${kind}`); const writable = hasRole(user, 'ADMIN', 'PURCHASER');
  const [editing, setEditing] = useState<Row | null | undefined>(); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(''); const lock = useRef(false); const [form] = Form.useForm(); const { message } = App.useApp();
  const failureText = (failure: unknown) => (failure as Error).message;
  const edit = (row: Row | null, parentId?: string) => { form.resetFields(); form.setFieldsValue(row || { sortOrder: 0, parentId }); setError(''); setEditing(row); };
  const remove = async (row: Row) => {
    try { await request(`/${kind}/${row.id}`, { method: 'DELETE', body: { expectedVersion: row.version } }); data.reload(); message.success('资料已删除'); }
    catch (failure) { message.error(failureText(failure)); }
  };
  const save = async () => {
    if (lock.current) return;
    const values = await form.validateFields().catch(() => null); if (!values) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const body = { name: values.name.trim(),
        ...(kind === 'categories' ? { sortOrder: values.sortOrder ?? 0, ...(values.parentId ? { parentId: values.parentId } : editing ? { parentId: null } : {}) } : {}),
        ...(editing ? { expectedVersion: editing.version } : {}) };
      await request(`/${kind}${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body });
      setEditing(undefined); data.reload(); message.success('资料已保存');
    } catch (failure) { setError(failureText(failure)); }
    finally { lock.current = false; setSaving(false); }
  };
  return <>
    {kind === 'categories' ? <CategoryTree {...data} writable={writable} edit={edit} remove={remove} /> : <ListPage title={titles[kind]} {...data} create={writable ? () => edit(null) : undefined} columns={[
      { title: '名称', dataIndex: 'name', width: 240 },
      ...(writable ? [{ title: '操作', width: 100, fixed: 'right' as const, render: (_: unknown, row: Row) => <div className="row-actions">
        <Tooltip title="编辑"><Button type="text" aria-label={`编辑${row.name}`} icon={<Pencil size={16} />} onClick={() => edit(row)} /></Tooltip>
        <Popconfirm title={`删除“${row.name}”？`} onConfirm={async () => {
          try { await request(`/${kind}/${row.id}`, { method: 'DELETE', body: { expectedVersion: row.version } }); data.reload(); message.success('资料已删除'); }
          catch (failure) { message.error(failureText(failure)); }
        }}><Tooltip title="删除"><Button danger type="text" aria-label={`删除${row.name}`} icon={<Trash2 size={16} />} /></Tooltip></Popconfirm>
      </div> }] : []),
    ]} />}
    <Modal title={`${editing ? '编辑' : '新增'}${titles[kind]}`} open={editing !== undefined} width={480} onOk={save} okText="保存" cancelText="取消"
      confirmLoading={saving} closable={!saving} maskClosable={!saving} keyboard={!saving} onCancel={() => { if (!saving) setEditing(undefined); }}>
      {error && <Alert type="error" showIcon title={error} />}
      <Form form={form} layout="vertical" disabled={saving} className="compact-form">
        <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: '请填写名称' }]}><Input maxLength={kind === 'categories' ? 160 : kind === 'units' ? 80 : 120} /></Form.Item>
        {kind === 'categories' && <>
          <Form.Item name="parentId" label="上级分类"><Select allowClear showSearch placeholder="一级分类" optionFilterProp="label" options={data.rows.filter(row => !row.parentId && row.id !== editing?.id).map(row => ({ value: row.id, label: row.name }))} /></Form.Item>
          <Form.Item name="sortOrder" label="排序"><InputNumber precision={0} min={-2147483648} max={2147483647} style={{ width: '100%' }} /></Form.Item>
        </>}
      </Form>
    </Modal>
  </>;
}
