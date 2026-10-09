import { useRef, useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Select, Spin, Table, Tooltip } from 'antd';
import { Archive, CalendarClock, Copy, ListOrdered, Pencil, Store } from 'lucide-react';
import { TemplateProducts } from '../components/TemplateProducts';
import '../components/TemplateProducts.css';
import { ListPage } from '../components/ListPage';
import { request } from '../lib/api';
import { useRows } from '../lib/useRows';
import { positiveIntegerRule, type CatalogProduct, type CatalogSupplier, type Named, type Template, type TemplateDetail, type TemplateItem } from '../lib/catalogTypes';
import { droppedCycleOverrides, type TemplateCycleOverride } from '../lib/templateCycleOverrides';

type Mode = 'metadata' | 'copy' | 'stores' | 'items' | 'cycles' | 'archive';
const titles: Record<Mode, string> = { metadata: '编辑模板', copy: '复制模板', stores: '绑定门店', items: '商品及供货优先级', cycles: '结算周期', archive: '归档模板' };
const cycleChoices = [{ value: 'IMMEDIATE', label: '现结' }, { value: 'WEEKLY', label: '周结' }, { value: 'HALF_MONTHLY', label: '半月结' }, { value: 'MONTHLY', label: '月结' }];
function renderCycleOverrideWarning(dropped: TemplateCycleOverride[], stores: Named[], suppliers: Named[]) {
  const storeName = (id: string) => stores.find(row => row.id === id)?.name || id;
  const supplierName = (id: string) => suppliers.find(row => row.id === id)?.name || id;
  return <div className="template-cycle-warning">
    <p>这些门店的账期覆盖会被清除，该供应商将改用供应商资料里的默认账期：</p>
    <ul>{dropped.map(row => <li key={`${row.storeId}:${row.supplierId}`}>{storeName(row.storeId)} / {supplierName(row.supplierId)} · {row.settlementCycle}</li>)}</ul>
  </div>;
}
export default function Templates() {
  const data = useRows<Template>('/templates'); const stores = useRows<Named>('/stores'); const products = useRows<CatalogProduct>('/products'); const suppliers = useRows<CatalogSupplier>('/suppliers');
  const categories = useRows<Named>('/categories');
  const units = useRows<Named>('/units');
  const [mode, setMode] = useState<Mode>('metadata'); const [open, setOpen] = useState(false); const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [cycleStore, setCycleStore] = useState<string>();
  // Cycles edited inline in the products editor are submitted after the items save succeeds.
  const [cycleDraft, setCycleDraft] = useState<{ storeId: string; supplierId: string; settlementCycle: string }[]>([]);
  const pendingCycles = useRef<{ storeId: string; supplierId: string; settlementCycle: string }[] | null>(null);
  // Tracks overrides the admin cleared inline, so they are removed instead of silently retained.
  const clearedCycleKeys = useRef(new Set<string>());
  const initialCycles = useRef('[]');
  const generation = useRef(0); const lock = useRef(false); const initialItems = useRef('[]'); const [form] = Form.useForm(); const { message, modal } = App.useApp();
  const referencesError = stores.error || products.error || suppliers.error || categories.error || units.error;
  const initialize = (next: Mode, value: TemplateDetail | null) => {
    form.resetFields(); setDetail(value); setCycleDraft([]); clearedCycleKeys.current = new Set();
    if (!value) return;
    if (next === 'copy') form.setFieldsValue({ name: `${value.name.slice(0, 196)}副本`, tag: value.tag, remark: value.remark });
    else form.setFieldsValue({ ...value, items: value.items.map(item => ({ ...item, suppliers: item.suppliers.map(link => ({ ...link })) })) });
    initialItems.current = JSON.stringify(form.getFieldValue('items') || []);
    if (next === 'cycles') {
      setCycleStore(value.storeIds[0]);
      const linked = new Set(value.items.filter(item => item.isEnabled).flatMap(item => item.suppliers.map(link => link.supplierId)));
      form.setFieldsValue({ cycles: value.storeIds.flatMap(storeId => suppliers.rows.filter(supplier => linked.has(supplier.id) && !supplier.isArchived && ['SUPPLIER_TERM', 'COMPANY_TERM'].includes(supplier.defaultSettlementMode)).map(supplier => ({
        storeId, supplierId: supplier.id, settlementCycle: value.cycleOverrides?.find(row => row.storeId === storeId && row.supplierId === supplier.id)?.settlementCycle || '',
      }))) });
      initialCycles.current = JSON.stringify(form.getFieldValue('cycles') || []);
    }
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
    const finish = () => { generation.current++; setOpen(false); setCycleDraft([]); clearedCycleKeys.current = new Set(); pendingCycles.current = null; };
    if ((mode === 'items' && (JSON.stringify(form.getFieldValue('items') || []) !== initialItems.current || cycleDraft.length > 0 || clearedCycleKeys.current.size > 0)) || (mode === 'cycles' && JSON.stringify(form.getFieldValue('cycles') || []) !== initialCycles.current)) modal.confirm({ title: '放弃未保存的修改？', okText: '放弃修改', cancelText: '继续编辑', onOk: finish });
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
            minOrderQty: item.minOrderQty || null, orderMultiple: item.orderMultiple || null, suppliers: item.suppliers.map(link => {
              const previousPrice = detail.items.find(row => row.productId === item.productId)?.suppliers.find(row => row.supplierId === link.supplierId)?.salesPrice;
              const salesPrice = link.salesPrice === ''
                ? item.initialSalesPrice ?? products.rows.find(row => row.id === item.productId)?.defaultSalesPrice
                : link.salesPrice;
              return { supplierId: link.supplierId, priority: link.priority,
                ...(salesPrice != null && link.salesPrice !== previousPrice ? { salesPrice } : {}) };
            }) }));
          if (new Set(items.map(item => item.productId)).size !== items.length || items.some(item => new Set(item.suppliers.map(link => link.supplierId)).size !== item.suppliers.length)) throw new Error('商品和每个商品的供货方不能重复');
          if (items.some(item => !item.suppliers.length)) throw new Error('每个商品至少选择一个供货方');
          for (const item of items) {
            if (!item.productId || !Number.isInteger(item.sortOrder) || item.sortOrder < 0 || item.sortOrder > 2147483647 || item.suppliers.some(link => !link.supplierId || !Number.isInteger(link.priority) || link.priority < 0 || link.priority > 2147483647)) throw new Error('请检查所有商品的供货方、排序和优先级');
            await positiveIntegerRule('起订量', true).validator(undefined, item.minOrderQty);
            await positiveIntegerRule('订货倍数', true).validator(undefined, item.orderMultiple);
          }
          // Removing a supplier's products drops its per-store settlement cycle; make that explicit before it happens.
          const dropped = droppedCycleOverrides(detail!.cycleOverrides || [], items);
          if (dropped.length) {
            const confirmed = await new Promise<boolean>(resolve => {
              modal.confirm({ title: '移除商品将清除账期覆盖', content: renderCycleOverrideWarning(dropped, stores.rows, suppliers.rows),
                okText: '确认清除并保存', cancelText: '返回修改', onOk: () => resolve(true), onCancel: () => resolve(false) });
            });
            if (!confirmed) return;
          }
          path += '/items'; method = 'PUT'; body = { ...version, items, confirmCycleOverrideRemoval: true };
          // Cycles typed inline are the source of truth: untouched overrides stay, cleared ones drop.
          if (cycleDraft.length) {
            const cleared = clearedCycleKeys.current;
            const merged = [
              ...(detail!.cycleOverrides || []).filter(row => !cycleDraft.some(next => next.storeId === row.storeId && next.supplierId === row.supplierId) && !cleared.has(`${row.storeId}:${row.supplierId}`)),
              ...cycleDraft,
            ].filter(row => !dropped.some(gone => gone.storeId === row.storeId && gone.supplierId === row.supplierId));
            pendingCycles.current = merged.map(row => ({ storeId: row.storeId, supplierId: row.supplierId, settlementCycle: row.settlementCycle }));
          }
        } else if (mode === 'cycles') {
          path += '/settlement-cycles'; method = 'PUT';
          body = { ...version, rows: (values.cycles || []).filter((row: { settlementCycle: string }) => row.settlementCycle) };
        } else { path += '/archive'; body = version; }
      }
      const saved = await request<{ version: number }>(path, { method, body });
      const cycles = pendingCycles.current; pendingCycles.current = null;
      if (cycles && mode === 'items') {
        // Products are already committed at this point; a cycle failure must not read as a failed save.
        try {
          // The items save bumped the template version, so cycles must go out against that new one.
          await request(`/templates/${detail!.id}/settlement-cycles`, { method: 'PUT', body: { expectedVersion: saved.version, rows: cycles } });
        } catch (failure) {
          setOpen(false); data.reload();
          message.warning(`商品已保存，但结算周期保存失败：${(failure as Error).message}`);
          return;
        }
      }
      setOpen(false); data.reload(); message.success('模板已保存');
    } catch (failure) { setError((failure as Error).message); } finally { lock.current = false; setSaving(false); }
  };
  const occupied = new Set(data.rows.filter(row => row.id !== detail?.id && !row.isArchived).flatMap(row => row.storeIds));
  const actions = [{ mode: 'metadata', icon: Pencil }, { mode: 'copy', icon: Copy }, { mode: 'stores', icon: Store }, { mode: 'items', icon: ListOrdered }, { mode: 'cycles', icon: CalendarClock }, { mode: 'archive', icon: Archive }] as const;
  return <>
    <ListPage title="订货模板" {...data} create={() => edit('metadata')} columns={[
      { title: '模板名称', dataIndex: 'name', width: 220 }, { title: '标签', dataIndex: 'tag', width: 120 },
      { title: '门店数量', width: 100, render: (_, row) => row.storeIds.length }, { title: '备注', dataIndex: 'remark', width: 180 },
      { title: '状态', width: 90, render: (_, row) => row.isArchived ? '已归档' : '有效' },
      { title: '操作', width: 208, fixed: 'right', render: (_, row) => <div className="row-actions">{actions.map(action => <Tooltip key={action.mode} title={titles[action.mode]}><Button type="text" danger={action.mode === 'archive'} disabled={row.isArchived} aria-label={`${titles[action.mode]}${row.name}`} icon={<action.icon size={16} />} onClick={() => edit(action.mode, row)} /></Tooltip>)}</div> },
    ]} />
    <Modal className={mode === 'items' ? 'template-product-editor' : undefined} title={detail ? `${titles[mode]} · ${detail.name}` : '新增模板'} open={open} width={mode === 'items' ? 1400 : 640} onCancel={close} onOk={save} okText={mode === 'archive' ? '确认归档' : '保存'} cancelText="取消"
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
        {mode === 'cycles' && <>
          <Form.Item label="门店"><Select value={cycleStore} onChange={setCycleStore} showSearch optionFilterProp="label" options={stores.rows.filter(row => detail?.storeIds.includes(row.id)).map(row => ({ value: row.id, label: row.name }))} /></Form.Item>
          <Form.List name="cycles">{fields => <Table pagination={false} size="small" rowKey="key" dataSource={fields.filter(field => form.getFieldValue(['cycles', field.name, 'storeId']) === cycleStore)} columns={[
            { title: '供应商', render: (_, field) => suppliers.rows.find(row => row.id === form.getFieldValue(['cycles', field.name, 'supplierId']))?.name },
            { title: '结算方式', render: (_, field) => suppliers.rows.find(row => row.id === form.getFieldValue(['cycles', field.name, 'supplierId']))?.defaultSettlementMode === 'SUPPLIER_TERM' ? '供应商账期' : '公司账期' },
            { title: '结算周期', width: 230, render: (_, field) => {
              const supplier = suppliers.rows.find(row => row.id === form.getFieldValue(['cycles', field.name, 'supplierId']));
              return <Form.Item name={[field.name, 'settlementCycle']} style={{ marginBottom: 0 }}><Select aria-label={`${supplier?.name}结算周期`} options={[{ value: '', label: `默认 · ${cycleChoices.find(row => row.value === supplier?.defaultSettlementCycle)?.label || '-'}` }, ...cycleChoices]} /></Form.Item>;
            } },
          ]} locale={{ emptyText: !detail?.storeIds.length ? '请先绑定门店' : '暂无账期供应商' }} />}</Form.List>
        </>}
        {mode === 'archive' && <Alert type="warning" showIcon title="将取消门店、商品及结算关联，历史订单保留。" />}
        {mode === 'items' && <TemplateProducts key={detail?.id} products={products.rows} suppliers={suppliers.rows} categories={categories.rows} units={units.rows} detail={detail} disabled={saving || units.loading} storeNames={new Map(stores.rows.map(row => [row.id, row.name]))} onCycleChange={(storeId, supplierId, settlementCycle) => { const key = `${storeId}:${supplierId}`; setCycleDraft(current => { const rest = current.filter(row => !(row.storeId === storeId && row.supplierId === supplierId)); return settlementCycle ? [...rest, { storeId, supplierId, settlementCycle }] : rest; }); if (settlementCycle) clearedCycleKeys.current.delete(key); else clearedCycleKeys.current.add(key); }} />}
      </Form>}
    </Modal>
  </>;
}
