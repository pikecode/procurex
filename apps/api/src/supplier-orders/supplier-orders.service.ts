import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FulfillmentStatus,
  PurchaseRequestStatus,
  SupplierOrderStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type { OrderItem, SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
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

  async get(id: string): Promise<SupplierOrderDetailView> {
    const order = await this.database.client.supplierOrder.findUnique({
      where: { id },
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

  async reject(id: string, expectedVersion: number, reason: string): Promise<RejectSupplierOrderResult> {
    const order = await this.database.client.supplierOrder.findUnique({ where: { id } });
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
