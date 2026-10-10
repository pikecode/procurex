export interface Named { id: string; name: string; code?: string }
export interface TemplateItem {
  productId: string; sortOrder: number; isEnabled: boolean; minOrderQty: string | null; orderMultiple: string | null; initialSalesPrice?: string | null;
  suppliers: { supplierId: string; priority: number; salesPrice?: string | null; supplyPrice?: string | null }[];
}
export interface Template extends Named {
  code: string; tag: string | null; remark: string | null; isArchived: boolean; version: number; storeIds: string[];
}
export interface TemplateDetail extends Template {
  cycleOverrides?: { storeId: string; supplierId: string; settlementCycle: string }[];
  items: TemplateItem[]; settings: { supplierId: string; settlementMode: string; settlementCycle: string }[];
}
export interface CatalogProduct extends Named { sku: string | null; categoryId: string; baseUnitId?: string; isActive: boolean; defaultSalesPrice: string | null; minOrderQty: string; orderMultiple: string; supplierIds?: string[]; supplierPurchasePrices?: { supplierId: string; supplyPrice: string }[] }
export interface CatalogSupplier extends Named { status: string; isArchived: boolean; defaultSettlementMode: string; defaultSettlementCycle: string }
export const settlementOptions = [{ value: 'STORED_VALUE', label: '储值支付' }, { value: 'CREDIT', label: '挂账' }, { value: 'SUPPLIER_TERM', label: '供应商账期' }, { value: 'COMPANY_TERM', label: '公司账期' }];
export const cycleOptions = [{ value: 'IMMEDIATE', label: '即时' }, { value: 'WEEKLY', label: '每周' }, { value: 'HALF_MONTHLY', label: '半月' }, { value: 'MONTHLY', label: '每月' }];
export const namedOptions = (rows: Named[]) => rows.map(row => ({ value: row.id, label: row.name }));
export function positiveIntegerRule(label: string, nullable = false) {
  return { validator: async (_: unknown, value: unknown) => {
    if (nullable && (value === null || value === undefined || value === '')) return;
    if (typeof value !== 'string' || !/^\d{1,14}(\.0{1,6})?$/.test(value) || Number(value) <= 0) throw new Error(`${label}必须为正整数，最多14位`);
  } };
}
export function decimalRule(label: string, positive = false, nullable = false) {
  return { validator: async (_: unknown, value: unknown) => {
    if (nullable && (value === null || value === undefined || value === '')) return;
    if (typeof value !== 'string' || !/^\d{1,14}(\.\d{1,6})?$/.test(value) || (positive && Number(value) <= 0)) throw new Error(`${label}须为${positive ? '正数' : '非负数'}，最多6位小数、14位整数`);
  } };
}
