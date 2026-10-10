import { randomInt, randomUUID } from 'node:crypto';
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
  Prisma,
} from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { auditedMasterDataTransaction, type MasterDataAuditContext } from '../audit/master-data-audit.js';
import type { StoreProfile } from '../common/master-data-profile.js';
import { lockFundingRequest, refreshRequestPaymentSummary } from '../purchase-requests/request-funding.js';
import { recordCreditMovement } from './credit-movements.js';
import { lockStoreGroups, validateStoreGroup } from './store-groups.service.js';

async function attachAccountEvidence(tx: Prisma.TransactionClient, input: { evidenceFileIds?: string[]; actorUserId?: string }, purpose: 'RECHARGE' | 'CLEARING', id: string) {
  const ids = input.evidenceFileIds ?? [];
  if (!input.actorUserId || !ids.length || ids.length > 5 || new Set(ids).size !== ids.length) {
    throw new ConflictException({ code: 'ACCOUNT_EVIDENCE_INVALID', message: 'Account evidence is invalid' });
  }
  const updated = await tx.fileObject.updateMany({ where: { id: { in: ids }, ownerId: input.actorUserId,
    status: 'READY', purpose, mimeType: { in: ['image/jpeg', 'image/png'] }, paymentId: null, receiptId: null,
    rechargeId: null, clearingId: null, product: { is: null } },
    data: purpose === 'RECHARGE' ? { rechargeId: id } : { clearingId: id } });
  if (updated.count !== ids.length) throw new ConflictException({ code: 'ACCOUNT_EVIDENCE_INVALID', message: 'Account evidence must be owned, ready and unused' });
}

