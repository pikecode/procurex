import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Select, Table } from 'antd';
import { request } from '../lib/api';
import type { Catalog, Purchase } from '../lib/workflowTypes';
import type { useWorkflowCommand } from '../lib/useWorkflowCommand';

type PreviewItem = { requestItemId: string; eligible: boolean; reason?: string; salesLineAmount: string; supplyLineAmount: string; priceVersionId: string; supplyPriceVersionId: string };
type Preview = { requestId: string; supplierId: string; items: PreviewItem[] };
export function SupplierAssignment({ purchase, command, onClose, onSaved }: { purchase: Purchase; command: ReturnType<typeof useWorkflowCommand>; onClose: () => void; onSaved: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [ids, setIds] = useState<string[]>([]); const [supplierId, setSupplierId] = useState<string>();
  const [preview, setPreview] = useState<Preview | null>(null); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    request<Catalog>(`/purchase-requests/${purchase.id}/edit-catalog`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setCatalog(value); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [purchase.id]);
  const suppliers = [...new Map((catalog?.items.flatMap(item => item.suppliers) || []).map(item => [item.supplierId, item])).values()];
  async function readPreview() {
    if (lock.current || command.blocked || !supplierId || !ids.length) return;
    lock.current = true; setBusy(true); setError(''); setPreview(null);
    try {
      const result = await request<Preview>(`/purchase-requests/${purchase.id}/reassign-preview`, { method: 'POST', body: { expectedVersion: purchase.version, itemIds: ids, supplierId } });
      if (result.requestId !== purchase.id || result.supplierId !== supplierId || !Array.isArray(result.items) || result.items.length !== ids.length
        || new Set(result.items.map(item => item.requestItemId)).size !== ids.length || result.items.some(item => !ids.includes(item.requestItemId) || (item.eligible && (!item.priceVersionId || !item.supplyPriceVersionId)))) throw new Error('供应商预览不完整，请重新预览。');
      setPreview(result);
    } catch (failure) { setError((failure as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  const valid = preview && preview.items.every(item => item.eligible);
  return <Modal open zIndex={1200} title="调整供应商" width={820} maskClosable={false} closable={!busy && !command.busy} onCancel={onClose} footer={<div className="actions workflow-actions">
    <Button disabled={busy || command.busy} onClick={onClose}>取消</Button>
    <Button loading={busy} disabled={command.blocked || !supplierId || !ids.length} onClick={readPreview}>预览调整</Button>
    <Button type="primary" loading={command.busy} disabled={busy || command.blocked || !valid} onClick={async () => {
      if (!valid || busy || command.blocked) return;
      if (await command.submit({ path: `/purchase-requests/${purchase.id}/assign`, method: 'POST', label: '调整供应商', body: { expectedVersion: purchase.version, itemIds: ids, supplierId,
        expectedPrices: preview.items.map(item => ({ requestItemId: item.requestItemId, priceVersionId: item.priceVersionId, supplyPriceVersionId: item.supplyPriceVersionId })) } })) onSaved();
    }}>确认调整</Button>
  </div>}>
    {(error || command.error) && <Alert type="error" showIcon title={error || command.error} />}
    {command.pending && <Alert type="warning" showIcon title={`待确认提交：${command.pending.label}`} action={<Button loading={command.busy} onClick={async () => { if (await command.recover()) onSaved(); }}>恢复原提交</Button>} />}
    <Select aria-label="目标供应商" placeholder="选择目标供应商" style={{ width: '100%', marginBottom: 12 }} showSearch optionFilterProp="label" loading={!catalog && !error} disabled={busy || command.blocked} value={supplierId}
      options={suppliers.map(item => ({ value: item.supplierId, label: item.supplierName }))} onChange={value => { setSupplierId(value); setPreview(null); }} />
    <Table rowKey="id" size="small" dataSource={purchase.items} pagination={false} scroll={{ x: 600 }} rowSelection={{ selectedRowKeys: ids, onChange: keys => { setIds(keys as string[]); setPreview(null); }, getCheckboxProps: () => ({ disabled: busy || command.blocked }) }} columns={[
      { title: '商品', render: (_, item) => item.productName || catalog?.items.find(row => row.product.id === item.productId)?.product.name || item.productId },
      { title: '数量', dataIndex: 'quantity' }, { title: '销售金额', dataIndex: 'salesLineAmount' }, { title: '供货金额', dataIndex: 'supplyLineAmount' },
    ]} />
    {preview && <section className="price-band"><h2>调整预览</h2><Table rowKey="requestItemId" size="small" dataSource={preview.items} pagination={false} scroll={{ x: 600 }} columns={[
      { title: '商品', render: (_, item) => purchase.items.find(row => row.id === item.requestItemId)?.productName || catalog?.items.find(row => row.product.id === purchase.items.find(value => value.id === item.requestItemId)?.productId)?.product.name },
      { title: '销售金额', dataIndex: 'salesLineAmount' }, { title: '供货金额', dataIndex: 'supplyLineAmount' },
      { title: '资格', render: (_, item) => item.eligible ? '可调整' : ({ SUPPLIER_NOT_ACTIVE: '供应商已停用', SUPPLIER_NOT_ALLOWED_FOR_PRODUCT: '供应商不适用此商品', PRICE_NOT_AVAILABLE: '缺少有效价格', ITEM_NOT_FOUND: '商品已变更' }[item.reason || ''] || '不可调整') },
    ]} /></section>}
  </Modal>;
}
