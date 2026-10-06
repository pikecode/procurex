import { esc } from './ui.js';
import { icons, iconButton, openEditor } from './workspace.js';

function mountEvidencePreview(context, editor, container, blob, filename) {
  const url = URL.createObjectURL(blob);
  const release = () => URL.revokeObjectURL(url);
  editor.dialog.addEventListener('close', release, { once: true });
  context.cleanup(release);
  container.innerHTML = `<button type="button" class="ws-proof-thumbnail" aria-label="预览${esc(filename)}"><img alt="${esc(filename)}"></button><span class="ws-proof-name">${esc(filename)}</span>${iconButton('download', '下载凭证', 'data-proof-download')}`;
  container.querySelector('img').src = url;
  container.querySelector('.ws-proof-thumbnail').onclick = () => {
    const preview = openEditor(context, '图片凭证', '<div class="ws-wide"><img class="ws-proof-full" alt="图片凭证"></div>');
    preview.form.querySelector('img').src = url;
    const close = () => { preview.dialog.close(); preview.dialog.remove(); };
    editor.dialog.addEventListener('close', close, { once: true });
    preview.dialog.addEventListener('close', () => editor.dialog.removeEventListener('close', close), { once: true });
  };
  container.querySelector('[data-proof-download]').onclick = () => {
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  };
}

export function openAccountEvidenceEditor(context, title, fields, purpose, submit) {
  let file; let uploading = false;
  const editor = openEditor(context, title, fields
    + '<section class="ws-wide"><h3>图片凭证</h3><input name="accountProofFile" type="file" accept="image/jpeg,image/png" hidden><div class="ws-actions"><button type="button" data-account-proof-add class="ws-secondary"><i data-lucide="paperclip"></i>添加凭证</button><span data-account-proof-status></span></div></section>', async (data, form) => {
    if (uploading || !file?.id) throw new Error('请先完成图片凭证上传。');
    data.delete('accountProofFile');
    await submit(data, form, [file.id]);
  });
  const form = editor.form;
  const alive = () => editor.dialog.isConnected && context.active();
  const update = () => {
    form.querySelector('[type="submit"]').disabled = uploading || !file?.id || Boolean(context.client.pendingCommand);
    form.querySelector('[data-account-proof-add]').disabled = uploading || Boolean(context.client.pendingCommand);
  };
  async function upload() {
    uploading = true; file.id = undefined; update();
    form.querySelector('[data-account-proof-status]').textContent = `${file.blob.name} · 上传中`;
    try { file.id = await context.uploadFile(file.blob, purpose, file.blob.name); }
    catch (error) { if (alive()) { const box = form.querySelector('.ws-form-error'); box.hidden = false; box.textContent = error.message; } }
    finally {
      uploading = false;
      if (alive()) {
        form.querySelector('[data-account-proof-status]').innerHTML = `${esc(file.blob.name)} · ${file.id ? '已上传' : '上传失败'} ${file.id ? '' : iconButton('rotate-cw', '重试上传', 'data-account-proof-retry')}`;
        form.querySelector('[data-account-proof-retry]')?.addEventListener('click', upload); icons(); update();
      }
    }
  }
  form.querySelector('[data-account-proof-add]').onclick = () => form.elements.accountProofFile.click();
  form.elements.accountProofFile.onchange = async event => {
    const blob = event.target.files[0]; event.target.value = ''; if (!blob) return;
    if (!['image/jpeg', 'image/png'].includes(blob.type) || !blob.size || blob.size > 10 * 1024 * 1024) {
      const box = form.querySelector('.ws-form-error'); box.hidden = false; box.textContent = '凭证须为JPEG或PNG，大小不超过10 MB。'; return;
    }
    file = { blob }; await upload();
  };
  update(); return editor;
}

export async function openAccountDocument(context, path) {
  const detail = await context.get(path); if (!context.active()) return;
  const editor = openEditor(context, '账户单据', `<div class="ws-wide ws-existing">${esc(detail.documentNo)}<br>金额 ${esc(detail.amount)} · ${esc(detail.businessDate)}<br>操作人 ${esc(detail.operatorName || '无历史记录')}${detail.collectionAccountId ? `<br>收款账户 ${esc(detail.collectionAccountId)}` : ''}<br>${esc(detail.remark || '')}</div>`
    + '<div class="ws-wide ws-proof-list">' + detail.evidenceFiles.map(file => `<div class="ws-proof-item" data-account-evidence="${esc(file.id)}" data-filename="${esc(file.filename)}"><span role="status">图片加载中...</span></div>`).join('')
    + (detail.evidenceFiles.length ? '' : '<p>无历史凭证记录</p>') + '</div>', null);
  await Promise.all([...editor.form.querySelectorAll('[data-account-evidence]')].map(async container => {
    const load = async () => {
      container.textContent = '图片加载中...';
      try {
        const blob = await context.client.request(`/files/${container.dataset.accountEvidence}/download`, { binary: true });
        if (!editor.dialog.isConnected || !context.active()) return;
        mountEvidencePreview(context, editor, container, blob, container.dataset.filename); icons();
      } catch (error) {
        if (!editor.dialog.isConnected || !context.active()) return;
        container.innerHTML = `<span role="alert">${esc(error.message)}</span>${iconButton('rotate-cw', '重新加载凭证', 'data-proof-retry')}`;
        container.querySelector('[data-proof-retry]').onclick = load; icons();
      }
    };
    await load();
  }));
}
