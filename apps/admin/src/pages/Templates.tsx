import { useRef, useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Select, Spin, Table, Tooltip } from 'antd';
import { Archive, Copy, ListOrdered, Pencil, Settings2, Store } from 'lucide-react';
import { TemplateProducts } from '../components/TemplateProducts';
import { ListPage } from '../components/ListPage';
import { request } from '../lib/api';
import { useRows } from '../lib/useRows';
import { cycleOptions, positiveIntegerRule, settlementOptions, type CatalogProduct, type CatalogSupplier, type Named, type Template, type TemplateDetail, type TemplateItem } from '../lib/catalogTypes';

type Mode = 'metadata' | 'copy' | 'stores' | 'items' | 'settings' | 'archive';
const titles: Record<Mode, string> = { metadata: '编辑模板', copy: '复制模板', stores: '绑定门店', items: '商品及供货优先级', settings: '支付方式管理', archive: '归档模板' };
export default function Templates() {
  const data = useRows<Template>('/templates'); const stores = useRows<Named>('/stores'); const products = useRows<CatalogProduct>('/products'); const suppliers = useRows<CatalogSupplier>('/suppliers');
  const categories = useRows<Named>('/categories');
  const units = useRows<Named>('/units');
  const [mode, setMode] = useState<Mode>('metadata'); const [open, setOpen] = useState(false); const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const generation = useRef(0); const lock = useRef(false); const initialItems = useRef('[]'); const initialSettings = useRef('[]'); const [form] = Form.useForm(); const { message, modal } = App.useApp();
  const referencesError = stores.error || products.error || suppliers.error || categories.error || units.error;
  const initialize = (next: Mode, value: TemplateDetail | null) => {
    form.resetFields(); setDetail(value);
    if (!value) return;
    if (next === 'copy') form.setFieldsValue({ name: `${value.name.slice(0, 196)}副本`, tag: value.tag, remark: value.remark });
    else if (next === 'settings') {
      const ids = [...new Set(value.items.flatMap(item => item.suppliers.map(link => link.supplierId)))];
      form.setFieldsValue({ settings: ids.map(supplierId => {
        const setting = value.settings.find(row => row.supplierId === supplierId); const supplier = suppliers.rows.find(row => row.id === supplierId);
        return { supplierId, settlementMode: setting?.settlementMode || supplier?.defaultSettlementMode, settlementCycle: setting?.settlementCycle || supplier?.defaultSettlementCycle };
      }) });
      initialSettings.current = JSON.stringify(form.getFieldValue('settings') || []);
    }
    else form.setFieldsValue({ ...value, items: value.items.map(item => ({ ...item, suppliers: item.suppliers.map(link => ({ supplierId: link.supplierId, priority: link.priority })) })) });
    initialItems.current = JSON.stringify(form.getFieldValue('items') || []);
  };
  const edit = async (next: Mode, row?: Template) => {
    const sequence = ++generation.current; setSourceId(row?.id || null); setMode(next); setOpen(true); setError(''); initialize(next, null); setLoading(Boolean(row));
    if (!row) return;
    try { const value = await request<TemplateDetail>(`/templates/${row.id}`); if (sequence === generation.current) initialize(next, value); }
    catch (failure) { if (sequence === generation.current) setError((failure as Error).message); }
    finally { if (sequence === generation.current) setLoading(false); }
  };
  const close = () => {
    if (saving) return;
    const finish = () => { generation.current++; setOpen(false); };
    if ((mode === 'items' && JSON.stringify(form.getFieldValue('items') || []) !== initialItems.current) || (mode === 'settings' && JSON.stringify(form.getFieldValue('settings') || []) !== initialSettings.current)) modal.confirm({ title: '放弃未保存的修改？', okText: '放弃修改', cancelText: '继续编辑', onOk: finish });
    else finish();
  };
  const save = async () => {
    if (lock.current || loading || referencesError || (sourceId && !detail)) return;
    const valid = await form.validateFields().then(() => true).catch(() => false); if (!valid) return;
    const values = form.getFieldsValue(true);
    lock.current = true; setSaving(true); setError('');
    try {
      let path = '/templates'; let method = 'POST'; let body: unknown;
      const version = { expectedVersion: detail?.version };
      if (mode === 'metadata' || mode === 'copy') {
        body = { name: values.name.trim(), tag: values.tag.trim(), remark: values.remark?.trim() || null,
          ...(detail ? version : {}) };
        if (detail) { path += `/${detail.id}${mode === 'copy' ? '/copy' : ''}`; method = mode === 'copy' ? 'POST' : 'PATCH'; }
      } else {
        if (!detail) throw new Error('模板读取失败，请关闭后重试'); path += `/${detail.id}`;
        if (mode === 'stores') { path += '/stores'; method = 'PUT'; body = { ...version, storeIds: values.storeIds || [] }; }
        else if (mode === 'items') {
          const items: TemplateItem[] = (values.items || []).map((item: TemplateItem) => ({ productId: item.productId, sortOrder: item.sortOrder ?? 0, isEnabled: item.isEnabled,
            minOrderQty: item.minOrderQty || null, orderMultiple: item.orderMultiple || null, suppliers: item.suppliers.map(link => ({ supplierId: link.supplierId, priority: link.priority })) }));
          if (new Set(items.map(item => item.productId)).size !== items.length || items.some(item => new Set(item.suppliers.map(link => link.supplierId)).size !== item.suppliers.length)) throw new Error('商品和每个商品的供货方不能重复');
          if (items.some(item => !item.suppliers.length)) throw new Error('每个商品至少选择一个供货方');
          for (const item of items) {
            if (!item.productId || !Number.isInteger(item.sortOrder) || item.sortOrder < 0 || item.sortOrder > 2147483647 || item.suppliers.some(link => !link.supplierId || !Number.isInteger(link.priority) || link.priority < 0 || link.priority > 2147483647)) throw new Error('请检查所有商品的供货方、排序和优先级');
            await positiveIntegerRule('起订量', true).validator(undefined, item.minOrderQty);
            await positiveIntegerRule('订货倍数', true).validator(undefined, item.orderMultiple);
          }
          path += '/items'; method = 'PUT'; body = { ...version, items };
        } else if (mode === 'settings') {
          path += '/supplier-settings'; method = 'PUT';
          body = { ...version, settings: values.settings || [] };
        } else { path += '/archive'; body = version; }
      }
      await request(path, { method, body }); setOpen(false); data.reload(); message.success('模板已保存');
    } catch (failure) { setError((failure as Error).message); } finally { lock.current = false; setSaving(false); }
  };
  const occupied = new Set(data.rows.filter(row => row.id !== detail?.id && !row.isArchived).flatMap(row => row.storeIds));
  const actions = [{ mode: 'metadata', icon: Pencil }, { mode: 'copy', icon: Copy }, { mode: 'stores', icon: Store }, { mode: 'items', icon: ListOrdered }, { mode: 'settings', icon: Settings2 }, { mode: 'archive', icon: Archive }] as const;
  return <>
    <ListPage title="订货模板" {...data} create={() => edit('metadata')} columns={[
      { title: '模板名称', dataIndex: 'name', width: 220 }, { title: '标签', dataIndex: 'tag', width: 120 },
      { title: '门店数量', width: 100, render: (_, row) => row.storeIds.length }, { title: '备注', dataIndex: 'remark', width: 180 },
      { title: '状态', width: 90, render: (_, row) => row.isArchived ? '已归档' : '有效' },
      { title: '操作', width: 208, fixed: 'right', render: (_, row) => <div className="row-actions">{actions.map(action => <Tooltip key={action.mode} title={titles[action.mode]}><Button type="text" danger={action.mode === 'archive'} disabled={row.isArchived} aria-label={`${titles[action.mode]}${row.name}`} icon={<action.icon size={16} />} onClick={() => edit(action.mode, row)} /></Tooltip>)}</div> },
    ]} />
    <Modal className={mode === 'items' ? 'template-product-editor' : undefined} title={detail ? `${titles[mode]} · ${detail.name}` : '新增模板'} open={open} width={mode === 'items' ? 1400 : mode === 'settings' ? 900 : 640} onCancel={close} onOk={save} okText={mode === 'archive' ? '确认归档' : '保存'} cancelText="取消"
      confirmLoading={saving} okButtonProps={{ danger: mode === 'archive', disabled: loading || Boolean(referencesError) || Boolean(sourceId && !detail) || stores.loading || products.loading || suppliers.loading || categories.loading }} closable={!saving} maskClosable={!saving} keyboard={!saving}>
      {(error || referencesError) && <Alert type="error" title={error || referencesError} showIcon />}
      {loading ? <Spin /> : <Form form={form} layout="vertical" disabled={saving} className="compact-form">
        {(mode === 'metadata' || mode === 'copy') && <div className="form-grid">
          {detail && mode === 'metadata' && <Form.Item name="code" label="模板编号"><Input disabled /></Form.Item>}
          <Form.Item name="name" label="模板名称" rules={[{ required: true, whitespace: true, message: '请填写模板名称' }]}><Input maxLength={200} /></Form.Item>
          <Form.Item name="tag" label="模板标签" rules={[{ required: true, whitespace: true, message: '请填写模板标签' }]}><Input maxLength={120} /></Form.Item>
          <Form.Item name="remark" label="备注" className="full-width"><Input.TextArea rows={2} maxLength={500} /></Form.Item>
        </div>}
        {mode === 'stores' && <Form.Item name="storeIds" label="绑定门店"><Select mode="multiple" showSearch optionFilterProp="label" options={stores.rows.filter(row => !occupied.has(row.id) || detail?.storeIds.includes(row.id)).map(row => ({ value: row.id, label: row.name }))} /></Form.Item>}
        {mode === 'archive' && <Alert type="warning" showIcon title="将取消门店、商品及结算关联，历史订单保留。" />}
        {mode === 'items' && <TemplateProducts key={detail?.id} products={products.rows} suppliers={suppliers.rows} categories={categories.rows} units={units.rows} detail={detail} disabled={saving || units.loading} />}
        {mode === 'settings' && <Form.List name="settings">{fields => <Table size="small" rowKey="key" dataSource={fields} pagination={false} scroll={{ x: 660, y: 420 }} columns={[
          { title: '供应商名称', width: 240, render: (_, field) => suppliers.rows.find(row => row.id === form.getFieldValue(['settings', field.name, 'supplierId']))?.name || '—' },
          { title: '支付方式', width: 230, render: (_, field) => <Form.Item name={[field.name, 'settlementMode']} rules={[{ required: true, message: '请选择支付方式' }]} style={{ marginBottom: 0 }}><Select aria-label="支付方式" options={settlementOptions} /></Form.Item> },
          { title: '结算周期', width: 180, render: (_, field) => <Form.Item name={[field.name, 'settlementCycle']} rules={[{ required: true, message: '请选择结算周期' }]} style={{ marginBottom: 0 }}><Select aria-label="结算周期" options={cycleOptions} /></Form.Item> },
        ]} locale={{ emptyText: '暂无关联供应商' }} />}</Form.List>}
      </Form>}
    </Modal>
  </>;
}
