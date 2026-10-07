import { useState } from 'react';
import { Button, Form, Input, Select, Table, Tabs, Tooltip, Tree } from 'antd';
import { Trash2 } from 'lucide-react';
import { namedOptions, type CatalogProduct, type CatalogSupplier, type Named, type TemplateDetail, type TemplateItem } from '../lib/catalogTypes';
import './TemplateProducts.css';

export function TemplateProducts({ products, suppliers, categories, units, detail, disabled = false }: { products: CatalogProduct[]; suppliers: CatalogSupplier[]; categories: (Named & { parentId?: string | null })[]; units: Named[]; detail: TemplateDetail | null; disabled?: boolean }) {
  const form = Form.useFormInstance();
  const [view, setView] = useState('selected'); const [category, setCategory] = useState<string>(); const [search, setSearch] = useState('');
  const items: TemplateItem[] = Form.useWatch('items', { form, preserve: true }) || [];
  const selectedIds = new Set(items.map(item => item.productId));
  const categoryIds = new Set(category ? [category, ...categories.filter(row => row.parentId === category).map(row => row.id)] : []);
  const originalIds = new Set(detail?.items.map(item => item.productId) || []);
  const matches = (product: CatalogProduct) => (!category || categoryIds.has(product.categoryId)) && `${product.name} ${product.sku || ''}`.toLowerCase().includes(search.trim().toLowerCase());
  const visible = products.filter(product => product.isActive && (!originalIds.has(product.id) || !selectedIds.has(product.id)) && matches(product));
  const changeSelection = (keys: string[]) => {
    if (disabled) return;
    const addedIds = new Set(keys);
    const retained = items.filter(item => originalIds.has(item.productId) || addedIds.has(item.productId));
    const additions = products.filter(product => addedIds.has(product.id) && !selectedIds.has(product.id) && product.isActive).map((product, index) => detail?.items.find(item => item.productId === product.id) || ({ productId: product.id, sortOrder: items.length + index, isEnabled: true, minOrderQty: null, orderMultiple: null,
      suppliers: suppliers.filter(supplier => !supplier.isArchived && product.supplierIds?.includes(supplier.id)).map((supplier, priority) => ({ supplierId: supplier.id, priority: (priority + 1) * 10 })) }));
    form.setFieldValue('items', [...retained, ...additions]);
  };
  const tree = [{ key: 'all', title: '全部分类' }, ...categories.filter(row => !row.parentId || !categories.some(parent => parent.id === row.parentId)).map(row => ({ key: row.id, title: row.name, children: categories.filter(child => child.parentId === row.id).map(child => ({ key: child.id, title: child.name })) }))];
  return <>
    <Tabs activeKey={view} onChange={value => { setView(value); setSearch(''); }} items={[{ key: 'selected', label: `已选商品 (${items.length})` }, { key: 'available', label: '待添加商品' }]} />
    <div className="template-product-picker"><aside><Tree blockNode defaultExpandAll selectedKeys={[category || 'all']} onSelect={keys => setCategory(keys[0] && keys[0] !== 'all' ? String(keys[0]) : undefined)} treeData={tree} titleRender={node => <span title={String(node.title)}>{node.title}</span>} /></aside><div className="template-product-content">
    <div className="filter-bar"><Input.Search aria-label="搜索模板商品" placeholder="商品名称 / 货号" value={search} onChange={event => setSearch(event.target.value)} /></div>
    {view === 'selected' ? <>
    <Form.List name="items">{(fields, { remove }) => <>
      <Table className="template-products-table" size="small" rowKey="key" dataSource={fields.filter(field => { const product = products.find(row => row.id === items[field.name]?.productId); return product ? matches(product) : !category && !search; })} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }} scroll={{ x: 1100 }} columns={[
        { title: '商品名称', width: 180, render: (_, field) => products.find(product => product.id === items[field.name]?.productId)?.name || '—' },
        { title: '商品分类', width: 120, render: (_, field) => { const product = products.find(row => row.id === items[field.name]?.productId); return categories.find(row => row.id === product?.categoryId)?.name || '—'; } },
        { title: '销售单位', width: 90, render: (_, field) => { const product = products.find(row => row.id === items[field.name]?.productId); return units.find(row => row.id === product?.baseUnitId)?.name || '—'; } },
        { title: '商品销售价', width: 120, align: 'right', render: (_, field) => products.find(product => product.id === items[field.name]?.productId)?.defaultSalesPrice ?? '—' },
        { title: '供应商', width: 210, render: (_, field) => {
          const item = items[field.name]; const product = products.find(row => row.id === item?.productId);
          const primary = [...(item?.suppliers || [])].sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId))[0]?.supplierId;
          return <Select aria-label="供应商" style={{ width: '100%' }} value={primary} disabled={disabled} showSearch optionFilterProp="label" placeholder="选择供应商" options={namedOptions(suppliers.filter(supplier => !supplier.isArchived && product?.supplierIds?.includes(supplier.id)))} onChange={supplierId => {
            const others = item.suppliers.filter(link => link.supplierId !== supplierId).sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId));
            form.setFieldValue(['items', field.name, 'suppliers'], [{ supplierId, priority: 0 }, ...others.map((link, index) => ({ ...link, priority: (index + 1) * 10 }))]);
          }} />;
        } },
        { title: '供货价格', width: 110, align: 'right', render: (_, field) => {
          const item = items[field.name]; const product = products.find(row => row.id === item?.productId);
          const primary = [...(item?.suppliers || [])].sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId))[0]?.supplierId;
          return product?.supplierPurchasePrices?.find(price => price.supplierId === primary)?.supplyPrice ?? '—';
        } },
        { title: '预估毛利', width: 110, align: 'right', render: (_, field) => {
          const item = items[field.name]; const product = products.find(row => row.id === item?.productId);
          const primary = [...(item?.suppliers || [])].sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId))[0]?.supplierId;
          const price = product?.supplierPurchasePrices?.find(row => row.supplierId === primary)?.supplyPrice;
          const sale = Number(product?.defaultSalesPrice);
          return price != null && Number.isFinite(sale) && sale > 0 ? `${((sale - Number(price)) / sale * 100).toFixed(2)}%` : '—';
        } },
        { title: '操作', width: 60, fixed: 'right', render: (_, field) => <Tooltip title="移除商品"><Button type="text" danger aria-label="移除商品" icon={<Trash2 size={16} />} onClick={() => remove(field.name)} /></Tooltip> },
      ]} />
    </>}</Form.List>
    </> : <Table size="small" rowKey="id" dataSource={visible} rowSelection={{ selectedRowKeys: items.filter(item => !originalIds.has(item.productId)).map(item => item.productId), preserveSelectedRowKeys: true, onChange: keys => changeSelection(keys.map(String)) }} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }} scroll={{ x: 560 }} columns={[
      { title: '商品名称', dataIndex: 'name', render: (_, product) => <span>{product.name}{selectedIds.has(product.id) && <small className="template-pending">待新增</small>}</span> }, { title: '分类', render: (_, product) => categories.find(row => row.id === product.categoryId)?.name || '-' }, { title: '货号', dataIndex: 'sku' }, { title: '销售价格', dataIndex: 'defaultSalesPrice' },
    ]} />}
    </div></div>
    <div className="template-change-summary">已选 {items.length} 项 · 待新增 {items.filter(item => !originalIds.has(item.productId)).length} 项 · 待移除 {[...originalIds].filter(id => !selectedIds.has(id)).length} 项</div>
  </>;
}
