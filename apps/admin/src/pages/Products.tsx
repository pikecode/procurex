import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Form, Image, Input, InputNumber, Modal, Select, Switch, Tooltip, Upload } from 'antd';
import { ArrowLeftRight, Pencil, Upload as UploadIcon } from 'lucide-react';
import { ListPage } from '../components/ListPage';
import { getSession, hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';

interface Product { id: string; name: string; sku: string | null; version: number; categoryId: string; baseUnitId: string; brandId: string | null; brand: string | null; defaultSalesPrice: string | null; minOrderQty: string; orderMultiple: string; isActive: boolean; imageFileId: string | null; purchaseUnitConversion: { purchaseUnitId: string; salesUnitsPerPurchaseUnit: string } | null }
interface Named { id: string; name: string }
function ProductImage({ id }: { id: string | null }) {
  const [url, setUrl] = useState(''); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true; let objectUrl = ''; const controller = new AbortController(); setUrl(''); setFailed(false);
    if (id) fetch(`/api/v1/files/${id}/download`, { headers: { Authorization: `Bearer ${getSession()?.accessToken}` }, signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('图片读取失败'); return response.blob(); })
      .then(blob => { if (alive) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id]);
  return url ? <Image width={40} height={40} src={url} style={{ objectFit: 'cover' }} /> : <span>{failed ? '加载失败' : id ? '加载中' : '-'}</span>;
}
export default function Products({ user }: { user: User }) {
  const data = useRows<Product>('/products'); const categories = useRows<Named>('/categories'); const units = useRows<Named>('/units'); const brands = useRows<Named>('/brands');
  const writable = hasRole(user, 'ADMIN', 'PURCHASER'); const [editing, setEditing] = useState<Product | null | undefined>();
  const [conversion, setConversion] = useState<Product | null>(null); const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(''); const lock = useRef(false); const [form] = Form.useForm(); const [unitForm] = Form.useForm();
  const imageId = Form.useWatch('imageFileId', form); const { message } = App.useApp();
  const referencesError = categories.error || units.error || brands.error;
  const options = (rows: Named[]) => rows.map(row => ({ value: row.id, label: row.name }));
  const edit = (row: Product | null) => { form.resetFields(); form.setFieldsValue(row || { defaultSalesPrice: '0', minOrderQty: '1', orderMultiple: '1', isActive: true, storageCondition: 'AMBIENT' }); setEditing(row); setError(''); };
  const save = async () => {
    if (lock.current || uploading) return; const values = await form.validateFields().catch(() => null); if (!values) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const body = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
      for (const key of ['sku', 'barcode', 'specification', 'imageFileId']) body[key] = body[key] || null;
      // Do not erase legacy free-text brands when unrelated fields are edited.
      if (values.brandId || !editing?.brand) body.brandId = values.brandId || null; else delete body.brandId;
      delete body.purchaseUnitConversion; delete body.brand;
      if (!editing) delete body.isActive;
      await request(`/products${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: { ...body, ...(editing ? { expectedVersion: editing.version } : {}) } });
      setEditing(undefined); data.reload(); message.success('商品已保存');
    } catch (failure) { setError((failure as Error).message); } finally { lock.current = false; setSaving(false); }
  };
  const decimal = (label: string, scale: number, positive = false) => [{ required: true, message: `请填写${label}` }, { validator: async (_: unknown, value: unknown) => {
    if (typeof value !== 'string' || !new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(value) || (positive && Number(value) <= 0)) throw new Error(`${label}须为${positive ? '正数' : '非负数'}，最多${scale}位小数`);
  } }];
  return <>
    <ListPage title="商品管理" {...data} create={writable ? () => edit(null) : undefined} filters={[{ key: 'categoryId', label: '分类', options: options(categories.rows) }]} columns={[
      { title: '图片', width: 75, render: (_, row) => <ProductImage id={row.imageFileId} /> },
      { title: '商品名称', dataIndex: 'name', width: 210 }, { title: '商品编码', dataIndex: 'sku', width: 130 },
      { title: '分类', width: 140, render: (_, row) => categories.rows.find(item => item.id === row.categoryId)?.name || '-' },
      { title: '销售单位', width: 100, render: (_, row) => units.rows.find(item => item.id === row.baseUnitId)?.name || '-' },
      { title: '默认售价', dataIndex: 'defaultSalesPrice', align: 'right', width: 120 },
      { title: '状态', width: 80, render: (_, row) => row.isActive ? '启用' : '停用' },
      { title: '操作', width: 90, fixed: 'right', render: (_, row) => <div className="row-actions">
        <Tooltip title={writable ? '编辑' : '查看'}><Button type="text" aria-label={`${writable ? '编辑' : '查看'}${row.name}`} icon={<Pencil size={16} />} onClick={() => edit(row)} /></Tooltip>
        <Tooltip title="采购单位换算"><Button type="text" aria-label={`采购单位换算${row.name}`} icon={<ArrowLeftRight size={16} />} onClick={() => { setConversion(row); unitForm.resetFields(); unitForm.setFieldsValue({ enabled: Boolean(row.purchaseUnitConversion), ...row.purchaseUnitConversion }); setError(''); }} /></Tooltip>
      </div> },
    ]} />
    <Modal title={`${writable ? editing ? '编辑' : '新增' : '查看'}商品`} open={editing !== undefined} width={720} onOk={save} okText="保存" cancelText="取消" footer={!writable ? null : undefined}
      confirmLoading={saving} okButtonProps={{ disabled: uploading || Boolean(referencesError) || categories.loading || units.loading || brands.loading }} closable={!saving && !uploading} maskClosable={!saving && !uploading} keyboard={!saving && !uploading} onCancel={() => { if (!saving && !uploading) setEditing(undefined); }}>
      {(error || referencesError) && <Alert type="error" title={error || referencesError} showIcon />}
      <Form form={form} layout="vertical" disabled={!writable || saving || uploading} className="compact-form"><div className="form-grid">
        <Form.Item name="name" label="商品名称" rules={[{ required: true, whitespace: true, message: '请填写商品名称' }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="sku" label="商品编码"><Input maxLength={100} /></Form.Item>
        <Form.Item name="categoryId" label="分类" rules={[{ required: true, message: '请选择分类' }]}><Select showSearch optionFilterProp="label" options={options(categories.rows)} /></Form.Item>
        <Form.Item name="baseUnitId" label="销售单位" rules={[{ required: true, message: '请选择销售单位' }]}><Select showSearch optionFilterProp="label" options={options(units.rows)} /></Form.Item>
        <Form.Item name="brandId" label="品牌"><Select placeholder={editing?.brandId ? undefined : editing?.brand || undefined} allowClear showSearch optionFilterProp="label" options={options(brands.rows)} /></Form.Item>
        <Form.Item name="barcode" label="条形码"><Input maxLength={100} /></Form.Item>
        <Form.Item name="specification" label="规格"><Input maxLength={240} /></Form.Item>
        <Form.Item name="storageCondition" label="存储条件"><Select options={[{ value: 'AMBIENT', label: '常温' }, { value: 'CHILLED', label: '冷藏' }, { value: 'FROZEN', label: '冷冻' }, { value: 'WARM', label: '保温' }]} /></Form.Item>
        <Form.Item name="defaultSalesPrice" label="默认售价" rules={decimal('默认售价', 6)}><InputNumber stringMode min="0" precision={6} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="minOrderQty" label="最小起订量" rules={decimal('最小起订量', 6, true)}><InputNumber stringMode precision={6} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="orderMultiple" label="订购倍数" rules={decimal('订购倍数', 6, true)}><InputNumber stringMode precision={6} style={{ width: '100%' }} /></Form.Item>
        {editing && <Form.Item name="isActive" label="启用" valuePropName="checked"><Switch /></Form.Item>}
        <Form.Item name="imageFileId" hidden><Input /></Form.Item>
        <Form.Item label="商品图片"><div className="actions"><ProductImage id={imageId || null} />{writable && <>
          <Upload accept="image/jpeg,image/png" showUploadList={false} disabled={saving || uploading} beforeUpload={async file => {
            if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 2 * 1024 * 1024 || !file.size) { message.error('请选择不超过2MB的JPEG或PNG图片'); return false; }
            setUploading(true); setError('');
            try {
              const session = await request<{ id: string; uploadToken: string }>('/files/upload-sessions', { method: 'POST', body: { purpose: 'PRODUCT', filename: file.name, mimeType: file.type, sizeBytes: file.size } });
              const response = await fetch(`/api/v1/files/${session.id}/content`, { method: 'POST', headers: { Authorization: `Bearer ${getSession()?.accessToken}`, 'x-upload-token': session.uploadToken, 'Content-Type': 'application/octet-stream' }, body: file, signal: AbortSignal.timeout(30000) });
              if (!response.ok) throw new Error('图片上传失败，请重新选择');
              await request(`/files/${session.id}/complete`, { method: 'POST' }); form.setFieldValue('imageFileId', session.id);
            } catch (failure) { setError((failure as Error).message); } finally { setUploading(false); }
            return false;
          }}><Button icon={<UploadIcon size={16} />} loading={uploading}>上传图片</Button></Upload>
          <Button disabled={saving || uploading || !imageId} onClick={() => form.setFieldValue('imageFileId', null)}>移除</Button>
        </>}</div></Form.Item>
      </div></Form>
    </Modal>
    <Modal title={`采购单位换算 · ${conversion?.name || ''}`} open={Boolean(conversion)} width={480} footer={!writable ? null : undefined} okText="保存" cancelText="关闭" confirmLoading={saving} okButtonProps={{ disabled: units.loading || Boolean(units.error) }} closable={!saving} maskClosable={!saving} keyboard={!saving} onCancel={() => { if (!saving) setConversion(null); }} onOk={async () => {
      if (lock.current || !conversion) return; const values = await unitForm.validateFields().catch(() => null); if (!values) return; lock.current = true; setSaving(true); setError('');
      try { await request(`/products/${conversion.id}/purchase-unit`, { method: 'PATCH', body: { expectedVersion: conversion.version, conversion: values.enabled ? { purchaseUnitId: values.purchaseUnitId, salesUnitsPerPurchaseUnit: values.salesUnitsPerPurchaseUnit } : null } }); setConversion(null); data.reload(); message.success('换算已保存'); }
      catch (failure) { setError((failure as Error).message); } finally { lock.current = false; setSaving(false); }
    }}>
      {(error || units.error) && <Alert type="error" title={error || units.error} showIcon />}
      <Form form={unitForm} layout="vertical" disabled={!writable || saving} className="compact-form">
        <Form.Item name="enabled" label="独立采购单位" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item noStyle shouldUpdate>{({ getFieldValue }) => getFieldValue('enabled') && <>
          <Form.Item name="purchaseUnitId" label="采购单位" rules={[{ required: true, message: '请选择采购单位' }]}><Select options={options(units.rows.filter(row => row.id !== conversion?.baseUnitId))} /></Form.Item>
          <Form.Item name="salesUnitsPerPurchaseUnit" label="每采购单位对应销售单位数量" rules={decimal('换算数量', 8, true)}><InputNumber stringMode precision={8} style={{ width: '100%' }} /></Form.Item>
        </>}</Form.Item>
      </Form>
    </Modal>
  </>;
}
