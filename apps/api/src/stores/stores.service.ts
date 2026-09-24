import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  FundingAllocationMethod,
  LedgerDirection,
  LedgerSourceType,
  StoreStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type {
  AccountLedger,
  ClearingDocument,
  ClearingItem,
  RechargeDocument,
  Store,
  StoreAccount,
} from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type StoreView = {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  address: string | null;
  status: StoreStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type StoreAccountView = {
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

export type StoreLedgerQuery = {
  occurredFrom?: Date;
  occurredTo?: Date;
};

export type AccountLedgerView = {
  id: string;
  accountId: string;
  direction: LedgerDirection;
  amount: string;
  balanceAfter: string;
  sourceType: LedgerSourceType;
  sourceId: string;
  note: string | null;
  occurredAt: string;
  createdAt: string;
};

export type CreateRechargeInput = {
  amount: string;
  businessDate: Date;
  collectionAccountId: string;
  remark?: string;
};

export type UpdateCreditLimitInput = {
  expectedVersion: number;
  limit: string;
  reason: string;
};

export type ClearingPreviewInput = {
  fundingAllocationIds: string[];
};

export type ClearingPreviewView = {
  storeId: string;
  totalAmount: string;
  items: ClearingPreviewItemView[];
};

export type CreateClearingInput = {
  items: CreateClearingItemInput[];
  businessDate: Date;
  remark?: string;
};

export type CreateClearingItemInput = {
  fundingAllocationId: string;
  expectedVersion: number;
  expectedAmount: string;
};

export type ClearingDocumentView = {
  id: string;
  clearingNo: string;
  storeId: string;
  amount: string;
  businessDate: string;
  remark: string | null;
  createdAt: string;
  items: ClearingItemView[];
  account: StoreAccountView;
};

export type ClearingItemView = {
  id: string;
  fundingAllocationId: string;
  amount: string;
  sourceVersion: number;
};

export type ClearingPreviewItemView = {
  fundingAllocationId: string;
  method: FundingAllocationMethod;
  targetAmount: string;
  netPaid: string;
  creditOutstanding: string;
  clearableAmount: string;
  version: number;
};

export type RechargeDocumentView = {
  id: string;
  rechargeNo: string;
  storeId: string;
  amount: string;
  businessDate: string;
  collectionAccountId: string;
  remark: string | null;
  createdAt: string;
  account: StoreAccountView;
};

export type CreateStoreInput = {
  code: string;
  name: string;
  contactName?: string;
  contactPhone?: string;
  address?: string;
};

export type UpdateStoreInput = {
  expectedVersion: number;
  name?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  status?: StoreStatus;
};

@Injectable()
export class StoresService {
  constructor(private readonly database: DatabaseService) {}

  async listStores(): Promise<StoreView[]> {
    const stores = await this.database.client.store.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return stores.map(toStoreView);
  }

  async createStore(input: CreateStoreInput): Promise<StoreView> {
    const store = await this.database.client.store.create({
      data: {
        code: input.code,
        name: input.name,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        address: input.address,
      },
    });

    return toStoreView(store);
  }

  async updateStore(id: string, input: UpdateStoreInput): Promise<StoreView> {
    const existing = await this.database.client.store.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'STORE_NOT_FOUND',
        message: 'Store was not found',
      });
    }

    const version = storeVersion(existing);
    if (version !== input.expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Store version has changed',
        details: { expectedVersion: input.expectedVersion, currentVersion: version },
      });
    }

    const updated = await this.database.client.store.update({
      where: { id },
      data: {
        name: input.name,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        address: input.address,
        status: input.status,
      },
    });

    return toStoreView(updated);
  }

  async getAccount(storeId: string): Promise<StoreAccountView> {
    await this.assertStoreExists(storeId);
    const account = await this.database.client.storeAccount.findUnique({ where: { storeId } });
    return toStoreAccountView(storeId, account);
  }

  async listLedgers(storeId: string, query: StoreLedgerQuery): Promise<AccountLedgerView[]> {
    await this.assertStoreExists(storeId);
    const account = await this.database.client.storeAccount.findUnique({ where: { storeId } });
    if (!account) {
      return [];
    }

    const ledgers = await this.database.client.accountLedger.findMany({
      where: {
        accountId: account.id,
        occurredAt: {
          gte: query.occurredFrom,
          lt: query.occurredTo,
        },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });

    return ledgers.map(toAccountLedgerView);
  }

  async createRecharge(storeId: string, input: CreateRechargeInput): Promise<RechargeDocumentView> {
    await this.assertStoreExists(storeId);

    const amount = new Decimal(input.amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (amount.lte(0)) {
      throw new ConflictException({
        code: 'INVALID_RECHARGE_AMOUNT',
        message: 'Recharge amount must be greater than zero',
      });
    }

    const result = await this.database.client.$transaction(async (tx) => {
      const recharge = await tx.rechargeDocument.create({
        data: {
          rechargeNo: makeRechargeNo(),
          storeId,
          amount: amount.toFixed(2),
          businessDate: input.businessDate,
          collectionAccountId: input.collectionAccountId,
          remark: input.remark,
        },
      });

      const account = await tx.storeAccount.upsert({
        where: { storeId },
        create: {
          storeId,
          balance: amount.toFixed(2),
        },
        update: {
          balance: { increment: amount.toFixed(2) },
          version: { increment: 1 },
        },
      });

      await tx.accountLedger.create({
        data: {
          accountId: account.id,
          direction: LedgerDirection.CREDIT,
          amount: amount.toFixed(2),
          balanceAfter: account.balance.toFixed(2),
          sourceType: LedgerSourceType.RECHARGE,
          sourceId: recharge.id,
          note: input.remark,
          occurredAt: input.businessDate,
        },
      });

      return { recharge, account };
    });

    return toRechargeDocumentView(result.recharge, result.account);
  }

  async updateCreditLimit(storeId: string, input: UpdateCreditLimitInput): Promise<StoreAccountView> {
    await this.assertStoreExists(storeId);
    const account = await this.database.client.storeAccount.findUnique({ where: { storeId } });
    if (!account) {
      throw new NotFoundException({
        code: 'STORE_ACCOUNT_NOT_FOUND',
        message: 'Store account was not found',
      });
    }

    if (account.version !== input.expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Store account version has changed',
        details: { expectedVersion: input.expectedVersion, currentVersion: account.version },
      });
    }

    const limit = new Decimal(input.limit).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (limit.lt(account.creditUsed)) {
      throw new ConflictException({
        code: 'CREDIT_LIMIT_BELOW_USED',
        message: 'Credit limit cannot be lower than currently used credit',
        details: { creditUsed: account.creditUsed.toFixed(2), limit: limit.toFixed(2) },
      });
    }

    const updated = await this.database.client.storeAccount.update({
      where: { id: account.id },
      data: {
        creditLimit: limit.toFixed(2),
        version: { increment: 1 },
      },
    });

    return toStoreAccountView(storeId, updated);
  }

  async previewClearing(storeId: string, input: ClearingPreviewInput): Promise<ClearingPreviewView> {
    await this.assertStoreExists(storeId);
    const allocations = await this.database.client.fundingAllocation.findMany({
      where: { id: { in: input.fundingAllocationIds } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (allocations.length !== input.fundingAllocationIds.length) {
      throw new ConflictException({
        code: 'FUNDING_ALLOCATION_NOT_FOUND',
        message: 'One or more funding allocations were not found',
      });
    }

    const items = allocations.map((allocation) => {
      if (allocation.storeId !== storeId) {
        throw new ConflictException({
          code: 'FUNDING_ALLOCATION_STORE_MISMATCH',
          message: 'Funding allocation does not belong to this store',
          details: { fundingAllocationId: allocation.id },
        });
      }
      if (!allocation.active) {
        throw new ConflictException({
          code: 'FUNDING_ALLOCATION_INACTIVE',
          message: 'Funding allocation is not active',
          details: { fundingAllocationId: allocation.id },
        });
      }

      const clearableAmount = Decimal.max(new Decimal(0), allocation.creditOutstanding);
      if (clearableAmount.lte(0)) {
        throw new ConflictException({
          code: 'FUNDING_ALLOCATION_NOT_CLEARABLE',
          message: 'Funding allocation has no clearable amount',
          details: { fundingAllocationId: allocation.id },
        });
      }

      return {
        fundingAllocationId: allocation.id,
        method: allocation.method,
        targetAmount: allocation.targetAmount.toFixed(2),
        netPaid: allocation.netPaid.toFixed(2),
        creditOutstanding: allocation.creditOutstanding.toFixed(2),
        clearableAmount: clearableAmount.toFixed(2),
        version: allocation.version,
      };
    });
    const totalAmount = items.reduce((sum, item) => sum.plus(item.clearableAmount), new Decimal(0));

    return {
      storeId,
      totalAmount: totalAmount.toFixed(2),
      items,
    };
  }

  async createClearing(storeId: string, input: CreateClearingInput): Promise<ClearingDocumentView> {
    const preview = await this.previewClearing(storeId, {
      fundingAllocationIds: input.items.map((item) => item.fundingAllocationId),
    });
    const inputById = new Map(input.items.map((item) => [item.fundingAllocationId, item]));
    for (const item of preview.items) {
      const inputItem = inputById.get(item.fundingAllocationId)!;
      if (inputItem.expectedVersion !== item.version) {
        throw new ConflictException({
          code: 'VERSION_CONFLICT',
          message: 'Funding allocation version has changed',
          details: {
            fundingAllocationId: item.fundingAllocationId,
            expectedVersion: inputItem.expectedVersion,
            currentVersion: item.version,
          },
        });
      }
      if (!new Decimal(inputItem.expectedAmount).eq(item.clearableAmount)) {
        throw new ConflictException({
          code: 'CLEARING_AMOUNT_CHANGED',
          message: 'Funding allocation clearable amount has changed',
          details: {
            fundingAllocationId: item.fundingAllocationId,
            expectedAmount: inputItem.expectedAmount,
            currentAmount: item.clearableAmount,
          },
        });
      }
    }

    const account = await this.database.client.storeAccount.findUnique({ where: { storeId } });
    if (!account) {
      throw new NotFoundException({
        code: 'STORE_ACCOUNT_NOT_FOUND',
        message: 'Store account was not found',
      });
    }
    const totalAmount = new Decimal(preview.totalAmount);
    if (account.creditUsed.lt(totalAmount)) {
      throw new ConflictException({
        code: 'CREDIT_USED_BELOW_CLEARING',
        message: 'Store credit used is lower than clearing amount',
        details: { creditUsed: account.creditUsed.toFixed(2), clearingAmount: totalAmount.toFixed(2) },
      });
    }

    const result = await this.database.client.$transaction(async (tx) => {
      const clearing = await tx.clearingDocument.create({
        data: {
          clearingNo: makeClearingNo(),
          storeId,
          amount: totalAmount.toFixed(2),
          businessDate: input.businessDate,
          remark: input.remark,
        },
      });

      for (const item of preview.items) {
        await tx.clearingItem.create({
          data: {
            clearingId: clearing.id,
            fundingAllocationId: item.fundingAllocationId,
            amount: item.clearableAmount,
            sourceVersion: item.version,
          },
        });
        await tx.fundingAllocation.update({
          where: { id: item.fundingAllocationId },
          data: {
            netPaid: { increment: item.clearableAmount },
            creditOutstanding: { decrement: item.clearableAmount },
            active: false,
            version: { increment: 1 },
          },
        });
      }

      const updatedAccount = await tx.storeAccount.update({
        where: { id: account.id },
        data: {
          creditUsed: { decrement: totalAmount.toFixed(2) },
          version: { increment: 1 },
        },
      });

      await tx.accountLedger.create({
        data: {
          accountId: account.id,
          direction: LedgerDirection.DEBIT,
          amount: totalAmount.toFixed(2),
          balanceAfter: updatedAccount.balance.toFixed(2),
          sourceType: LedgerSourceType.CLEARING,
          sourceId: clearing.id,
          note: input.remark,
          occurredAt: input.businessDate,
        },
      });

      const created = await tx.clearingDocument.findUniqueOrThrow({
        where: { id: clearing.id },
        include: { items: { orderBy: { createdAt: 'asc' } } },
      });

      return { clearing: created, account: updatedAccount };
    });

    return toClearingDocumentView(result.clearing, result.account);
  }

  private async assertStoreExists(storeId: string): Promise<void> {
    const store = await this.database.client.store.findUnique({ where: { id: storeId } });
    if (!store) {
      throw new NotFoundException({
        code: 'STORE_NOT_FOUND',
        message: 'Store was not found',
      });
    }
  }
}

function toStoreView(store: Store): StoreView {
  return {
    id: store.id,
    code: store.code,
    name: store.name,
    contactName: store.contactName,
    contactPhone: store.contactPhone,
    address: store.address,
    status: store.status,
    version: storeVersion(store),
    createdAt: store.createdAt.toISOString(),
    updatedAt: store.updatedAt.toISOString(),
  };
}

function storeVersion(store: Pick<Store, 'updatedAt'>): number {
  return store.updatedAt.getTime();
}

function toStoreAccountView(storeId: string, account: StoreAccount | null): StoreAccountView {
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

  const creditAvailable = account.creditLimit.minus(account.creditUsed);
  return {
    id: account.id,
    storeId: account.storeId,
    balance: account.balance.toFixed(2),
    creditLimit: account.creditLimit.toFixed(2),
    creditUsed: account.creditUsed.toFixed(2),
    creditAvailable: creditAvailable.toFixed(2),
    version: account.version,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

function toAccountLedgerView(ledger: AccountLedger): AccountLedgerView {
  return {
    id: ledger.id,
    accountId: ledger.accountId,
    direction: ledger.direction,
    amount: ledger.amount.toFixed(2),
    balanceAfter: ledger.balanceAfter.toFixed(2),
    sourceType: ledger.sourceType,
    sourceId: ledger.sourceId,
    note: ledger.note,
    occurredAt: ledger.occurredAt.toISOString(),
    createdAt: ledger.createdAt.toISOString(),
  };
}

function toRechargeDocumentView(recharge: RechargeDocument, account: StoreAccount): RechargeDocumentView {
  return {
    id: recharge.id,
    rechargeNo: recharge.rechargeNo,
    storeId: recharge.storeId,
    amount: recharge.amount.toFixed(2),
    businessDate: recharge.businessDate.toISOString().slice(0, 10),
    collectionAccountId: recharge.collectionAccountId,
    remark: recharge.remark,
    createdAt: recharge.createdAt.toISOString(),
    account: toStoreAccountView(recharge.storeId, account),
  };
}

function toClearingDocumentView(clearing: ClearingDocument & { items: ClearingItem[] }, account: StoreAccount): ClearingDocumentView {
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
    })),
    account: toStoreAccountView(clearing.storeId, account),
  };
}

function makeRechargeNo(): string {
  return makeDocumentNo('RCH');
}

function makeClearingNo(): string {
  return makeDocumentNo('CLR');
}

function makeDocumentNo(prefix: string): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  return `${prefix}${stamp}${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
}
