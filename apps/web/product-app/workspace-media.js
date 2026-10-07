export function mountCrop(editor) {
  const form = editor.form;
  const input = form.querySelector('[name="picture"]');
  const canvas = form.querySelector('canvas');
  const zoom = form.querySelector('[name="pictureZoom"]');
  const error = form.querySelector('.ws-image-error');
  let bitmap;
  let panX = 0, panY = 0, start;
  let removed = false;
  let selection = 0;
  const draw = () => {
    if (!bitmap) return;
    const scale = Math.max(800 / bitmap.width, 800 / bitmap.height) * Number(zoom.value);
    const width = bitmap.width * scale, height = bitmap.height * scale;
    panX = Math.max(-(width - 800) / 2, Math.min((width - 800) / 2, panX));
    panY = Math.max(-(height - 800) / 2, Math.min((height - 800) / 2, panY));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, 800, 800);
    context.drawImage(bitmap, (800 - width) / 2 + panX, (800 - height) / 2 + panY, width, height);
    canvas.hidden = false; zoom.parentElement.hidden = false;
  };
  input.onchange = async () => {
    const id = ++selection;
    bitmap?.close(); bitmap = null; canvas.hidden = true; zoom.parentElement.hidden = true; error.textContent = '';
    const file = input.files[0]; if (!file) return;
    try {
      if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('请选择不超过 20 MB 的 JPEG 或 PNG 图片。');
      const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (!form.isConnected || id !== selection) { image.close(); return; }
      if (image.width > 12000 || image.height > 12000) { image.close(); throw new Error('图片尺寸过大。'); }
      bitmap = image; zoom.value = '1'; panX = 0; panY = 0; removed = false; draw();
    } catch (failure) { if (id === selection && form.isConnected) { input.value = ''; error.textContent = failure.message; } }
  };
  zoom.oninput = draw;
  canvas.onpointerdown = event => { start = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); };
  canvas.onpointermove = event => {
    if (!start) return;
    const scale = 800 / canvas.getBoundingClientRect().width;
    panX += (event.clientX - start.x) * scale; panY += (event.clientY - start.y) * scale;
    start = { x: event.clientX, y: event.clientY }; draw();
  };
  canvas.onpointerup = canvas.onpointercancel = () => { start = null; };
  form.querySelector('[data-remove-image]').onclick = () => {
    selection += 1; removed = true; bitmap?.close(); bitmap = null; input.value = ''; canvas.hidden = true;
    zoom.parentElement.hidden = true; form.querySelector('[data-current-image]')?.remove();
  };
  editor.dialog.addEventListener('close', () => { selection += 1; bitmap?.close(); bitmap = null; });
  return {
    async imageFileId(context) {
      if (!bitmap) return removed ? null : undefined;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
      if (!blob || blob.size > 2 * 1024 * 1024) throw new Error('图片压缩失败，请更换图片。');
      return context.uploadImage(blob);
    },
  };
}

export async function hydrateImages(context, container) {
  await Promise.all([...container.querySelectorAll('img[data-image]')].map(async image => {
    try {
      const blob = await context.client.request(`/files/${image.dataset.image}/download`, { binary: true });
      if (!context.active() || !image.isConnected) return;
      const url = URL.createObjectURL(blob);
      context.cleanup(() => URL.revokeObjectURL(url));
      image.src = url; image.hidden = false;
    } catch { if (image.isConnected) image.remove(); }
  }));
}
