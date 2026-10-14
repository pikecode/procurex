import { useRef, useState } from 'react';
import { Alert, App, Button, Dropdown, Form, Input, Modal, Select, Spin, Table } from 'antd';
import { Archive, CalendarClock, Copy, MoreHorizontal, PackageOpen, Pencil } from 'lucide-react';
import { TemplateProducts, cycleChoices, termModes } from '../components/TemplateProducts';
import '../components/TemplateProducts.css';
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
  // Every supplier the template keeps is listed; only term suppliers get a cycle selector.
  const templateSuppliers = suppliers.rows.filter(row => retainedSuppliers.has(row.id));
  const settlementModeText = (mode: string) => mode === 'COMPANY_TERM' ? '公司账期结算' : mode === 'SUPPLIER_TERM' ? '供应商账期结算' : mode === 'STORED_VALUE' ? '储值支付' : mode === 'CREDIT' ? '挂账' : '—';
  const storeGroups = storeIds.map(storeId => ({
    storeId,
    name: stores.rows.find(store => store.id === storeId)?.name || '门店',
    suppliers: templateSuppliers.map(supplier => ({ supplier, cycle: cycles.find(row => row.storeId === storeId && row.supplierId === supplier.id)?.settlementCycle })),
    configurable: templateSuppliers.filter(supplier => termModes.has(supplier.defaultSettlementMode)).length,
    configured: cycles.filter(row => row.storeId === storeId).length,
  }));
  const setStoreCycle = (storeId: string, supplierId: string, value: string) => {
    const defaultValue = suppliers.rows.find(supplier => supplier.id === supplierId)?.defaultSettlementCycle;
    const rest = cycles.filter(row => !(row.storeId === storeId && row.supplierId === supplierId));
    form.setFieldValue('rows', value && value !== defaultValue ? [...rest, { storeId, supplierId, settlementCycle: value }] : rest);
  };
  const storeCycleColumns = (storeId: string, storeName: string) => [
    { title: '供应商', render: (_: unknown, row: { supplier: CatalogSupplier; cycle?: string }) => row.supplier.name },
    { title: '结算方式', width: 120, render: (_: unknown, row: { supplier: CatalogSupplier }) => <span className={termModes.has(row.supplier.defaultSettlementMode) ? undefined : 'template-cycle-na'}>{settlementModeText(row.supplier.defaultSettlementMode)}</span> },
    { title: '供应商默认周期', width: 120, render: (_: unknown, row: { supplier: CatalogSupplier }) => cycleLabel(row.supplier.defaultSettlementCycle) || <span className="template-cycle-na">—</span> },
    // Fall back to the supplier default so the admin sees the effective cycle, not an empty box.
    { title: '本门店结算周期', width: 220, render: (_: unknown, row: { supplier: CatalogSupplier; cycle?: string }) => termModes.has(row.supplier.defaultSettlementMode)
      ? <Select style={{ width: '100%' }} aria-label={`${storeName}-${row.supplier.name}结算周期`} disabled={saving} status={row.supplier.defaultSettlementCycle ? undefined : 'warning'} placeholder="请选择结算周期" value={row.cycle || row.supplier.defaultSettlementCycle || undefined} options={cycleChoices} onChange={value => setStoreCycle(storeId, row.supplier.id, value)} />
      : <span className="template-cycle-na">即时结算</span> },
  ];
  // One pane per store: a left store list scales to dozens of stores where horizontal tabs would not.
  const [cycleStore, setCycleStore] = useState<string>();
  const [storeKeyword, setStoreKeyword] = useState('');
  const totalConfigured = storeGroups.reduce((total, group) => total + group.configured, 0);
  const totalConfigurable = storeGroups.reduce((total, group) => total + group.configurable, 0);
  const visibleGroups = storeGroups.filter(group => !storeKeyword.trim() || group.name.includes(storeKeyword.trim()));
  const activeStoreId = visibleGroups.some(group => group.storeId === cycleStore)
    ? cycleStore!
    : visibleGroups.find(group => group.configured < group.configurable)?.storeId ?? visibleGroups[0]?.storeId;
  const settlement = <div className="template-settlement">
    {!storeIds.length ? <Alert type="warning" showIcon title="该模板尚未绑定门店" description="请先在「编辑」中配置适用门店，之后才能为门店设置结算周期。" />
      : !templateSuppliers.length ? <Alert type="info" showIcon title="该模板尚未关联供应商" description="请先在「配置商品」中为商品关联供应商。" />
      : <div className="template-settlement-picker">
        <aside>
          {storeGroups.length > 6 ? <Input.Search allowClear size="small" aria-label="搜索门店" placeholder="搜索门店" value={storeKeyword} onChange={event => setStoreKeyword(event.target.value)} /> : null}
          <div className="template-store-list" role="tablist" aria-label="门店结算周期">
            {visibleGroups.map(group => <button type="button" role="tab" key={group.storeId} aria-selected={group.storeId === activeStoreId}
              className={`template-store-item${group.storeId === activeStoreId ? ' is-active' : ''}`}
              onClick={() => setCycleStore(group.storeId)}>
              <span className="template-store-item-name" title={group.name}>{group.name}</span>
              {group.configurable ? <small className={group.configured < group.configurable ? 'is-pending' : 'is-done'}>{group.configured}/{group.configurable}</small>
                : <small className="is-none">无需设置</small>}
            </button>)}
            {!visibleGroups.length ? <span className="template-store-empty">没有匹配的门店</span> : null}
          </div>
        </aside>
        <div className="template-settlement-pane">
          {activeStoreId ? <Table size="small" rowKey="supplierId" pagination={false} dataSource={storeGroups.find(group => group.storeId === activeStoreId)!.suppliers} columns={storeCycleColumns(activeStoreId, storeGroups.find(group => group.storeId === activeStoreId)!.name)} /> : null}
          <div className="template-settlement-summary">共 {storeGroups.length} 个门店 · 已配置 {totalConfigured} / {totalConfigurable} 条门店账期</div>
        </div>
      </div>}
  </div>;
  return <>
    <ListPage title="订货模板" {...data} create={() => edit('edit')} columns={[
      { title: '模板名称', dataIndex: 'name', width: 220, ellipsis: true },
      { title: '标签', dataIndex: 'tag', width: 120, ellipsis: true },
      { title: '门店数', width: 78, align: 'center', render: (_, row) => row.storeIds.length },
      { title: '备注', dataIndex: 'remark', ellipsis: true },
      { title: '状态', width: 76, ellipsis: true, render: (_, row) => row.isArchived ? '已归档' : '有效' },
      { title: '操作', align: 'right' as const, width: 116, fixed: 'right', render: (_, row) => <RowActions ariaLabel={row.name} actions={[
      { key: 'edit', label: '编辑', icon: <Pencil size={15} />, disabled: row.isArchived, disabledReason: row.isArchived ? '已归档模板不可编辑' : undefined, onClick: () => edit('edit', row) },
      { key: 'products', label: titles.products, icon: <PackageOpen size={15} />, disabled: row.isArchived, disabledReason: row.isArchived ? '已归档模板不可配置' : undefined, onClick: () => edit('products', row) },
      { key: 'settlement', label: titles.settlement, icon: <CalendarClock size={15} />, disabled: row.isArchived, disabledReason: row.isArchived ? '已归档模板不可配置' : undefined, onClick: () => edit('settlement', row) },
      { key: 'copy', label: titles.copy, icon: <Copy size={15} />, onClick: () => edit('copy', row) },
      { key: 'archive', label: titles.archive, icon: <Archive size={15} />, danger: true, onClick: () => edit('archive', row) },
    ]} /> },
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
import { RowActions } from '../components/RowActions';
