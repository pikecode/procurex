import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { evaluateStoredValueFunding } from '../../../../packages/domain/src/funding.js';
import { toMoney } from '../../../../packages/domain/src/money.js';
import {
  FreightConfirmationStatus,
  FulfillmentStatus,
  PaymentStatus,
  PurchaseRequestStatus,
  ReplenishmentGapStatus,
  ShipmentKind,
  SupplierOrderStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type {
  OrderItem,
  ReplenishmentGap,
  Shipment,
  ShipmentGapAllocation,
  ShipmentItem,
  SupplierOrder,
} from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type ListSupplierOrdersInput = {
  storeId?: string;
  supplierId?: string;
  status?: SupplierOrderStatus;
};

export type SupplierOrderSummaryView = {
  id: string;
  supplierOrderNo: string;
  requestId: string;
  storeId: string;
  supplierId: string;
  status: SupplierOrderStatus;
  fulfillmentStatus: FulfillmentStatus;
  salesGoodsAmount: string;
  supplyGoodsAmount: string;
  pushedAt: string | null;
  firstShippedAt: string | null;
  rejectedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SupplierOrderDetailView = SupplierOrderSummaryView & {
  items: SupplierOrderItemView[];
};

export type SupplierOrderItemView = {
  id: string;
  productId: string;
  quantity: string;
  shippedQuantity: string;
  receivedQuantity: string;
  salesUnitPrice: string;
  supplyUnitPrice: string;
  salesLineAmount: string;
  supplyLineAmount: string;
};

export type RejectSupplierOrderResult = {
  supplierOrderId: string;
  requestId: string;
  status: SupplierOrderStatus;
  fulfillmentStatus: FulfillmentStatus;
  version: number;
  rejectedAt: string | null;
};

export type ReconcileSupplierOrderFundingResult = {
  supplierOrderId: string;
  supplierOrderVersion: number;
  requestId: string;
  requestStatus: PurchaseRequestStatus;
  requestVersion: number;
  paymentStatus: PaymentStatus;
  paidAmount: string;
  shortfallAmount: string;
  funding: {
    stored: {
      required: string;
      paid: string;
      available: string;
      shortfall: string;
    };
    canConfirm: boolean;
  };
};

export type ShipmentPreviewInput = {
  items: ShipmentPreviewItemInput[];
  freight: string;
  freightConfirmationId?: string;
  trackingNo?: string;
};

export type ShipmentPreviewItemInput = {
  orderItemId: string;
  shipQuantity: string;
  permanentlyReduceQuantity: string;
  gapAllocations?: ShipmentGapAllocationInput[];
};

export type ShipmentGapAllocationInput = {
  gapId: string;
  quantity: string;
};

export type ShipmentPreviewView = {
  supplierOrderId: string;
  version: number;
  items: ShipmentPreviewItemView[];
  totals: {
    shipQuantity: string;
    permanentlyReduceQuantity: string;
    remainingQuantity: string;
    salesGoodsAmount: string;
    supplyGoodsAmount: string;
    freight: string;
  };
  freightConfirmationId: string | null;
};

export type ShipmentView = {
  id: string;
  shipmentNo: string;
  supplierOrderId: string;
  sequence: number;
  kind: ShipmentKind;
  shippedAt: string;
  trackingNo: string | null;
  freight: string;
  freightConfirmationId: string | null;
  items: ShipmentItemView[];
};

export type ShipmentItemView = {
  id: string;
  orderItemId: string;
  productId: string;
  quantity: string;
  permanentlyReduced: string;
  salesLineAmount: string;
  supplyLineAmount: string;
  gapAllocations: ShipmentGapAllocationView[];
};

export type ShipmentGapAllocationView = {
  gapId: string;
  quantity: string;
};

export type ShipmentPreviewItemView = {
  orderItemId: string;
  productId: string;
  orderedQuantity: string;
  shippedQuantity: string;
  receivedQuantity: string;
  remainingQuantityBefore: string;
  shipQuantity: string;
  permanentlyReduceQuantity: string;
  remainingQuantityAfter: string;
  salesLineAmount: string;
  supplyLineAmount: string;
  gapAllocations: ShipmentPreviewGapAllocationView[];
};

export type ShipmentPreviewGapAllocationView = {
  gapId: string;
  quantity: string;
  remainingQuantityBefore: string;
  remainingQuantityAfter: string;
};

@Injectable()
export class SupplierOrdersService {
  constructor(private readonly database: DatabaseService) {}

  async list(input: ListSupplierOrdersInput): Promise<SupplierOrderSummaryView[]> {
    const orders = await this.database.client.supplierOrder.findMany({
      where: {
        storeId: input.storeId,
        supplierId: input.supplierId,
        status: input.status,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return orders.map(toSupplierOrderSummaryView);
  }

  async get(id: string, scope?: { type: string; supplierId?: string }): Promise<SupplierOrderDetailView> {
    const order = await this.database.client.supplierOrder.findUnique({
      where: { id, supplierId: scope?.type === 'SUPPLIER' ? scope?.supplierId : undefined },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'SUPPLIER_ORDER_NOT_FOUND',
        message: 'Supplier order was not found',
      });
    }

    return toSupplierOrderDetailView(order);
  }

  async shipmentPreview(id: string, expectedVersion: number, input: ShipmentPreviewInput, scope?: { type: string; supplierId?: string }): Promise<ShipmentPreviewView> {
    const order = await this.database.client.supplierOrder.findUnique({
      where: { id, supplierId: scope?.type === 'SUPPLIER' ? scope?.supplierId : undefined },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'SUPPLIER_ORDER_NOT_FOUND',
        message: 'Supplier order was not found',
      });
    }

    if (order.version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Supplier order version has changed',
        details: { expectedVersion, currentVersion: order.version },
      });
    }

    if (
      order.status !== SupplierOrderStatus.PUSHED &&
      order.status !== SupplierOrderStatus.ACCEPTED &&
      order.status !== SupplierOrderStatus.PARTIAL_SHIPPED
    ) {
      throw new ConflictException({
        code: 'SUPPLIER_ORDER_NOT_SHIPPABLE',
        message: 'Supplier order cannot be shipped in its current status',
        details: { status: order.status },
      });
    }

    const freightConfirmationId = await this.validateFreightConfirmation(order.id, input.freight, input.freightConfirmationId);
    const orderItemsById = new Map(order.items.map((item) => [item.id, item]));
    const requestedGapIds = input.items.flatMap((item) => item.gapAllocations?.map((allocation) => allocation.gapId) ?? []);
    const gaps = requestedGapIds.length
      ? await this.database.client.replenishmentGap.findMany({ where: { id: { in: requestedGapIds } } })
      : [];
    const gapsById = new Map(gaps.map((gap) => [gap.id, gap]));
    const previewItems = input.items.map((inputItem) => {
      const item = orderItemsById.get(inputItem.orderItemId);
      if (!item) {
        throw new ConflictException({
          code: 'ORDER_ITEM_NOT_FOUND',
          message: 'Shipment item does not belong to the supplier order',
          details: { orderItemId: inputItem.orderItemId },
        });
      }

      const shipQuantity = new Decimal(inputItem.shipQuantity);
      const permanentlyReduceQuantity = new Decimal(inputItem.permanentlyReduceQuantity);
      const remainingBefore = new Decimal(item.quantity).minus(item.shippedQuantity);
      const handledQuantity = shipQuantity.plus(permanentlyReduceQuantity);
      if (shipQuantity.lt(0) || permanentlyReduceQuantity.lt(0) || handledQuantity.lte(0) || handledQuantity.gt(remainingBefore)) {
        throw new ConflictException({
          code: 'INVALID_SHIPMENT_QUANTITY',
          message: 'Shipment quantities must be positive and cannot exceed remaining quantity',
          details: {
            orderItemId: item.id,
            remainingQuantity: remainingBefore.toDecimalPlaces(6).toString(),
          },
        });
      }

      const gapAllocations = (inputItem.gapAllocations ?? []).map((allocation) => {
        const gap = gapsById.get(allocation.gapId);
        if (!gap) {
          throw new ConflictException({
            code: 'REPLENISHMENT_GAP_NOT_FOUND',
            message: 'Replenishment gap was not found',
            details: { gapId: allocation.gapId },
          });
        }
        if (gap.orderItemId !== item.id) {
          throw new ConflictException({
            code: 'REPLENISHMENT_GAP_ITEM_MISMATCH',
            message: 'Replenishment gap does not belong to the shipment order item',
            details: { gapId: gap.id, orderItemId: item.id },
          });
        }
        if (gap.status !== ReplenishmentGapStatus.PENDING && gap.status !== ReplenishmentGapStatus.PARTIAL_FILLED) {
          throw new ConflictException({
            code: 'REPLENISHMENT_GAP_NOT_ALLOCATABLE',
            message: 'Replenishment gap cannot be allocated in its current status',
            details: { gapId: gap.id, status: gap.status },
          });
        }
        const quantity = new Decimal(allocation.quantity);
        if (quantity.lte(0) || quantity.gt(gap.remainingQuantity)) {
          throw new ConflictException({
            code: 'INVALID_REPLENISHMENT_GAP_QUANTITY',
            message: 'Replenishment gap allocation must be positive and cannot exceed remaining gap quantity',
            details: { gapId: gap.id, remainingQuantity: gap.remainingQuantity.toString() },
          });
        }
        const remainingQuantityAfter = new Decimal(gap.remainingQuantity).minus(quantity);
        return {
          gapId: gap.id,
          quantity: quantity.toDecimalPlaces(6).toString(),
          remainingQuantityBefore: gap.remainingQuantity.toString(),
          remainingQuantityAfter: remainingQuantityAfter.toDecimalPlaces(6).toString(),
        };
      });
      const allocatedGapQuantity = gapAllocations.reduce((sum, allocation) => sum.plus(allocation.quantity), new Decimal(0));
      if (allocatedGapQuantity.gt(shipQuantity)) {
        throw new ConflictException({
          code: 'INVALID_REPLENISHMENT_GAP_QUANTITY',
          message: 'Replenishment gap allocations cannot exceed shipped quantity',
          details: { orderItemId: item.id, shipQuantity: shipQuantity.toDecimalPlaces(6).toString() },
        });
      }

      const remainingAfter = remainingBefore.minus(handledQuantity);
      return {
        orderItemId: item.id,
        productId: item.productId,
        orderedQuantity: item.quantity.toString(),
        shippedQuantity: item.shippedQuantity.toString(),
        receivedQuantity: item.receivedQuantity.toString(),
        remainingQuantityBefore: remainingBefore.toDecimalPlaces(6).toString(),
        shipQuantity: shipQuantity.toDecimalPlaces(6).toString(),
        permanentlyReduceQuantity: permanentlyReduceQuantity.toDecimalPlaces(6).toString(),
        remainingQuantityAfter: remainingAfter.toDecimalPlaces(6).toString(),
        salesLineAmount: shipQuantity.mul(item.salesUnitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
        supplyLineAmount: shipQuantity.mul(item.supplyUnitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
        gapAllocations,
      };
    });

    const shipQuantity = previewItems.reduce((sum, item) => sum.plus(item.shipQuantity), new Decimal(0));
    const permanentlyReduceQuantity = previewItems.reduce((sum, item) => sum.plus(item.permanentlyReduceQuantity), new Decimal(0));
    const remainingQuantity = previewItems.reduce((sum, item) => sum.plus(item.remainingQuantityAfter), new Decimal(0));
    const salesGoodsAmount = previewItems.reduce((sum, item) => sum.plus(item.salesLineAmount), new Decimal(0));
    const supplyGoodsAmount = previewItems.reduce((sum, item) => sum.plus(item.supplyLineAmount), new Decimal(0));

    return {
      supplierOrderId: order.id,
      version: order.version,
      items: previewItems,
      totals: {
        shipQuantity: shipQuantity.toDecimalPlaces(6).toString(),
        permanentlyReduceQuantity: permanentlyReduceQuantity.toDecimalPlaces(6).toString(),
        remainingQuantity: remainingQuantity.toDecimalPlaces(6).toString(),
        salesGoodsAmount: salesGoodsAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
        supplyGoodsAmount: supplyGoodsAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
        freight: new Decimal(input.freight).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
      },
      freightConfirmationId,
    };
  }

  async createShipment(id: string, expectedVersion: number, input: ShipmentPreviewInput, scope?: { type: string; supplierId?: string }): Promise<ShipmentView> {
    const preview = await this.shipmentPreview(id, expectedVersion, input, scope);
    const order = await this.database.client.supplierOrder.findUniqueOrThrow({
      where: { id, supplierId: scope?.type === 'SUPPLIER' ? scope?.supplierId : undefined },
      include: { items: true, shipments: true },
    });
    const orderItemsById = new Map(order.items.map((item) => [item.id, item]));
    const sequence = order.shipments.length + 1;
    const kind = sequence === 1 ? ShipmentKind.INITIAL : ShipmentKind.REPLENISHMENT;
    const hasRemainingAfter = preview.items.some((item) => new Decimal(item.remainingQuantityAfter).gt(0));

    const shipment = await this.database.client.$transaction(async (tx) => {
      const created = await tx.shipment.create({
        data: {
          shipmentNo: makeShipmentNo(),
          supplierOrderId: order.id,
          sequence,
          kind,
          trackingNo: input.trackingNo,
          freight: preview.totals.freight,
          freightConfirmationId: preview.freightConfirmationId,
        },
      });

      if (preview.freightConfirmationId) {
        await tx.freightConfirmation.update({
          where: { id: preview.freightConfirmationId },
          data: {
            status: FreightConfirmationStatus.USED,
            usedAt: new Date(),
            version: { increment: 1 },
          },
        });
      }

      for (const previewItem of preview.items) {
        const orderItem = orderItemsById.get(previewItem.orderItemId)!;
        const shipmentItem = await tx.shipmentItem.create({
          data: {
            shipmentId: created.id,
            orderItemId: orderItem.id,
            quantity: previewItem.shipQuantity,
            permanentlyReduced: previewItem.permanentlyReduceQuantity,
            salesPriceSnapshot: orderItem.salesUnitPrice,
            supplyPriceSnapshot: orderItem.supplyUnitPrice,
            salesLineAmount: previewItem.salesLineAmount,
            supplyLineAmount: previewItem.supplyLineAmount,
          },
        });
        for (const allocation of previewItem.gapAllocations) {
          await tx.shipmentGapAllocation.create({
            data: {
              shipmentItemId: shipmentItem.id,
              gapId: allocation.gapId,
              quantity: allocation.quantity,
            },
          });
          await tx.replenishmentGap.update({
            where: { id: allocation.gapId },
            data: {
              remainingQuantity: allocation.remainingQuantityAfter,
              status: new Decimal(allocation.remainingQuantityAfter).eq(0)
                ? ReplenishmentGapStatus.FILLED
                : ReplenishmentGapStatus.PARTIAL_FILLED,
              version: { increment: 1 },
            },
          });
        }
        await tx.orderItem.update({
          where: { id: orderItem.id },
          data: {
            shippedQuantity: { increment: previewItem.shipQuantity },
          },
        });
      }

      await tx.supplierOrder.update({
        where: { id: order.id },
        data: {
          status: hasRemainingAfter ? SupplierOrderStatus.PARTIAL_SHIPPED : SupplierOrderStatus.SHIPPED,
          fulfillmentStatus: hasRemainingAfter ? FulfillmentStatus.PARTIAL_SHIPPED : FulfillmentStatus.SHIPPED,
          firstShippedAt: order.firstShippedAt ?? new Date(),
          version: { increment: 1 },
        },
      });

      return tx.shipment.findUniqueOrThrow({
        where: { id: created.id },
        include: { items: { include: { orderItem: true, gapAllocations: true }, orderBy: { createdAt: 'asc' } } },
      });
    });

    return toShipmentView(shipment);
  }

  async reject(id: string, expectedVersion: number, reason: string, scope?: { type: string; supplierId?: string }): Promise<RejectSupplierOrderResult> {
    const order = await this.database.client.supplierOrder.findUnique({ where: { id, supplierId: scope?.type === 'SUPPLIER' ? scope?.supplierId : undefined } });
    if (!order) {
      throw new NotFoundException({
        code: 'SUPPLIER_ORDER_NOT_FOUND',
        message: 'Supplier order was not found',
      });
    }

    if (order.version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Supplier order version has changed',
        details: { expectedVersion, currentVersion: order.version },
      });
    }

    if (order.status === SupplierOrderStatus.REJECTED) {
      return toRejectSupplierOrderResult(order);
    }

    if (
      order.firstShippedAt ||
      order.fulfillmentStatus !== FulfillmentStatus.PENDING ||
      (order.status !== SupplierOrderStatus.PUSHED && order.status !== SupplierOrderStatus.ACCEPTED)
    ) {
      throw new ConflictException({
        code: 'SUPPLIER_ORDER_NOT_REJECTABLE',
        message: 'Supplier order cannot be rejected in its current status',
        details: { status: order.status, fulfillmentStatus: order.fulfillmentStatus },
      });
    }

    const rejected = await this.database.client.$transaction(async (tx) => {
      const updated = await tx.supplierOrder.update({
        where: { id: order.id },
        data: {
          status: SupplierOrderStatus.REJECTED,
          fulfillmentStatus: FulfillmentStatus.CANCELED,
          rejectedAt: new Date(),
          rejectedReason: reason,
          version: { increment: 1 },
        },
      });

      await tx.purchaseRequest.update({
        where: { id: order.requestId },
        data: {
          status: PurchaseRequestStatus.PARTIAL_PUSHED,
          version: { increment: 1 },
        },
      });

      return updated;
    });

    return toRejectSupplierOrderResult(rejected);
  }

  async reconcileFunding(id: string, expectedVersion: number): Promise<ReconcileSupplierOrderFundingResult> {
    const order = await this.database.client.supplierOrder.findUnique({
      where: { id },
      include: { request: true },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'SUPPLIER_ORDER_NOT_FOUND',
        message: 'Supplier order was not found',
      });
    }

    if (order.version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Supplier order version has changed',
        details: { expectedVersion, currentVersion: order.version },
      });
    }

    if (order.request.status === PurchaseRequestStatus.CANCELED) {
      throw new ConflictException({
        code: 'PURCHASE_REQUEST_NOT_RECONCILABLE',
        message: 'Purchase request cannot reconcile funding in its current status',
        details: { status: order.request.status },
      });
    }

    const account = await this.database.client.storeAccount.findUnique({ where: { storeId: order.request.storeId } });
    const available = toMoney(account?.balance ?? 0);
    const funding = evaluateStoredValueFunding(available, order.request.salesGoodsAmount);
    const nextRequestStatus =
      funding.canConfirm && order.request.status === PurchaseRequestStatus.PENDING_FUNDS
        ? PurchaseRequestStatus.CONFIRMED
        : order.request.status;

    const updated = await this.database.client.$transaction(async (tx) => {
      const request = await tx.purchaseRequest.update({
        where: { id: order.requestId },
        data: {
          status: nextRequestStatus,
          paymentStatus: funding.canConfirm ? PaymentStatus.PAID : PaymentStatus.UNPAID,
          paidAmount: funding.paidAmount.toFixed(2),
          shortfallAmount: funding.shortfallAmount.toFixed(2),
          version: { increment: 1 },
        },
      });

      const supplierOrder = await tx.supplierOrder.update({
        where: { id: order.id },
        data: { version: { increment: 1 } },
      });

      return { request, supplierOrder };
    });

    return toReconcileSupplierOrderFundingResult(updated.supplierOrder, updated.request, available);
  }

  private async validateFreightConfirmation(
    supplierOrderId: string,
    freight: string,
    freightConfirmationId: string | undefined,
  ): Promise<string | null> {
    const freightAmount = new Decimal(freight).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (freightAmount.eq(0)) {
      if (freightConfirmationId) {
        throw new ConflictException({
          code: 'FREIGHT_CONFIRMATION_NOT_REQUIRED',
          message: 'Freight confirmation cannot be used for zero freight',
        });
      }
      return null;
    }

    if (!freightConfirmationId) {
      throw new ConflictException({
        code: 'FREIGHT_CONFIRMATION_REQUIRED',
        message: 'Non-zero shipment freight requires a confirmed freight confirmation',
      });
    }

    const confirmation = await this.database.client.freightConfirmation.findUnique({ where: { id: freightConfirmationId } });
    if (!confirmation) {
      throw new ConflictException({
        code: 'FREIGHT_CONFIRMATION_NOT_FOUND',
        message: 'Freight confirmation was not found',
        details: { freightConfirmationId },
      });
    }
    if (confirmation.supplierOrderId !== supplierOrderId) {
      throw new ConflictException({
        code: 'FREIGHT_CONFIRMATION_ORDER_MISMATCH',
        message: 'Freight confirmation does not belong to this supplier order',
        details: { freightConfirmationId },
      });
    }
    if (confirmation.status !== FreightConfirmationStatus.CONFIRMED) {
      throw new ConflictException({
        code: 'FREIGHT_CONFIRMATION_NOT_USABLE',
        message: 'Freight confirmation must be confirmed before it can be used',
        details: { freightConfirmationId, status: confirmation.status },
      });
    }
    if (!new Decimal(confirmation.amount).eq(freightAmount)) {
      throw new ConflictException({
        code: 'FREIGHT_CONFIRMATION_AMOUNT_MISMATCH',
        message: 'Freight confirmation amount must match shipment freight',
        details: { freightConfirmationId, freight: freightAmount.toFixed(2), amount: confirmation.amount.toFixed(2) },
      });
    }

    return confirmation.id;
  }
}

