import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Form, Image, Input, InputNumber, Modal, Select, Switch, Tabs, Tooltip, TreeSelect } from 'antd';
import { Pencil, ImageOff, Image as ImageIcon, LoaderCircle, X } from 'lucide-react';
import './Products.css';
import { ProductImageUpload } from '../components/ProductImageUpload';
import { PurchaseUnitFields } from '../components/PurchaseUnitFields';
import { ListPage } from '../components/ListPage';
import { getSession, hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { positiveIntegerRule } from '../lib/catalogTypes';

interface Product { supplierPurchasePrices?: { supplierId: string; supplyPrice: string; expectedVersionId: string | null }[]; id: string; supplierIds?: string[]; name: string; sku: string | null; version: number; categoryId: string; baseUnitId: string; brandId: string | null; brand: string | null; defaultSalesPrice: string | null; minOrderQty: string; orderMultiple: string; isActive: boolean; imageFileId: string | null; purchaseUnitConversion: { purchaseUnitId: string; salesUnitsPerPurchaseUnit: string } | null }
interface Named { id: string; name: string }
interface Category extends Named { parentId: string | null }
function fieldTab(name: string) { return ['supplierIds', 'purchasePrices', 'purchaseUnitId', 'salesUnitsPerPurchaseUnit'].includes(name) ? 'supply' : ['minOrderQty', 'orderMultiple'].includes(name) ? 'rules' : 'basic'; }
function ProductImage({ id }: { id: string | null }) {
  const [url, setUrl] = useState(''); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true; let objectUrl = ''; const controller = new AbortController(); setUrl(''); setFailed(false);
    if (id) fetch(`/api/v1/files/${id}/download`, { headers: { Authorization: `Bearer ${getSession()?.accessToken}` }, signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('图片读取失败'); return response.blob(); })
      .then(blob => { if (alive) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id]);
  const label = failed ? '图片加载失败' : id ? '图片加载中' : '暂无图片';
  const Icon = failed ? ImageOff : id ? LoaderCircle : ImageIcon;
  return url && !failed ? <Image width={40} height={40} src={url} alt="商品图片" onError={() => setFailed(true)} style={{ objectFit: 'cover', borderRadius: 4 }} /> :
    <Tooltip title={label}><span role="img" aria-label={label} style={{ display: 'inline-flex', width: 40, height: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 4, color: '#9ca3af', verticalAlign: 'middle' }}><Icon size={20} aria-hidden="true" /></span></Tooltip>;
}
export default function Products({ user }: { user: User }) {
  const data = useRows<Product>('/products'); const categories = useRows<Category>('/categories'); const units = useRows<Named>('/units'); const brands = useRows<Named>('/brands');
  const suppliers = useRows<Named & { status: string; isArchived: boolean }>('/suppliers');
  const writable = hasRole(user, 'ADMIN', 'PURCHASER'); const [editing, setEditing] = useState<Product | null | undefined>();
  const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(''); const lock = useRef(false); const [form] = Form.useForm();
  const selectedSupplierIds: string[] = Form.useWatch('supplierIds', form) || [];
  const salesUnitId = Form.useWatch('baseUnitId', form);
  const [activeTab, setActiveTab] = useState('basic');
  const [invalidTabs, setInvalidTabs] = useState<string[]>([]);
  const imageId = Form.useWatch('imageFileId', form); const { message } = App.useApp();
  const referencesError = categories.error || units.error || brands.error || suppliers.error;
  const options = (rows: Named[]) => rows.map(row => ({ value: row.id, label: row.name }));
  const categoryTree = categories.rows.filter(row => !row.parentId).map(row => ({ value: row.id, title: row.name, children: categories.rows.filter(child => child.parentId === row.id).map(child => ({ value: child.id, title: child.name })) }));
  const edit = (row: Product | null) => { form.resetFields(); form.setFieldsValue({ ...(row || { defaultSalesPrice: '0', minOrderQty: '1', orderMultiple: '1', isActive: true, storageCondition: 'AMBIENT', supplierIds: [] }), ...row?.purchaseUnitConversion, purchasePrices: Object.fromEntries((row?.supplierPurchasePrices || []).map(price => [price.supplierId, price.supplyPrice])) }); setEditing(row); setError(''); setActiveTab('basic'); setInvalidTabs([]); };
  const save = async () => {
    if (lock.current || uploading) return; const values = await form.validateFields().catch(failure => {
      const fields = failure.errorFields || [];
      setInvalidTabs([...new Set<string>(fields.map((field: { name: (string | number)[] }) => fieldTab(String(field.name[0]))))]);
      if (fields.length) {
        setActiveTab(fieldTab(String(fields[0].name[0])));
        setTimeout(() => form.scrollToField(fields[0].name, { block: 'center', focus: true }), 100);
      }
      return null;
    }); if (!values) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const body = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
      for (const key of ['sku', 'barcode', 'specification', 'imageFileId']) body[key] = body[key] || null;
      // Do not erase legacy free-text brands when unrelated fields are edited.
      if (values.brandId || !editing?.brand) body.brandId = values.brandId || null; else delete body.brandId;
      body.purchaseUnitConversion = values.purchaseUnitId ? { purchaseUnitId: values.purchaseUnitId, salesUnitsPerPurchaseUnit: values.salesUnitsPerPurchaseUnit } : null;
      body.supplierPurchasePrices = (values.supplierIds || []).flatMap((supplierId: string) => {
        const price = values.purchasePrices?.[supplierId];
        return price === undefined || price === null || price === '' ? [] : [{ supplierId, supplyPrice: String(price), expectedVersionId: editing?.supplierPurchasePrices?.find(row => row.supplierId === supplierId)?.expectedVersionId ?? null }];
      });
      delete body.purchasePrices;
      delete body.purchaseEnabled; delete body.purchaseUnitId; delete body.salesUnitsPerPurchaseUnit; delete body.brand;
      if (!editing) delete body.isActive;
      await request<Product>(`/products${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: { ...body, ...(editing ? { expectedVersion: editing.version } : {}) } });
      setEditing(undefined); data.reload(); message.success('商品已保存');
    } catch (failure) { setError((failure as Error).message); } finally { lock.current = false; setSaving(false); }
  };
  const decimal = (label: string, scale: number, positive = false) => [{ required: true, message: `请填写${label}` }, { validator: async (_: unknown, value: unknown) => {
    if (typeof value !== 'string' || !new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(value) || (positive && Number(value) <= 0)) throw new Error(`${label}须为${positive ? '正数' : '非负数'}，最多${scale}位小数`);
  } }];
  return <>
    <ListPage title="商品管理" {...data} create={writable ? () => edit(null) : undefined} filters={[{ key: 'categoryId', label: '分类', options: options(categories.rows) }]} columns={[
      { title: '图片', width: 75, render: (_, row) => <ProductImage id={row.imageFileId} /> },
      { title: '商品名称', dataIndex: 'name', width: 210, render: (_, row) => <strong>{row.name}</strong> },
      { title: '分类', width: 140, render: (_, row) => categories.rows.find(item => item.id === row.categoryId)?.name || '-' },
      { title: '销售单位', width: 100, render: (_, row) => units.rows.find(item => item.id === row.baseUnitId)?.name || '-' },
      { title: '销售价格', dataIndex: 'defaultSalesPrice', align: 'right', width: 120 },
      { title: '状态', width: 80, render: (_, row) => row.isActive ? '启用' : '停用' },
      { title: '操作', width: 80, fixed: 'right', render: (_, row) => <div className="row-actions">
        <Tooltip title={writable ? '编辑' : '查看'}><Button type="text" aria-label={`${writable ? '编辑' : '查看'}${row.name}`} icon={<Pencil size={16} />} onClick={() => edit(row)} /></Tooltip>
      </div> },
    ]} />
    <Modal className="product-editor" title={`${writable ? editing ? '编辑' : '新增' : '查看'}商品`} open={editing !== undefined} width={840} style={{ top: 24 }} onOk={() => save()} okText="保存" cancelText="取消" footer={!writable ? null : undefined}
      confirmLoading={saving} okButtonProps={{ disabled: uploading || Boolean(referencesError) || categories.loading || units.loading || brands.loading || suppliers.loading }} closable={!saving && !uploading} maskClosable={!saving && !uploading} keyboard={!saving && !uploading} onCancel={() => { if (!saving && !uploading) setEditing(undefined); }}>
      {(error || referencesError) && <Alert type="error" title={error || referencesError} showIcon />}
      <Form form={form} layout="vertical" disabled={!writable || saving || uploading} className="compact-form" onFieldsChange={() => setInvalidTabs([...new Set(form.getFieldsError().filter(field => field.errors.length).map(field => fieldTab(String(field.name[0]))))])}>
        <Tabs activeKey={activeTab} onChange={setActiveTab} destroyOnHidden={false} items={[
          { key: 'basic', forceRender: true, label: <span>基本信息{invalidTabs.includes('basic') && <span className="product-tab-error" aria-label="基本信息有错误">!</span>}</span>, children: <div className="form-grid">
        <Form.Item className="full-width" name="name" label="商品名称" rules={[{ required: true, whitespace: true, message: '请填写商品名称' }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="categoryId" label="商品分类" rules={[{ required: true, message: '请选择商品分类' }]}><TreeSelect showSearch treeNodeFilterProp="title" treeDefaultExpandAll treeData={categoryTree} /></Form.Item>
        <Form.Item name="baseUnitId" label="销售单位" rules={[{ required: true, message: '请选择销售单位' }]}><Select showSearch optionFilterProp="label" options={options(units.rows)} onChange={() => form.setFieldsValue({ purchaseUnitId: undefined, salesUnitsPerPurchaseUnit: undefined })} /></Form.Item>
        <Form.Item name="defaultSalesPrice" label="销售价格" rules={decimal('销售价格', 6)}><InputNumber aria-label="销售价格" stringMode min="0" precision={6} suffix={salesUnitId ? `元/${units.rows.find(row => row.id === salesUnitId)?.name || '销售单位'}` : '元'} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="storageCondition" label="储存条件"><Select options={[{ value: 'AMBIENT', label: '常温' }, { value: 'CHILLED', label: '冷藏' }, { value: 'FROZEN', label: '冷冻' }, { value: 'WARM', label: '保温' }]} /></Form.Item>
        <Form.Item name="brandId" label="品牌"><Select placeholder={editing?.brandId ? undefined : editing?.brand || undefined} allowClear showSearch optionFilterProp="label" options={options(brands.rows)} /></Form.Item>
        <Form.Item name="specification" label="规格"><Input maxLength={240} /></Form.Item>
        <Form.Item name="barcode" label="条码"><Input maxLength={100} /></Form.Item>
        <Form.Item name="sku" label="货号（选填）"><Input maxLength={100} /></Form.Item>
        {editing && <Form.Item name="isActive" label="启用" valuePropName="checked"><Switch /></Form.Item>}
        <Form.Item name="imageFileId" hidden><Input /></Form.Item>
        <Form.Item className="full-width" label="商品图片"><div className="actions"><ProductImage id={imageId || null} />{writable && <>
          <ProductImageUpload disabled={saving || uploading} onBusy={setUploading} onUpload={async file => {
              const session = await request<{ id: string; uploadToken: string }>('/files/upload-sessions', { method: 'POST', body: { purpose: 'PRODUCT', filename: file.name, mimeType: file.type, sizeBytes: file.size } });
              const response = await fetch(`/api/v1/files/${session.id}/content`, { method: 'POST', headers: { Authorization: `Bearer ${getSession()?.accessToken}`, 'x-upload-token': session.uploadToken, 'Content-Type': 'application/octet-stream' }, body: file, signal: AbortSignal.timeout(30000) });
              if (!response.ok) throw new Error('图片上传失败，请重新选择');
              await request(`/files/${session.id}/complete`, { method: 'POST' }); form.setFieldValue('imageFileId', session.id);
          }} />
          <Button disabled={saving || uploading || !imageId} onClick={() => form.setFieldValue('imageFileId', null)}>移除</Button>
        </>}</div></Form.Item>
          </div> },
          { key: 'supply', forceRender: true, label: <span>供应与采购{invalidTabs.includes('supply') && <span className="product-tab-error" aria-label="供应与采购有错误">!</span>}</span>, children: <>
        <section className="product-supplier-section" aria-label="供应商与采购价">
          <Form.Item name="supplierIds" label="关联供应商"><Select mode="multiple" placeholder="选择供应商" showSearch optionFilterProp="label" options={options(suppliers.rows.filter(row => !row.isArchived && (row.status === 'ACTIVE' || editing?.supplierIds?.includes(row.id))))} /></Form.Item>
          <div className="product-supplier-heading"><span>供应商名称</span><span>仓库采购价（选填）</span><span /></div>
          {selectedSupplierIds.length === 0 && <div className="product-supplier-empty">暂无关联供应商</div>}
          {selectedSupplierIds.map(supplierId => {
            const name = suppliers.rows.find(row => row.id === supplierId)?.name || '供应商';
            const unit = units.rows.find(row => row.id === salesUnitId)?.name;
            const existingPrice = editing?.supplierPurchasePrices?.find(row => row.supplierId === supplierId)?.supplyPrice;
            return <div className="product-supplier-row" key={supplierId}>
              <span className="product-supplier-name" title={name}>{name}</span>
              <div className="product-supplier-price"><Form.Item name={['purchasePrices', supplierId]} rules={[{ validator: async (_, value) => { if (value === undefined || value === null || value === '') return; if (typeof value !== 'string' || !/^\d{1,14}(\.\d{1,6})?$/.test(value)) throw new Error('采购价须为非负数，最多6位小数'); } }]}><InputNumber aria-label={name} stringMode min="0" precision={6} placeholder={existingPrice !== undefined ? `当前 ${existingPrice}` : '未设置'} style={{ width: '100%' }} /></Form.Item><span className="product-price-unit">{unit ? `元/${unit}` : '元/销售单位'}</span></div>
              <Tooltip title={`移除${name}`}><Button type="text" aria-label={`移除关联供应商${name}`} disabled={!writable || saving || uploading} icon={<X size={16} />} onClick={() => form.setFieldValue('supplierIds', selectedSupplierIds.filter(id => id !== supplierId))} /></Tooltip>
            </div>;
          })}
          <div className="form-grid product-conversion-fields"><PurchaseUnitFields units={units.rows} /></div>
        </section>
          </> },
          { key: 'rules', forceRender: true, label: <span>订货规则{invalidTabs.includes('rules') && <span className="product-tab-error" aria-label="订货规则有错误">!</span>}</span>, children: <div className="form-grid">
        <Form.Item name="minOrderQty" label="最小起订量" rules={[positiveIntegerRule('最小起订量')]}><InputNumber stringMode min="1" step="1" precision={0} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="orderMultiple" label="订购倍数" rules={[positiveIntegerRule('订购倍数')]}><InputNumber stringMode min="1" step="1" precision={0} style={{ width: '100%' }} /></Form.Item>
          </div> },
        ]} />
      </Form>
    </Modal>

  </>;
}
