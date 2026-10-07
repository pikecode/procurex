import type { ValidationIssue } from '../../../../packages/domain/src/validation.js';

export type StoreProfile = {
  groupName?: string | null;
  storeType?: string;
  receiptAddress?: string | null;
  receiptContactName?: string | null;
  receiptContactPhone?: string | null;
};
export type SupplierProfile = {
  address?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccount?: string | null;
  taxpayerId?: string | null;
  invoiceTitle?: string | null;
  requiresFreight?: boolean;
  supplierType?: string | null;
  settlementCycleDescription?: string | null;
  remark?: string | null;
};

export function profileText(field: string, value: unknown, max: number, required: boolean, nullable: boolean, issues: ValidationIssue[]): string | null | undefined {
  if (value === undefined && !required) return undefined;
  if (nullable && (value === null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    issues.push({ field, code: 'INVALID_PROFILE_FIELD', message: `${field} must be a non-empty string of at most ${max} characters` });
    return undefined;
  }
  return value.trim();
}

function choice(field: string, value: unknown, choices: string[], required: boolean, nullable: boolean, issues: ValidationIssue[]): string | null | undefined {
  if (value === undefined && !required) return undefined;
  if (nullable && (value === null || value === '')) return null;
  if (typeof value !== 'string' || !choices.includes(value)) {
    issues.push({ field, code: 'INVALID_PROFILE_CHOICE', message: `${field} must be one of ${choices.join(', ')}` });
    return undefined;
  }
  return value;
}

export function parseStoreProfile(body: Record<string, unknown>, create: boolean, issues: ValidationIssue[]): StoreProfile {
  const result: StoreProfile = {
    groupName: profileText('groupName', body.groupName, 120, false, true, issues),
    storeType: choice('storeType', body.storeType, ['DIRECT', 'FRANCHISE', 'JOINT'], create, false, issues) ?? undefined,
  };
  const receiptFields = ['receiptAddress', 'receiptContactName', 'receiptContactPhone'] as const;
  if (receiptFields.some(key => body[key] !== undefined)) {
    const values = receiptFields.map((key, index) => profileText(key, body[key], [300, 120, 32][index]!, true, true, issues));
    if (!(values.every(value => value === null) || values.every(value => typeof value === 'string'))) {
      issues.push({ field: 'receiptAddress', code: 'INCOMPLETE_RECEIPT_PROFILE', message: 'Provide all three receipt fields or clear all three to use store contact details' });
    }
    receiptFields.forEach((key, index) => { result[key] = values[index]; });
  }
  return result;
}

export function parseSupplierProfile(body: Record<string, unknown>, create: boolean, issues: ValidationIssue[]): SupplierProfile {
  const result: SupplierProfile = {};
  const optionalFields = { address: 300, bankName: 200, bankAccountName: 200, bankAccount: 80, taxpayerId: 80, invoiceTitle: 200 } as const;
  for (const key of Object.keys(optionalFields) as (keyof typeof optionalFields)[]) {
    result[key] = profileText(key, typeof body[key] === 'string' && !body[key].trim() ? null : body[key], optionalFields[key], false, true, issues);
  }
  for (const key of ['settlementCycleDescription', 'remark'] as const) result[key] = profileText(key, body[key], 500, false, true, issues);
  result.supplierType = choice('supplierType', body.supplierType, ['HEADQUARTERS', 'DIRECT'], false, true, issues);
  if (body.requiresFreight === undefined) result.requiresFreight = create ? false : undefined;
  else if (typeof body.requiresFreight === 'boolean') result.requiresFreight = body.requiresFreight;
  else issues.push({ field: 'requiresFreight', code: 'INVALID_BOOLEAN', message: 'requiresFreight must be a boolean' });
  if (body.defaultSettlementCycle !== undefined && !['IMMEDIATE', 'WEEKLY', 'HALF_MONTHLY', 'MONTHLY'].includes(String(body.defaultSettlementCycle))) {
    issues.push({ field: 'defaultSettlementCycle', code: 'INVALID_SETTLEMENT_CYCLE', message: 'Invalid settlement cycle' });
  }
  return result;
}

export function storeDestination(store: { name: string; address: string | null; contactName: string | null; contactPhone: string | null; receiptAddress: string | null; receiptContactName: string | null; receiptContactPhone: string | null }) {
  return { name: store.name, address: store.receiptAddress ?? store.address, contactName: store.receiptContactName ?? store.contactName, contactPhone: store.receiptContactPhone ?? store.contactPhone };
}
