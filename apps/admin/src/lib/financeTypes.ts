import type { EvidenceFile } from '../components/PrivateEvidence';
export type StoreAccount = { storeId: string; balance: string; reservedBalance: string; availableBalance: string; creditLimit: string; creditUsed: string; creditCumulative: string | null; creditAvailable: string; version: number };
export type FinanceStore = { id: string; name: string; groupName: string | null; status: string; account: StoreAccount };
export type Ledger = { id: string; direction: string; amount: string; balanceAfter: string; sourceType: string; sourceId: string; note: string | null; occurredAt: string };
export type CreditItem = { fundingAllocationId: string; supplierName: string | null; supplierOrderNo: string | null; occurredAt: string; creditOutstanding: string; version: number };
export type ClearingPreview = { storeId: string; totalAmount: string; items: { fundingAllocationId: string; version: number; clearableAmount: string }[] };
export type AccountDocument = { id: string; storeId: string; documentNo: string; kind: string; amount: string; businessDate: string; operatorName: string | null; remark: string | null; evidenceFiles: EvidenceFile[] };
export const moneyRule = (positive = false) => ({ validator: async (_: unknown, value: unknown) => {
  if (typeof value !== 'string' || !/^\d{1,14}(\.\d{1,2})?$/.test(value) || (positive && !/[1-9]/.test(value))) throw new Error(`请输入${positive ? '大于零的' : '非负'}金额，最多两位小数`);
} });
export const clearingSignature = (preview: ClearingPreview) => JSON.stringify({ storeId: preview.storeId, totalAmount: preview.totalAmount, items: [...preview.items].sort((a, b) => a.fundingAllocationId.localeCompare(b.fundingAllocationId)) });
