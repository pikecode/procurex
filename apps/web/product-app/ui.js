export const $ = (id) => document.getElementById(id);
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function money(value) {
  if (value === undefined || value === null || value === '') return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `¥${numeric.toFixed(2)}`;
}

export function metric(label, value, foot, emphasis = false) {
  return `<article class="metric ${emphasis ? 'emphasis' : ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></article>`;
}

export function resultLine(label, value) {
  return `<article><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`;
}

export function emptyState(title, detail) {
  return `<div class="empty"><strong>${esc(title)}</strong><small>${esc(detail)}</small></div>`;
}

export function tableRows(rows, columns, emptyLabel) {
  if (!rows.length) return `<tr><td colspan="${columns}">${esc(emptyLabel)}</td></tr>`;
  return rows.join('');
}

export function setNotice(message) {
  const notice = $('app-notice');
  if (!notice) return;
  notice.textContent = message || '';
  notice.classList.toggle('hidden', !message);
}
