import { useEffect, useState } from 'react';
import { Button, Image, Tooltip } from 'antd';
import { Download, RotateCcw, FileText } from 'lucide-react';
import { getSession } from '../lib/api';

export type EvidenceFile = { id: string; filename: string; mimeType: string; sizeBytes: string };
function EvidenceImage({ file }: { file: EvidenceFile }) {
  const [url, setUrl] = useState(''); const [failed, setFailed] = useState(false); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = ''; setUrl(''); setFailed(false);
    fetch(`/api/v1/files/${file.id}/download`, { headers: { Authorization: `Bearer ${getSession()?.accessToken}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async response => { if (!response.ok) throw new Error('读取失败'); const blob = await response.blob(); if (!['image/jpeg', 'image/png', ...(file.mimeType === 'application/pdf' ? ['application/pdf'] : [])].includes(blob.type)) throw new Error('凭证类型不符'); return blob; })
      .then(blob => { if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id, revision]);
  return <div className="evidence-file">{url ? file.mimeType === 'application/pdf' ? <Tooltip title="查看PDF凭证"><a href={url} target="_blank" rel="noreferrer"><Button aria-label={`查看${file.filename}`} type="text" icon={<FileText size={24} />} /></a></Tooltip> : <Image width={64} height={64} src={url} alt={file.filename} style={{ objectFit: 'cover' }} /> : <span>{failed ? '读取失败' : '加载中'}</span>}
    <span className="evidence-name" title={file.filename}>{file.filename}</span>
    {url ? <Tooltip title="下载凭证"><a href={url} download={file.filename}><Button aria-label={`下载${file.filename}`} type="text" icon={<Download size={16} />} /></a></Tooltip> : failed && <Tooltip title="重试读取"><Button aria-label={`重试${file.filename}`} type="text" icon={<RotateCcw size={16} />} onClick={() => setRevision(value => value + 1)} /></Tooltip>}
  </div>;
}
export function PrivateEvidence({ files }: { files: EvidenceFile[] }) {
  return <Image.PreviewGroup preview={{ zIndex: 1800 }}><div className="evidence-list">{files.map(file => <EvidenceImage key={file.id} file={file} />)}</div></Image.PreviewGroup>;
}
