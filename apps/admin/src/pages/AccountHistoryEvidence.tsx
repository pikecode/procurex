import { useEffect, useState } from 'react';
import { Button, Spin, Tooltip } from 'antd';
import { RotateCcw } from 'lucide-react';
import { PrivateEvidence } from '../components/PrivateEvidence';
import { request } from '../lib/api';
import type { AccountDocument } from '../lib/financeTypes';

export function AccountHistoryEvidence({ storeId, documentId, kind, active }: {
  storeId: string; documentId: string; kind: 'RECHARGE' | 'CLEARING'; active: boolean;
}) {
  const [document, setDocument] = useState<AccountDocument | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setDocument(null); setFailed(false);
    if (!active) return;
    const controller = new AbortController();
    request<AccountDocument>(`/stores/${storeId}/${kind === 'RECHARGE' ? 'recharges' : 'clearings'}/${documentId}`, { signal: controller.signal })
      .then(value => {
        if (value.storeId !== storeId || value.id !== documentId || value.kind !== kind) throw new Error('单据范围不匹配');
        if (!controller.signal.aborted) setDocument(value);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [storeId, documentId, kind, active, revision]);
  if (!active) return null;
  if (failed) return <Tooltip title="凭证读取失败，点击重试"><Button type="text" aria-label="重试历史凭证" icon={<RotateCcw size={16} />} onClick={() => setRevision(value => value + 1)} /></Tooltip>;
  if (!document) return <Spin size="small" />;
  return document.evidenceFiles?.length ? <PrivateEvidence files={document.evidenceFiles} /> : <span className="finance-no-evidence">无凭证</span>;
}
