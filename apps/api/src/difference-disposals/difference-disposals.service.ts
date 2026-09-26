import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  DifferenceDisposalDirection,
  DifferenceDisposalMethod,
  DifferenceDisposalStatus,
  PaymentAllocationState,
  SupplierOrderStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import { Prisma, type AdjustmentDocument, type DifferenceDisposal, type DifferenceDisposalItem, type Overpayment, type PaymentAllocation, type Shipment, type SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
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
  creditItemId: string | null;
  overpaymentId: string | null;
  adjustmentDocumentId: string | null;
  targetDebitItemId: string | null;
  amount: string;
  sourceVersion: number;
  createdAt: string;
};

type SettlementItemKind = 'STORE_RECEIVABLE' | 'SUPPLIER_PAYABLE' | 'ADJUSTMENT';

type DecodedSettlementItemId = {
  kind: SettlementItemKind;
  supplierOrderId: string;
  adjustmentDocumentId?: string;
  adjustmentSide?: 'STORE' | 'SUPPLIER';
};

type TargetOrder = SupplierOrder & { shipments: Shipment[] };
type AdjustmentCredit = AdjustmentDocument & { disposalItems: DifferenceDisposalItem[] };

@Injectable()
export class DifferenceDisposalsService {
  constructor(private readonly database: DatabaseService) {}

