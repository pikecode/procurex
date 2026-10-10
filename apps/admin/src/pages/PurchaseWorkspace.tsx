import { money } from '../lib/money';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, App, Button, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Select, Spin, Table, Tag, Tooltip } from 'antd';
import { Check, Eye, Pencil, Plus, Trash2, X } from 'lucide-react';
import { ListPage } from '../components/ListPage';
import { hasRole, request, type User } from '../lib/api';
import { decimalRule } from '../lib/catalogTypes';
import { useRows } from '../lib/useRows';
import { SupplierAssignment } from './SupplierAssignment';
import { RejectionEditor, RejectionTodos } from './RejectionWorkspace';
import { canRecoverWorkflow, useWorkflowCommand } from '../lib/useWorkflowCommand';
import { accountFundingName, workflowName, workflowTime, type Catalog, type Order, type Purchase, type PurchasePreview, type WorkflowItem } from '../lib/workflowTypes';

type Draft = { storeId: string; reason?: string; items: { productId: string; supplierId?: string; unitId: string; quantity: string }[] };
type Store = { id: string; name: string; status: string };
export default function PurchaseWorkspace({ user }: { user: User }) {
  const list = useRows<Purchase>('/purchase-requests'); const stores = useRows<Store>('/stores');
  const canWrite = hasRole(user, 'ADMIN', 'PURCHASER'); const command = useWorkflowCommand(user.id); const { message } = App.useApp();
  const [params, setParams] = useSearchParams(); const selected = params.get('request');
  const rejectedOrder = params.get('rejectedOrder');
  const openRejection = (requestId: string, orderId: string) => { command.clearError(); setParams({ request: requestId, rejectedOrder: orderId }); };
  const closeRejection = () => { if (!command.busy) setParams(selected ? { request: selected } : {}); };
  const [detail, setDetail] = useState<Purchase | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  const [assigning, setAssigning] = useState(false);
  const [mode, setMode] = useState<'create' | 'edit' | 'reject' | null>(null); const [catalog, setCatalog] = useState<Catalog | null>(null); const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false); const [preview, setPreview] = useState<PurchasePreview | null>(null); const [signature, setSignature] = useState('');
  const [previewing, setPreviewing] = useState(false); const previewLock = useRef(false); const [form] = Form.useForm<Draft>();
  const storeId = Form.useWatch('storeId', form); const watchedItems = Form.useWatch('items', form) as Draft['items'] | undefined;
  const invalidate = () => { setPreview(null); setSignature(''); };
  useEffect(() => {
    const controller = new AbortController(); setDetail(null); setError('');
    if (!selected) { setLoading(false); return; }
    setLoading(true);
    request<Purchase>(`/purchase-requests/${selected}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setDetail(value); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected, revision]);
  useEffect(() => {
    const controller = new AbortController(); setCatalog(null); setCatalogError(''); invalidate();
    if (!mode || mode === 'reject' || !storeId) { setCatalogLoading(false); return; }
    setCatalogLoading(true);
    const path = mode === 'edit' && detail ? `/purchase-requests/${detail.id}/edit-catalog` : `/stores/${storeId}/catalog`;
    request<Catalog>(path, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setCatalog(value); })
      .catch(failure => { if (!controller.signal.aborted) setCatalogError(failure.message); }).finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [storeId, mode, detail?.id, detail?.version]);
  const refresh = () => { list.reload(); setRevision(value => value + 1); };
  const close = () => { if (command.busy || previewing) return; setMode(null); invalidate(); form.resetFields(); };
  function open(mode: 'create' | 'edit' | 'reject') {
    command.clearError(); setError(''); invalidate(); form.resetFields();
    form.setFieldsValue(mode === 'create' ? { items: [{} as Draft['items'][number]] } : { storeId: detail!.storeId,
      items: detail!.items.map(item => ({ productId: item.productId, supplierId: item.supplierId, unitId: item.unitSnapshot?.inputUnitId, quantity: item.unitSnapshot?.inputQuantity || item.quantity })) });
    setMode(mode);
  }
  async function draft() {
    const values = await form.validateFields();
    if (!catalog || catalogLoading || catalogError) throw new Error('请先读取可订货目录。');
    if (!values.items?.length || new Set(values.items.map(item => item.productId)).size !== values.items.length) throw new Error('至少选择一项商品，且商品不能重复。');
    const items = values.items.map(item => {
      const entry = catalog.items.find(row => row.product.id === item.productId);
      if (!entry) throw new Error('商品已不在当前目录，请重新选择。');
      return { productId: item.productId, quantity: item.quantity, unitId: item.unitId, expectedProductVersion: entry.product.version,
        ...(mode === 'edit' ? { supplierId: item.supplierId } : {}) };
    });
    return mode === 'edit' ? { expectedVersion: detail!.version, reason: values.reason?.trim(), items } : { storeId: values.storeId, expectedTemplateId: catalog.templateId, items };
  }
  async function readPreview() {
    if (previewLock.current || command.blocked) return; previewLock.current = true; setPreviewing(true); setError(''); invalidate();
    try {
      const body = await draft(); const result = await request<PurchasePreview>(mode === 'edit' ? `/purchase-requests/${detail!.id}/items-preview` : '/purchase-requests/preview', { method: 'POST', body });
      if (result.templateId !== catalog!.templateId || !Array.isArray(result.items) || result.items.length !== body.items.length
        || result.items.some((item, index) => item.productId !== body.items[index].productId || !item.priceVersionId || !item.supplyPriceVersionId)) {
        throw new Error('预览商品或价格版本不完整，请重新读取目录后预览。');
      }
      setPreview(result); setSignature(JSON.stringify(body));
    }
    catch (failure) { if (!('errorFields' in (failure as object))) setError((failure as Error).message); }
    finally { previewLock.current = false; setPreviewing(false); }
  }
  async function save() {
    if (command.blocked || previewing) return;
    try {
      if (mode === 'reject') {
        const values = await form.validateFields();
        if (await command.submit({ path: `/purchase-requests/${detail!.id}/reject`, method: 'POST', label: '取消采购申请', body: { expectedVersion: detail!.version, reason: values.reason!.trim() } })) { close(); refresh(); message.success('采购申请已取消'); }
        return;
      }
      const body = await draft();
      if (!preview || JSON.stringify(body) !== signature) { invalidate(); throw new Error('内容已变化，请重新预览。'); }
      const items = body.items.map((item, index) => ({ ...item, expectedPriceVersionId: preview.items[index].priceVersionId, expectedSupplyPriceVersionId: preview.items[index].supplyPriceVersionId }));
      if (await command.submit({ path: mode === 'edit' ? `/purchase-requests/${detail!.id}/items` : '/purchase-requests', method: mode === 'edit' ? 'PATCH' : 'POST', label: mode === 'edit' ? '修改采购明细' : '提交采购申请', body: { ...body, items } })) { close(); refresh(); message.success('采购申请已保存'); }
    } catch (failure) { if (!('errorFields' in (failure as object))) setError((failure as Error).message); }
  }
  const itemColumns = [
    { title: '商品', dataIndex: 'productName', width: 180, render: (_: unknown, item: WorkflowItem) => item.productName || catalog?.items.find(row => row.product.id === item.productId)?.product.name || item.productId },
    { title: '数量', dataIndex: 'quantity', width: 110 }, { title: '销售单位', width: 110, render: (_: unknown, item: WorkflowItem) => item.unitName || item.unitSnapshot?.salesUnitName || '历史未核定' },
    { title: '销售单价', dataIndex: 'salesUnitPrice', width: 110, render: money }, { title: '供货单价', dataIndex: 'supplyUnitPrice', width: 110, render: money },
    { title: '销售金额', dataIndex: 'salesLineAmount', width: 110 }, { title: '供货金额', dataIndex: 'supplyLineAmount', width: 110 },
  ];
  const editable = detail && ['PENDING_FUNDS', 'PENDING_PROCUREMENT'].includes(detail.status) && !detail.supplierOrders.length;
  const recoveryNotice = command.pending && <Alert type="warning" showIcon title={`存在待确认提交：${command.pending.label}`} action={<Button disabled={!canRecoverWorkflow(user, command.pending.path)} loading={command.busy} onClick={async () => { if (await command.recover()) { close(); refresh(); message.success('原提交已确认'); } }}>恢复原提交</Button>} />;
  return <>
    {!selected && !mode && command.error && <Alert type="error" showIcon title={command.error} />}
    {!selected && !mode && recoveryNotice}
    <ListPage title="采购申请" rows={list.rows.map(row => ({ ...row, name: row.requestNo, storeName: stores.rows.find(store => store.id === row.storeId)?.name || row.storeId }))}
      loading={list.loading} error={list.error || stores.error} reload={refresh} create={canWrite && !command.blocked ? () => open('create') : undefined}
      filters={[{ key: 'status', label: '申请状态', options: ['PENDING_PROCUREMENT', 'PENDING_FUNDS', 'CONFIRMED', 'PARTIAL_PUSHED', 'COMPLETED', 'CANCELED'].map(value => ({ value, label: workflowName(value) })) }, { key: 'storeId', label: '门店', options: stores.rows.map(store => ({ value: store.id, label: store.name })) }]}
      columns={[{ title: '申请编号', dataIndex: 'requestNo', width: 205 }, { title: '门店', dataIndex: 'storeName', width: 170 },
        { title: '状态', dataIndex: 'status', width: 125, render: value => <Tag>{workflowName(value)}</Tag> }, { title: '储值/挂账入账', dataIndex: 'paymentStatus', width: 130, render: accountFundingName },
        { title: '销售金额', dataIndex: 'salesGoodsAmount', width: 110 }, { title: '资金缺口', dataIndex: 'shortfallAmount', width: 110 },
        { title: '提交时间', dataIndex: 'submittedAt', width: 165, render: workflowTime }, { title: '操作', width: 64, fixed: 'right', render: (_, row) => <Tooltip title="查看采购申请"><Button type="text" aria-label={`查看${row.requestNo}`} icon={<Eye size={16} />} onClick={() => setParams({ request: row.id })} /></Tooltip> }]} />
    {canWrite && <RejectionTodos revision={revision} onOpen={openRejection} />}
    {canWrite && selected && rejectedOrder && <RejectionEditor key={`${selected}:${rejectedOrder}`} requestId={selected} orderId={rejectedOrder} command={command} canRecover={canRecoverWorkflow(user, command.pending?.path)} onClose={closeRejection} onSaved={() => { setParams({ request: selected }); refresh(); }} />}
    <Modal title={detail?.requestNo || '采购申请详情'} open={Boolean(selected) && !(canWrite && rejectedOrder)} onCancel={() => { if (!command.busy && !mode && !assigning) setParams({}); }} footer={null} width={1000} closable={!mode && !assigning && !command.busy}>
      {!mode && !assigning && recoveryNotice}
      {!mode && !assigning && command.error && <Alert type="error" showIcon title={command.error} />}
      {loading ? <Spin /> : error && !mode ? <Alert type="error" title={error} action={<Button onClick={() => setRevision(value => value + 1)}>重试</Button>} /> : detail && <>
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={[
          { key: 'store', label: '门店', children: stores.rows.find(store => store.id === detail.storeId)?.name || detail.storeId },
          { key: 'status', label: '状态', children: workflowName(detail.status) }, { key: 'payment', label: '储值/挂账入账', children: accountFundingName(detail.paymentStatus) },
          { key: 'sales', label: '销售金额', children: detail.salesGoodsAmount }, { key: 'supply', label: '供货金额', children: detail.supplyGoodsAmount }, { key: 'reserved', label: '储值占用', children: detail.storedReservedAmount ?? '-' },
          { key: 'shortfall', label: '资金缺口', children: detail.shortfallAmount }, { key: 'reason', label: '取消原因', children: detail.rejectedReason || '-' },
        ]} />
        {canWrite && editable && <div className="actions workflow-actions"><Button icon={<Pencil size={16} />} disabled={command.blocked} onClick={() => open('edit')}>修改明细</Button>
          <Button icon={<Pencil size={16} />} disabled={command.blocked} onClick={() => { command.clearError(); setAssigning(true); }}>调整供应商</Button>
          <Popconfirm title="确认采购并生成供应商订单？" onConfirm={async () => { if (await command.submit({ path: `/purchase-requests/${detail.id}/confirm`, method: 'POST', label: '确认采购', body: { expectedVersion: detail.version } })) { refresh(); message.success('采购已确认'); } }} disabled={command.blocked}><Button type="primary" icon={<Check size={16} />} disabled={command.blocked}>确认采购</Button></Popconfirm>
          <Button danger icon={<X size={16} />} disabled={command.blocked} onClick={() => open('reject')}>取消申请</Button></div>}
        <Table rowKey="id" size="small" columns={itemColumns} dataSource={detail.items} scroll={{ x: 850 }} pagination={{ defaultPageSize: 10, showSizeChanger: true }} />
        <section className="price-band"><h2>供应商订单</h2><Table<Order> rowKey="id" size="small" dataSource={detail.supplierOrders} pagination={{ defaultPageSize: 10 }} scroll={{ x: 680 }} columns={[
          { title: '订单编号', dataIndex: 'supplierOrderNo', render: (value, row) => <Link onClick={() => setParams({})} to={`/supplier-orders?order=${row.id}`}>{value}</Link> },
          { title: '供应商', dataIndex: 'supplierName' }, { title: '状态', dataIndex: 'status', render: workflowName }, { title: '履约状态', dataIndex: 'fulfillmentStatus', render: workflowName }, { title: '销售金额', dataIndex: 'salesGoodsAmount' },
          { title: '拒单处理', width: 110, render: (_, row) => row.status !== 'REJECTED' ? '-' : row.rejectionHandled ? '已处理' : canWrite && detail.status === 'PARTIAL_PUSHED' ? <Button size="small" disabled={command.blocked} onClick={() => openRejection(detail.id, row.id)}>处理拒单</Button> : '待处理' },
        ]} /></section>
      </>}
    </Modal>
    {assigning && detail && canWrite && <SupplierAssignment purchase={detail} command={command} onClose={() => { if (!command.busy) setAssigning(false); }} onSaved={() => { setAssigning(false); refresh(); message.success('供应商调整已确认'); }} />}
    <Modal zIndex={1200} title={mode === 'create' ? '新增采购申请' : mode === 'edit' ? '修改采购明细' : '取消采购申请'} open={Boolean(mode)} onCancel={close} width={mode === 'reject' ? 520 : 960} closable={!command.busy && !previewing} maskClosable={false}
      footer={<div className="actions workflow-actions"><Button onClick={close} disabled={command.busy || previewing}>取消</Button>{mode !== 'reject' && <Button icon={<Eye size={16} />} onClick={readPreview} loading={previewing} disabled={command.blocked || catalogLoading || !catalog || Boolean(catalogError)}>预览金额</Button>}
        <Popconfirm key={mode} zIndex={1400} title={mode === 'reject' ? '确认取消此申请？' : '确认保存采购申请？'} onConfirm={save} disabled={command.blocked || previewing || (mode !== 'reject' && !preview)}><Button type="primary" icon={<Check size={16} />} loading={command.busy} disabled={command.blocked || previewing || (mode !== 'reject' && !preview)}>{mode === 'reject' ? '确认取消' : '确认保存'}</Button></Popconfirm></div>}>
      {(error || command.error || catalogError) && <Alert type="error" title={error || command.error || catalogError} />}
      {recoveryNotice}
      <Form form={form} layout="vertical" className="compact-form" disabled={command.blocked || previewing} onValuesChange={changed => { invalidate(); if ('storeId' in changed) form.setFieldValue('items', [{}]); }}>
        {mode !== 'reject' && <>
          <Form.Item label="订货门店" name="storeId" rules={[{ required: true, message: '请选择门店' }]}><Select showSearch optionFilterProp="label" disabled={mode === 'edit' || command.blocked || previewing} loading={stores.loading} options={stores.rows.filter(store => mode === 'edit' || store.status === 'ACTIVE').map(store => ({ value: store.id, label: store.name }))} /></Form.Item>
          {catalogLoading && <Spin />}
          <Form.List name="items">{(fields, { add, remove }) => <>{fields.map(field => {
            const item = watchedItems?.[field.name]; const entry = catalog?.items.find(row => row.product.id === item?.productId); const product = entry?.product;
            const units = product ? [{ value: product.baseUnitId, label: product.unitName }, ...(product.purchaseUnitConversion ? [{ value: product.purchaseUnitConversion.purchaseUnitId, label: product.purchaseUnitName || '采购单位' }] : [])] : [];
            return <div className="template-item" key={field.key}><div className="purchase-item-grid">
              <Form.Item label="商品" name={[field.name, 'productId']} rules={[{ required: true, message: '请选择商品' }]}><Select showSearch optionFilterProp="label" options={catalog?.items.map(row => ({ value: row.product.id, label: row.product.name })) || []} onChange={id => { const selected = catalog?.items.find(row => row.product.id === id); form.setFields([{ name: ['items', field.name, 'unitId'], value: selected?.product.baseUnitId }, { name: ['items', field.name, 'supplierId'], value: selected?.suppliers[0]?.supplierId }]); }} /></Form.Item>
              {mode === 'edit' && <Form.Item label="供应商" name={[field.name, 'supplierId']} rules={[{ required: true, message: '请选择供应商' }]}><Select options={entry?.suppliers.map(supplier => ({ value: supplier.supplierId, label: supplier.supplierName })) || []} /></Form.Item>}
              <Form.Item label="数量" name={[field.name, 'quantity']} rules={[decimalRule('数量', true)]}><InputNumber stringMode min="0.000001" controls={false} /></Form.Item>
              <Form.Item label="订货单位" name={[field.name, 'unitId']} rules={[{ required: true, message: '请选择单位' }]}><Select options={units} /></Form.Item>
            </div>{product && <div className="template-price">销售单位：{product.unitName}；起订量：{product.minOrderQty}；倍数：{product.orderMultiple}{product.purchaseUnitConversion && `；每${product.purchaseUnitName}折合${product.purchaseUnitConversion.salesUnitsPerPurchaseUnit}${product.unitName}`}</div>}
              <Tooltip title="移除商品"><Button className="template-remove" aria-label={`移除商品${field.name + 1}`} icon={<Trash2 size={16} />} onClick={() => { remove(field.name); invalidate(); }} disabled={command.blocked || previewing || fields.length === 1} /></Tooltip></div>;
          })}<Button icon={<Plus size={16} />} onClick={() => { add({}); invalidate(); }} disabled={command.blocked || previewing || !catalog}>添加商品</Button></>}</Form.List>
        </>}
        {mode !== 'create' && <Form.Item label={mode === 'reject' ? '取消原因' : '修改原因'} name="reason" rules={[{ required: true, whitespace: true, max: 300, message: '请输入原因，最多300字' }]}><Input.TextArea rows={2} maxLength={300} /></Form.Item>}
      </Form>
      {preview && <section className="price-band"><h2>金额预览</h2><Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
        { key: 'sales', label: '销售金额', children: preview.totals.salesGoodsAmount }, { key: 'supply', label: '供货金额', children: preview.totals.supplyGoodsAmount },
        ...(preview.funding ? [{ key: 'stored', label: '储值所需 / 可用 / 缺口', children: `${preview.funding.stored.required} / ${preview.funding.stored.available} / ${preview.funding.stored.shortfall}` },
          { key: 'credit', label: '挂账所需 / 可用 / 缺口', children: preview.funding.credit ? `${preview.funding.credit.required} / ${preview.funding.credit.available} / ${preview.funding.credit.shortfall}` : '-' }] : []),
      ]} />{preview.funding && <Tag color={preview.funding.canConfirm ? 'green' : 'gold'}>{preview.funding.canConfirm ? '资金可用' : '资金不足，提交后待补足'}</Tag>}
        <Table size="small" rowKey="productId" columns={itemColumns} dataSource={preview.items} scroll={{ x: 850 }} pagination={false} /></section>}
    </Modal>
  </>;
}
