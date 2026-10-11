import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Alert, Button, Modal, Spin } from 'antd';
import { Printer } from 'lucide-react';
import { getSession, request, type User } from '../lib/api';
import { money } from '../lib/money';
import { workflowName, workflowTime, type Purchase } from '../lib/workflowTypes';
import './PurchasePrint.css';

type PrintStore = { id: string; name: string; address?: string | null; contactName?: string | null; contactPhone?: string | null };
type Sheet = { purchase: Purchase; store: PrintStore };

export function PurchasePrint({ id, user, onClose }: { id: string; user: User; onClose: () => void }) {
  const [host] = useState(() => Object.assign(document.createElement('div'), { className: 'purchase-print-container' }));
  const [sheet, setSheet] = useState<Sheet>();
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false); const lock = useRef(false); const controller = useRef<AbortController | null>(null);
  async function read(signal: AbortSignal): Promise<Sheet> {
    if (getSession()?.user.id !== user.id) throw new Error('登录账号已变化，请重新打开订单');
    const purchase = await request<Purchase>(`/purchase-requests/${encodeURIComponent(id)}`, { signal });
    if (purchase.id !== id || user.scope?.type === 'MULTI_STORE' && !user.scope.storeIds?.includes(purchase.storeId)) throw new Error('订单不在当前授权范围');
    const store = await request<PrintStore>(`/stores/${encodeURIComponent(purchase.storeId)}`, { signal });
    if (store.id !== purchase.storeId) throw new Error('门店信息不匹配，请重新读取');
    return { purchase, store };
  }
  useEffect(() => {
    document.body.appendChild(host); mounted.current = true;
    const abort = new AbortController(); controller.current = abort;
    read(abort.signal).then(value => { if (!abort.signal.aborted) setSheet(value); })
      .catch(failure => { if (!abort.signal.aborted) setError((failure as Error).message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.current?.abort(); host.remove(); };
  }, [id, host]);
  async function print() {
    if (lock.current || !sheet) return;
    lock.current = true; setPrinting(true); setError('');
    const abort = new AbortController(); controller.current = abort;
    try {
      const fresh = await read(abort.signal);
      if (!mounted.current || abort.signal.aborted) return;
      flushSync(() => setSheet(fresh));
      window.print();
    } catch (failure) {
      if (mounted.current && !abort.signal.aborted) { setSheet(undefined); setError((failure as Error).message); }
    } finally { lock.current = false; if (mounted.current) setPrinting(false); }
  }
  return <Modal title="采购订单打印预览" open getContainer={host} width={850} zIndex={1600} mask={{ closable: false }}
    onCancel={onClose} closable={!printing} keyboard={!printing}
    footer={<><Button disabled={printing} onClick={onClose}>关闭</Button><Button type="primary" icon={<Printer size={16} />} disabled={loading || !sheet} loading={printing} onClick={print}>打印</Button></>}>
    {error && <Alert type="error" showIcon title={error} />}{loading && <Spin />}
    {sheet && <PurchasePrintSheet sheet={sheet} />}
  </Modal>;
}

export function PurchasePrintSheet({ sheet }: { sheet: Sheet }) {
  return <article className="purchase-print-sheet">
      <h1>采购订单</h1>
      <dl><div><dt>订单编号</dt><dd>{sheet.purchase.requestNo}</dd></div><div><dt>门店</dt><dd>{sheet.store.name}</dd></div>
        <div><dt>状态</dt><dd>{workflowName(sheet.purchase.status)}</dd></div><div><dt>下单时间</dt><dd>{workflowTime(sheet.purchase.submittedAt)}</dd></div>
        <div><dt>联系人</dt><dd>{sheet.store.contactName || '-'}</dd></div><div><dt>联系电话</dt><dd>{sheet.store.contactPhone || '-'}</dd></div>
        <div className="print-address"><dt>门店地址</dt><dd>{sheet.store.address || '-'}</dd></div></dl>
      <table><thead><tr><th>商品名称</th><th>销售单位</th><th>数量</th><th>销售单价</th><th>销售金额</th></tr></thead>
        <tbody>{sheet.purchase.items.map(item => <tr key={item.id}><td>{item.productName || '历史商品'}</td><td>{item.unitName || item.unitSnapshot?.salesUnitName || '-'}</td><td>{item.quantity}</td><td>{money(item.salesUnitPrice)}</td><td>{money(item.salesLineAmount)}</td></tr>)}</tbody></table>
      <div className="print-total">商品销售金额：{money(sheet.purchase.salesGoodsAmount)} 元</div>
    </article>;
}
