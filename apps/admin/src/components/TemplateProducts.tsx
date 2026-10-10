import { useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Radio, Table, Tabs, Tooltip, Tree } from 'antd';
import { Settings2, Trash2 } from 'lucide-react';
import { type CatalogProduct, type CatalogSupplier, type Named, type TemplateDetail, type TemplateItem } from '../lib/catalogTypes';
import './TemplateProducts.css';
import { money } from '../lib/money';
import { defaultTemplateSupplier } from '../lib/templateSuppliers';

// Only supplier/company term suppliers carry a settlement cycle; the others always settle immediately.
export const termModes = new Set(['SUPPLIER_TERM', 'COMPANY_TERM']);
export const cycleChoices = [{ value: 'IMMEDIATE', label: '现结' }, { value: 'WEEKLY', label: '周结' }, { value: 'HALF_MONTHLY', label: '半月结' }, { value: 'MONTHLY', label: '月结' }];

const modeLabels: Record<string, string> = { SUPPLIER_TERM: '供应商账期', COMPANY_TERM: '公司账期', STORED_VALUE: '储值支付', CREDIT: '挂账' };
const settlementModeLabel = (mode?: string) => (mode && modeLabels[mode]) || '—';

type SupplierLink = TemplateItem['suppliers'][number];
const supplyPriceOf = (product: CatalogProduct | undefined, link: SupplierLink) =>
  product?.supplierPurchasePrices?.find(row => row.supplierId === link.supplierId)?.supplyPrice ?? link.supplyPrice ?? null;
const salePriceOf = (item: TemplateItem | undefined, product: CatalogProduct | undefined, link?: SupplierLink) =>
  link?.salesPrice ?? (link ? supplyPriceOf(product, link) : null) ?? item?.salesPrice ?? item?.initialSalesPrice ?? product?.defaultSalesPrice ?? null;

// Negative margin is a pricing error worth surfacing, not just a number.
function MarginCell({ cost, sale }: { cost: string | null; sale: string | null }) {
  if (cost == null || sale == null || Number(sale) <= 0) return <span className="template-matrix-na">—</span>;
  const margin = (Number(sale) - Number(cost)) / Number(sale) * 100;
  return <span className={margin < 0 ? 'template-margin-negative' : undefined}>{margin.toFixed(2)}%</span>;
}

