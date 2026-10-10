import { money } from '../lib/money';
import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Descriptions, Form, InputNumber, Modal, Popconfirm, Select, Spin, Table, Tag, Tooltip } from 'antd';
import { Check, Eye, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { request } from '../lib/api';
import { decimalRule } from '../lib/catalogTypes';
import type { Catalog, PurchasePreview } from '../lib/workflowTypes';
import type { useWorkflowCommand } from '../lib/useWorkflowCommand';

type Draft = { items: { productId: string; unitId: string; quantity: string }[] };
type StoreCatalog = Catalog & { store: { name: string }; items: (Catalog['items'][number] & { suppliers: (Catalog['items'][number]['suppliers'][number] & { salesPrice?: string | null })[] })[] };
export function StoreOrderEditor({ storeId, command, onClose, onSaved }: { storeId: string; command: ReturnType<typeof useWorkflowCommand>; onClose: () => void; onSaved: () => void }) {
  const [catalog, setCatalog] = useState<StoreCatalog | null>(null); const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0);
  const [error, setError] = useState(''); const [preview, setPreview] = useState<PurchasePreview | null>(null); const [signature, setSignature] = useState('');
  const [previewing, setPreviewing] = useState(false); const lock = useRef(false); const [form] = Form.useForm<Draft>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const items = Form.useWatch('items', form) as Draft['items'] | undefined; const { message } = App.useApp();
  const invalidate = () => { setPreview(null); setSignature(''); };
  useEffect(() => {
    const controller = new AbortController(); setCatalog(null); setError(''); setLoading(true); invalidate();
    request<StoreCatalog>(`/stores/${storeId}/catalog`, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (value.storeId !== storeId || !value.templateId || !Array.isArray(value.items) || new Set(value.items.map(row => row.product.id)).size !== value.items.length) throw new Error('订货目录范围或模板不完整，请重新读取。');
      setCatalog(value);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [storeId, revision]);
  async function draft() {
    const values = await form.validateFields();
    if (!catalog || loading) throw new Error('请先读取订货目录。');
    if (!values.items?.length || new Set(values.items.map(row => row.productId)).size !== values.items.length) throw new Error('请选择商品，且同一商品不能重复。');
    return { storeId, expectedTemplateId: catalog.templateId, items: values.items.map(row => {
      const entry = catalog.items.find(item => item.product.id === row.productId); if (!entry) throw new Error('商品不在当前目录，请重新选择。');
      if (![entry.product.baseUnitId, entry.product.purchaseUnitConversion?.purchaseUnitId].includes(row.unitId)) throw new Error('订货单位已变更，请重新选择。');
      return { ...row, expectedProductVersion: entry.product.version };
    }) };
  }
  const disabled = command.blocked || previewing;
  return <Modal open zIndex={1200} title="门店订货" width={900} maskClosable={false} keyboard={!command.busy && !previewing} closable={!command.busy && !previewing} onCancel={() => { if (!command.busy && !previewing) onClose(); }} footer={<div className="actions workflow-actions">
    <Button onClick={onClose} disabled={command.busy || previewing}>取消</Button>
    <Tooltip title="重新读取目录"><Button aria-label="重新读取目录" icon={<RotateCcw size={16} />} disabled={disabled || loading} onClick={() => { invalidate(); setRevision(value => value + 1); }} /></Tooltip>
    <Button icon={<Eye size={16} />} loading={previewing} disabled={disabled || loading || !catalog?.items.length} onClick={async () => {
      if (lock.current || command.blocked) return; lock.current = true; setPreviewing(true); setError(''); invalidate();
      try { const body = await draft(); const result = await request<PurchasePreview & { storeId: string }>('/purchase-requests/preview', { method: 'POST', body });
        if (result.storeId !== storeId || result.templateId !== catalog!.templateId || result.items?.length !== body.items.length || result.items.some((row, index) => row.productId !== body.items[index].productId || !row.priceVersionId || !row.supplyPriceVersionId) || !result.funding || !result.totals?.salesGoodsAmount) throw new Error('核价结果或价格版本不完整，请重新核价。');
        setPreview(result); setSignature(JSON.stringify(body));
      } catch (failure) { if (!('errorFields' in (failure as object))) setError((failure as Error).message); }
      finally { lock.current = false; setPreviewing(false); }
    }}>核对订单</Button>
    <Popconfirm key={preview ? JSON.stringify(preview) : 'unreviewed'} getPopupContainer={node => node.parentElement!} zIndex={1400} open={confirmOpen && !disabled && Boolean(preview)} onOpenChange={setConfirmOpen} title="确认提交门店订单？" disabled={disabled || !preview} onConfirm={async () => {
      if (disabled) return; setConfirmOpen(false);
      try { const body = await draft(); if (!preview || JSON.stringify(body) !== signature) { invalidate(); throw new Error('订单内容已变化，请重新核对。'); }
        const approved = { ...body, items: body.items.map((row, index) => ({ ...row, expectedPriceVersionId: preview.items[index].priceVersionId, expectedSupplyPriceVersionId: preview.items[index].supplyPriceVersionId })) };
        if (await command.submit({ path: '/purchase-requests', method: 'POST', label: '提交门店订单', body: approved })) { message.success('门店订单已提交'); onSaved(); } else invalidate();
      } catch (failure) { if (!('errorFields' in (failure as object))) setError((failure as Error).message); }
    }}><Button type="primary" icon={<Check size={16} />} loading={command.busy} disabled={disabled || !preview}>提交订单</Button></Popconfirm>
  </div>}>
    {(error || command.error) && <Alert type="error" showIcon title={error || command.error} />}
    {command.pending && <Alert type="warning" showIcon title={`存在待确认提交：${command.pending.label}`} action={<Button disabled={command.pending.path !== '/purchase-requests' || command.pending.body.storeId !== storeId} loading={command.busy} onClick={async () => { if (command.pending?.path === '/purchase-requests' && command.pending.body.storeId === storeId && await command.recover()) onSaved(); }}>恢复原提交</Button>} />}
    {loading ? <Spin /> : catalog && <>
      <Descriptions size="small" items={[{ key: 'store', label: '订货门店', children: catalog.store.name }]} />
      {!catalog.items.length && <Alert type="info" title="当前门店暂无可订货商品" />}
      <Form form={form} layout="vertical" className="compact-form" initialValues={{ items: [{}] }} disabled={disabled} onValuesChange={invalidate}>
        <Form.List name="items">{(fields, { add, remove }) => <>{fields.map(field => {
          const product = catalog.items.find(row => row.product.id === items?.[field.name]?.productId)?.product;
          const units = product ? [{ value: product.baseUnitId, label: product.unitName }, ...(product.purchaseUnitConversion ? [{ value: product.purchaseUnitConversion.purchaseUnitId, label: product.purchaseUnitName || '采购单位' }] : [])] : [];
          return <div className="template-item" key={field.key}><div className="purchase-item-grid">
            <Form.Item label="商品" name={[field.name, 'productId']} rules={[{ required: true, message: '请选择商品' }]}><Select aria-label={`订货商品${field.name + 1}`} showSearch optionFilterProp="label" options={catalog.items.map(row => ({ value: row.product.id, label: row.product.name }))} onChange={value => { form.setFieldValue(['items', field.name, 'unitId'], catalog.items.find(row => row.product.id === value)?.product.baseUnitId); invalidate(); }} /></Form.Item>
            <Form.Item label="数量" name={[field.name, 'quantity']} rules={[decimalRule('数量', true)]}><InputNumber aria-label={`订货数量${field.name + 1}`} stringMode min="0.000001" controls={false} /></Form.Item>
            <Form.Item label="订货单位" name={[field.name, 'unitId']} rules={[{ required: true, message: '请选择单位' }]}><Select aria-label={`订货单位${field.name + 1}`} options={units} /></Form.Item>
          </div>{product && <div className="template-price">起订量：{product.minOrderQty}{product.unitName}；倍数：{product.orderMultiple}{product.purchaseUnitConversion && `；每${product.purchaseUnitName}折合${product.purchaseUnitConversion.salesUnitsPerPurchaseUnit}${product.unitName}`}</div>}
            <Tooltip title="移除商品"><Button className="template-remove" aria-label={`移除商品${field.name + 1}`} icon={<Trash2 size={16} />} disabled={disabled || fields.length === 1} onClick={() => { remove(field.name); invalidate(); }} /></Tooltip>
          </div>;
        })}<Button icon={<Plus size={16} />} disabled={disabled || !catalog.items.length} onClick={() => { add({}); invalidate(); }}>添加商品</Button></>}</Form.List>
      </Form>
    </>}
    {preview && <section className="price-band"><h2>订单核对</h2><Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
      { key: 'amount', label: '货款合计', children: preview.totals.salesGoodsAmount },
      { key: 'stored', label: '储值所需 / 可用 / 缺口', children: `${preview.funding!.stored.required} / ${preview.funding!.stored.available} / ${preview.funding!.stored.shortfall}` },
      ...(preview.funding!.credit ? [{ key: 'credit', label: '挂账所需 / 可用 / 缺口', children: `${preview.funding!.credit.required} / ${preview.funding!.credit.available} / ${preview.funding!.credit.shortfall}` }] : []),
    ]} /><Tag color={preview.funding!.canConfirm ? 'green' : 'gold'}>{preview.funding!.canConfirm ? '资金可用' : '资金不足，提交后待补足'}</Tag>
      <Table rowKey="productId" size="small" pagination={false} scroll={{ x: 550 }} dataSource={preview.items} columns={[{ title: '商品', render: (_, row) => catalog?.items.find(item => item.product.id === row.productId)?.product.name }, { title: '销售数量', dataIndex: 'quantity' }, { title: '销售单位', render: (_, row) => row.unitSnapshot?.salesUnitName }, { title: '销售单价', dataIndex: 'salesUnitPrice', render: money }, { title: '货款', dataIndex: 'salesLineAmount' }]} />
    </section>}
  </Modal>;
}
