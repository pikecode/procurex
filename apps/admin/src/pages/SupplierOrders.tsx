import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, App, Button, Descriptions, Modal, Popconfirm, Spin, Table, Tooltip } from 'antd';
import { Check, Coins, Eye, RotateCcw, Truck, X } from 'lucide-react';
import { ShipmentEditor } from './ShipmentEditor';
import { FreightEditor } from './FreightEditor';
import { ReceiptEditor, type ShipmentDetail } from './ReceiptEditor';
import { PrivateEvidence } from '../components/PrivateEvidence';
import { ListPage } from '../components/ListPage';
import { hasRole, request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { canRecoverWorkflow, useWorkflowCommand } from '../lib/useWorkflowCommand';
import { workflowName, workflowTime, type Order, type ShippingOrder, type Purchase, type ShipmentSummary } from '../lib/workflowTypes';

type Shipment = ShipmentDetail & { trackingNo: string | null; shippedAt: string };
export default function SupplierOrders({ user }: { user: User }) {
  const orders = useRows<Order>('/supplier-orders'); const suppliers = useRows<{ id: string; name: string }>('/suppliers'); const stores = useRows<{ id: string; name: string }>('/stores');
  const [params, setParams] = useSearchParams(); const id = params.get('order'); const [detail, setDetail] = useState<ShippingOrder | null>(null);
  const [editor, setEditor] = useState<'ship' | 'freight' | null>(null); const [review, setReview] = useState<{ id: string; action: 'confirm' | 'reject' }>();
  const [shipments, setShipments] = useState<ShipmentSummary[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  const [canReallocate, setCanReallocate] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [shipmentId, setShipmentId] = useState<string | null>(null); const [shipment, setShipment] = useState<Shipment | null>(null); const [shipmentError, setShipmentError] = useState(''); const [shipmentLoading, setShipmentLoading] = useState(false); const [shipmentRevision, setShipmentRevision] = useState(0);
  const command = useWorkflowCommand(user.id); const { message } = App.useApp(); const canWrite = hasRole(user, 'ADMIN', 'PURCHASER'); const canReadShipment = hasRole(user, 'ADMIN', 'HQ_FINANCE');
  const refresh = () => { orders.reload(); setRevision(value => value + 1); };
  useEffect(() => {
    const controller = new AbortController(); setDetail(null); setShipments([]); setError(''); setCanReallocate(false);
    if (!id) { setLoading(false); return; } setLoading(true);
    (async () => {
      const order = await request<ShippingOrder>(`/supplier-orders/${id}`, { signal: controller.signal });
      const purchase = await request<Purchase>(`/purchase-requests/${order.requestId}`, { signal: controller.signal });
      if (!controller.signal.aborted) { const summary = purchase.supplierOrders.find(row => row.id === order.id); setDetail(order); setShipments(summary?.shipments || []); setCanReallocate(purchase.status === 'PARTIAL_PUSHED' && summary?.status === 'REJECTED' && !summary.rejectionHandled); }
    })().catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, revision]);
  useEffect(() => {
    const controller = new AbortController(); setShipment(null); setShipmentError('');
    if (!shipmentId) { setShipmentLoading(false); return; } setShipmentLoading(true);
    request<Shipment>(`/shipments/${shipmentId}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setShipment(value); })
      .catch(failure => { if (!controller.signal.aborted) setShipmentError(failure.message); }).finally(() => { if (!controller.signal.aborted) setShipmentLoading(false); });
    return () => controller.abort();
  }, [shipmentId, shipmentRevision]);
  const recoveryNotice = command.pending && <Alert type="warning" showIcon title={`存在待确认提交：${command.pending.label}`} action={<Button disabled={!canRecoverWorkflow(user, command.pending.path)} loading={command.busy} onClick={async () => { if (await command.recover()) { refresh(); message.success('原提交已确认'); } }}>恢复原提交</Button>} />;
  const closeEditor = () => { setEditor(null); setReview(undefined); }; const saved = () => { closeEditor(); refresh(); };
  return <>
    {!id && command.error && <Alert type="error" title={command.error} showIcon />}
    {!id && recoveryNotice}
    <ListPage title="供应商订单" rows={orders.rows.map(order => ({ ...order, name: order.supplierOrderNo, supplierName: suppliers.rows.find(supplier => supplier.id === order.supplierId)?.name || order.supplierId }))}
      loading={orders.loading} error={orders.error || suppliers.error || stores.error} reload={refresh}
      filters={[{ key: 'storeId', label: '门店', options: stores.rows.map(row => ({ value: row.id, label: row.name })) }, { key: 'supplierId', label: '供应商', options: suppliers.rows.map(row => ({ value: row.id, label: row.name })) }, { key: 'status', label: '订单状态', options: [...new Set(orders.rows.map(row => row.status))].map(value => ({ value, label: workflowName(value) })) }]}
      columns={[{ title: '订单编号', dataIndex: 'supplierOrderNo', width: 205 }, { title: '门店', dataIndex: 'storeName', width: 155 }, { title: '供应商', dataIndex: 'supplierName', width: 155 }, { title: '状态', dataIndex: 'status', render: workflowName, width: 110 }, { title: '履约状态', dataIndex: 'fulfillmentStatus', render: workflowName, width: 115 }, { title: '销售金额', dataIndex: 'salesGoodsAmount', width: 110 }, { title: '供货金额', dataIndex: 'supplyGoodsAmount', width: 110 }, { title: '创建时间', dataIndex: 'createdAt', render: workflowTime, width: 165 }, { title: '操作', width: 64, fixed: 'right', render: (_, row) => <Tooltip title="查看供应商订单"><Button type="text" aria-label={`查看${row.supplierOrderNo}`} icon={<Eye size={16} />} onClick={() => setParams({ order: row.id })} /></Tooltip> }]} />
    <Modal title={detail?.supplierOrderNo || '供应商订单详情'} width={1000} open={Boolean(id)} onCancel={() => { if (!command.busy && !shipmentId && !editor) setParams({}); }} closable={!command.busy && !shipmentId && !editor} footer={null}>
      {!editor && !receiving && recoveryNotice}
      {!editor && !receiving && command.error && <Alert type="error" title={command.error} showIcon />}
      {loading ? <Spin /> : error ? <Alert type="error" title={error} action={<Button onClick={() => setRevision(value => value + 1)}>重试</Button>} /> : detail && <>
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={[
          { key: 'store', label: '门店', children: detail.storeName || stores.rows.find(row => row.id === detail.storeId)?.name || '-' }, { key: 'supplier', label: '供应商', children: suppliers.rows.find(row => row.id === detail.supplierId)?.name || '-' }, { key: 'status', label: '状态', children: workflowName(detail.status) }, { key: 'fulfillment', label: '履约状态', children: workflowName(detail.fulfillmentStatus) }, { key: 'sales', label: '销售金额', children: detail.salesGoodsAmount }, { key: 'supply', label: '供货金额', children: detail.supplyGoodsAmount }, { key: 'contact', label: '收货联系人', children: detail.destination?.contactName || '-' }, { key: 'phone', label: '联系电话', children: detail.destination?.contactPhone || '-' }, { key: 'address', label: '收货地址', children: detail.destination?.address || '-' },
        ]} />
        <div className="actions workflow-actions"><Link onClick={() => setParams({})} to={`/purchase-requests?request=${detail.requestId}`}><Button icon={<Eye size={16} />}>采购申请</Button></Link>
          {hasRole(user, 'ADMIN') && ['PUSHED', 'ACCEPTED', 'PARTIAL_SHIPPED', 'SHIPPED'].includes(detail.status) && <Button disabled={command.blocked} icon={<Truck size={16} />} onClick={() => setEditor('ship')}>发货与补发</Button>}
          {hasRole(user, 'ADMIN') && !['REJECTED', 'CANCELED'].includes(detail.status) && detail.requiresFreightSnapshot !== false && <Button disabled={command.blocked} icon={<Coins size={16} />} onClick={() => { setReview(undefined); setEditor('freight'); }}>申请运费</Button>}
          {canWrite && canReallocate && <Link to={`/purchase-requests?request=${detail.requestId}&rejectedOrder=${detail.id}`}><Button disabled={command.blocked} icon={<RotateCcw size={16} />}>处理拒单</Button></Link>}
          {canWrite && <Popconfirm title="重新核对订单资金？" onConfirm={async () => { if (await command.submit({ path: `/supplier-orders/${detail.id}/reconcile-funding`, method: 'POST', label: '核对订单资金', body: { expectedVersion: detail.version } })) { refresh(); message.success('资金核对已完成'); } }} disabled={command.blocked}><Button icon={<RotateCcw size={16} />} disabled={command.blocked}>核对资金</Button></Popconfirm>}</div>
        <Table rowKey="id" size="small" dataSource={detail.items} scroll={{ x: 900 }} pagination={{ defaultPageSize: 10, showSizeChanger: true }} columns={[{ title: '商品', dataIndex: 'productName', width: 180 }, { title: '数量', dataIndex: 'quantity', width: 90 }, { title: '单位', render: (_, row) => row.unitName || row.unitSnapshot?.salesUnitName || '历史未核定', width: 100 }, { title: '已发货', dataIndex: 'shippedQuantity', width: 90 }, { title: '已收货', dataIndex: 'receivedQuantity', width: 90 }, { title: '待发货', dataIndex: 'remainingToShipQuantity', width: 90 }, { title: '销售金额', dataIndex: 'salesLineAmount', width: 110 }, { title: '供货金额', dataIndex: 'supplyLineAmount', width: 110 }]} />
        <section className="price-band"><h2>运费申请</h2><Table rowKey="id" size="small" dataSource={detail.freightConfirmations || []} scroll={{ x: 650 }} pagination={{ defaultPageSize: 10, showSizeChanger: true }} columns={[{ title: '金额', dataIndex: 'amount', width: 100 }, { title: '申请原因', dataIndex: 'reason', width: 240 }, { title: '状态', width: 100, render: (_, row) => row.usedAt ? '已使用' : ({ PENDING: '待审核', CONFIRMED: '已确认', REJECTED: '已驳回' }[row.status] || row.status) }, { title: '申请时间', dataIndex: 'createdAt', render: workflowTime, width: 165 }, { title: '操作', width: 90, render: (_, row) => canWrite && row.status === 'PENDING' && !['REJECTED', 'CANCELED'].includes(detail.status) ? <div className="actions">{(['confirm', 'reject'] as const).map(action => <Tooltip key={action} title={action === 'confirm' ? '确认运费' : '驳回运费'}><Button type="text" aria-label={`${action === 'confirm' ? '确认' : '驳回'}运费${row.id}`} disabled={command.blocked} icon={action === 'confirm' ? <Check size={16} /> : <X size={16} />} onClick={() => { setReview({ id: row.id, action }); setEditor('freight'); }} /></Tooltip>)}</div> : '-' }]} /></section>
        <section className="price-band"><h2>发货记录</h2><Table rowKey="id" size="small" dataSource={shipments} scroll={{ x: 680 }} pagination={{ defaultPageSize: 10 }} columns={[{ title: '发货单号', dataIndex: 'shipmentNo', width: 200, render: (value, row) => canReadShipment ? <Button type="link" onClick={() => setShipmentId(row.id)}>{value}</Button> : value }, { title: '类型', dataIndex: 'kind', render: workflowName }, { title: '物流单号', dataIndex: 'trackingNo' }, { title: '发货时间', dataIndex: 'shippedAt', render: workflowTime }, { title: '收货时间', dataIndex: 'receivedAt', render: workflowTime }]} /></section>
      </>}
    </Modal>
    {id && editor === 'ship' && hasRole(user, 'ADMIN') && <ShipmentEditor key={id} orderId={id} command={command} onClose={closeEditor} onSaved={saved} />}
    {id && editor === 'freight' && (review ? canWrite : hasRole(user, 'ADMIN')) && <FreightEditor key={`${id}-${review?.id || 'new'}-${review?.action || ''}`} orderId={id} review={review} command={command} onClose={closeEditor} onSaved={saved} />}
    <Modal zIndex={1200} title={shipment?.shipmentNo || '发货明细'} open={Boolean(shipmentId)} closable={!receiving && !command.busy} onCancel={() => { if (!receiving && !command.busy) setShipmentId(null); }} footer={null} width={850}>
      {shipmentLoading ? <Spin /> : shipmentError ? <Alert type="error" title={shipmentError} action={<Button onClick={() => setShipmentRevision(value => value + 1)}>重试</Button>} /> : shipment && <>
        <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[{ key: 'tracking', label: '物流单号', children: shipment.trackingNo || '-' }, { key: 'shipped', label: '发货时间', children: workflowTime(shipment.shippedAt) }, { key: 'revision', label: '收货修订', children: shipment.currentReceiptRevision }]} />
        {hasRole(user, 'ADMIN') && (!shipment.currentReceiptRevision || shipment.items.some(item => !item.receiptLocked)) && <div className="actions workflow-actions"><Button disabled={command.blocked} icon={<Check size={16} />} onClick={() => setReceiving(true)}>{shipment.currentReceiptRevision ? '修订收货' : '登记收货'}</Button></div>}
        <Table rowKey="id" size="small" dataSource={shipment.items} scroll={{ x: 600 }} pagination={{ defaultPageSize: 10 }} columns={[{ title: '商品', dataIndex: 'productName' }, { title: '单位', dataIndex: 'unitName', render: value => value || '历史未核定' }, { title: '发货数量', dataIndex: 'shippedQuantity' }, { title: '当前收货数量', dataIndex: 'currentReceivedQuantity', render: value => value ?? '-' }, { title: '差异锁定', dataIndex: 'receiptLocked', render: value => value ? '已锁定' : '未锁定' }]} />
        {!!shipment.evidenceFiles?.length && <section className="price-band"><h2>收货凭证</h2><PrivateEvidence files={shipment.evidenceFiles} /></section>}
      </>}
    </Modal>
    {receiving && shipmentId && hasRole(user, 'ADMIN') && <ReceiptEditor key={shipmentId} shipmentId={shipmentId} command={command} onClose={() => setReceiving(false)} onSaved={() => { setReceiving(false); setShipmentRevision(value => value + 1); refresh(); }} />}
  </>;
}
