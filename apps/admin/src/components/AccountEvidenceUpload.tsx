import { useRef } from 'react';
import { App, Button, Tooltip, Upload } from 'antd';
import { Trash2, Upload as UploadIcon } from 'lucide-react';
import { getSession, request } from '../lib/api';
import { PrivateEvidence, type EvidenceFile } from './PrivateEvidence';

export function AccountEvidenceUpload({ purpose, files, onChange, uploading, onUploading, disabled, onError }: {
  purpose: 'RECHARGE' | 'CLEARING' | 'PAYMENT'; files: EvidenceFile[]; onChange: (files: EvidenceFile[]) => void;
  uploading: boolean; onUploading: (value: boolean) => void; disabled: boolean; onError: (value: string) => void;
}) {
  const lock = useRef(false); const { message } = App.useApp();
  return <section className="price-band"><h2>{purpose === 'PAYMENT' ? '付款凭证' : '图片凭证'}</h2><PrivateEvidence files={files} /><div className="actions workflow-actions">
    {files.map(file => <Tooltip key={file.id} title={`移除${file.filename}`}><Button type="text" aria-label={`移除${file.filename}`} icon={<Trash2 size={16} />} disabled={disabled || uploading} onClick={() => onChange(files.filter(row => row.id !== file.id))} /></Tooltip>)}
    <Upload accept={purpose === 'PAYMENT' ? 'image/jpeg,image/png,application/pdf' : 'image/jpeg,image/png'} showUploadList={false} disabled={disabled || uploading || files.length >= 5} beforeUpload={async file => {
      if (lock.current || disabled || files.length >= 5) return false;
      if (!(purpose === 'PAYMENT' ? ['image/jpeg', 'image/png', 'application/pdf'] : ['image/jpeg', 'image/png']).includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) { message.error(purpose === 'PAYMENT' ? '凭证须为不超过10MB的JPEG、PNG或PDF，最多5份' : '凭证须为不超过10MB的JPEG或PNG图片，最多5张'); return false; }
      lock.current = true; onUploading(true); onError('');
      try { const upload = await request<{ id: string; uploadToken: string }>('/files/upload-sessions', { method: 'POST', body: { purpose, filename: file.name, mimeType: file.type, sizeBytes: file.size } });
        const response = await fetch(`/api/v1/files/${upload.id}/content`, { method: 'POST', headers: { Authorization: `Bearer ${getSession()?.accessToken}`, 'x-upload-token': upload.uploadToken, 'Content-Type': 'application/octet-stream' }, body: file, signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error('凭证上传失败，请重新选择');
        const complete = await request<{ id: string; status: string }>(`/files/${upload.id}/complete`, { method: 'POST' });
        if (complete.id !== upload.id || complete.status !== 'READY') throw new Error('凭证未完成上传，不能关联');
        onChange([...files, { id: upload.id, filename: file.name, mimeType: file.type, sizeBytes: String(file.size) }]);
      } catch (failure) { onError((failure as Error).message); } finally { lock.current = false; onUploading(false); }
      return false;
    }}><Button icon={<UploadIcon size={16} />} disabled={disabled || uploading || files.length >= 5} loading={uploading}>上传凭证</Button></Upload>
  </div></section>;
}