export type StoreView = Pick<Store, 'groupName' | 'storeType' | 'receiptAddress' | 'receiptContactName' | 'receiptContactPhone'> & {
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
  reservedBalance: string;
  availableBalance: string;
  creditLimit: string;
  creditUsed: string;
  creditCumulative: string | null;
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
  evidenceFileIds?: string[];
  actorUserId?: string;
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

export type CreditItemView = {
  occurredAt: string;
  supplierId: string | null;
  supplierName: string | null;
  fundingAllocationId: string;
  supplierOrderNo: string | null;
  requestId: string | null;
  method: FundingAllocationMethod;
  creditOutstanding: string;
  version: number;
};

export type ClearingPreviewView = {
  storeId: string;
  totalAmount: string;
  items: ClearingPreviewItemView[];
};

export type CreateClearingInput = {
  evidenceFileIds?: string[];
  actorUserId?: string;
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
  evidenceFileIds?: string[];
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
  evidenceFileIds?: string[];
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

export type CreateStoreInput = StoreProfile & {
  code?: string;
  name: string;
  contactName?: string;
  contactPhone?: string;
  address?: string;
};

export type UpdateStoreInput = StoreProfile & {
  expectedVersion: number;
  name?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  status?: StoreStatus;
};

@Injectable()
export class StoresService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService = new AuditService(database)) {}

  async listStores(): Promise<StoreView[]> {
    const stores = await this.database.client.store.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return stores.map(toStoreView);
  }

  async getStore(id: string): Promise<StoreView> {
    const store = await this.database.client.store.findUnique({ where: { id } });
    if (!store) throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store was not found' });
    return toStoreView(store);
  }

  async createStore(input: CreateStoreInput, context?: MasterDataAuditContext): Promise<StoreView> {
    const store = await auditedMasterDataTransaction(this.database, this.audit, context, 'store.create', 'Store', async tx => {
      await lockStoreGroups(tx);
      await validateStoreGroup(tx, input.groupName);
      return tx.store.create({
      data: {
        code: input.code ?? `MD${randomUUID().replaceAll('-', '').toUpperCase()}`,
        name: input.name,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        address: input.address,
        groupName: input.groupName,
        storeType: input.storeType,
        receiptAddress: input.receiptAddress,
        receiptContactName: input.receiptContactName,
        receiptContactPhone: input.receiptContactPhone,
      },
    });
    });

    return toStoreView(store);
  }

  async updateStore(id: string, input: UpdateStoreInput, context?: MasterDataAuditContext): Promise<StoreView> {
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

    const updated = await auditedMasterDataTransaction(this.database, this.audit, context, 'store.update', 'Store', async tx => {
    await lockStoreGroups(tx);
    await validateStoreGroup(tx, input.groupName, existing.groupName);
    const changed = await tx.store.updateMany({
      where: { id, updatedAt: { gte: new Date(version), lt: new Date(version + 1) } },
      data: {
        name: input.name,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        address: input.address,
        status: input.status,
        groupName: input.groupName,
        storeType: input.storeType,
        receiptAddress: input.receiptAddress,
        receiptContactName: input.receiptContactName,
        receiptContactPhone: input.receiptContactPhone,
        updatedAt: new Date(Math.max(Date.now(), version + 1)),
      },
    });
    if (!changed.count) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Store version has changed' });
    return tx.store.findUniqueOrThrow({ where: { id } });
    });

    return toStoreView(updated);
  }

  async getAccount(storeId: string): Promise<StoreAccountView> {
    await this.assertStoreExists(storeId);
    const account = await this.database.client.storeAccount.findUnique({ where: { storeId } });
    return toStoreAccountView(storeId, account);
  }

  async changeGroups(stores: { id: string; expectedVersion: number }[], groupName: string | null, context: MasterDataAuditContext) {
    return this.database.client.$transaction(async tx => {
      await lockStoreGroups(tx);
      await validateStoreGroup(tx, groupName);
      for (const item of [...stores].sort((a, b) => a.id.localeCompare(b.id))) {
        const changed = await tx.store.updateMany({
          where: { id: item.id, updatedAt: { gte: new Date(item.expectedVersion), lt: new Date(item.expectedVersion + 1) } },
          data: { groupName, updatedAt: new Date(Math.max(Date.now(), item.expectedVersion + 1)) },
        });
        if (!changed.count) throw new ConflictException({ code: 'VERSION_CONFLICT', message: '门店资料已变化，请刷新后重新选择；本次分组调整未保存' });
        await this.audit.record({ ...context, action: 'store.group-change', entityType: 'Store', entityId: item.id,
          after: { result: 'SUCCEEDED', groupName } }, tx);
      }
      return { count: stores.length };
    });
  }

  async listFinanceStores() {
    const rows = await this.database.client.store.findMany({ include: { accounts: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return rows.map(({ accounts, ...store }) => ({ ...toStoreView(store), account: toStoreAccountView(store.id, accounts[0] ?? null) }));
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

  async createRecharge(storeId: string, input: CreateRechargeInput, transaction?: Prisma.TransactionClient): Promise<RechargeDocumentView> {
    await this.assertStoreExists(storeId, transaction);

    const amount = new Decimal(input.amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (amount.lte(0)) {
      throw new ConflictException({
        code: 'INVALID_RECHARGE_AMOUNT',
        message: 'Recharge amount must be greater than zero',
      });
    }

    const execute = async (tx: Prisma.TransactionClient) => {
      // Serialize account disabling with new recharges; historical documents stay unchanged.
      if (input.actorUserId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.collection-accounts'))`;
        const collection = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.collectionAccountId)
          ? await tx.collectionAccount.findFirst({ where: { id: input.collectionAccountId, status: 'ACTIVE' } }) : null;
        if (!collection) throw new ConflictException({ code: 'COLLECTION_ACCOUNT_UNAVAILABLE', message: 'Select an active collection account' });
      }
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

      await attachAccountEvidence(tx, input, 'RECHARGE', recharge.id);

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
    };
    const result = transaction ? await execute(transaction) : await this.database.client.$transaction(execute);

    return { ...toRechargeDocumentView(result.recharge, result.account), ...(input.evidenceFileIds ? { evidenceFileIds: input.evidenceFileIds } : {}) };
  }

  async updateCreditLimit(storeId: string, input: UpdateCreditLimitInput, transaction?: Prisma.TransactionClient): Promise<StoreAccountView> {
    const execute = async (tx: Prisma.TransactionClient) => {
      await this.assertStoreExists(storeId, tx);
      if (input.expectedVersion === 0) {
        const created = await tx.storeAccount.createMany({ data: { storeId }, skipDuplicates: true });
        if (!created.count) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Store account has changed' });
      }
      await tx.$queryRaw`SELECT id FROM "StoreAccount" WHERE "storeId" = ${storeId}::uuid FOR UPDATE`;
      const account = await tx.storeAccount.findUnique({ where: { storeId } });
      if (!account) {
        throw new NotFoundException({
          code: 'STORE_ACCOUNT_NOT_FOUND',
          message: 'Store account was not found',
        });
      }

      const expectedVersion = input.expectedVersion === 0 ? 1 : input.expectedVersion;
      if (account.version !== expectedVersion) {
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

      const updated = await tx.storeAccount.update({
        where: { id: account.id, version: expectedVersion },
        data: {
          creditLimit: limit.toFixed(2),
          version: { increment: 1 },
        },
      });

      return toStoreAccountView(storeId, updated);
    };
    return transaction ? execute(transaction) : this.database.client.$transaction(execute);
  }

  async listCreditItems(storeId: string): Promise<CreditItemView[]> {
    await this.assertStoreExists(storeId);
    const rows = await this.database.client.fundingAllocation.findMany({
      where: { storeId, active: true, creditOutstanding: { gt: 0 } },
      include: { supplierOrder: { select: { supplierOrderNo: true, supplierId: true, supplier: { select: { name: true } } } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(row => ({ occurredAt: row.createdAt.toISOString(), supplierId: row.supplierOrder?.supplierId ?? null,
      supplierName: row.supplierOrder?.supplier.name ?? null, fundingAllocationId: row.id, supplierOrderNo: row.supplierOrder?.supplierOrderNo ?? null,
      requestId: row.requestId, method: row.method, creditOutstanding: row.creditOutstanding.toFixed(2), version: row.version }));
  }

  async listCreditMovements(storeId: string) {
    await this.assertStoreExists(storeId);
    const rows = await this.database.client.creditMovement.findMany({ where: { account: { storeId } },
      include: { allocation: { select: { requestId: true, supplierOrder: { select: { supplierOrderNo: true } } } } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] });
    return rows.map(row => ({ id: row.id, kind: row.kind, amount: row.amount.toFixed(2), outstandingAfter: row.outstandingAfter.toFixed(2),
      fundingAllocationId: row.fundingAllocationId, requestId: row.allocation.requestId,
      supplierOrderNo: row.allocation.supplierOrder?.supplierOrderNo ?? null, sourceType: row.sourceType, sourceId: row.sourceId,
      occurredAt: row.occurredAt.toISOString() }));
  }

  async previewClearing(storeId: string, input: ClearingPreviewInput, transaction?: Prisma.TransactionClient): Promise<ClearingPreviewView> {
    await this.assertStoreExists(storeId, transaction);
    const allocations = await (transaction ?? (this.database.client as Prisma.TransactionClient)).fundingAllocation.findMany({
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

  async createClearing(storeId: string, input: CreateClearingInput, transaction?: Prisma.TransactionClient): Promise<ClearingDocumentView> {
    const preview = await this.previewClearing(storeId, {
      fundingAllocationIds: input.items.map((item) => item.fundingAllocationId),
    }, transaction);
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

    const account = await (transaction ?? (this.database.client as Prisma.TransactionClient)).storeAccount.findUnique({ where: { storeId } });
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

    const execute = async (tx: Prisma.TransactionClient) => {
      await lockFundingRequest(tx, storeId);
      const selectedAllocations = await tx.fundingAllocation.findMany({
        where: { id: { in: preview.items.map(item => item.fundingAllocationId) }, storeId },
        select: { requestId: true, supplierOrder: { select: { requestId: true } } },
      });
      const requestIds = [...new Set(selectedAllocations.map(item => item.requestId ?? item.supplierOrder?.requestId)
        .filter((id): id is string => Boolean(id)))].sort();
      for (const requestId of requestIds) await lockFundingRequest(tx, storeId, requestId);
      const clearing = await tx.clearingDocument.create({
        data: {
          clearingNo: makeClearingNo(),
          storeId,
          amount: totalAmount.toFixed(2),
          businessDate: input.businessDate,
          remark: input.remark,
        },
      });

      await attachAccountEvidence(tx, input, 'CLEARING', clearing.id);

      for (const item of preview.items) {
        await tx.clearingItem.create({
          data: {
            clearingId: clearing.id,
            fundingAllocationId: item.fundingAllocationId,
            amount: item.clearableAmount,
            sourceVersion: item.version,
          },
        });
        const allocationUpdated = await tx.fundingAllocation.updateMany({
          where: {
            id: item.fundingAllocationId,
            version: item.version,
            active: true,
            creditOutstanding: { gte: item.clearableAmount },
          },
          data: {
            netPaid: { increment: item.clearableAmount },
            creditOutstanding: { decrement: item.clearableAmount },
            active: false,
            version: { increment: 1 },
          },
        });
        if (allocationUpdated.count !== 1) {
          throw new ConflictException({
            code: 'CLEARING_AMOUNT_CHANGED',
            message: 'Funding allocation clearable amount has changed',
            details: { fundingAllocationId: item.fundingAllocationId },
          });
        }
        await recordCreditMovement(tx, { accountId: account.id, fundingAllocationId: item.fundingAllocationId,
          before: item.creditOutstanding, after: '0', sourceType: 'CLEARING', sourceId: clearing.id, clearing: true, occurredAt: input.businessDate });
      }

      const accountUpdated = await tx.storeAccount.updateMany({
        where: { id: account.id, version: account.version, creditUsed: { gte: totalAmount.toFixed(2) } },
        data: {
          creditUsed: { decrement: totalAmount.toFixed(2) },
          version: { increment: 1 },
        },
      });
      if (accountUpdated.count !== 1) {
        throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Store account changed during clearing' });
      }
      const updatedAccount = await tx.storeAccount.findUniqueOrThrow({ where: { id: account.id } });

      // Refresh payment summaries without reconciling funds or booking another debit.
      for (const requestId of requestIds) {
        await refreshRequestPaymentSummary(tx, requestId);
      }

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
    };
    const result = transaction ? await execute(transaction) : await this.database.client.$transaction(execute);

    return { ...toClearingDocumentView(result.clearing, result.account), ...(input.evidenceFileIds ? { evidenceFileIds: input.evidenceFileIds } : {}) };
  }

  async getAccountDocument(storeId: string, id: string, kind: 'RECHARGE' | 'CLEARING') {
    const include = { evidenceFiles: { select: { id: true, filename: true, mimeType: true } } };
    const document = kind === 'RECHARGE'
      ? await this.database.client.rechargeDocument.findFirst({ where: { id, storeId }, include })
      : await this.database.client.clearingDocument.findFirst({ where: { id, storeId }, include });
    if (!document) throw new NotFoundException({ code: 'ACCOUNT_DOCUMENT_NOT_FOUND', message: 'Account document was not found' });
    const audit = await this.database.client.auditLog.findFirst({ where: { entityId: document.id,
      entityType: kind === 'RECHARGE' ? 'RechargeDocument' : 'ClearingDocument',
      action: kind === 'RECHARGE' ? 'store.recharge.create' : 'store.clearing.create' },
      orderBy: { createdAt: 'desc' }, select: { actor: { select: { displayName: true } } } });
    return { id: document.id, documentNo: 'rechargeNo' in document ? document.rechargeNo : document.clearingNo,
      kind, storeId, amount: document.amount.toFixed(2), businessDate: document.businessDate.toISOString().slice(0, 10),
      remark: document.remark, evidenceFiles: document.evidenceFiles, operatorName: audit?.actor?.displayName ?? null,
      collectionAccountId: 'collectionAccountId' in document ? document.collectionAccountId : null };
  }

  private async assertStoreExists(storeId: string, transaction?: Prisma.TransactionClient): Promise<void> {
    const store = await (transaction ?? (this.database.client as Prisma.TransactionClient)).store.findUnique({ where: { id: storeId } });
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
    groupName: store.groupName,
    storeType: store.storeType,
    receiptAddress: store.receiptAddress,
    receiptContactName: store.receiptContactName,
    receiptContactPhone: store.receiptContactPhone,
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
      reservedBalance: '0.00',
      availableBalance: '0.00',
      creditLimit: '0.00',
      creditUsed: '0.00',
      creditCumulative: '0.00',
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
    reservedBalance: account.reservedBalance.toFixed(2),
    availableBalance: account.balance.minus(account.reservedBalance).toFixed(2),
    creditLimit: account.creditLimit.toFixed(2),
    creditUsed: account.creditUsed.toFixed(2),
    creditCumulative: account.creditCumulative?.toFixed(2) ?? null,
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
