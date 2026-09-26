import { Injectable, NotFoundException } from '@nestjs/common';
import type { ClearingDocument, ClearingItem, StoreAccount } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type ClearingDocumentDetailView = {
  id: string;
  clearingNo: string;
  storeId: string;
  amount: string;
  businessDate: string;
  remark: string | null;
  createdAt: string;
  items: ClearingItemDetailView[];
  account: {
    id: string | null;
    storeId: string;
    balance: string;
    creditLimit: string;
    creditUsed: string;
    creditAvailable: string;
    version: number;
    createdAt: string | null;
    updatedAt: string | null;
  };
};

export type ClearingItemDetailView = {
  id: string;
  fundingAllocationId: string;
  amount: string;
  sourceVersion: number;
  createdAt: string;
};

@Injectable()
export class ClearingsService {
  constructor(private readonly database: DatabaseService) {}

  async get(id: string, scope?: { type?: string; storeId?: string }): Promise<ClearingDocumentDetailView> {
    const clearing = await this.database.client.clearingDocument.findUnique({
      where: { id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!clearing || (isStoreScope(scope?.type) && clearing.storeId !== scope?.storeId)) {
      throw new NotFoundException({
        code: 'CLEARING_NOT_FOUND',
        message: 'Clearing document was not found',
      });
    }

    const account = await this.database.client.storeAccount.findUnique({ where: { storeId: clearing.storeId } });
    return toClearingDocumentDetailView(clearing, account);
  }
}

function isStoreScope(type?: string): boolean {
  return type === 'STORE' || type === 'STORE_FINANCE';
}

function toClearingDocumentDetailView(
  clearing: ClearingDocument & { items: ClearingItem[] },
  account: StoreAccount | null,
): ClearingDocumentDetailView {
  return {
    id: clearing.id,
    clearingNo: clearing.clearingNo,
    storeId: clearing.storeId,
    amount: clearing.amount.toFixed(2),
    businessDate: clearing.businessDate.toISOString().slice(0, 10),
    remark: clearing.remark,
    createdAt: clearing.createdAt.toISOString(),
    items: clearing.items.map((item) => ({
      id: item.id,
      fundingAllocationId: item.fundingAllocationId,
      amount: item.amount.toFixed(2),
      sourceVersion: item.sourceVersion,
      createdAt: item.createdAt.toISOString(),
    })),
    account: toStoreAccountSnapshot(clearing.storeId, account),
  };
}

function toStoreAccountSnapshot(storeId: string, account: StoreAccount | null): ClearingDocumentDetailView['account'] {
  if (!account) {
    return {
      id: null,
      storeId,
      balance: '0.00',
      creditLimit: '0.00',
      creditUsed: '0.00',
      creditAvailable: '0.00',
      version: 0,
      createdAt: null,
      updatedAt: null,
    };
  }

  return {
    id: account.id,
    storeId: account.storeId,
    balance: account.balance.toFixed(2),
    creditLimit: account.creditLimit.toFixed(2),
    creditUsed: account.creditUsed.toFixed(2),
    creditAvailable: account.creditLimit.minus(account.creditUsed).toFixed(2),
    version: account.version,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}
