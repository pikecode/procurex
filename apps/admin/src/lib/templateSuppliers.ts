import type { TemplateItem } from './catalogTypes.js';

export function selectTemplateSuppliers(previous: TemplateItem['suppliers'], ids: string[]): TemplateItem['suppliers'] {
  const ordered = [...previous].sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId));
  const retained = ordered.filter(row => ids.includes(row.supplierId));
  return [...retained, ...ids.filter(id => !retained.some(row => row.supplierId === id)).map(supplierId => ({ supplierId, priority: 0 }))]
    .map((row, index) => ({ ...row, priority: index * 10 }));
}

export function defaultTemplateSupplier(previous: TemplateItem['suppliers'], id: string) {
  const selected = previous.find(row => row.supplierId === id);
  if (!selected) return previous;
  return [selected, ...[...previous].filter(row => row.supplierId !== id).sort((a, b) => a.priority - b.priority || a.supplierId.localeCompare(b.supplierId))]
    .map((row, index) => ({ ...row, priority: index * 10 }));
}
