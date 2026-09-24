import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  DifferenceDisposalDirection,
  DifferenceDisposalMethod,
  DifferenceDisposalStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type { DifferenceDisposal, DifferenceDisposalItem } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type CreateDifferenceDisposalInput = {
  method: DifferenceDisposalMethod;
  creditItemIds: string[];
  targetDebitItemIds?: string[];
  amount: string;
  businessDate: Date;
  reason?: string;
};

export type ConfirmDifferenceDisposalInput = {
  expectedVersion: number;
};

export type DifferenceDisposalView = {
  id: string;
  disposalNo: string;
  direction: DifferenceDisposalDirection;
  method: DifferenceDisposalMethod;
  storeId: string | null;
  supplierId: string | null;
  amount: string;
  businessDate: string;
  status: DifferenceDisposalStatus;
  reason: string | null;
  version: number;
  confirmedAt: string | null;
  createdAt: string;
  items: DifferenceDisposalItemView[];
};

export type DifferenceDisposalItemView = {
  id: string;
  creditItemId: string;
  targetDebitItemId: string | null;
  amount: string;
  sourceVersion: number;
  createdAt: string;
};

@Injectable()
export class DifferenceDisposalsService {
  constructor(private readonly database: DatabaseService) {}

  async get(id: string): Promise<DifferenceDisposalView> {
    const disposal = await this.database.client.differenceDisposal.findUnique({
      where: { id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!disposal) {
      throw new NotFoundException({
        code: 'DIFFERENCE_DISPOSAL_NOT_FOUND',
        message: 'Difference disposal was not found',
      });
    }
    return toDifferenceDisposalView(disposal);
  }

  async create(input: CreateDifferenceDisposalInput): Promise<DifferenceDisposalView> {
    if (input.method !== DifferenceDisposalMethod.OFFLINE_RETURN) {
      throw new ConflictException({
        code: 'DIFFERENCE_DISPOSAL_METHOD_NOT_SUPPORTED',
        message: 'Only OFFLINE_RETURN is supported in this version',
      });
    }
    if (input.targetDebitItemIds && input.targetDebitItemIds.length > 0) {
      throw new ConflictException({
        code: 'TARGET_DEBIT_NOT_SUPPORTED',
        message: 'Offline return does not accept target debit items',
      });
    }

    const returns = await this.database.client.discrepancyReturn.findMany({
      where: { id: { in: input.creditItemIds } },
      include: { orderItem: { include: { supplierOrder: true } }, differenceDisposalItems: true },
    });
    if (returns.length !== input.creditItemIds.length) {
      throw new NotFoundException({
        code: 'DIFFERENCE_CREDIT_ITEM_NOT_FOUND',
        message: 'One or more difference credit items were not found',
      });
    }

    const storeId = returns[0]!.orderItem.supplierOrder.storeId;
    const supplierId = returns[0]!.orderItem.supplierOrder.supplierId;
    const items = returns.map((returnRecord) => {
      if (returnRecord.differenceDisposalItems.length > 0) {
        throw new ConflictException({
          code: 'DIFFERENCE_CREDIT_ALREADY_DISPOSED',
          message: 'Difference credit item has already been disposed',
          details: { creditItemId: returnRecord.id },
        });
      }
      if (returnRecord.orderItem.supplierOrder.storeId !== storeId || returnRecord.orderItem.supplierOrder.supplierId !== supplierId) {
        throw new ConflictException({
          code: 'DIFFERENCE_CREDIT_SUBJECT_MISMATCH',
          message: 'Difference credit items must share the same store and supplier',
        });
      }
      return {
        creditItemId: returnRecord.id,
        amount: new Decimal(returnRecord.quantity).mul(returnRecord.orderItem.supplyUnitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
        sourceVersion: returnRecord.orderItem.supplierOrder.version,
      };
    });

    const amount = items.reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
    if (!amount.eq(input.amount)) {
      throw new ConflictException({
        code: 'DIFFERENCE_DISPOSAL_AMOUNT_CHANGED',
        message: 'Difference disposal amount does not match current credit items',
        details: { expectedAmount: input.amount, currentAmount: amount.toFixed(2) },
      });
    }

    const disposal = await this.database.client.differenceDisposal.create({
      data: {
        disposalNo: makeDisposalNo(),
        direction: DifferenceDisposalDirection.SUPPLIER_TO_COMPANY,
        method: input.method,
        storeId,
        supplierId,
        amount: amount.toFixed(2),
        businessDate: input.businessDate,
        reason: input.reason,
        items: {
          create: items.map((item) => ({
            creditItemId: item.creditItemId,
            amount: item.amount.toFixed(2),
            sourceVersion: item.sourceVersion,
          })),
        },
      },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });

    return toDifferenceDisposalView(disposal);
  }

  async confirm(id: string, input: ConfirmDifferenceDisposalInput): Promise<DifferenceDisposalView> {
    const disposal = await this.database.client.differenceDisposal.findUnique({
      where: { id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!disposal) {
      throw new NotFoundException({
        code: 'DIFFERENCE_DISPOSAL_NOT_FOUND',
        message: 'Difference disposal was not found',
      });
    }
    if (disposal.version !== input.expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Difference disposal version has changed',
        details: { expectedVersion: input.expectedVersion, currentVersion: disposal.version },
      });
    }
    if (disposal.status !== DifferenceDisposalStatus.PENDING) {
      throw new ConflictException({
        code: 'DIFFERENCE_DISPOSAL_NOT_CONFIRMABLE',
        message: 'Difference disposal cannot be confirmed in its current status',
        details: { status: disposal.status },
      });
    }

    const confirmed = await this.database.client.differenceDisposal.update({
      where: { id },
      data: {
        status: DifferenceDisposalStatus.CONFIRMED,
        confirmedAt: new Date(),
        version: { increment: 1 },
      },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });

    return toDifferenceDisposalView(confirmed);
  }
}

function toDifferenceDisposalView(disposal: DifferenceDisposal & { items: DifferenceDisposalItem[] }): DifferenceDisposalView {
  return {
    id: disposal.id,
    disposalNo: disposal.disposalNo,
    direction: disposal.direction,
    method: disposal.method,
    storeId: disposal.storeId,
    supplierId: disposal.supplierId,
    amount: disposal.amount.toFixed(2),
    businessDate: disposal.businessDate.toISOString().slice(0, 10),
    status: disposal.status,
    reason: disposal.reason,
    version: disposal.version,
    confirmedAt: disposal.confirmedAt?.toISOString() ?? null,
    createdAt: disposal.createdAt.toISOString(),
    items: disposal.items.map(toDifferenceDisposalItemView),
  };
}

function toDifferenceDisposalItemView(item: DifferenceDisposalItem): DifferenceDisposalItemView {
  return {
    id: item.id,
    creditItemId: item.creditItemId,
    targetDebitItemId: item.targetDebitItemId,
    amount: item.amount.toFixed(2),
    sourceVersion: item.sourceVersion,
    createdAt: item.createdAt.toISOString(),
  };
}

function makeDisposalNo(): string {
  return `DD-${Date.now()}-${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
}