  async get(id: string, scope?: { type?: string; storeId?: string; supplierId?: string }): Promise<DifferenceDisposalView> {
    const disposal = await this.database.client.differenceDisposal.findUnique({
      where: { id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!disposal || (scope?.type === 'STORE' && disposal.storeId !== scope.storeId) || (scope?.type === 'SUPPLIER' && disposal.supplierId !== scope.supplierId)) {
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

    return this.database.client.$transaction(async (tx) => {
      for (const id of [...input.creditItemIds, ...(input.targetDebitItemIds ?? [])].sort()) {
        await waitForSettlementLock(tx, id);
      }

    const returns = await tx.discrepancyReturn.findMany({
      where: { id: { in: input.creditItemIds } },
      include: { orderItem: { include: { supplierOrder: true } }, differenceDisposalItems: true },
    });
    const overpayments = await tx.overpayment.findMany({
      where: { id: { in: input.creditItemIds } },
      include: { payment: true, disposalItems: true },
    });
    const adjustmentDocuments = await tx.adjustmentDocument.findMany({
      where: { id: { in: input.creditItemIds } },
      include: { disposalItems: true },
    });
    const returnById = new Map(returns.map((item) => [item.id, item]));
    const overpaymentById = new Map(overpayments.map((item) => [item.id, item]));
    const adjustmentById = new Map(adjustmentDocuments.map((item) => [item.id, item]));
    if (input.creditItemIds.some((id) => !returnById.has(id) && !overpaymentById.has(id) && !adjustmentById.has(id))) {
      throw new NotFoundException({
        code: 'DIFFERENCE_CREDIT_ITEM_NOT_FOUND',
        message: 'One or more difference credit items were not found',
      });
    }

    const firstId = input.creditItemIds[0]!;
    const first = returnById.get(firstId) ?? overpaymentById.get(firstId) ?? adjustmentById.get(firstId)!;
    const storeId = 'orderItem' in first ? first.orderItem.supplierOrder.storeId : first.storeId;
    const supplierId = 'orderItem' in first ? first.orderItem.supplierOrder.supplierId : first.supplierId;
    const direction = returnById.has(firstId)
      ? DifferenceDisposalDirection.SUPPLIER_TO_COMPANY
      : adjustmentById.has(firstId)
        ? adjustmentDirection(adjustmentById.get(firstId)!)
        : overpaymentDirection(overpaymentById.get(firstId)!);
    const targetDebitItemIds = input.method === DifferenceDisposalMethod.OFFSET ? input.targetDebitItemIds! : [];
    const targetAvailability =
      input.method === DifferenceDisposalMethod.OFFSET ? await this.loadTargetAvailability(targetDebitItemIds, supplierId, storeId, direction, tx) : new Map<string, Decimal>();
    const items = input.creditItemIds.map((creditItemId, index) => {
      const returnRecord = returnById.get(creditItemId);
      const overpayment = overpaymentById.get(creditItemId);
      const adjustmentDocument = adjustmentById.get(creditItemId);
      if (adjustmentDocument && !new Decimal(adjustmentDocument.amount).isNegative()) {
        throw new ConflictException({
          code: 'DIFFERENCE_ADJUSTMENT_NOT_CREDIT',
          message: 'Only negative adjustment documents can be disposed as credits',
          details: { creditItemId },
        });
      }
      const alreadyDisposed = returnRecord?.differenceDisposalItems.length || overpayment?.disposalItems.length || adjustmentDocument?.disposalItems.length;
      if (alreadyDisposed) {
        throw new ConflictException({
          code: 'DIFFERENCE_CREDIT_ALREADY_DISPOSED',
          message: 'Difference credit item has already been disposed',
          details: { creditItemId },
        });
      }
      const itemStoreId = returnRecord?.orderItem.supplierOrder.storeId ?? overpayment?.storeId ?? adjustmentDocument!.storeId;
      const itemSupplierId = returnRecord?.orderItem.supplierOrder.supplierId ?? overpayment?.supplierId ?? adjustmentDocument!.supplierId;
      if (itemStoreId !== storeId || itemSupplierId !== supplierId || (returnRecord && direction !== DifferenceDisposalDirection.SUPPLIER_TO_COMPANY) || (overpayment && overpaymentDirection(overpayment) !== direction) || (adjustmentDocument && adjustmentDirection(adjustmentDocument) !== direction)) {
        throw new ConflictException({
          code: 'DIFFERENCE_CREDIT_SUBJECT_MISMATCH',
          message: 'Difference credit items must share the same store and supplier',
        });
      }
      return {
        creditItemId: returnRecord?.id ?? null,
        overpaymentId: overpayment?.id ?? null,
        adjustmentDocumentId: adjustmentDocument?.id ?? null,
        targetDebitItemId: targetDebitItemIds[index] ?? null,
        amount: returnRecord ? new Decimal(returnRecord.quantity).mul(returnRecord.orderItem.supplyUnitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : overpayment ? new Decimal(overpayment.amount) : new Decimal(adjustmentDocument!.amount).abs(),
        sourceVersion: returnRecord?.orderItem.supplierOrder.version ?? overpayment?.sourceRevision ?? adjustmentDocument!.sourceRevision,
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

    const disposal = await tx.differenceDisposal.create({
      data: {
        disposalNo: makeDisposalNo(),
        direction,
        method: input.method,
        storeId,
        supplierId,
        amount: amount.toFixed(2),
        businessDate: input.businessDate,
        reason: input.reason,
        items: {
          create: items.map((item) => ({
            creditItemId: item.creditItemId,
            overpaymentId: item.overpaymentId,
            adjustmentDocumentId: item.adjustmentDocumentId,
            targetDebitItemId: item.targetDebitItemId,
            amount: item.amount.toFixed(2),
            sourceVersion: item.sourceVersion,
          })),
        },
      },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });

    return toDifferenceDisposalView(disposal);
    });
  }

  private async loadTargetAvailability(targetDebitItemIds: string[], supplierId: string, storeId: string, direction: DifferenceDisposalDirection, client: DatabaseService['client'] | Prisma.TransactionClient = this.database.client): Promise<Map<string, Decimal>> {
    if (new Set(targetDebitItemIds).size !== targetDebitItemIds.length) {
      throw new ConflictException({
        code: 'TARGET_DEBIT_DUPLICATED',
        message: 'Target debit items must not repeat',
      });
    }
    const decoded = targetDebitItemIds.map((id) => ({ id, decoded: decodeSettlementItemId(id) }));
    for (const item of decoded) {
      const expectedKind = direction === DifferenceDisposalDirection.COMPANY_TO_STORE ? 'STORE_RECEIVABLE' : 'SUPPLIER_PAYABLE';
      const expectedAdjustmentSide = direction === DifferenceDisposalDirection.COMPANY_TO_STORE ? 'STORE' : 'SUPPLIER';
      if (item.decoded.kind !== expectedKind && !(item.decoded.kind === 'ADJUSTMENT' && item.decoded.adjustmentSide === expectedAdjustmentSide)) {
        throw new ConflictException({
          code: 'TARGET_DEBIT_KIND_NOT_SUPPORTED',
          message: 'Offset disposal currently supports supplier payable target debit items only',
          details: { targetDebitItemId: item.id },
        });
      }
    }

    const orders = await client.supplierOrder.findMany({
      where: { id: { in: decoded.map((item) => item.decoded.supplierOrderId) } },
      include: { shipments: true },
    });
    const ordersById = new Map(orders.map((order) => [order.id, order]));
    const adjustmentDocuments = await client.adjustmentDocument.findMany({
      where: { id: { in: decoded.flatMap(({ decoded: item }) => item.adjustmentDocumentId ? [item.adjustmentDocumentId] : []) } },
    });
    const adjustmentsById = new Map(adjustmentDocuments.map((document) => [document.id, document]));
    const allocations = await client.paymentAllocation.findMany({
      where: {
        settlementItemId: { in: targetDebitItemIds },
        state: { in: [PaymentAllocationState.RESERVED, PaymentAllocationState.CONFIRMED] },
      },
    });
    const usedByPayments = summarizeAllocations(allocations);
    const disposalItems = await client.differenceDisposalItem.findMany({
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
      if (order.supplierId !== supplierId || (direction === DifferenceDisposalDirection.COMPANY_TO_STORE && order.storeId !== storeId)) {
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
      if (item.decoded.kind === 'ADJUSTMENT') {
        const adjustment = item.decoded.adjustmentDocumentId ? adjustmentsById.get(item.decoded.adjustmentDocumentId) : undefined;
        if (!adjustment || adjustment.supplierOrderId !== order.id || adjustment.side !== item.decoded.adjustmentSide || !new Decimal(adjustment.amount).gt(0)) {
          throw new ConflictException({ code: 'TARGET_ADJUSTMENT_NOT_PAYABLE', message: 'Target adjustment must be a positive adjustment for this order' });
        }
        result.set(item.id, Decimal.max(new Decimal(adjustment.amount).minus(usedByPayments.get(item.id) ?? 0).minus(usedByDisposals.get(item.id) ?? 0), 0));
      } else {
        result.set(item.id, targetAvailableAmount(order, item.decoded.kind, usedByPayments.get(item.id), usedByDisposals.get(item.id)));
      }
    }
    return result;
  }

  async confirm(id: string, input: ConfirmDifferenceDisposalInput, scope?: { type?: string; storeId?: string; supplierId?: string }): Promise<DifferenceDisposalView> {
    const disposal = await this.database.client.differenceDisposal.findUnique({
      where: { id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!disposal || (scope?.type === 'STORE' && disposal.storeId !== scope.storeId) || (scope?.type === 'SUPPLIER' && disposal.supplierId !== scope.supplierId)) {
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

    const changed = await this.database.client.differenceDisposal.updateMany({
      where: { id, version: input.expectedVersion, status: DifferenceDisposalStatus.PENDING },
      data: {
        status: DifferenceDisposalStatus.CONFIRMED,
        confirmedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Difference disposal has already changed' });
    }
    const confirmed = await this.database.client.differenceDisposal.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { createdAt: 'asc' } } } });

    return toDifferenceDisposalView(confirmed);
  }
}

async function waitForSettlementLock(tx: Prisma.TransactionClient, id: string): Promise<void> {
  for (;;) {
    const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${id}::text, 0)) AS locked`;
    if (rows[0]?.locked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
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
    overpaymentId: item.overpaymentId,
    adjustmentDocumentId: item.adjustmentDocumentId,
    targetDebitItemId: item.targetDebitItemId,
    amount: item.amount.toFixed(2),
    sourceVersion: item.sourceVersion,
    createdAt: item.createdAt.toISOString(),
  };
}

function overpaymentDirection(overpayment: Overpayment & { payment: { direction: string } }): DifferenceDisposalDirection {
  return overpayment.payment.direction === 'STORE_TO_COMPANY'
    ? DifferenceDisposalDirection.COMPANY_TO_STORE
    : DifferenceDisposalDirection.SUPPLIER_TO_COMPANY;
}

function adjustmentDirection(adjustment: AdjustmentCredit): DifferenceDisposalDirection {
  return adjustment.side === 'STORE'
    ? DifferenceDisposalDirection.COMPANY_TO_STORE
    : DifferenceDisposalDirection.SUPPLIER_TO_COMPANY;
}

function decodeSettlementItemId(id: string): DecodedSettlementItemId {
  try {
    const parsed = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as {
      kind?: unknown;
      supplierOrderId?: unknown;
      adjustmentDocumentId?: unknown;
      adjustmentSide?: unknown;
    };
    if (
      (parsed.kind === 'STORE_RECEIVABLE' || parsed.kind === 'SUPPLIER_PAYABLE') &&
      typeof parsed.supplierOrderId === 'string'
    ) {
      return { kind: parsed.kind, supplierOrderId: parsed.supplierOrderId };
    }
    if (parsed.kind === 'ADJUSTMENT' && typeof parsed.supplierOrderId === 'string' && typeof parsed.adjustmentDocumentId === 'string' && (parsed.adjustmentSide === 'STORE' || parsed.adjustmentSide === 'SUPPLIER')) {
      return { kind: 'ADJUSTMENT', supplierOrderId: parsed.supplierOrderId, adjustmentDocumentId: parsed.adjustmentDocumentId, adjustmentSide: parsed.adjustmentSide };
    }
  } catch {
    // Fall through to uniform bad item handling.
  }
  throw new ConflictException({
    code: 'INVALID_TARGET_DEBIT_ITEM_ID',
    message: 'Target debit item id is invalid',
  });
}

function targetAvailableAmount(order: TargetOrder, kind: SettlementItemKind, paymentAmount: Decimal | undefined, disposalAmount: Decimal | undefined): Decimal {
  const goodsAmount = new Decimal(kind === 'STORE_RECEIVABLE' ? order.salesGoodsAmount : order.supplyGoodsAmount);
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
