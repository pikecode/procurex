import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Spin, Table, Tooltip, Upload } from 'antd';
import { Check, Eye, RotateCcw, Trash2, Upload as UploadIcon } from 'lucide-react';
import { PrivateEvidence, type EvidenceFile } from '../components/PrivateEvidence';
import { getSession, request } from '../lib/api';
import { decimalRule } from '../lib/catalogTypes';
import type { useWorkflowCommand } from '../lib/useWorkflowCommand';

export type ShipmentDetail = { id: string; shipmentNo: string; supplierOrderId: string; supplierOrderNo: string; supplierOrderVersion: number; currentReceiptRevision: number; evidenceFiles?: EvidenceFile[]; items: { id: string; productName: string; unitName: string | null; shippedQuantity: string; currentReceivedQuantity: string | null; receiptLocked: boolean }[] };
type ReceiptInput = { expectedOrderVersion: number; expectedReceiptRevision: number; items: { shipmentItemId: string; receivedQuantity: string }[]; evidenceFileIds?: string[] };
export function ReceiptEditor({ shipmentId, command, onClose, onSaved }: { shipmentId: string; command: ReturnType<typeof useWorkflowCommand>; onClose: () => void; onSaved: () => void }) {
  const [shipment, setShipment] = useState<ShipmentDetail | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  const [files, setFiles] = useState<EvidenceFile[]>([]); const [uploading, setUploading] = useState(false); const uploadLock = useRef(false); const [review, setReview] = useState<ReceiptInput | null>(null);
  const [form] = Form.useForm<{ items: ReceiptInput['items'] }>(); const { message } = App.useApp();
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setShipment(null); setError(''); setReview(null); form.resetFields();
    request<ShipmentDetail>(`/shipments/${shipmentId}`, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (value.id !== shipmentId || !Number.isInteger(value.supplierOrderVersion) || !Number.isInteger(value.currentReceiptRevision) || !value.items?.length || new Set(value.items.map(item => item.id)).size !== value.items.length) throw new Error('发货明细不完整，请重新读取。');
      if (value.currentReceiptRevision > 0 && value.items.every(item => item.receiptLocked)) throw new Error('本发货单的收货数量已全部锁定，不能再修订。');
      setShipment(value); form.setFieldsValue({ items: value.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: item.currentReceivedQuantity ?? '' })) });
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [shipmentId, revision, form]);
  async function draft(): Promise<ReceiptInput> {
    const values = await form.validateFields(); if (!shipment || loading || uploading) throw new Error('请先完成明细读取和凭证上传。');
    if (values.items.length !== shipment.items.length || new Set(values.items.map(item => item.shipmentItemId)).size !== shipment.items.length || values.items.some(item => !shipment.items.some(row => row.id === item.shipmentItemId))) throw new Error('收货清单未逐项覆盖发货明细，请重新读取。');
    return { expectedOrderVersion: shipment.supplierOrderVersion, expectedReceiptRevision: shipment.currentReceiptRevision, items: values.items, ...(files.length ? { evidenceFileIds: files.map(file => file.id) } : {}) };
  }
  const locked = uploading || command.blocked;
  return <Modal open zIndex={1400} title={shipment?.currentReceiptRevision ? '修订收货' : '登记收货'} width={800} maskClosable={false} keyboard={!uploading && !command.busy} closable={!uploading && !command.busy} onCancel={() => { if (!uploading && !command.busy) onClose(); }} footer={<div className="actions workflow-actions">
    <Button disabled={uploading || command.busy} onClick={onClose}>取消</Button><Tooltip title="重新读取收货明细"><Button aria-label="重新读取收货明细" icon={<RotateCcw size={16} />} disabled={locked} onClick={() => { command.clearError(); setRevision(value => value + 1); }} /></Tooltip>
    <Button icon={<Eye size={16} />} disabled={locked || !shipment || loading} onClick={async () => { try { setReview(await draft()); setError(''); } catch (failure) { if (!('errorFields' in (failure as object))) setError((failure as Error).message); } }}>核对收货</Button>
    <Popconfirm key={revision} zIndex={1600} title="确认收货？金额及储值扣款由服务端按实际收货核定。" disabled={!review || locked} onConfirm={async () => {
      if (locked) return;
      try { const body = await draft(); if (!review || JSON.stringify(body) !== JSON.stringify(review)) { setReview(null); throw new Error('收货内容已变化，请重新核对。'); }
        if (await command.submit({ path: `/shipments/${shipmentId}/receipts`, method: 'POST', label: '确认收货', body })) { message.success('收货已确认'); onSaved(); } else setReview(null);
      } catch (failure) { if (!('errorFields' in (failure as object))) setError((failure as Error).message); }
    }}><Button type="primary" icon={<Check size={16} />} disabled={!review || locked} loading={command.busy}>确认收货</Button></Popconfirm>
  </div>}>
    {(error || command.error) && <Alert type="error" showIcon title={error || command.error} />}
    {command.pending && <Alert type="warning" showIcon title={`待确认提交：${command.pending.label}`} action={<Button loading={command.busy} onClick={async () => { if (await command.recover()) onSaved(); }}>恢复原提交</Button>} />}
    {loading ? <Spin /> : shipment && <>
      <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[{ key: 'shipment', label: '发货单', children: shipment.shipmentNo }, { key: 'revision', label: '当前收货修订', children: shipment.currentReceiptRevision }]} />
      <Form form={form} layout="vertical" className="compact-form" disabled={locked} onValuesChange={() => setReview(null)}><Form.List name="items">{fields => fields.map(field => { const item = shipment.items[field.name]; return <div className="shipping-item" key={field.key}>
        <strong>{item.productName}</strong><div className="template-price">发货数量：{item.shippedQuantity}；单位：{item.unitName || '历史未核定'}；{item.receiptLocked ? '已锁定' : '可登记'}</div>
        <Form.Item hidden name={[field.name, 'shipmentItemId']}><Input /></Form.Item><Form.Item label="实际收货数量" name={[field.name, 'receivedQuantity']} rules={[decimalRule('收货数量')]}><InputNumber aria-label={`收货数量${item.id}`} stringMode controls={false} min="0" disabled={locked || item.receiptLocked} /></Form.Item>
        {!item.receiptLocked && <Button size="small" disabled={locked} onClick={() => { form.setFieldValue(['items', field.name, 'receivedQuantity'], item.shippedQuantity); setReview(null); }}>全部到货</Button>}
      </div>; })}</Form.List></Form>
      {!!shipment.evidenceFiles?.length && <section className="price-band"><h2>上一修订凭证</h2><PrivateEvidence files={shipment.evidenceFiles} /></section>}
      <section className="price-band"><h2>本次收货凭证</h2><PrivateEvidence files={files} /><div className="actions workflow-actions">{files.map(file => <Tooltip key={file.id} title={`移除${file.filename}`}><Button type="text" aria-label={`移除${file.filename}`} icon={<Trash2 size={16} />} disabled={locked} onClick={() => { setFiles(current => current.filter(row => row.id !== file.id)); setReview(null); }} /></Tooltip>)}
        <Upload accept="image/jpeg,image/png" showUploadList={false} disabled={locked || files.length >= 6} beforeUpload={async file => {
          if (uploadLock.current || command.blocked || files.length >= 6) return false;
          if (!['image/jpeg', 'image/png'].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) { message.error('收货凭证须为不超过10MB的JPEG或PNG图片，最多6张'); return false; }
          uploadLock.current = true; setUploading(true); setReview(null); setError('');
          try { const upload = await request<{ id: string; uploadToken: string }>('/files/upload-sessions', { method: 'POST', body: { purpose: 'RECEIPT', filename: file.name, mimeType: file.type, sizeBytes: file.size } });
            const response = await fetch(`/api/v1/files/${upload.id}/content`, { method: 'POST', headers: { Authorization: `Bearer ${getSession()?.accessToken}`, 'x-upload-token': upload.uploadToken, 'Content-Type': 'application/octet-stream' }, body: file, signal: AbortSignal.timeout(30000) });
            if (!response.ok) throw new Error('凭证上传失败，请重新选择');
            const complete = await request<{ id: string; status: string }>(`/files/${upload.id}/complete`, { method: 'POST' }); if (complete.id !== upload.id || complete.status !== 'READY') throw new Error('凭证尚未完成上传，不能关联收货');
            setFiles(current => [...current, { id: upload.id, filename: file.name, mimeType: file.type, sizeBytes: String(file.size) }]);
          } catch (failure) { setError((failure as Error).message); } finally { uploadLock.current = false; setUploading(false); } return false;
        }}><Button disabled={locked || files.length >= 6} loading={uploading} icon={<UploadIcon size={16} />}>上传凭证</Button></Upload>
      </div></section>
      {review && <section className="price-band"><h2>收货核对</h2><Table rowKey="shipmentItemId" size="small" pagination={false} scroll={{ x: 450 }} dataSource={review.items} columns={[{ title: '商品', render: (_, item) => shipment.items.find(row => row.id === item.shipmentItemId)?.productName }, { title: '实际收货', dataIndex: 'receivedQuantity' }]} /></section>}
    </>}
  </Modal>;
}
