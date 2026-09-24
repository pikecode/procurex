import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  FulfillmentStatus,
  PaymentStatus,
  PurchaseRequestStatus,
  SupplierOrderStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type { PurchaseRequest, RequestItem, SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import {
  PurchaseRequestPreviewService,
  type PurchaseRequestPreview,
  type PurchaseRequestPreviewInput,
} from './purchase-request-preview.service.js';

export type PurchaseRequestView = PurchaseRequestPreview & {
  id: string;
  requestNo: string;
  status: PurchaseRequestStatus;
  paymentStatus: PaymentStatus;
  version: number;
  submittedAt: string;
};

export type PurchaseRequestSummaryView = {
  id: string;
  requestNo: string;
  storeId: string;
  templateId: string;
  status: PurchaseRequestStatus;
  paymentStatus: PaymentStatus;
  salesGoodsAmount: string;
  supplyGoodsAmount: string;
  paidAmount: string;
  shortfallAmount: string;
  version: number;
  submittedAt: string;
  confirmedAt: string | null;
  rejectedAt: string | null;
};

export type PurchaseRequestDetailView = PurchaseRequestSummaryView & {
  rejectedReason: string | null;
  items: PurchaseRequestItemView[];
  supplierOrders: SupplierOrderSummaryView[];
};

export type PurchaseRequestItemView = {
  id: string;
  productId: string;
  supplierId: string;
  priceVersionId: string | null;
  quantity: string;
  salesUnitPrice: string;
  supplyUnitPrice: string;
  salesLineAmount: string;
  supplyLineAmount: string;
};

export type SupplierOrderSummaryView = {
  id: string;
  supplierOrderNo: string;
  supplierId: string;
  status: SupplierOrderStatus;
  fulfillmentStatus: FulfillmentStatus;
  salesGoodsAmount: string;
  supplyGoodsAmount: string;
  pushedAt: string | null;
  version: number;
};

export type ListPurchaseRequestsInput = {
  storeId?: string;
  status?: PurchaseRequestStatus;
};

export type ConfirmPurchaseRequestResult = {
  requestId: string;
  status: PurchaseRequestStatus;
  supplierOrderIds: string[];
};

export type RejectPurchaseRequestResult = {
  requestId: string;
  status: PurchaseRequestStatus;
  version: number;
  rejectedAt: string | null;
};

@Injectable()
export class PurchaseRequestsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly previewService: PurchaseRequestPreviewService,
  ) {}

  async list(input: ListPurchaseRequestsInput): Promise<PurchaseRequestSummaryView[]> {
    const requests = await this.database.client.purchaseRequest.findMany({
      where: {
        storeId: input.storeId,
        status: input.status,
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    });

    return requests.map(toPurchaseRequestSummaryView);
  }

  async get(id: string): Promise<PurchaseRequestDetailView> {
    const request = await this.database.client.purchaseRequest.findUnique({
      where: { id },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        supplierOrders: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!request) {
      throw new NotFoundException({
        code: 'PURCHASE_REQUEST_NOT_FOUND',
        message: 'Purchase request was not found',
      });
    }

    return toPurchaseRequestDetailView(request);
  }

  async create(input: PurchaseRequestPreviewInput): Promise<PurchaseRequestView> {
    const preview = await this.previewService.preview(input);
    const status = preview.funding.canConfirm ? PurchaseRequestStatus.PENDING_PROCUREMENT : PurchaseRequestStatus.PENDING_FUNDS;

    const request = await this.database.client.$transaction(async (tx) => {
      const created = await tx.purchaseRequest.create({
        data: {
          requestNo: makeRequestNo(),
          storeId: preview.storeId,
          templateId: preview.templateId,
          status,
          paymentStatus: preview.funding.canConfirm ? PaymentStatus.PAID : PaymentStatus.UNPAID,
          salesGoodsAmount: preview.totals.salesGoodsAmount,
          supplyGoodsAmount: preview.totals.supplyGoodsAmount,
          paidAmount: preview.funding.stored.paid,
          shortfallAmount: preview.funding.stored.shortfall,
        },
      });

      await tx.requestItem.createMany({
        data: preview.items.map((item) => ({
          requestId: created.id,
          productId: item.productId,
          supplierId: item.supplierId,
          priceVersionId: item.priceVersionId,
          quantity: item.quantity,
          salesUnitPrice: item.salesUnitPrice,
          supplyUnitPrice: item.supplyUnitPrice,
          salesLineAmount: item.salesLineAmount,
          supplyLineAmount: item.supplyLineAmount,
        })),
      });

      return created;
    });

    return {
      ...preview,
      id: request.id,
      requestNo: request.requestNo,
      status: request.status,
      paymentStatus: request.paymentStatus,
      version: request.version,
      submittedAt: request.submittedAt.toISOString(),
    };
  }

  async confirm(id: string, expectedVersion: number): Promise<ConfirmPurchaseRequestResult> {
    const request = await this.database.client.purchaseRequest.findUnique({
      where: { id },
      include: { items: true, supplierOrders: true },
    });
    if (!request) {
      throw new NotFoundException({
        code: 'PURCHASE_REQUEST_NOT_FOUND',
        message: 'Purchase request was not found',
      });
    }

    if (request.version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Purchase request version has changed',
        details: { expectedVersion, currentVersion: request.version },
      });
    }

    if (request.status === PurchaseRequestStatus.CONFIRMED || request.supplierOrders.length > 0) {
      return {
        requestId: request.id,
        status: request.status,
        supplierOrderIds: request.supplierOrders.map((order) => order.id).sort(),
      };
    }

    if (request.status !== PurchaseRequestStatus.PENDING_PROCUREMENT) {
      throw new ConflictException({
        code: 'PURCHASE_REQUEST_NOT_CONFIRMABLE',
        message: 'Purchase request cannot be confirmed in its current status',
        details: { status: request.status },
      });
    }

    const supplierGroups = new Map<string, typeof request.items>();
    for (const item of request.items) {
      const group = supplierGroups.get(item.supplierId) ?? [];
      group.push(item);
      supplierGroups.set(item.supplierId, group);
    }

    const supplierOrderIds = await this.database.client.$transaction(async (tx) => {
      const createdOrderIds: string[] = [];

      for (const [supplierId, items] of supplierGroups.entries()) {
        const salesGoodsAmount = items.reduce((sum, item) => sum.plus(item.salesLineAmount), new Decimal(0));
        const supplyGoodsAmount = items.reduce((sum, item) => sum.plus(item.supplyLineAmount), new Decimal(0));
        const supplierOrder = await tx.supplierOrder.create({
          data: {
            supplierOrderNo: makeSupplierOrderNo(),
            requestId: request.id,
            storeId: request.storeId,
            supplierId,
            status: SupplierOrderStatus.PUSHED,
            fulfillmentStatus: FulfillmentStatus.PENDING,
            pushedAt: new Date(),
            salesGoodsAmount: salesGoodsAmount.toFixed(2),
            supplyGoodsAmount: supplyGoodsAmount.toFixed(2),
          },
        });

        await tx.orderItem.createMany({
          data: items.map((item) => ({
            supplierOrderId: supplierOrder.id,
            productId: item.productId,
            quantity: item.quantity,
            salesUnitPrice: item.salesUnitPrice,
            supplyUnitPrice: item.supplyUnitPrice,
            salesLineAmount: item.salesLineAmount,
            supplyLineAmount: item.supplyLineAmount,
          })),
        });

        createdOrderIds.push(supplierOrder.id);
      }

      await tx.purchaseRequest.update({
        where: { id: request.id },
        data: {
          status: PurchaseRequestStatus.CONFIRMED,
          confirmedAt: new Date(),
          version: { increment: 1 },
        },
      });

      return createdOrderIds;
    });

    return {
      requestId: request.id,
      status: PurchaseRequestStatus.CONFIRMED,
      supplierOrderIds: supplierOrderIds.sort(),
    };
  }

  async reject(id: string, expectedVersion: number, reason: string): Promise<RejectPurchaseRequestResult> {
    const request = await this.database.client.purchaseRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException({
        code: 'PURCHASE_REQUEST_NOT_FOUND',
        message: 'Purchase request was not found',
      });
    }

    if (request.version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Purchase request version has changed',
        details: { expectedVersion, currentVersion: request.version },
      });
    }

    if (request.status === PurchaseRequestStatus.CANCELED) {
      return {
        requestId: request.id,
        status: request.status,
        version: request.version,
        rejectedAt: request.rejectedAt?.toISOString() ?? null,
      };
    }

    if (request.status !== PurchaseRequestStatus.PENDING_PROCUREMENT) {
      throw new ConflictException({
        code: 'PURCHASE_REQUEST_NOT_REJECTABLE',
        message: 'Purchase request cannot be rejected in its current status',
        details: { status: request.status },
      });
    }

    const rejected = await this.database.client.purchaseRequest.update({
      where: { id: request.id },
      data: {
        status: PurchaseRequestStatus.CANCELED,
        rejectedAt: new Date(),
        rejectedReason: reason,
        version: { increment: 1 },
      },
    });

    return {
      requestId: rejected.id,
      status: rejected.status,
      version: rejected.version,
      rejectedAt: rejected.rejectedAt?.toISOString() ?? null,
    };
  }
}

