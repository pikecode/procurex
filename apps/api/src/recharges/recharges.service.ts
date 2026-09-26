import { Injectable, NotFoundException } from '@nestjs/common';
import type { RechargeDocument, StoreAccount } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type RechargeDocumentDetailView = {
  id: string;
  rechargeNo: string;
  storeId: string;
  amount: string;
  businessDate: string;
  collectionAccountId: string;
  remark: string | null;
  createdAt: string;
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

@Injectable()
export class RechargesService {
  constructor(private readonly database: DatabaseService) {}

  async get(id: string, scope?: { type?: string; storeId?: string }): Promise<RechargeDocumentDetailView> {
    const recharge = await this.database.client.rechargeDocument.findUnique({ where: { id } });
    if (!recharge || ((scope?.type === 'STORE' || scope?.type === 'STORE_FINANCE') && recharge.storeId !== scope.storeId)) {
      throw new NotFoundException({
        code: 'RECHARGE_NOT_FOUND',
        message: 'Recharge document was not found',
      });
    }

    const account = await this.database.client.storeAccount.findUnique({ where: { storeId: recharge.storeId } });
    return toRechargeDocumentDetailView(recharge, account);
  }
}

function toRechargeDocumentDetailView(recharge: RechargeDocument, account: StoreAccount | null): RechargeDocumentDetailView {
  return {
    id: recharge.id,
    rechargeNo: recharge.rechargeNo,
    storeId: recharge.storeId,
    amount: recharge.amount.toFixed(2),
    businessDate: recharge.businessDate.toISOString().slice(0, 10),
    collectionAccountId: recharge.collectionAccountId,
    remark: recharge.remark,
    createdAt: recharge.createdAt.toISOString(),
    account: toStoreAccountSnapshot(recharge.storeId, account),
  };
}

function toStoreAccountSnapshot(storeId: string, account: StoreAccount | null): RechargeDocumentDetailView['account'] {
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
