import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, App, Button, Descriptions, Input, Modal, Result, Table } from 'antd';
import { Eye, Truck, X, Coins } from 'lucide-react';
import { request, type User } from '../lib/api';
import { useRows } from '../lib/useRows';
import { useWorkflowCommand } from '../lib/useWorkflowCommand';
import { workflowName, workflowTime, type ShippingOrder } from '../lib/workflowTypes';
import { ListPage } from '../components/ListPage';
import { ShipmentEditor } from './ShipmentEditor';
import { FreightEditor } from './FreightEditor';

const rejectable = (order: ShippingOrder) => ['PUSHED', 'ACCEPTED'].includes(order.status) && order.fulfillmentStatus === 'PENDING' && !order.firstShippedAt;
export default function SupplierWorkspace({ user }: { user: User }) {
  if (!user.roles.includes('SUPPLIER') || !user.scope?.supplierId) return <Result status="403" title="供应商账号尚未绑定供应商" />;
  return <Workspace key={`${user.id}:${user.scope.supplierId}`} user={user} supplierId={user.scope.supplierId} />;
}
function Workspace({ user, supplierId }: { user: User; supplierId: string }) {
  const list = useRows<ShippingOrder>(`/supplier-orders?supplierId=${encodeURIComponent(supplierId)}`);
  const command = useWorkflowCommand(user.id); const { message } = App.useApp();
  const [order, setOrder] = useState<ShippingOrder>(); const [error, setError] = useState(''); const [reading, setReading] = useState(false);
  const [editor, setEditor] = useState<'ship' | 'freight' | 'reject'>(); const [reason, setReason] = useState('');
  const [params] = useSearchParams(); const linkedOrder = params.get('order');
  useEffect(() => {
    if (!linkedOrder) return;
    const controller = new AbortController(); setReading(true); setOrder(undefined); setError('');
    request<ShippingOrder>(`/supplier-orders/${linkedOrder}`, { signal: controller.signal }).then(value => {
      if (value.id !== linkedOrder || value.supplierId !== supplierId) throw new Error('订单不属于当前供应商。');
      if (!controller.signal.aborted) setOrder(value);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setReading(false); });
    return () => controller.abort();
  }, [linkedOrder, supplierId]);
  async function read(id: string) {
    const value = await request<ShippingOrder>(`/supplier-orders/${id}`);
    if (value.id !== id || value.supplierId !== supplierId) throw new Error('订单不属于当前供应商。');
    return value;
  }
  async function open(id: string) {
    setReading(true); setError(''); setOrder(undefined);
    try { setOrder(await read(id)); } catch (failure) { setError((failure as Error).message); } finally { setReading(false); }
  }
  function saved() { setEditor(undefined); setOrder(undefined); list.reload(); }
  async function recover() {
    const pending = command.pending;
    if (!pending || !/^\/supplier-orders\/[0-9a-f-]{36}\/(reject|shipments|freight-confirmations)$/.test(pending.path)) { setError('此提交不能在供应商工作台恢复，请核查原操作。'); return; }
    try { await read(pending.path.split('/')[2]); if (await command.recover()) { message.success('原提交已确认'); saved(); } } catch (failure) { setError((failure as Error).message); }
  }
  return <>
    {(error || command.error) && <Alert type="error" showIcon title={error || command.error} />}
    {command.pending && <Alert type="warning" showIcon title={`待确认提交：${command.pending.label}`} action={<Button loading={command.busy} onClick={recover}>恢复原提交</Button>} />}
    <ListPage title="供应商工作台" rows={list.rows.filter(row => row.supplierId === supplierId).map(row => ({ ...row, name: row.supplierOrderNo }))} loading={list.loading || reading} error={list.error} reload={list.reload}
      filters={[{ key: 'status', label: '订单状态', options: ['PUSHED', 'ACCEPTED', 'PARTIAL_SHIPPED', 'SHIPPED', 'REJECTED', 'CANCELED'].map(value => ({ value, label: workflowName(value) })) }]}
      columns={[{ title: '订单编号', dataIndex: 'supplierOrderNo' }, { title: '门店', dataIndex: 'storeName' }, { title: '订单状态', dataIndex: 'status', render: workflowName }, { title: '履约状态', dataIndex: 'fulfillmentStatus', render: workflowName }, { title: '供货金额', dataIndex: 'supplyGoodsAmount' }, { title: '创建时间', dataIndex: 'createdAt', render: workflowTime }, { title: '操作', fixed: 'right', width: 92, render: (_, row) => <Button size="small" icon={<Eye size={14} />} onClick={() => open(row.id)}>查看</Button> }]} />
    <Modal open={Boolean(order)} title={order?.supplierOrderNo} width={920} footer={null} maskClosable={false} closable={!command.busy && !editor} onCancel={() => setOrder(undefined)}>
      {order && <>
        <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[{ key: 'status', label: '订单状态', children: workflowName(order.status) }, { key: 'amount', label: '供货金额', children: order.supplyGoodsAmount }, { key: 'address', label: '收货地址', children: order.destination?.address || '-' }, { key: 'contact', label: '收货联系人', children: `${order.destination?.contactName || '-'} ${order.destination?.contactPhone || ''}` }]} />
        <div className="actions workflow-actions">
          {['PUSHED', 'ACCEPTED', 'PARTIAL_SHIPPED', 'SHIPPED'].includes(order.status) && <Button icon={<Truck size={16} />} disabled={command.blocked} onClick={() => setEditor('ship')}>发货与补发</Button>}
          {!['REJECTED', 'CANCELED'].includes(order.status) && order.requiresFreightSnapshot !== false && <Button icon={<Coins size={16} />} disabled={command.blocked} onClick={() => setEditor('freight')}>申请运费</Button>}
          {rejectable(order) && <Button danger icon={<X size={16} />} disabled={command.blocked} onClick={() => { setReason(''); setEditor('reject'); }}>拒单</Button>}
        </div>
        <Table rowKey="id" size="small" pagination={false} scroll={{ x: 650 }} dataSource={order.items} columns={[{ title: '商品', dataIndex: 'productName' }, { title: '订货数量', dataIndex: 'quantity' }, { title: '单位', render: (_, row) => row.unitName || row.unitSnapshot?.salesUnitName || '-' }, { title: '已发货', dataIndex: 'shippedQuantity' }, { title: '已收货', dataIndex: 'receivedQuantity' }, { title: '待发货', dataIndex: 'remainingToShipQuantity' }, { title: '供货金额', dataIndex: 'supplyLineAmount' }]} />
        <h2>运费申请</h2><Table rowKey="id" size="small" pagination={false} dataSource={order.freightConfirmations || []} columns={[{ title: '金额', dataIndex: 'amount' }, { title: '原因', dataIndex: 'reason' }, { title: '状态', dataIndex: 'status', render: workflowName }]} />
      </>}
    </Modal>
    {order && editor === 'ship' && <ShipmentEditor orderId={order.id} supplierId={supplierId} onRecover={recover} command={command} onClose={() => setEditor(undefined)} onSaved={saved} />}
    {order && editor === 'freight' && <FreightEditor orderId={order.id} supplierId={supplierId} onRecover={recover} command={command} onClose={() => setEditor(undefined)} onSaved={saved} />}
    <Modal open={editor === 'reject'} zIndex={1200} title="确认拒单" maskClosable={false} closable={!command.busy} onCancel={() => setEditor(undefined)} footer={<Button danger type="primary" loading={command.busy} disabled={command.blocked || !reason.trim()} onClick={async () => {
      if (!order || command.blocked) return;
      try { const current = await read(order.id); if (!rejectable(current) || current.version !== order.version) { setOrder(current); setEditor(undefined); throw new Error('订单已变化，请重新核对后操作。'); }
        if (await command.submit({ path: `/supplier-orders/${order.id}/reject`, method: 'POST', body: { expectedVersion: current.version, reason: reason.trim() }, label: '供应商拒单' })) { message.success('拒单已确认'); saved(); }
      } catch (failure) { setError((failure as Error).message); }
    }}>确认拒单</Button>}>
      <Input.TextArea aria-label="拒单原因" rows={3} maxLength={300} value={reason} disabled={command.blocked} onChange={event => setReason(event.target.value)} placeholder="拒单原因" />
      {command.error && <Alert type="error" showIcon title={command.error} />}
      {command.pending && <Button loading={command.busy} onClick={recover}>恢复原提交</Button>}
    </Modal>
  </>;
}
