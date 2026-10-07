import { useRef, useState } from 'react';
import { Alert, App, Button, Cascader, Checkbox, Descriptions, Divider, Form, Input, Modal, Select, Tag, Tooltip, Tree } from 'antd';
import { Eye, Folders, Pencil } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { ListPage } from '../components/ListPage';
import { hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { composeAddress, regionOptions, splitAddress } from '../lib/regions';
import './Stores.css';

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
  region?: string[]; addressDetail: string; sameReceipt: boolean; receiptRegion?: string[]; receiptDetail?: string;
  receiptContactName?: string; receiptContactPhone?: string; status: string;
}
export default function Stores({ user }: { user: User }) {
  const data = useRows<Store>('/stores'); const groups = useRows<Group>('/store-groups');
  const [params, setParams] = useSearchParams(); const groupKey = params.get('group') || 'all';
  const selectedGroup = groups.rows.find(group => group.id === groupKey);
  const [groupSearch, setGroupSearch] = useState(''); const [selected, setSelected] = useState<string[]>([]);
  const [moving, setMoving] = useState(false); const [target, setTarget] = useState<string>('ungrouped');
  const [moveError, setMoveError] = useState(''); const [moveBusy, setMoveBusy] = useState(false); const moveLock = useRef(false);
  const chooseGroup = (key: string) => { setSelected([]); setParams(current => { const next = new URLSearchParams(current); if (key === 'all') next.delete('group'); else next.set('group', key); return next; }); };
  const scopedRows = data.rows.filter(row => groupKey === 'all' || (groupKey === 'ungrouped' ? !row.groupName : selectedGroup && row.groupName === selectedGroup.name));
  const groupChoices = [{ value: 'all', label: `全部门店 (${data.rows.length})` }, { value: 'ungrouped', label: `未分组 (${data.rows.filter(row => !row.groupName).length})` },
    ...groups.rows.map(group => ({ value: group.id, label: `${group.name} (${group.storeCount})${group.status === 'DISABLED' ? ' · 已停用' : ''}` }))];
  const [editing, setEditing] = useState<Store | null | undefined>(); const [detail, setDetail] = useState<Store>();
  const [form] = Form.useForm<StoreForm>(); const [saving, setSaving] = useState(false); const lock = useRef(false);
  const [error, setError] = useState(''); const { message } = App.useApp();
  const sameReceipt = Form.useWatch('sameReceipt', form); const writable = hasRole(user, 'ADMIN');
  const edit = (store: Store | null) => {
    const address = splitAddress(store?.address || ''); const receipt = splitAddress(store?.receiptAddress || '');
    form.resetFields(); form.setFieldsValue({ contactName: store?.contactName || '', contactPhone: store?.contactPhone || '', code: store?.code || '', name: store?.name || '', groupName: store ? store.groupName || undefined : selectedGroup?.status === 'ACTIVE' ? selectedGroup.name : undefined,
      storeType: store?.storeType || undefined, region: address.region, addressDetail: address.detail,
      sameReceipt: !Boolean(store?.receiptAddress || store?.receiptContactName || store?.receiptContactPhone), receiptRegion: receipt.region, receiptDetail: receipt.detail,
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
        receiptAddress: !values.sameReceipt ? composeAddress(values.receiptRegion, values.receiptDetail || '', Boolean(editing?.receiptAddress && !splitAddress(editing.receiptAddress).region)) : null,
        receiptContactName: !values.sameReceipt ? values.receiptContactName!.trim() : null,
        receiptContactPhone: !values.sameReceipt ? values.receiptContactPhone!.trim() : null,
        ...(editing ? { expectedVersion: editing.version, status: values.status } : {}),
      };
      await request(`/stores${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body });
      setEditing(undefined); data.reload(); groups.reload(); message.success('门店资料已保存');
    } catch (failure) { setError((failure as Error).message); }
    finally { setSaving(false); lock.current = false; }
  };
  const move = async () => {
    if (moveLock.current) return;
    const rows = selected.map(id => data.rows.find(row => row.id === id));
    const destination = groups.rows.find(group => group.id === target);
    if (!rows.length || rows.length > 100 || rows.some(row => !row) || (target !== 'ungrouped' && destination?.status !== 'ACTIVE')) { setMoveError('请选择1至100个门店及有效分组'); return; }
    moveLock.current = true; setMoveBusy(true); setMoveError('');
    try {
      await request('/stores/group-memberships', { method: 'POST', body: { groupName: target === 'ungrouped' ? null : destination!.name, stores: rows.map(row => ({ id: row!.id, expectedVersion: row!.version })) } });
      setMoving(false); setSelected([]); data.reload(); groups.reload(); message.success('门店分组已调整');
    } catch (failure) { setMoveError((failure as Error).message); }
    finally { moveLock.current = false; setMoveBusy(false); }
  };
  return <>
    <div className="store-workspace">
      <aside className="store-group-panel"><div className="store-group-heading"><strong>门店分组</strong><Tooltip title="维护分组"><Link to="/store-groups"><Button type="text" aria-label="维护分组" icon={<Folders size={16} />} /></Link></Tooltip></div>
        <Input.Search aria-label="搜索门店分组" placeholder="分组名称" allowClear value={groupSearch} onChange={event => setGroupSearch(event.target.value)} />
        <Tree blockNode selectedKeys={[groupKey]} onSelect={keys => { if (keys.length) chooseGroup(String(keys[0])); }} treeData={groupChoices.filter(choice => ['all', 'ungrouped'].includes(choice.value) || choice.label.toLowerCase().includes(groupSearch.trim().toLowerCase())).map(choice => ({ key: choice.value, title: <span className="store-group-label">{choice.label}</span> }))} />
      </aside>
      <div className="store-list-panel">
      <Select className="store-group-mobile" aria-label="选择门店分组" showSearch optionFilterProp="label" value={groupKey} options={groupChoices} onChange={chooseGroup} />
      {groups.error && <Alert type="warning" showIcon title={groups.error} action={<Button onClick={groups.reload}>重试</Button>} />}
      {groupKey !== 'all' && <div className="store-group-context"><Tag>{groupKey === 'ungrouped' ? '未分组' : selectedGroup?.name || '分组不存在'}</Tag>{selectedGroup?.status === 'DISABLED' && <Tag>已停用</Tag>}</div>}
    <ListPage key={groupKey} title="门店管理" {...data} rows={scopedRows} reload={() => { setSelected([]); data.reload(); groups.reload(); }} create={writable && (groupKey === 'all' || groupKey === 'ungrouped' || selectedGroup?.status === 'ACTIVE') ? () => edit(null) : undefined}
      rowSelection={writable ? { selectedRowKeys: selected, preserveSelectedRowKeys: true, onChange: keys => setSelected(keys.map(String)) } : undefined}
      tools={<>{writable && <Button icon={<Folders size={16} />} disabled={!selected.length || selected.length > 100} onClick={() => { setTarget('ungrouped'); setMoveError(''); setMoving(true); }}>调整分组{selected.length ? ` (${selected.length})` : ''}</Button>}<Link to="/store-groups"><Button icon={<Folders size={16} />}>分组管理</Button></Link></>}
      filters={[{ key: 'storeType', label: '门店类型', options: types }, { key: 'status', label: '门店状态', options: statusOptions }]}
      columns={[
        { title: '门店名称', dataIndex: 'name', width: 260, sorter: (a, b) => a.name.localeCompare(b.name, 'zh-CN'), render: value => <strong>{value}</strong> },
        { title: '门店联系人', dataIndex: 'contactName', width: 140, render: value => value || '-' },
        { title: '门店联系号码', dataIndex: 'contactPhone', width: 180, render: value => value || '-' },
        { title: '门店类型', dataIndex: 'storeType', width: 120, render: value => types.find(type => type.value === value)?.label || '-' },
        { title: '门店状态', dataIndex: 'status', width: 100, render: value => <Status value={value} /> },
        { title: '操作', width: 86, fixed: 'right', render: (_, row) => <div className="row-actions"><Tooltip title="查看门店"><Button type="text" aria-label={`查看${row.name}`} icon={<Eye size={16} />} onClick={() => setDetail(row)} /></Tooltip>{writable && <Tooltip title="编辑门店"><Button type="text" aria-label={`编辑${row.name}`} icon={<Pencil size={16} />} onClick={() => edit(row)} /></Tooltip>}</div> },
      ]} />
      </div>
    </div>
    <Modal title={`调整分组 · ${selected.length} 个门店`} open={moving} onOk={move} okText="确认调整" cancelText="取消" confirmLoading={moveBusy} closable={!moveBusy} maskClosable={!moveBusy} keyboard={!moveBusy} onCancel={() => { if (!moveBusy) setMoving(false); }}>
      {moveError && <Alert type="error" showIcon title={moveError} />}
      <Form layout="vertical" className="compact-form"><Form.Item label="目标分组"><Select aria-label="目标分组" showSearch optionFilterProp="label" disabled={moveBusy} value={target} onChange={setTarget} style={{ width: '100%' }} options={[{ value: 'ungrouped', label: '未分组' }, ...groups.rows.filter(group => group.status === 'ACTIVE').map(group => ({ value: group.id, label: group.name }))]} /></Form.Item></Form>
    </Modal>
    <Modal title={editing ? '编辑门店' : '新增门店'} open={editing !== undefined} onCancel={() => { if (!saving) setEditing(undefined); }} onOk={save}
      okText="保存" cancelText="取消" confirmLoading={saving} closable={!saving} maskClosable={!saving} keyboard={!saving} width={680}>
      {error && <Alert type="error" showIcon title={error} />}
      <Form form={form} layout="vertical" disabled={saving} className="compact-form">
        <div className="form-grid">
          <Form.Item name="name" label="门店名称" rules={required}><Input maxLength={200} /></Form.Item>
          <Form.Item name="groupName" label="所属分组"><Select allowClear placeholder="未分组" loading={groups.loading} options={groups.rows.filter(group => group.status === 'ACTIVE' || group.name === editing?.groupName).map(group => ({ value: group.name, label: group.name + (group.status === 'ACTIVE' ? '' : '（已停用）') }))} /></Form.Item>
          <Form.Item name="storeType" label="门店类型" rules={[{ required: true, message: '请选择门店类型' }]}><Select options={types} /></Form.Item>
          <Form.Item name="contactName" label="联系人" rules={required}><Input maxLength={120} /></Form.Item>
          <Form.Item name="contactPhone" label="联系电话" rules={required}><Input maxLength={32} /></Form.Item>
          <Form.Item name="region" label="门店省市区" className="full-width" rules={[{ required: !editing?.address || Boolean(splitAddress(editing.address).region), message: '请选择省市区' }]}><Cascader options={regionOptions} placeholder="请选择省 / 市 / 区" showSearch /></Form.Item>
          <Form.Item name="addressDetail" label="门店详细地址" className="full-width" rules={required}><Input maxLength={300} /></Form.Item>
          {editing && <Form.Item name="status" label="状态"><Select options={statusOptions} /></Form.Item>}
          <div className="full-width"><Divider titlePlacement="start" style={{ margin: '4px 0 12px', fontSize: 13 }}>收货信息</Divider></div>
          <Form.Item name="sameReceipt" valuePropName="checked" className="full-width"><Checkbox>同门店信息</Checkbox></Form.Item>
          {sameReceipt && <Form.Item noStyle shouldUpdate>{() => {
            let options = regionOptions;
            const regionNames = (form.getFieldValue('region') || []).map((code: string) => {
              const option = options.find(item => item.value === code); options = option?.children || []; return option?.label;
            });
            return <Descriptions className="full-width" size="small" column={1} items={[
            { key: 'address', label: '收货地址', children: [...regionNames, form.getFieldValue('addressDetail')].filter(Boolean).join(' / ') || '-' },
            { key: 'contact', label: '收货人', children: form.getFieldValue('contactName') || '-' },
            { key: 'phone', label: '收货电话', children: form.getFieldValue('contactPhone') || '-' },
          ]} />; }}</Form.Item>}
          {sameReceipt === false && <>
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
