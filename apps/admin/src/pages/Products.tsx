import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, Button, Empty, Form, Image, Input, InputNumber, Modal, Segmented, Select, Switch, Table, Tag, Tooltip, TreeSelect } from 'antd';
import { ChevronRight, Pencil, ImageOff, Image as ImageIcon, LoaderCircle, Plus, RefreshCw, Search } from 'lucide-react';
import './Products.css';
import { ProductImageUpload } from '../components/ProductImageUpload';
import { PurchaseUnitFields } from '../components/PurchaseUnitFields';
import { getSession, hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { positiveIntegerRule } from '../lib/catalogTypes';
import { money } from '../lib/money';

interface Product { id: string; name: string; sku: string | null; version: number; categoryId: string; baseUnitId: string; brandId: string | null; brand: string | null; defaultSalesPrice: string | null; minOrderQty: string; orderMultiple: string; isActive: boolean; imageFileId: string | null; purchaseUnitConversion: { purchaseUnitId: string; salesUnitsPerPurchaseUnit: string } | null }
interface Named { id: string; name: string }
interface Category extends Named { parentId: string | null }
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
  const writable = hasRole(user, 'ADMIN', 'PURCHASER'); const [editing, setEditing] = useState<Product | null | undefined>();
  const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(''); const lock = useRef(false); const [form] = Form.useForm();
  const salesUnitId = Form.useWatch('baseUnitId', form);
  const imageId = Form.useWatch('imageFileId', form); const { message } = App.useApp();
  const referencesError = categories.error || units.error || brands.error;
  const options = (rows: Named[]) => rows.map(row => ({ value: row.id, label: row.name }));
  // Products may only sit on leaf categories, so grouping nodes are selectable as containers but not as targets.
  const childCategoryIds = new Set(categories.rows.filter(row => row.parentId).map(row => row.parentId));
  const categoryTree = categories.rows.filter(row => !row.parentId).map(row => ({ value: row.id, title: row.name,
    disabled: childCategoryIds.has(row.id),
    children: categories.rows.filter(child => child.parentId === row.id).map(child => ({ value: child.id, title: child.name })) }));
  const edit = (row: Product | null) => { form.resetFields(); form.setFieldsValue({ ...(row || { defaultSalesPrice: '0', minOrderQty: '1', orderMultiple: '1', isActive: true, storageCondition: 'AMBIENT' }), ...row?.purchaseUnitConversion }); setEditing(row); setError(''); };
  const save = async () => {
    if (lock.current || uploading) return; const values = await form.validateFields().catch(failure => {
      const fields = failure.errorFields || [];
      if (fields.length) setTimeout(() => form.scrollToField(fields[0].name, { block: 'center', focus: true }), 100);
      return null;
    }); if (!values) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const body = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
      for (const key of ['sku', 'barcode', 'specification', 'imageFileId']) body[key] = body[key] || null;
      // Do not erase legacy free-text brands when unrelated fields are edited.
      if (values.brandId || !editing?.brand) body.brandId = values.brandId || null; else delete body.brandId;
      body.purchaseUnitConversion = values.purchaseUnitId ? { purchaseUnitId: values.purchaseUnitId, salesUnitsPerPurchaseUnit: values.salesUnitsPerPurchaseUnit } : null;
      delete body.purchaseUnitId; delete body.salesUnitsPerPurchaseUnit; delete body.brand;
      if (!editing) delete body.isActive;
      await request<Product>(`/products${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: { ...body, ...(editing ? { expectedVersion: editing.version } : {}) } });
      setEditing(undefined); data.reload(); message.success('商品已保存');
    } catch (failure) { setError((failure as Error).message); } finally { lock.current = false; setSaving(false); }
  };
  const decimal = (label: string, scale: number, positive = false) => [{ required: true, message: `请填写${label}` }, { validator: async (_: unknown, value: unknown) => {
    if (typeof value !== 'string' || !new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(value) || (positive && Number(value) <= 0)) throw new Error(`${label}须为${positive ? '正数' : '非负数'}，最多${scale}位小数`);
  } }];
const useNarrow = () => { const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches);
  useEffect(() => { const query = window.matchMedia('(max-width: 600px)'); const update = () => setNarrow(query.matches);
    query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []); return narrow; };

  // 左侧分类导航 + 右侧商品列表
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [categoryKeyword, setCategoryKeyword] = useState('');
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1); const [size, setSize] = useState(10);
  const narrow = useNarrow();

  const sortedCategories = useMemo(() => [...categories.rows].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')), [categories.rows]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of data.rows) map.set(row.categoryId, (map.get(row.categoryId) || 0) + 1);
    return map;
  }, [data.rows]);
  const descendants = useMemo(() => {
    const map = new Map<string, string[]>();
    const collect = (parentId: string): string[] => sortedCategories.filter(row => row.parentId === parentId).flatMap(row => [row.id, ...collect(row.id)]);
    for (const row of sortedCategories) map.set(row.id, collect(row.id));
    return map;
  }, [sortedCategories]);
  const countFor = (id: string) => (descendants.get(id) || []).reduce((total, childId) => total + (counts.get(childId) || 0), 0) + (counts.get(id) || 0);

  const treeQuery = categoryKeyword.trim().toLocaleLowerCase();
  const visibleRoots = useMemo(() => sortedCategories.filter(row => !row.parentId || !sortedCategories.some(parent => parent.id === row.parentId)).filter(root => {
    if (!treeQuery) return true;
    return root.name.toLocaleLowerCase().includes(treeQuery)
      || sortedCategories.some(child => child.parentId === root.id && child.name.toLocaleLowerCase().includes(treeQuery));
  }), [sortedCategories, treeQuery]);

  const activeCategoryName = activeCategory ? categories.rows.find(row => row.id === activeCategory)?.name || '' : '';
  const filtered = useMemo(() => {
    const scope = activeCategory ? [activeCategory, ...(descendants.get(activeCategory) || [])] : null;
    const query = keyword.trim().toLocaleLowerCase();
    return data.rows.filter(row => (!scope || scope.includes(row.categoryId))
      && (status === 'all' || row.isActive === (status === 'active'))
      && (!query || `${row.name} ${row.sku || ''}`.toLocaleLowerCase().includes(query)));
  }, [data.rows, activeCategory, descendants, keyword, status]);
  const selectCategory = (id: string) => { setActiveCategory(id); setPage(1); };
  const resetFilters = () => { setKeyword(''); setStatus('all'); setPage(1); };

  return <>
    <section className="product-browser">
      <aside className="product-category-panel">
        <div className="product-category-title">商品分类</div>
        <Input className="product-category-search" size="small" allowClear aria-label="搜索分类" placeholder="搜索分类" prefix={<Search size={14} />}
          value={categoryKeyword} onChange={event => setCategoryKeyword(event.target.value)} />
        <nav className="product-category-list" aria-label="商品分类">
          <button type="button" className={`product-category-item${activeCategory === '' ? ' is-active' : ''}`} aria-current={activeCategory === '' || undefined}
            onClick={() => selectCategory('')}>
            <span className="product-category-name">全部商品</span><span className="product-category-count">{data.rows.length}</span>
          </button>
          {visibleRoots.map(root => {
            const children = sortedCategories.filter(row => row.parentId === root.id);
            const shown = children.filter(child => !treeQuery || root.name.toLocaleLowerCase().includes(treeQuery) || child.name.toLocaleLowerCase().includes(treeQuery));
            const isOpen = !collapsed.includes(root.id);
            return <div className="product-category-group" key={root.id}>
              <div className={`product-category-row${activeCategory === root.id ? ' is-active' : ''}`}>
                {children.length > 0 && <button type="button" className="product-category-toggle" aria-label={`${isOpen ? '收起' : '展开'}${root.name}`} aria-expanded={isOpen}
                  onClick={() => setCollapsed(current => isOpen ? [...current, root.id] : current.filter(id => id !== root.id))}>
                  <ChevronRight size={14} className={isOpen ? 'is-open' : undefined} aria-hidden="true" />
                </button>}
                <button type="button" className="product-category-item" aria-current={activeCategory === root.id || undefined} onClick={() => selectCategory(root.id)}>
                  <span className="product-category-name">{root.name}</span><span className="product-category-count">{countFor(root.id)}</span>
                </button>
              </div>
              {children.length > 0 && isOpen && <div className="product-category-children">
                {shown.map(child => <button type="button" key={child.id} className={`product-category-item is-child${activeCategory === child.id ? ' is-active' : ''}`}
                  aria-current={activeCategory === child.id || undefined} onClick={() => selectCategory(child.id)}>
                  <span className="product-category-name">{child.name}</span><span className="product-category-count">{counts.get(child.id) || 0}</span>
                </button>)}
              </div>}
            </div>;
          })}
          {!visibleRoots.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的分类" />}
        </nav>
      </aside>
      <div className="product-list-panel">
        <div className="page-heading">
          <h1>商品管理</h1>
          <div className="actions">
            <span className="product-scope">{activeCategoryName ? `分类：${activeCategoryName}` : `全部 ${data.rows.length} 个商品`}</span>
            <Tooltip title="刷新列表"><Button aria-label="刷新列表" icon={<RefreshCw size={16} />} onClick={() => { data.reload(); categories.reload(); }} loading={data.loading} /></Tooltip>
            {writable && <Button type="primary" icon={<Plus size={16} />} onClick={() => edit(null)}>新增</Button>}
          </div>
        </div>
        <div className="filter-bar">
          <Input className="search-input" allowClear aria-label="搜索商品管理" placeholder="商品名称、货号" prefix={<Search size={16} />} value={keyword}
            onChange={event => { setKeyword(event.target.value); setPage(1); }} />
          <Segmented aria-label="按状态筛选" value={status} onChange={value => { setStatus(value as typeof status); setPage(1); }}
            options={[{ label: '全部', value: 'all' }, { label: '启用', value: 'active' }, { label: '停用', value: 'inactive' }]} />
          <Tooltip title="重置筛选"><Button aria-label="重置筛选" icon={<RefreshCw size={16} />} onClick={resetFilters} /></Tooltip>
        </div>
        {data.error && <Alert type="error" showIcon title={data.error} action={<Button size="small" onClick={data.reload}>重试</Button>} />}
        <Table<Product> rowKey="id" size="small" loading={data.loading} dataSource={filtered} scroll={narrow ? undefined : { x: 720 }}
          locale={{ emptyText: <Empty description={keyword || status !== 'all' ? '没有符合条件的商品' : '该分类下还没有商品'} /> }}
          pagination={{ current: Math.min(page, Math.max(1, Math.ceil(filtered.length / size))), pageSize: size, showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100], showTotal: total => `共 ${total} 条`,
            onChange: (current, pageSize) => { setPage(pageSize !== size ? 1 : current); setSize(pageSize); } }}
          columns={[
            { title: '图片', width: 72, render: (_, row) => <ProductImage id={row.imageFileId} /> },
            { title: '商品名称', dataIndex: 'name', ellipsis: narrow, render: (_, row) => <span className="product-cell-name" title={row.name}>{row.name}</span> },
            ...(narrow ? [{ title: '商品价格（参考）', dataIndex: 'defaultSalesPrice', align: 'right' as const, width: 118, render: money }] : [
              { title: '分类', width: 130, render: (_: unknown, row: Product) => categories.rows.find(item => item.id === row.categoryId)?.name || '-' },
              { title: '销售单位', width: 92, render: (_: unknown, row: Product) => units.rows.find(item => item.id === row.baseUnitId)?.name || '-' },
              { title: '商品价格（参考）', dataIndex: 'defaultSalesPrice', align: 'right' as const, width: 140, render: money },
              { title: '状态', width: 72, render: (_: unknown, row: Product) => <Tag color={row.isActive ? 'green' : 'default'}>{row.isActive ? '启用' : '停用'}</Tag> },
            ]),
            { title: '操作', align: 'right' as const, width: 88, fixed: narrow ? undefined : 'right', render: (_, row) => <RowActions ariaLabel={row.name} actions={[{ key: 'edit', label: writable ? '编辑' : '查看', icon: <Pencil size={15} />, onClick: () => edit(row) }]} /> },
          ]} />
      </div>
    </section>
    <Modal className="product-editor" title={`${writable ? editing ? '编辑' : '新增' : '查看'}商品`} open={editing !== undefined} width={840} style={{ top: 24 }} onOk={() => save()} okText="保存" cancelText="取消" footer={!writable ? null : undefined}
      confirmLoading={saving} okButtonProps={{ disabled: uploading || Boolean(referencesError) || categories.loading || units.loading || brands.loading }} closable={!saving && !uploading} maskClosable={!saving && !uploading} keyboard={!saving && !uploading} onCancel={() => { if (!saving && !uploading) setEditing(undefined); }}>
      {(error || referencesError) && <Alert type="error" title={error || referencesError} showIcon />}
      {writable && <Alert type="info" showIcon message="供应商关联、供货价与上下架请在“供应商管理 > 管理商品”中维护。" />}
      <Form form={form} layout="vertical" disabled={!writable || saving || uploading} className="compact-form product-form">
        <section className="product-form-section" aria-label="商品信息">
          <div className="product-form-heading">商品信息</div>
          <div className="form-grid">
        <Form.Item className="full-width" name="name" label="商品名称" rules={[{ required: true, whitespace: true, message: '请填写商品名称' }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="categoryId" label="商品分类" rules={[{ required: true, message: '请选择商品分类' }]}><TreeSelect showSearch treeNodeFilterProp="title" treeDefaultExpandAll treeData={categoryTree} /></Form.Item>
        <Form.Item name="baseUnitId" label="销售单位" rules={[{ required: true, message: '请选择销售单位' }]}><Select showSearch optionFilterProp="label" options={options(units.rows)} onChange={() => form.setFieldsValue({ purchaseUnitId: undefined, salesUnitsPerPurchaseUnit: undefined })} /></Form.Item>
        <Form.Item name="defaultSalesPrice" label="商品价格（参考）" rules={decimal('商品价格', 2)}><InputNumber aria-label="商品价格（参考）" stringMode min="0" precision={2} suffix={salesUnitId ? `元/${units.rows.find(row => row.id === salesUnitId)?.name || '销售单位'}` : '元'} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="storageCondition" label="储存条件"><Select options={[{ value: 'AMBIENT', label: '常温' }, { value: 'CHILLED', label: '冷藏' }, { value: 'FROZEN', label: '冷冻' }, { value: 'WARM', label: '保温' }]} /></Form.Item>
        <Form.Item name="brandId" label="品牌"><Select placeholder={editing?.brandId ? undefined : editing?.brand || undefined} allowClear showSearch optionFilterProp="label" options={options(brands.rows)} /></Form.Item>
        <Form.Item name="specification" label="规格"><Input maxLength={240} /></Form.Item>
        <Form.Item name="barcode" label="条码"><Input maxLength={100} /></Form.Item>
        <Form.Item name="sku" label="货号（选填）"><Input maxLength={100} /></Form.Item>
        {editing && <Form.Item name="isActive" label="启用" valuePropName="checked"><Switch /></Form.Item>}
          </div>
        </section>
        <section className="product-form-section" aria-label="单位换算">
          <div className="product-form-heading">单位换算 <span className="product-form-note">选填；采购单位与销售单位不同时设置换算关系</span></div>
          <div className="form-grid"><PurchaseUnitFields units={units.rows} salesUnitId={salesUnitId} /></div>
        </section>
        <section className="product-form-section" aria-label="订货规则">
          <div className="product-form-heading">订货规则 <span className="product-form-note">默认最小起订量和订购倍数均为 1 个销售单位</span></div>
          <div className="form-grid">
            <Form.Item name="minOrderQty" label="最小起订量" rules={[positiveIntegerRule('最小起订量')]}><InputNumber stringMode min="1" step="1" precision={0} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="orderMultiple" label="订购倍数" rules={[positiveIntegerRule('订购倍数')]}><InputNumber stringMode min="1" step="1" precision={0} style={{ width: '100%' }} /></Form.Item>
          </div>
        </section>
        <section className="product-form-section" aria-label="商品图片">
          <div className="product-form-heading">商品图片 <span className="product-form-note">正方形展示；上传时可裁切，图片大于 2MB 自动压缩</span></div>
          <div className="form-grid">
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
          </div>
        </section>
      </Form>
    </Modal>

  </>;
}
import { RowActions } from '../components/RowActions';
