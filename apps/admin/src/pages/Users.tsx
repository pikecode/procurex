import { useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Select, Table, Tag, Tooltip } from 'antd';
import { History, KeyRound, LogOut, Pencil } from 'lucide-react';
import { getSession, request } from '../lib/api';
import { useRows } from '../lib/useRows';
import { ListPage } from '../components/ListPage';

type Row = { id: string; name: string; username: string; displayName: string; status: string; version: number; roles: string[]; roleFilter?: string; scopeFilter?: string; createdAt: string; lastLoginAt: string | null; scope: { type: string; storeId?: string; supplierId?: string } | null };
type AccountSnapshot = { displayName: string; status: string; roles: string[]; scope: { type: string; storeId?: string | null; supplierId?: string | null } | null };
type UserAudit = { id: string; action: string; actorName: string; createdAt: string; before?: AccountSnapshot; after?: AccountSnapshot };
function snapshotText(value?: AccountSnapshot) {
  if (!value?.roles) return '未记录详细变更';
  const scope = value.scope;
  return `${value.displayName} · ${value.status === 'ACTIVE' ? '启用' : '停用'} · ${value.roles.map(code => roles.find(role => role.value === code)?.label || code).join('、')} · ${scope?.type === 'STORE' ? `门店 ${scope.storeId}` : scope?.type === 'SUPPLIER' ? `供应商 ${scope.supplierId}` : '公司'}`;
}
function AccountHistory({ row, close }: { row: Row; close: () => void }) {
  const data = useRows<UserAudit>(`/audit-logs?entityType=User&entityId=${row.id}&limit=100`);
  const names: Record<string, string> = { 'user.create': '创建账号', 'user.update': '修改账号', 'user.password-reset': '重置密码', 'user.password-change': '修改密码', 'user.sessions-revoke': '强制退出登录' };
  return <Modal title={`操作记录 · ${row.username}`} open onCancel={close} footer={null} width={720}>
    {data.error && <Alert type="error" title={data.error} action={<Button onClick={data.reload}>重试</Button>} />}
    <Table<UserAudit> size="small" rowKey="id" loading={data.loading} dataSource={data.rows} expandable={{ rowExpandable: entry => !!entry.before?.roles, expandedRowRender: entry => <div><p>修改前：{snapshotText(entry.before)}</p><p>修改后：{snapshotText(entry.after)}</p></div> }} columns={[{ title: '操作', render: (_, entry) => names[entry.action] || entry.action }, { title: '操作人', dataIndex: 'actorName' }, { title: '时间', render: (_, entry) => new Date(entry.createdAt).toLocaleString('zh-CN', { hour12: false }) }]} pagination={{ pageSize: 10 }} scroll={{ x: 600 }} />
  </Modal>;
}
type Entity = { id: string; name: string; status: string };
const roles = [{ value: 'ADMIN', label: '管理员' }, { value: 'PURCHASER', label: '采购' }, { value: 'HQ_FINANCE', label: '公司财务' }, { value: 'STORE', label: '门店' }, { value: 'STORE_FINANCE', label: '门店财务' }, { value: 'SUPPLIER', label: '供应商' }];
export default function Users() {
  const data = useRows<Row>('/users'); const stores = useRows<Entity>('/stores'); const suppliers = useRows<Entity>('/suppliers');
  const [form] = Form.useForm(); const [passwordForm] = Form.useForm(); const role = Form.useWatch('role', form);
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<Row | null>(null); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const { message } = App.useApp();
  const [passwordUser, setPasswordUser] = useState<Row | null>(null); const [passwordSaving, setPasswordSaving] = useState(false); const [passwordError, setPasswordError] = useState('');
  const [historyUser, setHistoryUser] = useState<Row | null>(null);
  const currentUserId = getSession()?.user.id;
  const { modal } = App.useApp();
  const edit = (row: Row | null) => { form.resetFields(); form.setFieldsValue(row ? { displayName: row.displayName, status: row.status, role: row.roles.length === 1 ? row.roles[0] : undefined, storeId: row.scope?.storeId, supplierId: row.scope?.supplierId } : { role: 'STORE' }); setEditing(row); setError(''); setOpen(true); };
  const scope = (value: { role: string; storeId?: string; supplierId?: string }) => ['STORE', 'STORE_FINANCE'].includes(value.role) ? { type: 'STORE', storeId: value.storeId } : value.role === 'SUPPLIER' ? { type: 'SUPPLIER', supplierId: value.supplierId } : { type: 'COMPANY' };
  const resetPassword = async () => {
    if (!passwordUser || passwordSaving) return;
    const value = await passwordForm.validateFields().catch(() => null); if (!value) return;
    setPasswordSaving(true); setPasswordError('');
    try { await request(`/users/${passwordUser.id}/password`, { method: 'POST', body: { password: value.password, expectedVersion: passwordUser.version } }); setPasswordUser(null); passwordForm.resetFields(); data.reload(); message.success('密码已重置，旧会话已退出'); }
    catch (failure) { setPasswordError((failure as Error).message); } finally { setPasswordSaving(false); }
  };
  const revoke = (row: Row) => modal.confirm({ title: `强制退出 ${row.username} 的登录？`, content: '该账号在所有设备上的登录将失效，下次访问需要重新登录。账号不会停用，密码不变，仍可重新登录。', okText: '强制退出登录', cancelText: '取消', onOk: async () => { try { await request(`/users/${row.id}/revoke-sessions`, { method: 'POST' }); data.reload(); message.success('已强制退出该账号的全部登录'); } catch (failure) { message.error((failure as Error).message); throw failure; } } });
  const save = async () => {
    if (saving) return;
    const value = await form.validateFields().catch(() => null); if (!value) return;
    setSaving(true); setError('');
    try {
      const permissionChanged = editing && value.role && (editing.roles.length !== 1 || editing.roles[0] !== value.role || (editing.scope?.storeId ?? undefined) !== (value.role === 'STORE' || value.role === 'STORE_FINANCE' ? value.storeId : undefined) || (editing.scope?.supplierId ?? undefined) !== (value.role === 'SUPPLIER' ? value.supplierId : undefined));
      const body = editing ? { displayName: value.displayName.trim(), status: value.status, expectedVersion: editing.version, ...(permissionChanged ? { role: value.role, scope: scope(value) } : {}) } : { username: value.username.trim(), displayName: value.displayName.trim(), password: value.password, role: value.role,
        ...(['STORE', 'STORE_FINANCE'].includes(value.role) ? { storeId: value.storeId } : value.role === 'SUPPLIER' ? { supplierId: value.supplierId } : {}) };
      await request(editing ? `/users/${editing.id}` : '/users', { method: editing ? 'PATCH' : 'POST', body });
      setOpen(false); form.resetFields(); data.reload(); message.success('用户已保存');
    } catch (failure) { setError((failure as Error).message); } finally { setSaving(false); }
  };
  return <><ListPage<Row> title="用户管理" {...data} searchPlaceholder="账号、姓名" rows={data.rows.map(row => ({ ...row, name: `${row.username} ${row.displayName}`, roleFilter: row.roles.join(','), scopeFilter: row.scope?.storeId || row.scope?.supplierId || 'COMPANY' }))} filters={[
    { key: 'status', label: '状态', options: [{ value: 'ACTIVE', label: '启用' }, { value: 'DISABLED', label: '停用' }] },
    { key: 'roleFilter', label: '角色', options: [...roles, ...data.rows.filter(row => row.roles.length > 1).map(row => ({ value: row.roles.join(','), label: row.roles.map(code => roles.find(item => item.value === code)?.label || code).join('、') })).filter((item, index, list) => list.findIndex(other => other.value === item.value) === index)] },
    { key: 'scopeFilter', label: '所属', options: [{ value: 'COMPANY', label: '公司' }, ...stores.rows.map(row => ({ value: row.id, label: row.name })), ...suppliers.rows.map(row => ({ value: row.id, label: row.name }))] },
  ]} create={() => edit(null)} columns={[
    { title: '账号', dataIndex: 'username', width: 180 }, { title: '姓名', dataIndex: 'displayName', width: 160 },
    { title: '角色', render: (_, row) => row.roles.map(code => roles.find(item => item.value === code)?.label || code).join('、') },
    { title: '所属', render: (_, row) => row.scope?.type === 'STORE' ? stores.rows.find(item => item.id === row.scope?.storeId)?.name || '门店' : row.scope?.type === 'SUPPLIER' ? suppliers.rows.find(item => item.id === row.scope?.supplierId)?.name || '供应商' : '公司' },
    { title: '状态', width: 90, render: (_, row) => <Tag color={row.status === 'ACTIVE' ? 'green' : undefined}>{row.status === 'ACTIVE' ? '启用' : '停用'}</Tag> },
    { title: '创建时间', width: 160, render: (_, row) => new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false }) },
    { title: '最近登录', width: 160, render: (_, row) => row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString('zh-CN', { hour12: false }) : '未记录' },
    { title: '操作', width: 160, fixed: 'right', render: (_, row) => <div className="actions"><Tooltip title="编辑用户"><Button type="text" aria-label={`编辑${row.username}`} icon={<Pencil size={16} />} onClick={() => edit(row)} /></Tooltip><Tooltip title="重置密码"><Button type="text" aria-label={`重置${row.username}密码`} icon={<KeyRound size={16} />} onClick={() => { setPasswordUser(row); setPasswordError(''); passwordForm.resetFields(); }} /></Tooltip><Tooltip title="强制退出登录"><Button type="text" aria-label={`强制退出${row.username}的登录`} icon={<LogOut size={16} />} onClick={() => revoke(row)} /></Tooltip><Tooltip title="操作记录"><Button type="text" aria-label={`查看${row.username}操作记录`} icon={<History size={16} />} onClick={() => setHistoryUser(row)} /></Tooltip></div> },
  ]} /><Modal title={editing ? '编辑用户' : '新增用户'} open={open} width={560} onCancel={() => !saving && setOpen(false)} onOk={save} confirmLoading={saving} okText="保存" cancelText="取消" maskClosable={!saving}>
    {error && <Alert type="error" title={error} showIcon />}
    {editing && <Alert type="info" title={`账号：${editing.username} · 当前角色：${editing.roles.map(code => roles.find(item => item.value === code)?.label || code).join('、')}`} />}
    {editing && <Alert type="warning" title="调整角色或所属、停用账号后，旧登录会话将退出。" />}
    <Form form={form} layout="vertical" className="compact-form" disabled={saving}><div className="form-grid">
      {!editing && <Form.Item name="username" label="账号" rules={[{ required: true }, { pattern: /^[a-zA-Z0-9_\-.]{3,80}$/, message: '请输入3至80位字母、数字、下划线、点或短横线' }]}><Input autoComplete="off" /></Form.Item>}
      <Form.Item name="displayName" label="姓名" rules={[{ required: true, whitespace: true }]}><Input maxLength={120} /></Form.Item>
      {!editing && <><Form.Item name="password" label="密码" rules={[{ required: true }, { min: 8, max: 128, message: '密码需为8至128位' }]}><Input.Password autoComplete="new-password" /></Form.Item>
      </>}
      <Form.Item name="role" label="角色" rules={[{ required: !editing || editing.roles.length === 1 }]}><Select allowClear={!!editing && editing.roles.length > 1} placeholder={editing?.roles.length && editing.roles.length > 1 ? '保留当前多角色' : '选择角色'} disabled={editing?.id === currentUserId} options={roles} /></Form.Item>
      {['STORE', 'STORE_FINANCE'].includes(role) && <Form.Item name="storeId" label="所属门店" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" loading={stores.loading} options={stores.rows.filter(item => item.status === 'ACTIVE' || item.id === editing?.scope?.storeId).map(item => ({ value: item.id, label: item.name }))} /></Form.Item>}
      {role === 'SUPPLIER' && <Form.Item name="supplierId" label="所属供应商" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" loading={suppliers.loading} options={suppliers.rows.filter(item => item.status === 'ACTIVE' || item.id === editing?.scope?.supplierId).map(item => ({ value: item.id, label: item.name }))} /></Form.Item>}
      {editing && <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select disabled={editing.id === currentUserId} options={[{ value: 'ACTIVE', label: '启用' }, { value: 'DISABLED', label: '停用' }]} /></Form.Item>}
    </div></Form>
  </Modal><Modal title={`重置密码 · ${passwordUser?.username || ''}`} open={!!passwordUser} onCancel={() => !passwordSaving && setPasswordUser(null)} onOk={resetPassword} confirmLoading={passwordSaving} okText="确认重置" cancelText="取消" maskClosable={false}>
    <Alert type="warning" showIcon title="重置后，该账号的全部登录会话将退出。" />{passwordError && <Alert type="error" title={passwordError} showIcon />}
    <Form form={passwordForm} layout="vertical" disabled={passwordSaving}><Form.Item name="password" label="新密码" rules={[{ required: true }, { min: 8, max: 128, message: '密码需为8至128位' }]}><Input.Password autoComplete="new-password" /></Form.Item><Form.Item name="confirmPassword" label="确认新密码" dependencies={['password']} rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, value) => value === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error('两次密码不一致')) })]}><Input.Password autoComplete="new-password" /></Form.Item></Form>
  </Modal>{historyUser && <AccountHistory row={historyUser} close={() => setHistoryUser(null)} />}</>;
}