export function TemplateProducts({ products, suppliers, categories, units, detail, disabled = false, dirty }: { products: CatalogProduct[]; suppliers: CatalogSupplier[]; categories: (Named & { parentId?: string | null })[]; units: Named[]; detail: TemplateDetail | null; disabled?: boolean; dirty: boolean }) {
  const form = Form.useFormInstance();
  const [view, setView] = useState('selected'); const [category, setCategory] = useState<string>(); const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<React.Key[]>([]);
  const items: TemplateItem[] = Form.useWatch('items', { form, preserve: true }) || [];
  const selectedIds = new Set(items.map(item => item.productId));
  const categoryIds = new Set(category ? [category, ...categories.filter(row => row.parentId === category).map(row => row.id)] : []);
  const originalIds = new Set(detail?.items.map(item => item.productId) || []);
  const matches = (product: CatalogProduct) => (!category || categoryIds.has(product.categoryId)) && `${product.name} ${product.sku || ''}`.toLowerCase().includes(search.trim().toLowerCase());
  const visible = products.filter(product => product.isActive && (!originalIds.has(product.id) || !selectedIds.has(product.id)) && matches(product));
  const pendingIds = items.filter(item => !originalIds.has(item.productId)).map(item => item.productId);
  const configurePending = () => {
    setView('selected');
    setSearch('');
    setExpanded(current => [...new Set([...current, ...pendingIds])]);
  };
  const changeSelection = (keys: string[]) => {
    if (disabled) return;
    const addedIds = new Set(keys);
    const retained = items.filter(item => originalIds.has(item.productId) || addedIds.has(item.productId));
    const additions = products.filter(product => addedIds.has(product.id) && !selectedIds.has(product.id) && product.isActive).map((product, index) => detail?.items.find(item => item.productId === product.id) || (() => {
      const links = suppliers.filter(supplier => !supplier.isArchived && supplier.status === 'ACTIVE' && product.supplierPurchasePrices?.some(row => row.supplierId === supplier.id)).map((supplier, priority) => {
        const supplyPrice = product.supplierPurchasePrices!.find(row => row.supplierId === supplier.id)!.supplyPrice;
        return { supplierId: supplier.id, priority: priority * 10, salesPrice: supplyPrice, supplyPrice };
      });
      return { productId: product.id, sortOrder: items.length + index, isEnabled: true, minOrderQty: null, orderMultiple: null,
        salesPrice: links[0]?.salesPrice ?? product.defaultSalesPrice, suppliers: links };
    })());
    form.setFieldValue('items', [...retained, ...additions]);
  };
  const selectedCategoryIds = new Set(products.filter(product => selectedIds.has(product.id)).map(product => product.categoryId));
  categories.forEach(row => { if (selectedCategoryIds.has(row.id) && row.parentId) selectedCategoryIds.add(row.parentId); });
  const visibleCategories = view === 'selected' ? categories.filter(row => selectedCategoryIds.has(row.id)) : categories;
  const tree = [{ key: 'all', title: '全部分类' }, ...visibleCategories.filter(row => !row.parentId || !visibleCategories.some(parent => parent.id === row.parentId)).map(row => ({ key: row.id, title: row.name, children: visibleCategories.filter(child => child.parentId === row.id).map(child => ({ key: child.id, title: child.name })) }))];
  return <>
    <Tabs activeKey={view} onChange={value => { setView(value); setCategory(undefined); setSearch(''); }} items={[{ key: 'selected', label: `已选商品 (${items.length})` }, { key: 'available', label: '待添加商品' }]} />
    <div className="template-product-picker"><aside><Tree blockNode defaultExpandAll selectedKeys={[category || 'all']} onSelect={keys => setCategory(keys[0] && keys[0] !== 'all' ? String(keys[0]) : undefined)} treeData={tree} titleRender={node => <span title={String(node.title)}>{node.title}</span>} /></aside><div className="template-product-content">
    <div className="filter-bar"><Input.Search aria-label="搜索模板商品" placeholder="商品名称 / 货号" value={search} onChange={event => setSearch(event.target.value)} /></div>
    {view === 'selected' ? <>
    <Form.List name="items">{(fields, { remove }) => <>
      <Table className="template-products-table" size="small" rowKey={field => items[field.name]?.productId || field.key} expandable={{ showExpandColumn: false, expandedRowKeys: expanded, onExpandedRowsChange: keys => setExpanded([...keys]), expandedRowRender: field => {
        const item = items[field.name]; const product = products.find(row => row.id === item?.productId);
        const primary = [...(item?.suppliers || [])].sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId))[0]?.supplierId;
        // Prices belong to the product; cycles belong to the store. Keep them in separate blocks.
        const priceTable = <Table className="template-supplier-price-table" size="small" rowKey="supplierId" pagination={false} dataSource={item?.suppliers || []} rowClassName={link => primary === link.supplierId ? 'template-primary-supplier-row' : ''} columns={[
          { title: '首选', width: 72, align: 'center', render: (_, link) => <Radio aria-label={`默认供应商${link.supplierId}`} checked={primary === link.supplierId} disabled={disabled} onChange={() => form.setFieldValue(['items', field.name, 'suppliers'], defaultTemplateSupplier(item.suppliers, link.supplierId))} /> },
          { title: '供应商', render: (_, link) => suppliers.find(row => row.id === link.supplierId)?.name || '—' },
          { title: '结算方式', width: 110, render: (_, link) => settlementModeLabel(suppliers.find(row => row.id === link.supplierId)?.defaultSettlementMode) },
          { title: '供货价', width: 120, align: 'right', render: (_, link) => money(supplyPriceOf(product, link)) },
          { title: '门店销售价', width: 170, render: (_, link, supplierIndex) => <Form.Item name={[field.name, 'suppliers', supplierIndex, 'salesPrice']} style={{ marginBottom: 0 }} rules={[{ required: true, message: '请填写门店销售价' }, { validator: async (_, value) => { if (!/^\d{1,14}(\.\d{1,2})?$/.test(String(value))) throw new Error('最多两位小数'); } }]}><InputNumber aria-label={`门店销售价${product?.name || ''}${suppliers.find(row => row.id === link.supplierId)?.name || ''}`} stringMode min="0" precision={2} prefix="¥" disabled={disabled} placeholder={money(salePriceOf(item, product, link))} /></Form.Item> },
          { title: '预估毛利', width: 110, align: 'right', render: (_, link) => <MarginCell cost={supplyPriceOf(product, link)} sale={salePriceOf(item, product, link)} /> },
        ]} />;
        return <div className="template-expanded">
          <div className="template-section-title"><span className="template-section-product">{product?.name}</span><span>供应商价格配置 · {item?.suppliers.length || 0} 家</span></div>
          {!item?.suppliers.length && <Alert type="warning" title="该商品尚未关联有效供应商，请先到商品管理中维护" showIcon />}
          {priceTable}
        </div>;
      }}} dataSource={fields.filter(field => { const product = products.find(row => row.id === items[field.name]?.productId); return product ? matches(product) : !category && !search; })} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }} scroll={{ x: 980 }} tableLayout="fixed" columns={[
        { title: '商品名称', width: 210, ellipsis: true, render: (_, field) => { const name = products.find(product => product.id === items[field.name]?.productId)?.name || '—'; return <span title={name}>{name}</span>; } },
        { title: '商品分类', width: 120, ellipsis: true, render: (_, field) => { const product = products.find(row => row.id === items[field.name]?.productId); const name = categories.find(row => row.id === product?.categoryId)?.name || '—'; return <span title={name}>{name}</span>; } },
        { title: '销售单位', width: 76, render: (_, field) => { const product = products.find(row => row.id === items[field.name]?.productId); return units.find(row => row.id === product?.baseUnitId)?.name || '—'; } },
        { title: '参考销售价', width: 106, align: 'right', render: (_, field) => money(products.find(row => row.id === items[field.name]?.productId)?.defaultSalesPrice) },
        { title: '首选供应商售价', width: 132, align: 'right', render: (_, field) => { const item = items[field.name]; const product = products.find(row => row.id === item?.productId); const primary = [...(item?.suppliers || [])].sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId))[0]; return <strong className="template-primary-price">{money(salePriceOf(item, product, primary))}</strong>; } },
        { title: '首选供应商', width: 160, ellipsis: true, render: (_, field) => {
          const item = items[field.name];
          const primary = [...(item?.suppliers || [])].sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId))[0]?.supplierId;
          const primaryName = suppliers.find(row => row.id === primary)?.name;
          return item?.suppliers.length ? <span className="template-primary-supplier" title={primaryName}>{primaryName || '—'}</span> : <span className="template-matrix-na">未关联供应商</span>;
        } },
        { title: '供应商数', width: 82, align: 'center', render: (_, field) => `${items[field.name]?.suppliers.length || 0} 家` },
        { title: '操作', width: 132, fixed: 'right', render: (_, field) => { const productId = items[field.name]?.productId; return <div className="template-product-actions"><Button disabled={disabled} type="link" icon={<Settings2 size={15} />} onClick={() => setExpanded(current => current.includes(productId) ? current.filter(key => key !== productId) : [...current, productId])}>{expanded.includes(productId) ? '收起' : '配置价格'}</Button><Tooltip title="移除商品"><Button disabled={disabled} type="text" danger aria-label="移除商品" icon={<Trash2 size={16} />} onClick={() => remove(field.name)} /></Tooltip></div>; } },
      ]} />
    </>}</Form.List>
    </> : <><Table size="small" rowKey="id" dataSource={visible} rowSelection={{ getCheckboxProps: product => ({ disabled: disabled || !product.supplierPurchasePrices?.length, title: !product.supplierPurchasePrices?.length ? '请先在商品管理中维护供应商供货价' : undefined }), selectedRowKeys: pendingIds, preserveSelectedRowKeys: true, onChange: keys => changeSelection(keys.map(String)) }} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }} scroll={{ x: 560 }} columns={[
      { title: '商品名称', dataIndex: 'name', render: (_, product) => <span>{product.name}{selectedIds.has(product.id) && <small className="template-pending">待新增</small>}{!product.supplierPurchasePrices?.length && <small className="template-price-missing">未维护供应商供货价</small>}</span> }, { title: '分类', render: (_, product) => categories.find(row => row.id === product.categoryId)?.name || '-' }, { title: '货号', dataIndex: 'sku' }, { title: '参考销售价', dataIndex: 'defaultSalesPrice', render: money }, { title: '可供货供应商', width: 120, render: (_, product) => `${product.supplierPurchasePrices?.length || 0} 家` },
    ]} /><div className="template-picker-action"><span>已勾选 {pendingIds.length} 个待新增商品</span><Button type="primary" disabled={disabled || !pendingIds.length} onClick={configurePending}>加入已选并配置价格</Button></div></>}
    </div></div>
    <div className="template-change-summary">
      <span>已选 {items.length} 项 · 待新增 {items.filter(item => !originalIds.has(item.productId)).length} 项 · 待移除 {[...originalIds].filter(id => !selectedIds.has(id)).length} 项</span>
      {dirty ? <strong className="template-dirty">● 有未保存修改</strong> : null}
    </div>
  </>;
}