function toPurchaseRequestSummaryView(request: PurchaseRequest): PurchaseRequestSummaryView {
  return {
    id: request.id,
    requestNo: request.requestNo,
    storeId: request.storeId,
    templateId: request.templateId,
    status: request.status,
    paymentStatus: request.paymentStatus,
    salesGoodsAmount: request.salesGoodsAmount.toFixed(2),
    supplyGoodsAmount: request.supplyGoodsAmount.toFixed(2),
    paidAmount: request.paidAmount.toFixed(2),
    shortfallAmount: request.shortfallAmount.toFixed(2),
    version: request.version,
    submittedAt: request.submittedAt.toISOString(),
    confirmedAt: request.confirmedAt?.toISOString() ?? null,
    rejectedAt: request.rejectedAt?.toISOString() ?? null,
  };
}

function toPurchaseRequestDetailView(
  request: PurchaseRequest & { items: RequestItem[]; supplierOrders: SupplierOrder[] },
): PurchaseRequestDetailView {
  return {
    ...toPurchaseRequestSummaryView(request),
    rejectedReason: request.rejectedReason,
    items: request.items.map(toPurchaseRequestItemView),
    supplierOrders: request.supplierOrders.map(toSupplierOrderSummaryView),
  };
}

function toPurchaseRequestItemView(item: RequestItem): PurchaseRequestItemView {
  return {
    id: item.id,
    productId: item.productId,
    supplierId: item.supplierId,
    priceVersionId: item.priceVersionId,
    quantity: item.quantity.toString(),
    salesUnitPrice: item.salesUnitPrice.toString(),
    supplyUnitPrice: item.supplyUnitPrice.toString(),
    salesLineAmount: item.salesLineAmount.toFixed(2),
    supplyLineAmount: item.supplyLineAmount.toFixed(2),
  };
}

function toSupplierOrderSummaryView(order: SupplierOrder): SupplierOrderSummaryView {
  return {
    id: order.id,
    supplierOrderNo: order.supplierOrderNo,
    supplierId: order.supplierId,
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus,
    salesGoodsAmount: order.salesGoodsAmount.toFixed(2),
    supplyGoodsAmount: order.supplyGoodsAmount.toFixed(2),
    pushedAt: order.pushedAt?.toISOString() ?? null,
    version: order.version,
  };
}

function makeRequestNo(): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  return `PR${stamp}${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
}

function makeSupplierOrderNo(): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  return `SO${stamp}${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
}
