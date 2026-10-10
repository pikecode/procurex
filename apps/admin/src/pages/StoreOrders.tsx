import { money } from '../lib/money';
import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Modal, Result, Spin, Table, Tag } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { ListPage } from '../components/ListPage';
import { PrivateEvidence } from '../components/PrivateEvidence';
import { hasRole, request, type User } from '../lib/api';
import { useWorkflowCommand } from '../lib/useWorkflowCommand';
import { accountFundingName, workflowName, workflowTime, type Purchase } from '../lib/workflowTypes';
import { ReceiptEditor, type ShipmentDetail } from './ReceiptEditor';
import { StoreOrderEditor } from './StoreOrderEditor';

export default function StoreOrders({ user }: { user: User }) {
  const [params, setParams] = useSearchParams(); const orderId = params.get('order');
  const [rows, setRows] = useState<Purchase[]>([]); const [detail, setDetail] = useState<Purchase | null>(null);
  const [loading, setLoading] = useState(false); const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(''); const [detailError, setDetailError] = useState(''); const [revision, setRevision] = useState(0);
  const [shipmentId, setShipmentId] = useState<string | null>(null); const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [shipmentLoading, setShipmentLoading] = useState(false); const [shipmentError, setShipmentError] = useState(''); const [receiving, setReceiving] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const command = useWorkflowCommand(user.id); const storeId = user.scope?.storeId;
  const scoped = Boolean(storeId && ['STORE', 'STORE_FINANCE'].includes(user.scope?.type || ''));
  const writable = scoped && hasRole(user, 'STORE') && user.scope?.type === 'STORE';
  const recoverable = writable && Boolean(command.pending && (/^\/shipments\/[0-9a-f-]{36}\/receipts$/.test(command.pending.path) || (command.pending.path === '/purchase-requests' && command.pending.body.storeId === storeId)));
  useEffect(() => {
    setRows([]); if (!scoped) return;
    const controller = new AbortController(); setLoading(true); setError('');
    request<Purchase[]>(`/purchase-requests?storeId=${encodeURIComponent(storeId!)}`, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(value) || value.some(row => row.storeId !== storeId)) throw new Error('订单范围不匹配，请核查门店绑定。');
      setRows(value);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [scoped, storeId, revision]);
  useEffect(() => {
    setDetail(null); setDetailError(''); if (!orderId || !scoped) return;
    const controller = new AbortController(); setDetailLoading(true);
    request<Purchase>(`/purchase-requests/${encodeURIComponent(orderId)}`, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (value.id !== orderId || value.storeId !== storeId || !Array.isArray(value.items) || !Array.isArray(value.supplierOrders)) throw new Error('订单明细或门店范围不匹配。');
      setDetail(value);
    }).catch(failure => { if (!controller.signal.aborted) setDetailError(failure.message); }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [orderId, scoped, storeId, revision]);
  useEffect(() => {
    setShipment(null); setShipmentError(''); if (!shipmentId || !detail) return;
    const controller = new AbortController(); setShipmentLoading(true);
    request<ShipmentDetail>(`/shipments/${shipmentId}`, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (value.id !== shipmentId || !detail.supplierOrders.some(order => order.id === value.supplierOrderId && order.shipments?.some(row => row.id === shipmentId))) throw new Error('发货单不属于当前订单。');
      setShipment(value);
    }).catch(failure => { if (!controller.signal.aborted) setShipmentError(failure.message); }).finally(() => { if (!controller.signal.aborted) setShipmentLoading(false); });
    return () => controller.abort();
  }, [shipmentId, detail]);
  if (!scoped) return <Result status="warning" title="尚未绑定门店，无法查看订单" />;
  const saved = () => { setOrdering(false); setReceiving(false); setShipmentId(null); setRevision(value => value + 1); };
  const recovery = command.pending && <Alert type="warning" showIcon title={`存在待确认提交：${command.pending.label}`} action={<Button disabled={!recoverable} loading={command.busy} onClick={async () => { if (recoverable && await command.recover()) saved(); }}>恢复原提交</Button>} />;
  return <>
    {!receiving && !ordering && command.error && <Alert type="error" showIcon title={command.error} />}
    {!orderId && !receiving && !ordering && recovery}
    <ListPage title="门店订单" rows={rows.map(row => ({ ...row, name: row.requestNo }))} loading={loading} error={error} reload={() => setRevision(value => value + 1)}
      tools={writable && <Button type="primary" icon={<Plus size={16} />} disabled={command.blocked || ordering || Boolean(orderId)} onClick={() => { command.clearError(); setOrdering(true); }}>门店订货</Button>}
      filters={[{ key: 'status', label: '订单状态', options: [...new Set(rows.map(row => row.status))].map(value => ({ value, label: workflowName(value) })) }]}
      columns={[{ title: '订单编号', dataIndex: 'requestNo', render: (value, row) => <Button type="link" onClick={() => { setShipmentId(null); setParams({ order: row.id }); }}>{value}</Button> },
        { title: '订单状态', dataIndex: 'status', render: value => <Tag>{workflowName(value)}</Tag> }, { title: '储值/挂账入账', dataIndex: 'paymentStatus', render: accountFundingName },
        { title: '货款', dataIndex: 'salesGoodsAmount' }, { title: '账户入账金额', dataIndex: 'paidAmount' }, { title: '资金缺口', dataIndex: 'shortfallAmount' }, { title: '下单时间', dataIndex: 'submittedAt', render: workflowTime }]} />
    <Modal open={Boolean(orderId)} title="门店订单详情" width={960} footer={null} maskClosable={false} closable={!shipmentId} onCancel={() => { if (!shipmentId) setParams({}); }}>
      {!shipmentId && !receiving && recovery}
      {detailError && <Alert type="error" title={detailError} action={<Button onClick={() => setRevision(value => value + 1)}>重试</Button>} />}
      {detailLoading ? <Spin /> : detail && <>
        <Descriptions size="small" column={{ xs: 1, sm: 3 }} items={[{ key: 'no', label: '订单编号', children: detail.requestNo }, { key: 'status', label: '状态', children: workflowName(detail.status) }, { key: 'amount', label: '货款', children: detail.salesGoodsAmount }, { key: 'reserved', label: '储值预占', children: detail.storedReservedAmount || '0' }, { key: 'payment', label: '储值/挂账入账', children: accountFundingName(detail.paymentStatus) }]} />
        {detail.rejectedReason && <Alert type="warning" title={`拒单原因：${detail.rejectedReason}`} />}
        <Descriptions size="small" column={1} items={detail.supplierOrders.filter(order => order.deliveryContactPhone).map(order => ({ key: order.id, label: `${order.supplierName || '供应商'}配送联系`, children: <a href={`tel:${order.deliveryContactPhone}`}>{order.deliveryContactPhone}</a> }))} />
        <Table rowKey="id" size="small" pagination={false} scroll={{ x: 550 }} dataSource={detail.items} columns={[{ title: '商品', dataIndex: 'productName' }, { title: '数量', dataIndex: 'quantity' }, { title: '单位', render: (_, row) => row.unitName || row.unitSnapshot?.salesUnitName || '-' }, { title: '单价', dataIndex: 'salesUnitPrice', render: money }, { title: '货款', dataIndex: 'salesLineAmount' }]} />
        <section className="price-band"><h2>发货进度</h2><Table rowKey="id" size="small" pagination={false} scroll={{ x: 550 }} dataSource={detail.supplierOrders.flatMap(order => (order.shipments || []).map(row => ({ ...row, supplierName: order.supplierName })))} columns={[{ title: '发货单', dataIndex: 'shipmentNo', render: (value, row) => <Button type="link" onClick={() => setShipmentId(row.id)}>{value}</Button> }, { title: '供应商', dataIndex: 'supplierName' }, { title: '物流单号', dataIndex: 'trackingNo' }, { title: '发货时间', dataIndex: 'shippedAt', render: workflowTime }, { title: '收货时间', dataIndex: 'receivedAt', render: workflowTime }]} /></section>
      </>}
    </Modal>
    <Modal open={Boolean(shipmentId)} zIndex={1200} title="发货明细" width={760} maskClosable={false} closable={!receiving} onCancel={() => { if (!receiving) setShipmentId(null); }} footer={writable && shipment && (!shipment.currentReceiptRevision || shipment.items.some(row => !row.receiptLocked)) ? <Button type="primary" disabled={command.blocked} onClick={() => setReceiving(true)}>{shipment.currentReceiptRevision ? '修订收货' : '登记收货'}</Button> : null}>
      {shipmentError && <Alert type="error" title={shipmentError} />}{shipmentLoading ? <Spin /> : shipment && <><Descriptions size="small" items={[{ key: 'no', label: '发货单', children: shipment.shipmentNo }]} /><Table rowKey="id" size="small" pagination={false} scroll={{ x: 450 }} dataSource={shipment.items} columns={[{ title: '商品', dataIndex: 'productName' }, { title: '单位', dataIndex: 'unitName' }, { title: '发货', dataIndex: 'shippedQuantity' }, { title: '已登记收货', dataIndex: 'currentReceivedQuantity', render: value => value ?? '-' }, { title: '收货状态', render: (_, row) => row.receiptLocked ? '已锁定' : '可登记' }]} /><PrivateEvidence files={shipment.evidenceFiles || []} /></>}
    </Modal>
    {receiving && shipmentId && writable && <ReceiptEditor shipmentId={shipmentId} command={command} onClose={() => setReceiving(false)} onSaved={saved} />}
    {ordering && writable && <StoreOrderEditor storeId={storeId!} command={command} onClose={() => setOrdering(false)} onSaved={saved} />}
  </>;
}
