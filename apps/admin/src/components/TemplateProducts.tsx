import { useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Switch, Table, Tooltip, Tree } from 'antd';
import { Plus, Trash2 } from 'lucide-react';
import { positiveIntegerRule, namedOptions, settlementOptions, type CatalogProduct, type CatalogSupplier, type Named, type TemplateDetail, type TemplateItem } from '../lib/catalogTypes';
import './TemplateProducts.css';

export function TemplateProducts({ products, suppliers, categories, detail }: { products: CatalogProduct[]; suppliers: CatalogSupplier[]; categories: (Named & { parentId?: string | null })[]; detail: TemplateDetail | null }) {
  const form = Form.useFormInstance();
  const [picker, setPicker] = useState(false); const [category, setCategory] = useState<string>(); const [search, setSearch] = useState(''); const [selected, setSelected] = useState<string[]>([]);
  const items: TemplateItem[] = Form.useWatch('items', form) || [];
  const selectedIds = new Set(items.map(item => item.productId));
  const categoryIds = new Set(category ? [category, ...categories.filter(row => row.parentId === category).map(row => row.id)] : []);
  const visible = products.filter(product => product.isActive && !selectedIds.has(product.id) && (!category || categoryIds.has(product.categoryId)) && `${product.name} ${product.sku || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const addSelected = () => {
    const additions = products.filter(product => selected.includes(product.id) && !selectedIds.has(product.id) && product.isActive).map((product, index) => ({ productId: product.id, sortOrder: items.length + index, isEnabled: true, minOrderQty: null, orderMultiple: null,
      suppliers: suppliers.filter(supplier => !supplier.isArchived && product.supplierIds?.includes(supplier.id)).map((supplier, priority) => ({ supplierId: supplier.id, priority: (priority + 1) * 10 })) }));
    form.setFieldValue('items', [...items, ...additions]); setSelected([]); setPicker(false);
  };
  return <>
    <Form.List name="items">{(fields, { remove }) => <>
      <div className="filter-bar"><Button icon={<Plus size={16} />} onClick={() => { setSelected([]); setPicker(true); }}>添加商品</Button></div>
      <Table className="template-products-table" size="small" rowKey="key" dataSource={fields} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }} scroll={{ x: 1100 }} columns={[
        { title: '商品', width: 180, render: (_, field) => <Form.Item name={[field.name, 'productId']} rules={[{ required: true, message: '请选择商品' }]}><Select aria-label="商品" showSearch optionFilterProp="label" options={namedOptions(products)} /></Form.Item> },
        { title: '供货方 / 优先级', width: 300, render: (_, field) => <Form.List name={[field.name, 'suppliers']} rules={[{ validator: async (_, links) => { if (!links?.length) throw new Error('每个商品至少选择一个供货方'); } }]}>{(links, controls, meta) => <>
          {links.map(link => <div className="template-supplier-cell" key={link.key}>
            <Form.Item name={[link.name, 'supplierId']} rules={[{ required: true, message: '请选择供货方' }]}><Select aria-label="供货方" showSearch optionFilterProp="label" options={namedOptions(suppliers.filter(supplier => !supplier.isArchived))} /></Form.Item>
            <Form.Item name={[link.name, 'priority']} rules={[{ required: true }]}><InputNumber aria-label="优先级" precision={0} min={0} max={2147483647} /></Form.Item>
            <Tooltip title="移除供货方"><Button type="text" danger aria-label="移除供货方" icon={<Trash2 size={14} />} onClick={() => controls.remove(link.name)} /></Tooltip>
          </div>)}<Form.ErrorList errors={meta.errors} /><Button size="small" icon={<Plus size={14} />} onClick={() => controls.add({ priority: 100 })}>供货方</Button>
        </>}</Form.List> },
        { title: '供货价 / 售价', width: 150, render: (_, field) => {
          const item = detail?.items.find(item => item.productId === items[field.name]?.productId);
          return item?.suppliers.length ? item.suppliers.map(link => <div key={link.supplierId}>{link.supplyPrice ?? '-'} / {link.salesPrice ?? item.initialSalesPrice ?? '-'}</div>) : '-';
        } },
        { title: '结算方式', width: 140, render: (_, field) => (items[field.name]?.suppliers || []).map(link => {
          const setting = detail?.settings.find(row => row.supplierId === link.supplierId); const supplier = suppliers.find(row => row.id === link.supplierId);
          return <div key={link.supplierId}>{settlementOptions.find(option => option.value === (setting?.settlementMode || supplier?.defaultSettlementMode))?.label || '-'}</div>;
        }) },
        { title: '起订量', width: 120, render: (_, field) => <Form.Item name={[field.name, 'minOrderQty']} rules={[positiveIntegerRule('起订量', true)]}><InputNumber aria-label="起订量覆盖" stringMode min="1" step="1" precision={0} placeholder={products.find(product => product.id === items[field.name]?.productId)?.minOrderQty || '1'} /></Form.Item> },
        { title: '订货倍数', width: 120, render: (_, field) => <Form.Item name={[field.name, 'orderMultiple']} rules={[positiveIntegerRule('订货倍数', true)]}><InputNumber aria-label="订货倍数覆盖" stringMode min="1" step="1" precision={0} placeholder={products.find(product => product.id === items[field.name]?.productId)?.orderMultiple || '1'} /></Form.Item> },
        { title: '排序', width: 100, render: (_, field) => <Form.Item name={[field.name, 'sortOrder']} rules={[{ required: true }]}><InputNumber aria-label="排序" precision={0} min={0} max={2147483647} /></Form.Item> },
        { title: '启用', width: 70, render: (_, field) => <Form.Item name={[field.name, 'isEnabled']} valuePropName="checked"><Switch size="small" aria-label="启用" /></Form.Item> },
        { title: '操作', width: 60, fixed: 'right', render: (_, field) => <Tooltip title="移除商品"><Button type="text" danger aria-label="移除商品" icon={<Trash2 size={16} />} onClick={() => remove(field.name)} /></Tooltip> },
      ]} />
    </>}</Form.List>
    <Modal title="添加商品" open={picker} width={960} onCancel={() => setPicker(false)} onOk={addSelected} okText={`添加已选商品 (${selected.length})`} okButtonProps={{ disabled: !selected.length }} cancelText="取消">
      <div className="filter-bar"><Select aria-label="商品分类" allowClear placeholder="全部分类" showSearch optionFilterProp="label" options={namedOptions(categories)} value={category} onChange={setCategory} /><Input.Search aria-label="搜索商品" placeholder="商品名称 / 货号" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <div className="template-product-picker"><aside><Tree blockNode defaultExpandAll selectedKeys={[category || 'all']} onSelect={keys => setCategory(keys[0] && keys[0] !== 'all' ? String(keys[0]) : undefined)} treeData={[{ key: 'all', title: '全部分类' }, ...categories.filter(row => !row.parentId || !categories.some(parent => parent.id === row.parentId)).map(row => ({ key: row.id, title: row.name, children: categories.filter(child => child.parentId === row.id).map(child => ({ key: child.id, title: child.name })) }))]} /></aside>
      <Table size="small" rowKey="id" dataSource={visible} rowSelection={{ selectedRowKeys: selected, preserveSelectedRowKeys: true, onChange: keys => setSelected(keys.map(String)) }} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }} scroll={{ x: 560 }} columns={[
        { title: '商品名称', dataIndex: 'name' }, { title: '分类', render: (_, product) => categories.find(row => row.id === product.categoryId)?.name || '-' }, { title: '货号', dataIndex: 'sku' }, { title: '默认售价', dataIndex: 'defaultSalesPrice' },
      ]} /></div>
    </Modal>
  </>;
}
