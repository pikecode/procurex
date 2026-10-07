import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Slider, Upload } from 'antd';
import { Upload as UploadIcon } from 'lucide-react';
import Cropper, { type Area } from 'react-easy-crop';

export async function cropProductImage(source: string, area: Area, filename: string): Promise<File> {
  const image = new Image(); image.src = source; await image.decode();
  const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
  if (!context) throw new Error('无法处理图片');
  let side = Math.min(1600, Math.round(area.width), Math.round(area.height));
  for (let attempt = 0; attempt < 8; attempt++) {
    canvas.width = side; canvas.height = side;
    context.fillStyle = '#fff'; context.fillRect(0, 0, side, side);
    context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, side, side);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片压缩失败')), 'image/jpeg', Math.max(0.55, 0.9 - attempt * 0.05)));
    if (blob.size <= 2 * 1024 * 1024) return new File([blob], `${filename.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
    side = Math.max(1, Math.floor(side * 0.8));
  }
  throw new Error('图片压缩失败，请重新选择');
}

export function ProductImageUpload({ disabled, onUpload, onBusy }: { disabled: boolean; onUpload: (file: File) => Promise<void>; onBusy: (busy: boolean) => void }) {
  const [source, setSource] = useState(''); const [name, setName] = useState(''); const [error, setError] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 }); const [zoom, setZoom] = useState(1); const [area, setArea] = useState<Area>(); const [busy, setBusy] = useState(false);
  const current = useRef('');
  useEffect(() => () => { if (current.current) URL.revokeObjectURL(current.current); }, []);
  const close = () => { URL.revokeObjectURL(current.current); current.current = ''; setSource(''); onBusy(false); };
  return <>
    <Upload accept="image/jpeg,image/png" showUploadList={false} disabled={disabled} beforeUpload={file => {
      if (!['image/jpeg', 'image/png'].includes(file.type) || !file.size) { setError('请选择JPEG或PNG图片'); return false; }
      if (current.current) URL.revokeObjectURL(current.current);
      current.current = URL.createObjectURL(file); setName(file.name); setSource(current.current); setCrop({ x: 0, y: 0 }); setZoom(1); setArea(undefined); setError(''); onBusy(true); return false;
    }}><Button icon={<UploadIcon size={16} />} disabled={disabled}>上传图片</Button></Upload>
    {!source && error && <Alert type="error" title={error} />}
    <Modal title="裁切商品图片" open={Boolean(source)} width={520} transitionName="" okText="确认上传" cancelText="取消" confirmLoading={busy} okButtonProps={{ disabled: !area }} closable={!busy} maskClosable={!busy} keyboard={!busy} onCancel={close} onOk={async () => {
      if (!area || busy) return; setBusy(true); setError('');
      try { const file = await cropProductImage(source, area, name); await onUpload(file); close(); }
      catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
    }}>
      {error && <Alert type="error" title={error} showIcon />}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1', marginTop: 16, background: '#202426' }}>
        {source && <Cropper image={source} crop={crop} zoom={zoom} aspect={1} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setArea(pixels)} />}
      </div>
      <Slider aria-label="图片缩放" min={1} max={3} step={0.01} value={zoom} disabled={busy} onChange={setZoom} />
    </Modal>
  </>;
}
