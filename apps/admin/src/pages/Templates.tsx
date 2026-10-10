import { useRef, useState } from 'react';
import { Alert, App, Button, Dropdown, Form, Input, Modal, Select, Spin, Table } from 'antd';
import { Archive, CalendarClock, Copy, MoreHorizontal, PackageOpen, Pencil } from 'lucide-react';
import { TemplateProducts, cycleChoices, termModes } from '../components/TemplateProducts';
import { ListPage } from '../components/ListPage';
import { request } from '../lib/api';
import { useRows } from '../lib/useRows';
import { type CatalogProduct, type CatalogSupplier, type Named, type Template, type TemplateDetail, type TemplateItem } from '../lib/catalogTypes';
import { type TemplateCycleOverride } from '../lib/templateCycleOverrides';
import { selectTemplateSuppliers } from '../lib/templateSuppliers';

type Mode = 'edit' | 'products' | 'settlement' | 'copy' | 'archive';
const titles = { edit: '编辑模板', products: '配置商品', settlement: '结算配置', copy: '复制模板', archive: '归档模板' };
export default function Templates() {
  const data = useRows<Template>('/templates'); const stores = useRows<Named>('/stores');
  const products = useRows<CatalogProduct>('/products'); const suppliers = useRows<CatalogSupplier>('/suppliers');
  const categories = useRows<Named>('/categories'); const units = useRows<Named>('/units');
  const [form] = Form.useForm(); const { modal, message } = App.useApp();
  const [open, setOpen] = useState(false); const [mode, setMode] = useState<Mode>('edit');
  const [detail, setDetail] = useState<TemplateDetail | null>(null); const [sourceId, setSourceId] = useState<string>();
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const generation = useRef(0); const lock = useRef(false); const initial = useRef('');
  const values = Form.useWatch([], { form, preserve: true }) || {};
  const items: TemplateItem[] = values.items || []; const storeIds: string[] = values.storeIds || [];
  const cycles: TemplateCycleOverride[] = values.rows || [];
  const refsError = stores.error || products.error || suppliers.error || categories.error || units.error;
  const refsLoading = stores.loading || products.loading || suppliers.loading || categories.loading || units.loading;
  const dirty = () => JSON.stringify(form.getFieldsValue(true)) !== initial.current;
  const supplierPrice = (item: TemplateItem, link: TemplateItem['suppliers'][number]) => {
    const product = products.rows.find(row => row.id === item.productId);
    return link.salesPrice ?? product?.supplierPurchasePrices?.find(row => row.supplierId === link.supplierId)?.supplyPrice ?? item.salesPrice ?? item.initialSalesPrice ?? product?.defaultSalesPrice;
  };
  const inheritProductSuppliers = (item: TemplateItem): TemplateItem => {
    const product = products.rows.find(row => row.id === item.productId);
    if (!product) return item;
    const supplierIds = (product?.supplierIds || []).filter(id => {
      const supplier = suppliers.rows.find(row => row.id === id);
      return supplier && !supplier.isArchived && supplier.status === 'ACTIVE' && product.supplierPurchasePrices?.some(price => price.supplierId === id);
    });
    const links = selectTemplateSuppliers(item.suppliers || [], supplierIds).map(link => ({ ...link, salesPrice: supplierPrice(item, link) }));
    return { ...item, salesPrice: links[0]?.salesPrice ?? item.salesPrice ?? item.initialSalesPrice ?? product.defaultSalesPrice, suppliers: links };
  };
  const edit = async (next: Mode, row?: Template) => {
    const sequence = ++generation.current; setSourceId(row?.id); setMode(next); setOpen(true); setError(''); setDetail(null); setLoading(!!row);
    form.resetFields(); form.setFieldsValue({ name: '', tag: '', remark: '', storeIds: [], items: [], rows: [] }); initial.current = JSON.stringify(form.getFieldsValue(true));
    if (!row) return;
    try {
      const result = await request<TemplateDetail>(`/templates/${row.id}`);
      if (sequence !== generation.current) return;
      setDetail(result);
      form.setFieldsValue({ name: next === 'copy' ? `${result.name.slice(0, 196)}副本` : result.name, tag: result.tag || '', remark: result.remark || '', storeIds: result.storeIds, items: result.items.map(inheritProductSuppliers), rows: result.cycleOverrides || [] });
      initial.current = JSON.stringify(form.getFieldsValue(true));
    } catch (failure) { if (sequence === generation.current) setError((failure as Error).message); }
    finally { if (sequence === generation.current) setLoading(false); }
  };
  const close = () => {
    if (saving) return;
    const finish = () => { generation.current++; setOpen(false); };
    if (mode !== 'archive' && dirty()) modal.confirm({ title: '放弃未保存的修改？', okText: '放弃修改', cancelText: '继续编辑', onOk: finish }); else finish();
  };
  const retainedSuppliers = new Set(items.filter(item => item.isEnabled).flatMap(item => item.suppliers.map(link => link.supplierId)));
  const termSuppliers = suppliers.rows.filter(row => retainedSuppliers.has(row.id) && termModes.has(row.defaultSettlementMode));
  const cycleLabel = (value?: string | null) => cycleChoices.find(choice => choice.value === value)?.label;
  const occupiedBy = new Map<string, Template>();
  data.rows.filter(row => row.id !== detail?.id && !row.isArchived).forEach(template => template.storeIds.forEach(storeId => occupiedBy.set(storeId, template)));
  const save = async () => {
    if (lock.current || loading || refsLoading || refsError || (sourceId && !detail)) return;
    try { await form.validateFields(); } catch { return; }
    const current = form.getFieldsValue(true);
    lock.current = true; setSaving(true); setError('');
    try {
      const metadata = { name: current.name.trim(), tag: current.tag.trim(), remark: current.remark?.trim() || null };
      const nextStores: string[] = current.storeIds || [];
      if (mode === 'archive') await request(`/templates/${detail!.id}/archive`, { method: 'POST', body: { expectedVersion: detail!.version } });
      else if (!detail || mode === 'copy') await request(detail ? `/templates/${detail.id}/copy` : '/templates', { method: 'POST', body: { ...metadata, ...(!detail ? { storeIds: nextStores, confirmStoreReassignment: false } : {}), ...(detail ? { expectedVersion: detail.version } : {}) } });
      else if (mode === 'products') {
        const nextItems = (current.items || []) as TemplateItem[];
        if (nextItems.some(item => !item.suppliers.length)) throw new Error('模板商品必须先在商品管理中关联至少一个有效供应商');
        const active = new Set(nextItems.filter(item => item.isEnabled).flatMap(item => item.suppliers.map(link => link.supplierId)));
        const dropped = (detail.cycleOverrides || []).filter(row => !active.has(row.supplierId));
        if (dropped.length) {
          const confirmed = await new Promise<boolean>(resolve => modal.confirm({ title: '确认清除关联账期？', content: <ul>{dropped.map(row => <li key={`${row.storeId}:${row.supplierId}`}>{stores.rows.find(store => store.id === row.storeId)?.name} / {suppliers.rows.find(supplier => supplier.id === row.supplierId)?.name}</li>)}</ul>, okText: '清除并保存', cancelText: '返回修改', onOk: () => resolve(true), onCancel: () => resolve(false) }));
          if (!confirmed) return;
        }
        await request(`/templates/${detail.id}/items`, { method: 'PUT', body: { expectedVersion: detail.version, confirmCycleOverrideRemoval: true, items: nextItems.map(item => ({ productId: item.productId, salesPrice: supplierPrice(item, [...item.suppliers].sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId))[0]!), sortOrder: item.sortOrder, isEnabled: item.isEnabled, minOrderQty: item.minOrderQty, orderMultiple: item.orderMultiple, suppliers: item.suppliers.map(link => ({ supplierId: link.supplierId, priority: link.priority, salesPrice: supplierPrice(item, link) })) })) } });
      } else if (mode === 'settlement') {
        const active = new Set(items.filter(item => item.isEnabled).flatMap(item => item.suppliers.map(link => link.supplierId)));
        const rows = (current.rows || []).filter((row: TemplateCycleOverride) => nextStores.includes(row.storeId) && active.has(row.supplierId));
        await request(`/templates/${detail.id}/settlement-cycles`, { method: 'PUT', body: { expectedVersion: detail.version, rows } });
      } else {
        // Basic editing must not silently inherit or rewrite supplier choices.
        const nextItems = detail.items;
        const active = new Set(nextItems.filter(item => item.isEnabled).flatMap(item => item.suppliers.map(link => link.supplierId)));
        const rows = (current.rows || []).filter((row: TemplateCycleOverride) => nextStores.includes(row.storeId) && active.has(row.supplierId));
        const dropped = (detail.cycleOverrides || []).filter(row => !nextStores.includes(row.storeId));
        if (dropped.length) {
          const confirmed = await new Promise<boolean>(resolve => modal.confirm({ title: '确认清除门店账期？', content: '移除门店后，该门店在本模板中的结算周期配置将一并清除。', okText: '清除并保存', cancelText: '返回修改', onOk: () => resolve(true), onCancel: () => resolve(false) }));
          if (!confirmed) return;
        }
        await request(`/templates/${detail.id}/configuration`, { method: 'PUT', body: { ...metadata, expectedVersion: detail.version, storeIds: nextStores, rows, confirmStoreReassignment: false, confirmCycleOverrideRemoval: true, items: nextItems.map(item => ({ productId: item.productId, salesPrice: supplierPrice(item, [...item.suppliers].sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId))[0]!), sortOrder: item.sortOrder, isEnabled: item.isEnabled, minOrderQty: item.minOrderQty, orderMultiple: item.orderMultiple, suppliers: item.suppliers.map(link => ({ supplierId: link.supplierId, priority: link.priority, salesPrice: supplierPrice(item, link) })) })) } });
      }
      setOpen(false); data.reload(); message.success(mode === 'products' ? '商品配置已保存' : mode === 'settlement' ? '结算配置已保存' : '模板已保存');
    } catch (failure) { setError((failure as Error).message); }
    finally { lock.current = false; setSaving(false); }
  };
  const basic = <div className="form-grid">
    <Form.Item name="name" label="模板名称" rules={[{ required: true, whitespace: true, message: '请填写模板名称' }]}><Input maxLength={200} /></Form.Item>
    <Form.Item name="tag" label="模板标签" rules={[{ required: true, whitespace: true, message: '请填写模板标签' }]}><Input maxLength={120} /></Form.Item>
    {mode === 'edit' && <Form.Item name="storeIds" label="适用门店" className="full-width" extra="一个门店只能使用一个有效订货模板；已被占用的门店需先从原模板移除。"><Select mode="multiple" showSearch optionFilterProp="label" placeholder="请选择可使用该模板的门店" options={stores.rows.map(row => { const template = occupiedBy.get(row.id); return { value: row.id, disabled: !!template, label: template ? `${row.name}（已用于：${template.name}）` : row.name }; })} /></Form.Item>}
    <Form.Item name="remark" label="备注" className="full-width"><Input.TextArea rows={2} maxLength={500} /></Form.Item>
  </div>;
  const settlement = <Table size="small" scroll={{ x: 960 }} locale={{ emptyText: storeIds.length ? '暂无账期供应商' : '暂无适用门店' }} rowKey={row => `${row.storeId}:${row.supplierId}`} pagination={{ defaultPageSize: 10, showSizeChanger: true }} dataSource={storeIds.flatMap(storeId => termSuppliers.map(supplier => ({ storeId, supplierId: supplier.id, supplier })))} columns={[
    { title: '门店', render: (_, row) => stores.rows.find(store => store.id === row.storeId)?.name },
    { title: '供应商', render: (_, row) => row.supplier.name },
    { title: '结算方式', render: (_, row) => row.supplier.defaultSettlementMode === 'COMPANY_TERM' ? '公司账期结算' : '供应商账期结算' },
    { title: '供应商默认周期', render: (_, row) => cycleLabel(row.supplier.defaultSettlementCycle) || '未设置' },
    { title: '门店结算周期', width: 220, render: (_, row) => { const defaultValue = row.supplier.defaultSettlementCycle; const selected = cycles.find(cycle => cycle.storeId === row.storeId && cycle.supplierId === row.supplierId)?.settlementCycle || defaultValue || undefined; return <Select style={{ width: '100%' }} aria-label={`${row.storeId}-${row.supplierId}结算周期`} disabled={saving} status={defaultValue ? undefined : 'warning'} placeholder="请选择结算周期" value={selected} options={cycleChoices} onChange={value => form.setFieldValue('rows', [...cycles.filter(cycle => cycle.storeId !== row.storeId || cycle.supplierId !== row.supplierId), ...(value === defaultValue ? [] : [{ storeId: row.storeId, supplierId: row.supplierId, settlementCycle: value }])])} />; } },
  ]} />;
  return <>
    <ListPage title="订货模板" {...data} create={() => edit('edit')} columns={[
      { title: '模板名称', dataIndex: 'name', width: 220, ellipsis: true },
      { title: '标签', dataIndex: 'tag', width: 120, ellipsis: true },
      { title: '门店数', width: 78, align: 'center', render: (_, row) => row.storeIds.length },
      { title: '备注', dataIndex: 'remark', ellipsis: true },
      { title: '状态', width: 76, ellipsis: true, render: (_, row) => row.isArchived ? '已归档' : '有效' },
      { title: '操作', width: 136, fixed: 'right', render: (_, row) => <div className="row-actions template-list-actions">
        <Button type="link" disabled={row.isArchived} icon={<Pencil size={15} />} onClick={() => edit('edit', row)}>编辑</Button>
        <Dropdown trigger={['click']} disabled={row.isArchived} menu={{ items: [
          { key: 'products', icon: <PackageOpen size={15} />, label: titles.products },
          { key: 'settlement', icon: <CalendarClock size={15} />, label: titles.settlement },
          { type: 'divider' },
          { key: 'copy', icon: <Copy size={15} />, label: titles.copy },
          { key: 'archive', icon: <Archive size={15} />, label: titles.archive, danger: true },
        ], onClick: ({ key }) => edit(key as Mode, row) }}>
          <Button type="text" disabled={row.isArchived} aria-label={`更多操作${row.name}`} icon={<MoreHorizontal size={17} />} />
        </Dropdown>
      </div> },
    ]} />
    <Modal className={mode === 'products' ? 'template-product-editor' : undefined} title={detail ? `${titles[mode]} · ${detail.name}` : '新增模板'} open={open} width={mode === 'products' ? 'min(1400px, 94vw)' : mode === 'settlement' ? 'min(1100px, 92vw)' : 640} onCancel={close} onOk={save} okText={mode === 'archive' ? '确认归档' : '保存'} confirmLoading={saving} okButtonProps={{ disabled: loading || refsLoading || !!refsError || !!(sourceId && !detail), danger: mode === 'archive' }} closable={!saving} maskClosable={false} keyboard={!saving}>
      {(error || refsError) && <Alert type="error" title={error || refsError} showIcon />}
      {loading ? <Spin /> : <Form form={form} layout="vertical" disabled={saving} className="compact-form">
        {mode === 'archive' ? <Alert type="warning" title="归档后取消门店、商品和账期关联，历史订单保留。" showIcon />
          : mode === 'products' && detail ? <TemplateProducts products={products.rows} suppliers={suppliers.rows} categories={categories.rows} units={units.rows} detail={detail} disabled={saving} dirty={dirty()} />
          : mode === 'settlement' && detail ? settlement
          : basic}
      </Form>}
    </Modal>
  </>;
}
