import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  DifferenceDisposalDirection,
  DifferenceDisposalMethod,
  DifferenceDisposalStatus,
  PaymentAllocationState,
  SupplierOrderStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type { DifferenceDisposal, DifferenceDisposalItem, PaymentAllocation, Shipment, SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
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

type SettlementItemKind = 'STORE_RECEIVABLE' | 'SUPPLIER_PAYABLE';

type DecodedSettlementItemId = {
  kind: SettlementItemKind;
  supplierOrderId: string;
};

type TargetOrder = SupplierOrder & { shipments: Shipment[] };

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
    if (input.method === DifferenceDisposalMethod.OFFLINE_RETURN && input.targetDebitItemIds && input.targetDebitItemIds.length > 0) {
      throw new ConflictException({
        code: 'TARGET_DEBIT_NOT_SUPPORTED',
        message: 'Offline return does not accept target debit items',
      });
    }
    if (input.method === DifferenceDisposalMethod.OFFSET && (input.targetDebitItemIds?.length ?? 0) !== input.creditItemIds.length) {
      throw new ConflictException({
        code: 'TARGET_DEBIT_REQUIRED',
        message: 'Offset disposal requires one target debit item for each credit item',
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
    const targetDebitItemIds = input.method === DifferenceDisposalMethod.OFFSET ? input.targetDebitItemIds! : [];
    const targetAvailability =
      input.method === DifferenceDisposalMethod.OFFSET ? await this.loadTargetAvailability(targetDebitItemIds, supplierId) : new Map<string, Decimal>();
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
        targetDebitItemId: targetDebitItemIds[input.creditItemIds.indexOf(returnRecord.id)] ?? null,
        amount: new Decimal(returnRecord.quantity).mul(returnRecord.orderItem.supplyUnitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
        sourceVersion: returnRecord.orderItem.supplierOrder.version,
      };
    });
    for (const item of items) {
      if (!item.targetDebitItemId) {
        continue;
      }
      const available = targetAvailability.get(item.targetDebitItemId);
      if (!available || available.lt(item.amount)) {
        throw new ConflictException({
          code: 'TARGET_DEBIT_AMOUNT_INSUFFICIENT',
          message: 'Target debit item does not have enough payable amount for this offset',
          details: {
            targetDebitItemId: item.targetDebitItemId,
            requiredAmount: item.amount.toFixed(2),
            availableAmount: available?.toFixed(2) ?? '0.00',
          },
        });
      }
    }

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
            targetDebitItemId: item.targetDebitItemId,
            amount: item.amount.toFixed(2),
            sourceVersion: item.sourceVersion,
          })),
        },
      },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });

    return toDifferenceDisposalView(disposal);
  }

  private async loadTargetAvailability(targetDebitItemIds: string[], supplierId: string): Promise<Map<string, Decimal>> {
    if (new Set(targetDebitItemIds).size !== targetDebitItemIds.length) {
      throw new ConflictException({
        code: 'TARGET_DEBIT_DUPLICATED',
        message: 'Target debit items must not repeat',
      });
    }
    const decoded = targetDebitItemIds.map((id) => ({ id, decoded: decodeSettlementItemId(id) }));
    for (const item of decoded) {
      if (item.decoded.kind !== 'SUPPLIER_PAYABLE') {
        throw new ConflictException({
          code: 'TARGET_DEBIT_KIND_NOT_SUPPORTED',
          message: 'Offset disposal currently supports supplier payable target debit items only',
          details: { targetDebitItemId: item.id },
        });
      }
    }

    const orders = await this.database.client.supplierOrder.findMany({
      where: { id: { in: decoded.map((item) => item.decoded.supplierOrderId) } },
      include: { shipments: true },
    });
    const ordersById = new Map(orders.map((order) => [order.id, order]));
    const allocations = await this.database.client.paymentAllocation.findMany({
      where: {
        settlementItemId: { in: targetDebitItemIds },
        state: { in: [PaymentAllocationState.RESERVED, PaymentAllocationState.CONFIRMED] },
      },
    });
    const usedByPayments = summarizeAllocations(allocations);
    const disposalItems = await this.database.client.differenceDisposalItem.findMany({
      where: {
        targetDebitItemId: { in: targetDebitItemIds },
        disposal: { status: { in: [DifferenceDisposalStatus.PENDING, DifferenceDisposalStatus.CONFIRMED] } },
      },
    });
    const usedByDisposals = summarizeDisposalItems(disposalItems);

    const result = new Map<string, Decimal>();
    for (const item of decoded) {
      const order = ordersById.get(item.decoded.supplierOrderId);
      if (!order) {
        throw new NotFoundException({
          code: 'TARGET_DEBIT_ITEM_NOT_FOUND',
          message: 'Target debit item source order was not found',
          details: { targetDebitItemId: item.id },
        });
      }
      if (order.supplierId !== supplierId) {
        throw new ConflictException({
          code: 'TARGET_DEBIT_SUBJECT_MISMATCH',
          message: 'Offset target debit item must belong to the same supplier',
          details: { targetDebitItemId: item.id },
        });
      }
      if (order.status !== SupplierOrderStatus.COMPLETED || !order.firstShippedAt) {
        throw new ConflictException({
          code: 'TARGET_DEBIT_NOT_PAYABLE',
          message: 'Offset target debit item source order is not completed',
          details: { targetDebitItemId: item.id },
        });
      }
      result.set(item.id, targetAvailableAmount(order, usedByPayments.get(item.id), usedByDisposals.get(item.id)));
    }
    return result;
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

function decodeSettlementItemId(id: string): DecodedSettlementItemId {
  try {
    const parsed = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as {
      kind?: unknown;
      supplierOrderId?: unknown;
    };
    if (
      (parsed.kind === 'STORE_RECEIVABLE' || parsed.kind === 'SUPPLIER_PAYABLE') &&
      typeof parsed.supplierOrderId === 'string'
    ) {
      return { kind: parsed.kind, supplierOrderId: parsed.supplierOrderId };
    }
  } catch {
    // Fall through to uniform bad item handling.
  }
  throw new ConflictException({
    code: 'INVALID_TARGET_DEBIT_ITEM_ID',
    message: 'Target debit item id is invalid',
  });
}

function targetAvailableAmount(order: TargetOrder, paymentAmount: Decimal | undefined, disposalAmount: Decimal | undefined): Decimal {
  const goodsAmount = new Decimal(order.supplyGoodsAmount);
  const freightAmount = order.shipments.reduce((sum, shipment) => sum.plus(shipment.freight), new Decimal(0));
  return Decimal.max(goodsAmount.plus(freightAmount).minus(paymentAmount ?? 0).minus(disposalAmount ?? 0), 0);
}

function summarizeAllocations(allocations: PaymentAllocation[]): Map<string, Decimal> {
  const result = new Map<string, Decimal>();
  for (const allocation of allocations) {
    result.set(allocation.settlementItemId, (result.get(allocation.settlementItemId) ?? new Decimal(0)).plus(allocation.amount));
  }
  return result;
}

function summarizeDisposalItems(items: DifferenceDisposalItem[]): Map<string, Decimal> {
  const result = new Map<string, Decimal>();
  for (const item of items) {
    if (!item.targetDebitItemId) {
      continue;
    }
    result.set(item.targetDebitItemId, (result.get(item.targetDebitItemId) ?? new Decimal(0)).plus(item.amount));
  }
  return result;
}

function makeDisposalNo(): string {
  return `DD-${Date.now()}-${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
}
