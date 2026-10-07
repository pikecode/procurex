import { useRef, useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Popconfirm, Select, Tooltip } from 'antd';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ListPage } from '../components/ListPage';
import { hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { Status, statusOptions, type Group } from './Stores';

interface CollectionAccount { id: string; name: string; bankName: string; accountName: string; accountNo: string; status: string; version: number }
export default function Directories({ user, kind }: { user: User; kind: 'groups' | 'accounts' }) {
  const groups = kind === 'groups'; const path = groups ? '/store-groups' : '/collection-accounts';
  const data = useRows<Group & CollectionAccount>(path);
  const [editing, setEditing] = useState<(Group & CollectionAccount) | null | undefined>();
  const [saving, setSaving] = useState(false); const lock = useRef(false); const [error, setError] = useState('');
  const [form] = Form.useForm(); const { message } = App.useApp();
  const writable = hasRole(user, 'ADMIN', ...(groups ? [] : ['HQ_FINANCE']));
  const edit = (item: (Group & CollectionAccount) | null) => { form.resetFields(); form.setFieldsValue(item || { status: 'ACTIVE' }); setError(''); setEditing(item); };
  const save = async () => {
    if (lock.current) return;
    const values = await form.validateFields().catch(() => null); if (!values) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const body = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
      await request(`${path}${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: { ...body, ...(editing ? { expectedVersion: editing.version } : {}) } });
      setEditing(undefined); data.reload(); message.success('资料已保存');
    } catch (failure) { setError((failure as Error).message); }
    finally { setSaving(false); lock.current = false; }
  };
  const remove = async (item: Group) => {
    try { await request(`${path}/${item.id}`, { method: 'DELETE', body: { expectedVersion: item.version } }); data.reload(); message.success('分组已删除'); }
    catch (failure) { message.error((failure as Error).message); }
  };
  const title = groups ? '门店分组' : '收款账户';
  return <>
    <ListPage title={title} {...data} create={writable ? () => edit(null) : undefined} filters={[{ key: 'status', label: '状态', options: statusOptions }]}
      tools={groups ? <Link to="/stores"><Button icon={<ArrowLeft size={16} />}>门店管理</Button></Link> : undefined}
      columns={[
        { title: groups ? '分组名称' : '账户名称', dataIndex: 'name', width: 220 },
        ...(groups ? [{ title: '门店数量', dataIndex: 'storeCount', width: 130, render: (_: unknown, item: Group) => <Link aria-label={`查看${item.name}的门店`} to={`/stores?group=${encodeURIComponent(item.id)}`}>{item.storeCount}</Link> }] : [
          { title: '开户银行', dataIndex: 'bankName', width: 180 }, { title: '开户户名', dataIndex: 'accountName', width: 200 }, { title: '账号', dataIndex: 'accountNo', width: 230 },
        ]),
        { title: '状态', dataIndex: 'status', width: 90, render: value => <Status value={value} /> },
        ...(writable ? [{ title: '操作', width: 90, fixed: 'right' as const, render: (_: unknown, item: Group & CollectionAccount) => <div className="row-actions">
          <Tooltip title="编辑"><Button type="text" aria-label={`编辑${item.name}`} icon={<Pencil size={16} />} onClick={() => edit(item)} /></Tooltip>
          {groups && <Popconfirm title={`删除分组“${item.name}”？`} onConfirm={() => remove(item)} disabled={item.storeCount > 0}>
            <Tooltip title={item.storeCount ? '分组仍有关联门店' : '删除分组'}><Button type="text" danger disabled={item.storeCount > 0} aria-label={`删除${item.name}`} icon={<Trash2 size={16} />} /></Tooltip>
          </Popconfirm>}
        </div> }] : []),
      ]} />
    <Modal title={`${editing ? '编辑' : '新增'}${groups ? '分组' : '收款账户'}`} open={editing !== undefined} onCancel={() => { if (!saving) setEditing(undefined); }} onOk={save}
      okText="保存" cancelText="取消" confirmLoading={saving} closable={!saving} maskClosable={!saving} keyboard={!saving} width={groups ? 440 : 600}>
      {error && <Alert type="error" showIcon title={error} />}
      <Form form={form} layout="vertical" disabled={saving} className="compact-form">
        <div className={groups ? '' : 'form-grid'}>
          <Form.Item name="name" label={groups ? '分组名称' : '账户名称'} rules={[{ required: true, whitespace: true, message: '请填写名称' }]}><Input maxLength={120} /></Form.Item>
          {!groups && <>
            <Form.Item name="bankName" label="开户银行" rules={[{ required: true, whitespace: true, message: '请填写开户银行' }]}><Input maxLength={120} /></Form.Item>
            <Form.Item name="accountName" label="开户户名" rules={[{ required: true, whitespace: true, message: '请填写开户户名' }]}><Input maxLength={120} /></Form.Item>
            <Form.Item name="accountNo" label="账号" rules={[{ required: true, whitespace: true, message: '请填写账号' }]}><Input maxLength={80} /></Form.Item>
          </>}
          {(!groups || editing) && <Form.Item name="status" label="状态"><Select options={statusOptions} /></Form.Item>}
        </div>
      </Form>
    </Modal>
  </>;
}
