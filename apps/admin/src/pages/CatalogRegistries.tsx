import { useRef, useState } from 'react';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Tooltip } from 'antd';
import { Pencil, Power, Trash2 } from 'lucide-react';
import { ListPage } from '../components/ListPage';
import { CategoryTree } from '../components/CategoryTree';
import { modalWidth } from '../lib/theme';
import { hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';

type Kind = 'categories' | 'brands' | 'units' | 'logistics-companies';
interface Row { id: string; name: string; code?: string; parentId?: string | null; sortOrder?: number; version: number; isActive?: boolean }
const titles = { categories: '商品分类', brands: '品牌管理', units: '单位管理', 'logistics-companies': '物流公司' };
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
        ...(kind === 'logistics-companies' && editing ? { isActive: values.isActive ?? editing.isActive } : {}),
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
      ...(kind === 'logistics-companies' ? [{ title: '状态', dataIndex: 'isActive', width: 100, render: (active: boolean) => active ? '启用' : '停用' }] : []),
      ...(writable ? [{ title: '操作', align: 'right' as const, width: 160, fixed: 'right' as const, render: (_: unknown, row: Row) => <RowActions ariaLabel={row.name} actions={[
        { key: 'edit', label: '编辑', icon: <Pencil size={15} />, onClick: () => edit(row) },
        ...(kind === 'logistics-companies' ? [{ key: 'toggle', label: row.isActive ? '停用' : '启用', icon: <Power size={15} />, onClick: async () => {
          try { await request(`/${kind}/${row.id}`, { method: 'PATCH', body: { expectedVersion: row.version, isActive: !row.isActive } }); data.reload(); message.success(row.isActive ? '物流公司已停用' : '物流公司已启用'); }
          catch (failure) { message.error(failureText(failure)); }
        } }] : []),
        ...(kind === 'logistics-companies' ? [] : [{ key: 'delete', label: '删除', icon: <Trash2 size={15} />, danger: true, confirm: { title: `删除“${row.name}”？` },
          onClick: async () => {
            try { await request(`/${kind}/${row.id}`, { method: 'DELETE', body: { expectedVersion: row.version } }); data.reload(); message.success('资料已删除'); }
            catch (failure) { message.error(failureText(failure)); }
          } }]),
      ]} /> }] : []),
    ]} />}
    <Modal title={`${editing ? '编辑' : '新增'}${titles[kind]}`} open={editing !== undefined} width={modalWidth.form} onOk={save} okText="保存" cancelText="取消"
      confirmLoading={saving} closable={!saving} maskClosable={!saving} keyboard={!saving} onCancel={() => { if (!saving) setEditing(undefined); }}>
      {error && <Alert type="error" showIcon title={error} />}
      <Form form={form} layout="vertical" disabled={saving} className="compact-form">
        <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: '请填写名称' }]}><Input maxLength={kind === 'categories' ? 160 : kind === 'units' ? 80 : 120} /></Form.Item>
        {kind === 'logistics-companies' && editing && <Form.Item name="isActive" label="状态"><Select options={[{ value: true, label: '启用' }, { value: false, label: '停用' }]} /></Form.Item>}
        {kind === 'categories' && <>
          <Form.Item name="parentId" label="上级分类"><Select allowClear showSearch placeholder="一级分类" optionFilterProp="label" options={data.rows.filter(row => !row.parentId && row.id !== editing?.id).map(row => ({ value: row.id, label: row.name }))} /></Form.Item>
          <Form.Item name="sortOrder" label="排序"><InputNumber precision={0} min={-2147483648} max={2147483647} style={{ width: '100%' }} /></Form.Item>
        </>}
      </Form>
    </Modal>
  </>;
}
import { RowActions } from '../components/RowActions';
