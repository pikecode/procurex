import { useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Radio, Select, Table, Tabs, Tooltip, Tree } from 'antd';
import { Trash2 } from 'lucide-react';
import { namedOptions, type CatalogProduct, type CatalogSupplier, type Named, type TemplateDetail, type TemplateItem } from '../lib/catalogTypes';
import './TemplateProducts.css';
import { money } from '../lib/money';
import { defaultTemplateSupplier } from '../lib/templateSuppliers';

// Only supplier/company term suppliers carry a settlement cycle; the others always settle immediately.
export const termModes = new Set(['SUPPLIER_TERM', 'COMPANY_TERM']);
export const cycleChoices = [{ value: 'IMMEDIATE', label: '现结' }, { value: 'WEEKLY', label: '周结' }, { value: 'HALF_MONTHLY', label: '半月结' }, { value: 'MONTHLY', label: '月结' }];

export function TemplateProducts({ products, suppliers, categories, units, detail, disabled = false, storeNames, onCycleChange }: { products: CatalogProduct[]; suppliers: CatalogSupplier[]; categories: (Named & { parentId?: string | null })[]; units: Named[]; detail: TemplateDetail | null; disabled?: boolean; storeNames: Map<string, string>; onCycleChange?: (storeId: string, supplierId: string, settlementCycle: string) => void }) {
  const form = Form.useFormInstance();
  const [view, setView] = useState('selected'); const [category, setCategory] = useState<string>(); const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<React.Key[]>([]);
  const items: TemplateItem[] = Form.useWatch('items', { form, preserve: true }) || [];
  const selectedIds = new Set(items.map(item => item.productId));
  const categoryIds = new Set(category ? [category, ...categories.filter(row => row.parentId === category).map(row => row.id)] : []);
  const originalIds = new Set(detail?.items.map(item => item.productId) || []);
  const matches = (product: CatalogProduct) => (!category || categoryIds.has(product.categoryId)) && `${product.name} ${product.sku || ''}`.toLowerCase().includes(search.trim().toLowerCase());
  const visible = products.filter(product => product.isActive && (!originalIds.has(product.id) || !selectedIds.has(product.id)) && matches(product));
  const stores = (detail?.storeIds || []).map(id => ({ id }));
  const cycleOverrides = detail?.cycleOverrides || [];
  const cycleFor = (storeId: string, supplierId: string) => cycleOverrides.find(row => row.storeId === storeId && row.supplierId === supplierId)?.settlementCycle || '';
  const setCycle = (storeId: string, supplierId: string, settlementCycle: string) => onCycleChange?.(storeId, supplierId, settlementCycle ?? '');
  const changeSelection = (keys: string[]) => {
    if (disabled) return;
    const addedIds = new Set(keys);
    const retained = items.filter(item => originalIds.has(item.productId) || addedIds.has(item.productId));
    const additions = products.filter(product => addedIds.has(product.id) && !selectedIds.has(product.id) && product.isActive).map((product, index) => detail?.items.find(item => item.productId === product.id) || ({ productId: product.id, sortOrder: items.length + index, isEnabled: true, minOrderQty: null, orderMultiple: null,
      suppliers: suppliers.filter(supplier => !supplier.isArchived && supplier.status === 'ACTIVE' && product.supplierIds?.includes(supplier.id)).map((supplier, priority) => ({ supplierId: supplier.id, priority })) }));
    form.setFieldValue('items', [...retained, ...additions]);
  };
  const tree = [{ key: 'all', title: '全部分类' }, ...categories.filter(row => !row.parentId || !categories.some(parent => parent.id === row.parentId)).map(row => ({ key: row.id, title: row.name, children: categories.filter(child => child.parentId === row.id).map(child => ({ key: child.id, title: child.name })) }))];
  return <>
    <Tabs activeKey={view} onChange={value => { setView(value); setSearch(''); }} items={[{ key: 'selected', label: `已选商品 (${items.length})` }, { key: 'available', label: '待添加商品' }]} />
    <div className="template-product-picker"><aside><Tree blockNode defaultExpandAll selectedKeys={[category || 'all']} onSelect={keys => setCategory(keys[0] && keys[0] !== 'all' ? String(keys[0]) : undefined)} treeData={tree} titleRender={node => <span title={String(node.title)}>{node.title}</span>} /></aside><div className="template-product-content">
    <div className="filter-bar"><Input.Search aria-label="搜索模板商品" placeholder="商品名称 / 货号" value={search} onChange={event => setSearch(event.target.value)} /></div>
    {view === 'selected' ? <>
    <Form.List name="items">{(fields, { remove }) => <>
      <Table className="template-products-table" size="small" rowKey="key" expandable={{ expandedRowKeys: expanded, onExpandedRowsChange: keys => setExpanded([...keys]), expandedRowRender: field => {
        const item = items[field.name]; const product = products.find(row => row.id === item?.productId);
        const primary = [...(item?.suppliers || [])].sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId))[0]?.supplierId;
        return <div className="template-supplier-expanded">
        <Table size="small" rowKey="supplierId" pagination={false} dataSource={item?.suppliers || []} columns={[
          { title: '默认供应商', width: 110, render: (_, link) => <Radio aria-label={`默认供应商${link.supplierId}`} checked={primary === link.supplierId} disabled={disabled} onChange={() => form.setFieldValue(['items', field.name, 'suppliers'], defaultTemplateSupplier(item.suppliers, link.supplierId))} /> },
          { title: '供应商', render: (_, link) => suppliers.find(row => row.id === link.supplierId)?.name || '—' },
          { title: '结算方式', width: 110, render: (_, link) => { const mode = suppliers.find(row => row.id === link.supplierId)?.defaultSettlementMode; return mode === 'SUPPLIER_TERM' ? '供应商账期' : mode === 'COMPANY_TERM' ? '公司账期' : mode === 'STORED_VALUE' ? '储值支付' : mode === 'CREDIT' ? '挂账' : '—'; } },
          { title: '供货价', width: 120, align: 'right', render: (_, link) => money(product?.supplierPurchasePrices?.find(row => row.supplierId === link.supplierId)?.supplyPrice ?? link.supplyPrice) },
          { title: '销售价', width: 160, render: (_, link, index) => <Form.Item name={[field.name, 'suppliers', index, 'salesPrice']} rules={[{ validator: async (_, value) => { if (value == null || value === '') return; if (!/^\d{1,14}(\.\d{1,2})?$/.test(String(value))) throw new Error('销售价须为非负数，最多两位小数'); } }]}><InputNumber aria-label={`销售价${link.supplierId}`} stringMode min="0" precision={2} disabled={disabled} placeholder={money(item.initialSalesPrice ?? product?.defaultSalesPrice)} /></Form.Item> },
          { title: '预估毛利', width: 110, align: 'right', render: (_, link) => { const cost = product?.supplierPurchasePrices?.find(row => row.supplierId === link.supplierId)?.supplyPrice ?? link.supplyPrice; const sale = Number(link.salesPrice ?? item.initialSalesPrice ?? product?.defaultSalesPrice); return cost != null && sale > 0 ? `${((sale - Number(cost)) / sale * 100).toFixed(2)}%` : '—'; } },
        ]} />
        {stores.length ? <>
          <div className="template-cycle-heading">结算周期 · 按门店<span>仅公司账期和供应商账期需要设置，其余结算方式固定即时结算</span></div>
          <div className="template-cycle-grid" style={{ gridTemplateColumns: `minmax(200px, 1fr) repeat(${stores.length}, minmax(150px, 1fr))` }}>
            <div className="template-cycle-head">供应商 / 门店</div>
            {stores.map(store => <div className="template-cycle-head" key={store.id} title={store.id}>{storeNames.get(store.id) || '门店'}</div>)}
            {(item?.suppliers || []).map(link => {
              const supplier = suppliers.find(row => row.id === link.supplierId);
              const configurable = !!supplier && termModes.has(supplier.defaultSettlementMode);
              return [
                <div className="template-cycle-supplier" key={`${link.supplierId}-label`}>
                  <span title={supplier?.name}>{supplier?.name || '—'}</span>
                  {primary === link.supplierId ? <small>首选</small> : null}
                </div>,
                ...stores.map(store => <div className="template-cycle-cell" key={`${link.supplierId}-${store.id}`}>
                  {configurable
                    ? <Select aria-label={`${supplier?.name}-${storeNames.get(store.id) || '门店'}结算周期`} size="small" allowClear placeholder="默认" disabled={disabled}
                        value={cycleFor(store.id, link.supplierId) || undefined}
                        options={[{ value: '', label: `默认 · ${cycleChoices.find(row => row.value === supplier?.defaultSettlementCycle)?.label || '-'}`, disabled: true }, ...cycleChoices.map(row => ({ value: row.value, label: row.label }))].filter(row => row.value !== '')}
                        onChange={value => setCycle(store.id, link.supplierId, value)} />
                    : <span className="template-cycle-na">即时结算</span>}
                </div>),
              ];
            })}
          </div>
        </> : <Alert type="info" showIcon title="该模板尚未绑定门店，绑定门店后可在此按门店设置结算周期。" />}
        </div>;
      } }} dataSource={fields.filter(field => { const product = products.find(row => row.id === items[field.name]?.productId); return product ? matches(product) : !category && !search; })} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }} scroll={{ x: 1100 }} columns={[
        { title: '商品名称', width: 180, render: (_, field) => products.find(product => product.id === items[field.name]?.productId)?.name || '—' },
        { title: '商品分类', width: 120, render: (_, field) => { const product = products.find(row => row.id === items[field.name]?.productId); return categories.find(row => row.id === product?.categoryId)?.name || '—'; } },
        { title: '销售单位', width: 90, render: (_, field) => { const product = products.find(row => row.id === items[field.name]?.productId); return units.find(row => row.id === product?.baseUnitId)?.name || '—'; } },
        { title: '默认销售价', width: 120, align: 'right', render: (_, field) => { const item = items[field.name]; const primary = [...(item?.suppliers || [])].sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId))[0]; return money(primary?.salesPrice ?? item?.initialSalesPrice ?? products.find(product => product.id === item?.productId)?.defaultSalesPrice); } },
        { title: '供应商', width: 210, render: (_, field) => {
          const item = items[field.name];
          const primary = [...(item?.suppliers || [])].sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId))[0]?.supplierId;
          return <div className="template-supplier-cell-list">
            {(item?.suppliers || []).map(link => {
              const supplier = suppliers.find(row => row.id === link.supplierId);
              return <span key={link.supplierId}>
                <span title={supplier?.name}>{supplier?.name || '—'}</span>
                {primary === link.supplierId ? <small>首选</small> : <button type="button" disabled={disabled} aria-label={`设为首选供应商${supplier?.name || ''}`} onClick={() => form.setFieldValue(['items', field.name, 'suppliers'], defaultTemplateSupplier(item.suppliers, link.supplierId))}>设首选</button>}
              </span>;
            })}
          </div>;
        } },
        { title: '供货价格', width: 110, align: 'right', render: (_, field) => {
          const item = items[field.name]; const product = products.find(row => row.id === item?.productId);
          const primary = [...(item?.suppliers || [])].sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId))[0]?.supplierId;
          return money(product?.supplierPurchasePrices?.find(price => price.supplierId === primary)?.supplyPrice);
        } },
        { title: '预估毛利', width: 110, align: 'right', render: (_, field) => {
          const item = items[field.name]; const product = products.find(row => row.id === item?.productId);
          const primary = [...(item?.suppliers || [])].sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId))[0]?.supplierId;
          const price = product?.supplierPurchasePrices?.find(row => row.supplierId === primary)?.supplyPrice;
          const sale = Number(item?.suppliers.find(row => row.supplierId === primary)?.salesPrice ?? item?.initialSalesPrice ?? product?.defaultSalesPrice);
          return price != null && Number.isFinite(sale) && sale > 0 ? `${((sale - Number(price)) / sale * 100).toFixed(2)}%` : '—';
        } },
        { title: '操作', width: 60, fixed: 'right', render: (_, field) => <Tooltip title="移除商品"><Button type="text" danger aria-label="移除商品" icon={<Trash2 size={16} />} onClick={() => remove(field.name)} /></Tooltip> },
      ]} />
    </>}</Form.List>
    </> : <Table size="small" rowKey="id" dataSource={visible} rowSelection={{ selectedRowKeys: items.filter(item => !originalIds.has(item.productId)).map(item => item.productId), preserveSelectedRowKeys: true, onChange: keys => changeSelection(keys.map(String)) }} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }} scroll={{ x: 560 }} columns={[
      { title: '商品名称', dataIndex: 'name', render: (_, product) => <span>{product.name}{selectedIds.has(product.id) && <small className="template-pending">待新增</small>}</span> }, { title: '分类', render: (_, product) => categories.find(row => row.id === product.categoryId)?.name || '-' }, { title: '货号', dataIndex: 'sku' }, { title: '销售价格', dataIndex: 'defaultSalesPrice', render: money },
    ]} />}
    </div></div>
    <div className="template-change-summary">已选 {items.length} 项 · 待新增 {items.filter(item => !originalIds.has(item.productId)).length} 项 · 待移除 {[...originalIds].filter(id => !selectedIds.has(id)).length} 项</div>
  </>;
}
