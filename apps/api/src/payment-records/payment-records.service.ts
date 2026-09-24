import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { SupplierOrderStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import type { Shipment, SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type PaymentDirection = 'STORE_TO_COMPANY' | 'COMPANY_TO_SUPPLIER';
export type PaymentChannel = 'COMPANY';
export type SettlementItemKind = 'STORE_RECEIVABLE' | 'SUPPLIER_PAYABLE';

export type PaymentPreviewView = {
  direction: PaymentDirection;
  channel: PaymentChannel;
  storeId: string | null;
  supplierId: string | null;
  totalPayableAmount: string;
  totalPendingPaymentAmount: string;
  totalConfirmedPaidAmount: string;
  items: PaymentPreviewItemView[];
  blockedItems: PaymentPreviewBlockedItemView[];
};

export type PaymentPreviewItemView = {
  settlementItemId: string;
  kind: SettlementItemKind;
  supplierOrderId: string;
  supplierOrderNo: string;
  storeId: string;
  supplierId: string;
  sourceVersion: number;
  payableAmount: string;
  pendingPaymentAmount: string;
  confirmedPaidAmount: string;
};

export type PaymentPreviewBlockedItemView = {
  settlementItemId: string;
  code: string;
  message: string;
};

type DecodedSettlementItemId = {
  kind: SettlementItemKind;
  supplierOrderId: string;
};

type PreviewOrder = SupplierOrder & { shipments: Shipment[] };

@Injectable()
export class PaymentRecordsService {
  constructor(private readonly database: DatabaseService) {}

  async preview(settlementItemIds: string[]): Promise<PaymentPreviewView> {
    const uniqueIds = [...new Set(settlementItemIds)];
    const decoded = uniqueIds.map((id) => ({ id, decoded: decodeSettlementItemId(id) }));
    const supplierOrderIds = decoded.map((item) => item.decoded.supplierOrderId);
    const orders = await this.database.client.supplierOrder.findMany({
      where: { id: { in: supplierOrderIds } },
      include: { shipments: true },
    });
    const ordersById = new Map(orders.map((order) => [order.id, order]));
    const items: PaymentPreviewItemView[] = [];
    const blockedItems: PaymentPreviewBlockedItemView[] = [];

    for (const item of decoded) {
      const order = ordersById.get(item.decoded.supplierOrderId);
      if (!order) {
        blockedItems.push({
          settlementItemId: item.id,
          code: 'SETTLEMENT_ITEM_NOT_FOUND',
          message: 'Settlement item source order was not found',
        });
        continue;
      }
      if (order.status !== SupplierOrderStatus.COMPLETED || !order.firstShippedAt) {
        blockedItems.push({
          settlementItemId: item.id,
          code: 'SETTLEMENT_ITEM_NOT_PAYABLE',
          message: 'Settlement item source order is not completed',
        });
        continue;
      }
      items.push(toPreviewItem(item.id, item.decoded.kind, order));
    }

    if (items.length === 0) {
      throw new NotFoundException({
        code: 'PAYMENT_PREVIEW_EMPTY',
        message: 'No payable settlement items were found',
        details: { blockedItems },
      });
    }

    const direction = directionForKind(items[0]!.kind);
    const storeId = direction === 'STORE_TO_COMPANY' ? items[0]!.storeId : null;
    const supplierId = direction === 'COMPANY_TO_SUPPLIER' ? items[0]!.supplierId : null;
    for (const item of items) {
      if (directionForKind(item.kind) !== direction) {
        throw new ConflictException({
          code: 'PAYMENT_DIRECTION_MISMATCH',
          message: 'Settlement items must share the same payment direction',
        });
      }
      if (storeId && item.storeId !== storeId) {
        throw new ConflictException({
          code: 'PAYMENT_PAYER_MISMATCH',
          message: 'Store payment items must share the same store',
        });
      }
      if (supplierId && item.supplierId !== supplierId) {
        throw new ConflictException({
          code: 'PAYMENT_PAYEE_MISMATCH',
          message: 'Supplier payment items must share the same supplier',
        });
      }
    }

    const totalPayableAmount = items.reduce((sum, item) => sum.plus(item.payableAmount), new Decimal(0));
    return {
      direction,
      channel: 'COMPANY',
      storeId,
      supplierId,
      totalPayableAmount: totalPayableAmount.toFixed(2),
      totalPendingPaymentAmount: '0.00',
      totalConfirmedPaidAmount: '0.00',
      items,
      blockedItems,
    };
  }
}

function toPreviewItem(settlementItemId: string, kind: SettlementItemKind, order: PreviewOrder): PaymentPreviewItemView {
  const goodsAmount = kind === 'STORE_RECEIVABLE' ? new Decimal(order.salesGoodsAmount) : new Decimal(order.supplyGoodsAmount);
  const freightAmount = order.shipments.reduce((sum, shipment) => sum.plus(shipment.freight), new Decimal(0));
  return {
    settlementItemId,
    kind,
    supplierOrderId: order.id,
    supplierOrderNo: order.supplierOrderNo,
    storeId: order.storeId,
    supplierId: order.supplierId,
    sourceVersion: order.version,
    payableAmount: goodsAmount.plus(freightAmount).toFixed(2),
    pendingPaymentAmount: '0.00',
    confirmedPaidAmount: '0.00',
  };
}

function directionForKind(kind: SettlementItemKind): PaymentDirection {
  return kind === 'STORE_RECEIVABLE' ? 'STORE_TO_COMPANY' : 'COMPANY_TO_SUPPLIER';
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
    code: 'INVALID_SETTLEMENT_ITEM_ID',
    message: 'Settlement item id is invalid',
  });
}