function toReconcileSupplierOrderFundingResult(
  order: SupplierOrder,
  request: { id: string; status: PurchaseRequestStatus; paymentStatus: PaymentStatus; salesGoodsAmount: Decimal; paidAmount: Decimal; shortfallAmount: Decimal; version: number },
  available: Decimal,
): ReconcileSupplierOrderFundingResult {
  const canConfirm = request.paymentStatus === PaymentStatus.PAID;
  return {
    supplierOrderId: order.id,
    supplierOrderVersion: order.version,
    requestId: request.id,
    requestStatus: request.status,
    requestVersion: request.version,
    paymentStatus: request.paymentStatus,
    paidAmount: request.paidAmount.toFixed(2),
    shortfallAmount: request.shortfallAmount.toFixed(2),
    funding: {
      stored: {
        required: request.salesGoodsAmount.toFixed(2),
        paid: request.paidAmount.toFixed(2),
        available: available.toFixed(2),
        shortfall: request.shortfallAmount.toFixed(2),
      },
      canConfirm,
    },
  };
}

function toSupplierOrderSummaryView(order: SupplierOrder): SupplierOrderSummaryView {
  return {
    id: order.id,
    supplierOrderNo: order.supplierOrderNo,
    requestId: order.requestId,
    storeId: order.storeId,
    supplierId: order.supplierId,
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus,
    salesGoodsAmount: order.salesGoodsAmount.toFixed(2),
    supplyGoodsAmount: order.supplyGoodsAmount.toFixed(2),
    pushedAt: order.pushedAt?.toISOString() ?? null,
    firstShippedAt: order.firstShippedAt?.toISOString() ?? null,
    rejectedAt: order.rejectedAt?.toISOString() ?? null,
    version: order.version,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

function toRejectSupplierOrderResult(order: SupplierOrder): RejectSupplierOrderResult {
  return {
    supplierOrderId: order.id,
    requestId: order.requestId,
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus,
    version: order.version,
    rejectedAt: order.rejectedAt?.toISOString() ?? null,
  };
}

function toSupplierOrderDetailView(order: SupplierOrder & { items: OrderItem[] }): SupplierOrderDetailView {
  return {
    ...toSupplierOrderSummaryView(order),
    items: order.items.map(toSupplierOrderItemView),
  };
}

function toSupplierOrderItemView(item: OrderItem): SupplierOrderItemView {
  return {
    id: item.id,
    productId: item.productId,
    quantity: item.quantity.toString(),
    shippedQuantity: item.shippedQuantity.toString(),
    receivedQuantity: item.receivedQuantity.toString(),
    salesUnitPrice: item.salesUnitPrice.toString(),
    supplyUnitPrice: item.supplyUnitPrice.toString(),
    salesLineAmount: item.salesLineAmount.toFixed(2),
    supplyLineAmount: item.supplyLineAmount.toFixed(2),
  };
}

function toShipmentView(
  shipment: Shipment & { items: Array<ShipmentItem & { orderItem: OrderItem; gapAllocations: ShipmentGapAllocation[] }> },
): ShipmentView {
  return {
    id: shipment.id,
    shipmentNo: shipment.shipmentNo,
    supplierOrderId: shipment.supplierOrderId,
    sequence: shipment.sequence,
    kind: shipment.kind,
    shippedAt: shipment.shippedAt.toISOString(),
    trackingNo: shipment.trackingNo,
    freight: shipment.freight.toFixed(2),
    freightConfirmationId: shipment.freightConfirmationId,
    items: shipment.items.map((item) => ({
      id: item.id,
      orderItemId: item.orderItemId,
      productId: item.orderItem.productId,
      quantity: item.quantity.toString(),
      permanentlyReduced: item.permanentlyReduced.toString(),
      salesLineAmount: item.salesLineAmount.toFixed(2),
      supplyLineAmount: item.supplyLineAmount.toFixed(2),
      gapAllocations: item.gapAllocations.map((allocation) => ({
        gapId: allocation.gapId,
        quantity: allocation.quantity.toString(),
      })),
    })),
  };
}

function makeShipmentNo(): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  return `SH${stamp}${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
}
