import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Select, Spin, Table } from 'antd';
import { Check, Eye } from 'lucide-react';
import { AccountEvidenceUpload } from '../components/AccountEvidenceUpload';
import type { EvidenceFile } from '../components/PrivateEvidence';
import { request } from '../lib/api';
import { clearingSignature, moneyRule, type ClearingPreview, type StoreAccount } from '../lib/financeTypes';
import type { useWorkflowCommand } from '../lib/useWorkflowCommand';

export function StoreFinanceEditor({ storeId, mode, ids, command, onClose, onSaved }: {
  storeId: string; mode: 'recharge' | 'credit' | 'clearing'; ids: string[]; command: ReturnType<typeof useWorkflowCommand>; onClose: () => void; onSaved: () => void;
}) {
  const [form] = Form.useForm(); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [account, setAccount] = useState<StoreAccount | null>(null); const [accounts, setAccounts] = useState<{ id: string; name: string; bankName: string; accountNo: string; status: string }[]>([]);
  const [preview, setPreview] = useState<ClearingPreview | null>(null); const [review, setReview] = useState(''); const [checking, setChecking] = useState(false); const lock = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [files, setFiles] = useState<EvidenceFile[]>([]); const [uploading, setUploading] = useState(false); const { message } = App.useApp();
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    const load = async () => {
      if (mode === 'credit') { const result = await request<StoreAccount>(`/stores/${storeId}/account`, { signal: controller.signal }); if (result.storeId !== storeId || !Number.isInteger(result.version)) throw new Error('账户范围或版本不匹配。'); if (!controller.signal.aborted) { setAccount(result); form.setFieldValue('limit', result.creditLimit); } }
      if (mode === 'recharge') { const result = await request<typeof accounts>('/collection-accounts', { signal: controller.signal }); if (!controller.signal.aborted) setAccounts(result.filter(row => row.status === 'ACTIVE')); }
      if (mode === 'clearing') { const result = await request<ClearingPreview>(`/stores/${storeId}/clearings/preview`, { method: 'POST', body: { fundingAllocationIds: ids }, signal: controller.signal }); validatePreview(result); if (!controller.signal.aborted) setPreview(result); }
    };
    load().catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [storeId, mode, ids, form]);
  function validatePreview(value: ClearingPreview) {
    if (value.storeId !== storeId || !value.items?.length || value.items.length !== ids.length || new Set(value.items.map(row => row.fundingAllocationId)).size !== ids.length || value.items.some(row => !ids.includes(row.fundingAllocationId) || !Number.isInteger(row.version) || !row.clearableAmount)) throw new Error('销账预览未覆盖所选明细，请重新读取。');
  }
  async function draft() {
    const values = await form.validateFields();
    if (loading || uploading) throw new Error('请等待数据和凭证读取完成。');
    if (mode === 'credit') { if (!account) throw new Error('请重新读取账户版本。'); return { expectedVersion: account.version, limit: values.limit as string, reason: values.reason.trim() }; }
    const common = { businessDate: values.businessDate as string, ...(values.remark?.trim() ? { remark: values.remark.trim() } : {}), ...(files.length ? { evidenceFileIds: files.map(file => file.id) } : {}) };
    if (mode === 'recharge') { if (!accounts.some(row => row.id === values.collectionAccountId)) throw new Error('请选择启用的收款账户。'); return { ...common, amount: values.amount as string, collectionAccountId: values.collectionAccountId as string }; }
    if (!preview) throw new Error('请重新读取销账预览。');
    return { ...common, items: preview.items.map(row => ({ fundingAllocationId: row.fundingAllocationId, expectedVersion: row.version, expectedAmount: row.clearableAmount })) };
  }
  const disabled = command.blocked || checking || uploading; const ready = !loading && (mode === 'credit' ? Boolean(account) : mode === 'clearing' ? Boolean(preview) : accounts.length > 0);
  const label = mode === 'credit' ? '调整挂账额度' : mode === 'clearing' ? '门店销账' : '门店充值'; const path = `/stores/${storeId}/${mode === 'credit' ? 'credit-limit' : mode === 'clearing' ? 'clearings' : 'recharges'}`;
  return <Modal open zIndex={1400} title={label} width={700} maskClosable={false} closable={!command.busy && !checking && !uploading} keyboard={!command.busy && !checking && !uploading} onCancel={() => { if (!command.busy && !checking && !uploading) onClose(); }} footer={<div className="actions workflow-actions">
    <Button disabled={command.busy || checking || uploading} onClick={onClose}>取消</Button>
    <Button icon={<Eye size={16} />} disabled={disabled || !ready} loading={checking} onClick={async () => { if (lock.current) return; lock.current = true; setChecking(true); setReview(''); setError(''); try { setReview(JSON.stringify(await draft())); } catch (failure) { if (!('errorFields' in (failure as object))) setError((failure as Error).message); } finally { lock.current = false; setChecking(false); } }}>核对提交</Button>
    <Popconfirm key={review} getPopupContainer={node => node.parentElement!} zIndex={1600} open={confirmOpen && !disabled && Boolean(review)} onOpenChange={setConfirmOpen} title={mode === 'recharge' ? '确认增加门店储值余额？' : mode === 'clearing' ? '确认还款销账并释放挂账额度？不会扣减储值。' : '确认调整挂账额度？'} disabled={disabled || !review} onConfirm={async () => {
      if (disabled || lock.current) return; setConfirmOpen(false); lock.current = true; setChecking(true);
      try { const body = await draft(); if (JSON.stringify(body) !== review) throw new Error('内容已变更，请重新核对。');
        if (mode === 'clearing') { const fresh = await request<ClearingPreview>(`/stores/${storeId}/clearings/preview`, { method: 'POST', body: { fundingAllocationIds: ids } }); validatePreview(fresh); if (!preview || clearingSignature(fresh) !== clearingSignature(preview)) { setPreview(fresh); throw new Error('挂账明细已变化，请按最新金额重新核对。'); } }
        if (await command.submit({ path, method: mode === 'credit' ? 'PATCH' : 'POST', label, body })) { message.success(`${label}已确认`); onSaved(); }
      } catch (failure) { if (!('errorFields' in (failure as object))) setError((failure as Error).message); } finally { setReview(''); lock.current = false; setChecking(false); }
    }}><Button type="primary" icon={<Check size={16} />} disabled={disabled || !review} loading={command.busy}>确认提交</Button></Popconfirm>
  </div>}>
    {(error || command.error) && <Alert type="error" showIcon title={error || command.error} />}
    {command.pending && <Alert type="warning" showIcon title={`存在待确认提交：${command.pending.label}`} action={<Button disabled={!/^\/stores\/[0-9a-f-]{36}\/(recharges|clearings|credit-limit)$/.test(command.pending.path)} loading={command.busy} onClick={async () => { if (command.pending && /^\/stores\/[0-9a-f-]{36}\/(recharges|clearings|credit-limit)$/.test(command.pending.path) && await command.recover()) onSaved(); }}>恢复原提交</Button>} />}
    {loading ? <Spin /> : <>
      {mode === 'recharge' && !accounts.length && <Alert type="warning" title="暂无启用的收款账户，请先配置收款账户" />}
      {preview && <><Descriptions size="small" items={[{ key: 'total', label: '销账合计', children: preview.totalAmount }]} /><Table size="small" rowKey="fundingAllocationId" pagination={false} scroll={{ x: 450 }} dataSource={preview.items} columns={[{ title: '挂账明细', dataIndex: 'fundingAllocationId' }, { title: '核定销账金额', dataIndex: 'clearableAmount' }]} /></>}
      <Form form={form} layout="vertical" className="compact-form finance-form" disabled={disabled} initialValues={{ businessDate: new Date().toLocaleDateString('sv-SE') }} onValuesChange={() => setReview('')}>
        {mode === 'credit' ? <><Form.Item label="挂账额度" name="limit" rules={[moneyRule()]}><InputNumber aria-label="挂账额度" stringMode controls={false} min="0" /></Form.Item><Form.Item label="调整原因" name="reason" rules={[{ required: true, whitespace: true, max: 300, message: '请输入调整原因，最多300字' }]}><Input.TextArea rows={2} maxLength={300} /></Form.Item></> : <>
          {mode === 'recharge' && <><Form.Item label="充值金额" name="amount" rules={[moneyRule(true)]}><InputNumber aria-label="充值金额" stringMode controls={false} min="0.01" /></Form.Item><Form.Item label="收款账户" name="collectionAccountId" rules={[{ required: true, message: '请选择收款账户' }]}><Select aria-label="收款账户" options={accounts.map(row => ({ value: row.id, label: `${row.name} · ${row.bankName} · 尾号${row.accountNo.slice(-4)}` }))} /></Form.Item></>}
          <Form.Item label="业务日期" name="businessDate" rules={[{ required: true, message: '请选择业务日期' }]}><Input aria-label="业务日期" type="date" /></Form.Item>
          <Form.Item label="备注" name="remark" rules={[{ max: 300, message: '备注最多300字' }]}><Input.TextArea rows={2} maxLength={300} /></Form.Item>
        </>}
      </Form>
      {mode !== 'credit' && <AccountEvidenceUpload purpose={mode === 'recharge' ? 'RECHARGE' : 'CLEARING'} files={files} onChange={value => { setFiles(value); setReview(''); }} uploading={uploading} onUploading={value => { setUploading(value); setReview(''); }} disabled={command.blocked || checking} onError={setError} />}
      {review && <section className="price-band"><h2>提交核对</h2><Descriptions size="small" column={1} items={Object.entries(JSON.parse(review)).filter(([key]) => !['items', 'evidenceFileIds', 'expectedVersion'].includes(key)).map(([key, value]) => ({ key, label: ({ amount: '充值金额', limit: '挂账额度', reason: '调整原因', businessDate: '业务日期', remark: '备注', collectionAccountId: '收款账户' } as Record<string, string>)[key] || key, children: key === 'collectionAccountId' ? accounts.find(row => row.id === value)?.name : String(value) }))} /></section>}
    </>}
  </Modal>;
}
