export type TemplateCycleOverride = { storeId: string; supplierId: string; settlementCycle: string };
export type TemplateCycleOverrideItem = { isEnabled: boolean; suppliers: { supplierId: string }[] };

// Mirrors the API rule: only suppliers left on enabled items keep their per-store settlement cycle override.
export function droppedCycleOverrides(overrides: TemplateCycleOverride[], items: TemplateCycleOverrideItem[]): TemplateCycleOverride[] {
  const retained = new Set(items.filter(item => item.isEnabled).flatMap(item => item.suppliers.map(link => link.supplierId)));
  return overrides.filter(row => !retained.has(row.supplierId));
}