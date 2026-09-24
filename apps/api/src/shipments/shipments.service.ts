import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { FulfillmentStatus, SupplierOrderStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import type { Receipt, ReceiptItem, Shipment, ShipmentItem } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type CreateReceiptInput = {
  expectedOrderVersion: number;
  expectedReceiptRevision: number;
  items: ReceiptItemInput[];
};

export type ReceiptItemInput = {
  shipmentItemId: string;
  receivedQuantity: string;
};

export type ReceiptView = {
  id: string;
  receiptNo: string;
  shipmentId: string;
  revision: number;
  isCurrent: boolean;
  submittedAt: string;
  items: ReceiptItemView[];
};

export type ReceiptItemView = {
  id: string;
  shipmentItemId: string;
  receivedQuantity: string;
};

@Injectable()
export class ShipmentsService {
  constructor(private readonly database: DatabaseService) {}

  async createReceipt(shipmentId: string, input: CreateReceiptInput): Promise<ReceiptView> {
    const shipment = await this.database.client.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        supplierOrder: { include: { items: { include: { shipmentItems: true } } } },
        items: { orderBy: { createdAt: 'asc' } },
        receipts: { where: { isCurrent: true }, orderBy: { revision: 'desc' } },
      },
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: 'Shipment was not found',
      });
    }

    if (shipment.supplierOrder.version !== input.expectedOrderVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Supplier order version has changed',
        details: { expectedVersion: input.expectedOrderVersion, currentVersion: shipment.supplierOrder.version },
      });
    }

    if (input.expectedReceiptRevision !== 0 || shipment.receipts.length > 0) {
      throw new ConflictException({
        code: 'RECEIPT_REVISION_CONFLICT',
        message: 'Only first receipt revision is supported in this version',
        details: { expectedReceiptRevision: input.expectedReceiptRevision, currentRevision: shipment.receipts[0]?.revision ?? 0 },
      });
    }

    const shipmentItemsById = new Map(shipment.items.map((item) => [item.id, item]));
    const inputIds = new Set(input.items.map((item) => item.shipmentItemId));
    if (inputIds.size !== input.items.length || inputIds.size !== shipment.items.length) {
      throw new ConflictException({
        code: 'INVALID_RECEIPT_ITEMS',
        message: 'Receipt items must cover each shipment item exactly once',
      });
    }

    for (const shipmentItem of shipment.items) {
      if (!inputIds.has(shipmentItem.id)) {
        throw new ConflictException({
          code: 'INVALID_RECEIPT_ITEMS',
          message: 'Receipt items must cover each shipment item exactly once',
          details: { shipmentItemId: shipmentItem.id },
        });
      }
    }

    const receiptItems = input.items.map((item) => {
      const shipmentItem = shipmentItemsById.get(item.shipmentItemId);
      if (!shipmentItem) {
        throw new ConflictException({
          code: 'SHIPMENT_ITEM_NOT_FOUND',
          message: 'Receipt item does not belong to the shipment',
          details: { shipmentItemId: item.shipmentItemId },
        });
      }

      const receivedQuantity = new Decimal(item.receivedQuantity);
      if (receivedQuantity.lt(0) || receivedQuantity.gt(shipmentItem.quantity)) {
        throw new ConflictException({
          code: 'INVALID_RECEIVED_QUANTITY',
          message: 'Received quantity must be between zero and shipped quantity',
          details: { shipmentItemId: shipmentItem.id, shippedQuantity: shipmentItem.quantity.toString() },
        });
      }

      return { shipmentItem, receivedQuantity };
    });

    const receipt = await this.database.client.$transaction(async (tx) => {
      const created = await tx.receipt.create({
        data: {
          receiptNo: makeReceiptNo(),
          shipmentId: shipment.id,
          revision: 1,
        },
      });

      for (const item of receiptItems) {
        const createdReceiptItem = await tx.receiptItem.create({
          data: {
            receiptId: created.id,
            shipmentItemId: item.shipmentItem.id,
            receivedQuantity: item.receivedQuantity.toDecimalPlaces(6).toString(),
          },
        });
        const missingQuantity = new Decimal(item.shipmentItem.quantity).minus(item.receivedQuantity);
        if (missingQuantity.gt(0)) {
          await tx.discrepancy.create({
            data: {
              receiptItemId: createdReceiptItem.id,
              orderItemId: item.shipmentItem.orderItemId,
              missingQuantity: missingQuantity.toDecimalPlaces(6).toString(),
            },
          });
        }
        await tx.orderItem.update({
          where: { id: item.shipmentItem.orderItemId },
          data: {
            receivedQuantity: { increment: item.receivedQuantity.toDecimalPlaces(6).toString() },
          },
        });
      }

      const orderItems = await tx.orderItem.findMany({
        where: { supplierOrderId: shipment.supplierOrderId },
        include: { shipmentItems: true },
      });
      const nextFulfillmentStatus = resolveFulfillmentStatus(orderItems);
      await tx.supplierOrder.update({
        where: { id: shipment.supplierOrderId },
        data: {
          fulfillmentStatus: nextFulfillmentStatus,
          status: nextFulfillmentStatus === FulfillmentStatus.RECEIVED ? SupplierOrderStatus.SHIPPED : shipment.supplierOrder.status,
          version: { increment: 1 },
        },
      });

      return tx.receipt.findUniqueOrThrow({
        where: { id: created.id },
        include: { items: { orderBy: { createdAt: 'asc' } } },
      });
    });

    return toReceiptView(receipt);
  }
}

function resolveFulfillmentStatus(orderItems: Array<{ quantity: Decimal; shippedQuantity: Decimal; receivedQuantity: Decimal; shipmentItems: ShipmentItem[] }>): FulfillmentStatus {
  const allHandled = orderItems.every((item) => {
    const reduced = item.shipmentItems.reduce((sum, shipmentItem) => sum.plus(shipmentItem.permanentlyReduced), new Decimal(0));
    return new Decimal(item.shippedQuantity).plus(reduced).gte(item.quantity);
  });
  const allShippedReceived = orderItems.every((item) => new Decimal(item.receivedQuantity).gte(item.shippedQuantity));

  if (allHandled && allShippedReceived) {
    return FulfillmentStatus.RECEIVED;
  }

  return FulfillmentStatus.PARTIAL_SHIPPED;
}

function toReceiptView(receipt: Receipt & { items: ReceiptItem[] }): ReceiptView {
  return {
    id: receipt.id,
    receiptNo: receipt.receiptNo,
    shipmentId: receipt.shipmentId,
    revision: receipt.revision,
    isCurrent: receipt.isCurrent,
    submittedAt: receipt.submittedAt.toISOString(),
    items: receipt.items.map((item) => ({
      id: item.id,
      shipmentItemId: item.shipmentItemId,
      receivedQuantity: item.receivedQuantity.toString(),
    })),
  };
}

function makeReceiptNo(): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  return `RC${stamp}${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
}
