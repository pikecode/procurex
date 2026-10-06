import { useRef, useState } from 'react';
import { Alert, App, Button, Cascader, Descriptions, Form, Input, Modal, Select, Switch, Tag, Tooltip } from 'antd';
import { Eye, Folders, Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ListPage } from '../components/ListPage';
import { hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { composeAddress, regionOptions, splitAddress } from '../lib/regions';

export interface Store {
  id: string; code: string; name: string; groupName: string | null; storeType: string | null; contactName: string | null; contactPhone: string | null;
  address: string | null; receiptAddress: string | null; receiptContactName: string | null; receiptContactPhone: string | null;
  status: string; version: number;
}
export interface Group { id: string; name: string; status: string; version: number; storeCount: number }
const types = [{ value: 'DIRECT', label: '直营店' }, { value: 'FRANCHISE', label: '加盟店' }, { value: 'JOINT', label: '联营店' }];
export const statusOptions = [{ value: 'ACTIVE', label: '启用' }, { value: 'DISABLED', label: '停用' }];
export const Status = ({ value }: { value: string }) => <Tag color={value === 'ACTIVE' ? 'success' : 'default'}>{value === 'ACTIVE' ? '启用' : '停用'}</Tag>;
const required = [{ required: true, whitespace: true, message: '请填写此项' }];
interface StoreForm {
  code: string; name: string; groupName?: string; storeType: string; contactName: string; contactPhone: string;
  region?: string[]; addressDetail: string; independent: boolean; receiptRegion?: string[]; receiptDetail?: string;
  receiptContactName?: string; receiptContactPhone?: string; status: string;
}
export default function Stores({ user }: { user: User }) {
  const data = useRows<Store>('/stores'); const groups = useRows<Group>('/store-groups');
  const [editing, setEditing] = useState<Store | null | undefined>(); const [detail, setDetail] = useState<Store>();
  const [form] = Form.useForm<StoreForm>(); const [saving, setSaving] = useState(false); const lock = useRef(false);
  const [error, setError] = useState(''); const { message } = App.useApp();
  const independent = Form.useWatch('independent', form); const writable = hasRole(user, 'ADMIN');
  const edit = (store: Store | null) => {
    const address = splitAddress(store?.address || ''); const receipt = splitAddress(store?.receiptAddress || '');
    form.resetFields(); form.setFieldsValue({ contactName: store?.contactName || '', contactPhone: store?.contactPhone || '', code: store?.code || '', name: store?.name || '', groupName: store?.groupName || undefined,
      storeType: store?.storeType || undefined, region: address.region, addressDetail: address.detail,
      independent: Boolean(store?.receiptAddress), receiptRegion: receipt.region, receiptDetail: receipt.detail,
      receiptContactName: store?.receiptContactName || '', receiptContactPhone: store?.receiptContactPhone || '', status: store?.status || 'ACTIVE' });
    setError(''); setEditing(store);
  };
  const save = async () => {
    if (lock.current) return;
    const values = await form.validateFields().catch(() => null); if (!values) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const body = {
        name: values.name.trim(), groupName: values.groupName || null, storeType: values.storeType,
        contactName: values.contactName.trim(), contactPhone: values.contactPhone.trim(),
        address: composeAddress(values.region, values.addressDetail, Boolean(editing?.address && !splitAddress(editing.address).region)),
        receiptAddress: values.independent ? composeAddress(values.receiptRegion, values.receiptDetail || '', Boolean(editing?.receiptAddress && !splitAddress(editing.receiptAddress).region)) : null,
        receiptContactName: values.independent ? values.receiptContactName!.trim() : null,
        receiptContactPhone: values.independent ? values.receiptContactPhone!.trim() : null,
        ...(editing ? { expectedVersion: editing.version, status: values.status } : { code: values.code.trim() }),
      };
      await request(`/stores${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body });
      setEditing(undefined); data.reload(); message.success('门店资料已保存');
    } catch (failure) { setError((failure as Error).message); }
    finally { setSaving(false); lock.current = false; }
  };
  return <>
    <ListPage title="门店管理" {...data} create={writable ? () => edit(null) : undefined}
      tools={<Link to="/store-groups"><Button icon={<Folders size={16} />}>分组管理</Button></Link>}
      filters={[{ key: 'storeType', label: '门店类型', options: types }, { key: 'groupName', label: '所属分组', options: [...new Set(data.rows.map(row => row.groupName).filter(Boolean))].map(name => ({ value: name!, label: name! })) }, { key: 'status', label: '门店状态', options: statusOptions }]}
      columns={[
        { title: '门店 / 编号', dataIndex: 'name', width: 220, sorter: (a, b) => a.name.localeCompare(b.name, 'zh-CN'), render: (_, row) => <><strong>{row.name}</strong><small>{row.code}</small></> },
        { title: '分组 / 类型', width: 150, render: (_, row) => <>{row.groupName || '未分组'}<small>{types.find(type => type.value === row.storeType)?.label || '-'}</small></> },
        { title: '联系人', dataIndex: 'contactName', width: 100, render: value => value || '-' }, { title: '联系电话', dataIndex: 'contactPhone', width: 140, render: value => value || '-' },
        { title: '收货地址', width: 260, render: (_, row) => <>{row.receiptAddress || row.address || '-'}<small>{row.receiptContactName || row.contactName || '-'} · {row.receiptContactPhone || row.contactPhone || '-'}</small></> },
        { title: '状态', dataIndex: 'status', width: 80, render: value => <Status value={value} /> },
        { title: '操作', width: 86, fixed: 'right', render: (_, row) => <div className="row-actions"><Tooltip title="查看门店"><Button type="text" aria-label={`查看${row.name}`} icon={<Eye size={16} />} onClick={() => setDetail(row)} /></Tooltip>{writable && <Tooltip title="编辑门店"><Button type="text" aria-label={`编辑${row.name}`} icon={<Pencil size={16} />} onClick={() => edit(row)} /></Tooltip>}</div> },
      ]} />
    <Modal title={editing ? '编辑门店' : '新增门店'} open={editing !== undefined} onCancel={() => { if (!saving) setEditing(undefined); }} onOk={save}
      okText="保存" cancelText="取消" confirmLoading={saving} closable={!saving} maskClosable={!saving} keyboard={!saving} width={680}>
      {error && <Alert type="error" showIcon title={error} />}
      <Form form={form} layout="vertical" disabled={saving} className="compact-form">
        <div className="form-grid">
          <Form.Item name="code" label="门店编号" rules={required}><Input maxLength={80} disabled={Boolean(editing)} /></Form.Item>
          <Form.Item name="name" label="门店名称" rules={required}><Input maxLength={200} /></Form.Item>
          <Form.Item name="groupName" label="所属分组"><Select allowClear placeholder="未分组" loading={groups.loading} options={groups.rows.filter(group => group.status === 'ACTIVE' || group.name === editing?.groupName).map(group => ({ value: group.name, label: group.name + (group.status === 'ACTIVE' ? '' : '（已停用）') }))} /></Form.Item>
          <Form.Item name="storeType" label="门店类型" rules={[{ required: true, message: '请选择门店类型' }]}><Select options={types} /></Form.Item>
          <Form.Item name="contactName" label="联系人" rules={required}><Input maxLength={120} /></Form.Item>
          <Form.Item name="contactPhone" label="联系电话" rules={required}><Input maxLength={32} /></Form.Item>
          <Form.Item name="region" label="门店省市区" className="full-width" rules={[{ required: !editing?.address || Boolean(splitAddress(editing.address).region), message: '请选择省市区' }]}><Cascader options={regionOptions} placeholder="请选择省 / 市 / 区" showSearch /></Form.Item>
          <Form.Item name="addressDetail" label="门店详细地址" className="full-width" rules={required}><Input maxLength={300} /></Form.Item>
          <Form.Item name="independent" label="独立收货信息" valuePropName="checked"><Switch /></Form.Item>
          {editing && <Form.Item name="status" label="状态"><Select options={statusOptions} /></Form.Item>}
          {independent && <>
            <Form.Item name="receiptRegion" label="收货省市区" className="full-width" rules={[{ required: !editing?.receiptAddress || Boolean(splitAddress(editing.receiptAddress).region), message: '请选择省市区' }]}><Cascader options={regionOptions} placeholder="请选择省 / 市 / 区" showSearch /></Form.Item>
            <Form.Item name="receiptDetail" label="收货详细地址" className="full-width" rules={required}><Input maxLength={300} /></Form.Item>
            <Form.Item name="receiptContactName" label="收货人" rules={required}><Input maxLength={120} /></Form.Item>
            <Form.Item name="receiptContactPhone" label="收货电话" rules={required}><Input maxLength={32} /></Form.Item>
          </>}
        </div>
        {groups.error && <Alert type="warning" title={groups.error} action={<Button onClick={groups.reload}>重试</Button>} />}
      </Form>
    </Modal>
    <Modal title="门店资料" open={Boolean(detail)} onCancel={() => setDetail(undefined)} footer={<Button onClick={() => setDetail(undefined)}>关闭</Button>}>
      {detail && <Descriptions size="small" column={1} items={[
        { key: 'name', label: '门店名称', children: detail.name }, { key: 'code', label: '编号', children: detail.code },
        { key: 'group', label: '分组', children: detail.groupName || '未分组' }, { key: 'type', label: '类型', children: types.find(type => type.value === detail.storeType)?.label },
        { key: 'contact', label: '联系人', children: `${detail.contactName} · ${detail.contactPhone}` },
        { key: 'address', label: '门店地址', children: detail.address }, { key: 'receipt', label: '收货地址', children: detail.receiptAddress || detail.address },
        { key: 'receiver', label: '收货人', children: `${detail.receiptContactName || detail.contactName} · ${detail.receiptContactPhone || detail.contactPhone}` },
        { key: 'status', label: '状态', children: <Status value={detail.status} /> },
      ]} />}
    </Modal>
  </>;
}
