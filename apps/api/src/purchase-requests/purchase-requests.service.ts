import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { evaluateStoredValueFunding } from '../../../../packages/domain/src/funding.js';
import { lineAmount, toMoney, toQuantity } from '../../../../packages/domain/src/money.js';
import {
  FulfillmentStatus,
  PaymentStatus,
  PurchaseRequestStatus,
  SupplierOrderStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type { PurchaseRequest, RequestItem, SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { PricingService } from '../pricing/pricing.service.js';
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

export type ReplacePurchaseRequestItemInput = {
  productId: string;
  supplierId: string;
  quantity: string;
};

export type ReassignPurchaseRequestPreview = {
  requestId: string;
  supplierId: string;
  items: ReassignPurchaseRequestPreviewItem[];
};

export type ReassignPurchaseRequestPreviewItem = {
  requestItemId: string;
  productId: string | null;
  currentSupplierId: string | null;
  targetSupplierId: string;
  eligible: boolean;
  reason: string | null;
  salesUnitPrice: string | null;
  supplyUnitPrice: string | null;
  salesLineAmount: string | null;
  supplyLineAmount: string | null;
  priceVersionId: string | null;
};

export type ReallocatePurchaseRequestAssignmentInput = {
  requestItemId: string;
  supplierId?: string;
  cancel?: boolean;
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
    private readonly pricingService: PricingService,
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

  async replaceItems(
    id: string,
    expectedVersion: number,
    items: ReplacePurchaseRequestItemInput[],
  ): Promise<PurchaseRequestDetailView> {
    const request = await this.database.client.purchaseRequest.findUnique({
      where: { id },
      include: { supplierOrders: true },
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

    if (request.status !== PurchaseRequestStatus.PENDING_PROCUREMENT || request.supplierOrders.length > 0) {
      throw new ConflictException({
        code: 'PURCHASE_REQUEST_ITEMS_NOT_EDITABLE',
        message: 'Purchase request items cannot be edited in its current status',
        details: { status: request.status },
      });
    }

    const duplicateProductId = findDuplicate(items.map((item) => item.productId));
    if (duplicateProductId) {
      throw new ConflictException({
        code: 'DUPLICATE_PURCHASE_REQUEST_PRODUCT',
        message: 'Purchase request items cannot contain duplicate products',
        details: { productId: duplicateProductId },
      });
    }

    const templateItems = await this.database.client.templateItem.findMany({
      where: {
        templateId: request.templateId,
        isEnabled: true,
        product: { isActive: true },
      },
      include: { suppliers: true },
    });
    const allowedSuppliersByProduct = new Map(
      templateItems.map((item) => [item.productId, new Set(item.suppliers.map((supplier) => supplier.supplierId))]),
    );

    const pricedItems = await Promise.all(
      items.map(async (item) => {
        const allowedSuppliers = allowedSuppliersByProduct.get(item.productId);
        if (!allowedSuppliers) {
          throw new ConflictException({
            code: 'PRODUCT_NOT_IN_TEMPLATE',
            message: 'Product is not available in the purchase request template',
            details: { productId: item.productId },
          });
        }
        if (!allowedSuppliers.has(item.supplierId)) {
          throw new ConflictException({
            code: 'SUPPLIER_NOT_ALLOWED_FOR_PRODUCT',
            message: 'Supplier is not allowed for this template product',
            details: { productId: item.productId, supplierId: item.supplierId },
          });
        }

        const quantity = toQuantity(item.quantity);
        if (quantity.lte(0)) {
          throw new ConflictException({
            code: 'INVALID_ITEM_QUANTITY',
            message: 'Purchase request item quantity must be greater than zero',
            details: { productId: item.productId },
          });
        }

        const price = await this.pricingService.getEffectivePrice(item.productId, item.supplierId, new Date());
        return {
          productId: item.productId,
          supplierId: item.supplierId,
          priceVersionId: price.versionId,
          quantity: quantity.toString(),
          salesUnitPrice: new Decimal(price.salesPrice).toString(),
          supplyUnitPrice: new Decimal(price.supplyPrice).toString(),
          salesLineAmount: lineAmount(quantity, price.salesPrice).toFixed(2),
          supplyLineAmount: lineAmount(quantity, price.supplyPrice).toFixed(2),
        };
      }),
    );

    const salesGoodsAmount = pricedItems.reduce((sum, item) => sum.plus(item.salesLineAmount), toMoney(0));
    const supplyGoodsAmount = pricedItems.reduce((sum, item) => sum.plus(item.supplyLineAmount), toMoney(0));
    const account = await this.database.client.storeAccount.findUnique({ where: { storeId: request.storeId } });
    const funding = evaluateStoredValueFunding(toMoney(account?.balance ?? 0), salesGoodsAmount);

    const updated = await this.database.client.$transaction(async (tx) => {
      await tx.requestItem.deleteMany({ where: { requestId: request.id } });
      await tx.requestItem.createMany({
        data: pricedItems.map((item) => ({
          requestId: request.id,
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

      await tx.purchaseRequest.update({
        where: { id: request.id },
        data: {
          status: funding.canConfirm ? PurchaseRequestStatus.PENDING_PROCUREMENT : PurchaseRequestStatus.PENDING_FUNDS,
          paymentStatus: funding.canConfirm ? PaymentStatus.PAID : PaymentStatus.UNPAID,
          salesGoodsAmount: salesGoodsAmount.toFixed(2),
          supplyGoodsAmount: supplyGoodsAmount.toFixed(2),
          paidAmount: funding.paidAmount.toFixed(2),
          shortfallAmount: funding.shortfallAmount.toFixed(2),
          version: { increment: 1 },
        },
      });

      return tx.purchaseRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: {
          items: { orderBy: { createdAt: 'asc' } },
          supplierOrders: { orderBy: { createdAt: 'asc' } },
        },
      });
    });

    return toPurchaseRequestDetailView(updated);
  }

  async reassignPreview(id: string, expectedVersion: number, itemIds: string[], supplierId: string): Promise<ReassignPurchaseRequestPreview> {
    const request = await this.loadEditableRequest(id, expectedVersion);
    const previewItems = await this.previewReassignment(request, itemIds, supplierId);
    return { requestId: request.id, supplierId, items: previewItems };
  }

  async assign(id: string, expectedVersion: number, itemIds: string[], supplierId: string): Promise<PurchaseRequestDetailView> {
    const request = await this.loadEditableRequest(id, expectedVersion);
    const previewItems = await this.previewReassignment(request, itemIds, supplierId);
    const ineligible = previewItems.filter((item) => !item.eligible);
    if (ineligible.length > 0) {
      throw new ConflictException({
        code: 'REASSIGNMENT_NOT_ELIGIBLE',
        message: 'All purchase request items must be eligible before assignment',
        details: { items: ineligible },
      });
    }

    const updatedItems = request.items.map((item) => {
      const preview = previewItems.find((candidate) => candidate.requestItemId === item.id);
      if (!preview) {
        return item;
      }
      return {
        ...item,
        supplierId,
        priceVersionId: preview.priceVersionId,
        salesUnitPrice: new Decimal(preview.salesUnitPrice!),
        supplyUnitPrice: new Decimal(preview.supplyUnitPrice!),
        salesLineAmount: new Decimal(preview.salesLineAmount!),
        supplyLineAmount: new Decimal(preview.supplyLineAmount!),
      };
    });
    const salesGoodsAmount = updatedItems.reduce((sum, item) => sum.plus(item.salesLineAmount), toMoney(0));
    const supplyGoodsAmount = updatedItems.reduce((sum, item) => sum.plus(item.supplyLineAmount), toMoney(0));
    const account = await this.database.client.storeAccount.findUnique({ where: { storeId: request.storeId } });
    const funding = evaluateStoredValueFunding(toMoney(account?.balance ?? 0), salesGoodsAmount);

    const updated = await this.database.client.$transaction(async (tx) => {
      for (const preview of previewItems) {
        await tx.requestItem.update({
          where: { id: preview.requestItemId },
          data: {
            supplierId,
            priceVersionId: preview.priceVersionId,
            salesUnitPrice: preview.salesUnitPrice!,
            supplyUnitPrice: preview.supplyUnitPrice!,
            salesLineAmount: preview.salesLineAmount!,
            supplyLineAmount: preview.supplyLineAmount!,
          },
        });
      }

      await tx.purchaseRequest.update({
        where: { id: request.id },
        data: {
          status: funding.canConfirm ? PurchaseRequestStatus.PENDING_PROCUREMENT : PurchaseRequestStatus.PENDING_FUNDS,
          paymentStatus: funding.canConfirm ? PaymentStatus.PAID : PaymentStatus.UNPAID,
          salesGoodsAmount: salesGoodsAmount.toFixed(2),
          supplyGoodsAmount: supplyGoodsAmount.toFixed(2),
          paidAmount: funding.paidAmount.toFixed(2),
          shortfallAmount: funding.shortfallAmount.toFixed(2),
          version: { increment: 1 },
        },
      });

      return tx.purchaseRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: {
          items: { orderBy: { createdAt: 'asc' } },
          supplierOrders: { orderBy: { createdAt: 'asc' } },
        },
      });
    });

    return toPurchaseRequestDetailView(updated);
  }

  async reallocate(
    id: string,
    expectedVersion: number,
    rejectedOrderId: string,
    assignments: ReallocatePurchaseRequestAssignmentInput[],
  ): Promise<PurchaseRequestDetailView> {
    const request = await this.database.client.purchaseRequest.findUnique({
      where: { id },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        supplierOrders: { include: { items: true } },
      },
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

    if (request.status !== PurchaseRequestStatus.PARTIAL_PUSHED) {
      throw new ConflictException({
        code: 'PURCHASE_REQUEST_NOT_REALLOCATABLE',
        message: 'Purchase request cannot be reallocated in its current status',
        details: { status: request.status },
      });
    }

    const rejectedOrder = request.supplierOrders.find((order) => order.id === rejectedOrderId);
    if (!rejectedOrder || rejectedOrder.status !== SupplierOrderStatus.REJECTED) {
      throw new ConflictException({
        code: 'REJECTED_SUPPLIER_ORDER_NOT_FOUND',
        message: 'Rejected supplier order does not belong to this purchase request',
        details: { rejectedOrderId },
      });
    }

    const requestItemsById = new Map(request.items.map((item) => [item.id, item]));
    const rejectedProductIds = new Set(rejectedOrder.items.map((item) => item.productId));
    const rejectedRequestItemIds = new Set(request.items.filter((item) => rejectedProductIds.has(item.productId)).map((item) => item.id));
    const assignmentIds = new Set(assignments.map((assignment) => assignment.requestItemId));

    if (assignmentIds.size !== assignments.length || assignmentIds.size !== rejectedRequestItemIds.size) {
      throw new ConflictException({
        code: 'INVALID_REALLOCATION_ASSIGNMENTS',
        message: 'Assignments must cover each rejected request item exactly once',
      });
    }
    for (const requestItemId of rejectedRequestItemIds) {
      if (!assignmentIds.has(requestItemId)) {
        throw new ConflictException({
          code: 'INVALID_REALLOCATION_ASSIGNMENTS',
          message: 'Assignments must cover each rejected request item exactly once',
          details: { requestItemId },
        });
      }
    }

    const templateItems = await this.database.client.templateItem.findMany({
      where: {
        templateId: request.templateId,
        isEnabled: true,
        product: { isActive: true },
      },
      include: { suppliers: true },
    });
    const allowedSuppliersByProduct = new Map(
      templateItems.map((item) => [item.productId, new Set(item.suppliers.map((supplier) => supplier.supplierId))]),
    );

    const pricedAssignments = await Promise.all(
      assignments.map(async (assignment) => {
        const item = requestItemsById.get(assignment.requestItemId);
        if (!item || !rejectedRequestItemIds.has(item.id)) {
          throw new ConflictException({
            code: 'REALLOCATION_ITEM_NOT_REJECTED',
            message: 'Assignment item is not part of the rejected supplier order',
            details: { requestItemId: assignment.requestItemId },
          });
        }

        if (assignment.cancel) {
          return { assignment, item, price: null };
        }

        if (!assignment.supplierId) {
          throw new ConflictException({
            code: 'REALLOCATION_SUPPLIER_REQUIRED',
            message: 'supplierId is required unless cancel is true',
            details: { requestItemId: item.id },
          });
        }

        const allowedSuppliers = allowedSuppliersByProduct.get(item.productId);
        if (!allowedSuppliers?.has(assignment.supplierId)) {
          throw new ConflictException({
            code: 'SUPPLIER_NOT_ALLOWED_FOR_PRODUCT',
            message: 'Supplier is not allowed for this template product',
            details: { productId: item.productId, supplierId: assignment.supplierId },
          });
        }

        const targetOrder = request.supplierOrders.find((order) => order.supplierId === assignment.supplierId && order.status !== SupplierOrderStatus.REJECTED);
        if (targetOrder?.firstShippedAt) {
          throw new ConflictException({
            code: 'TARGET_SUPPLIER_ALREADY_SHIPPED',
            message: 'Target supplier order has already shipped',
            details: { supplierId: assignment.supplierId },
          });
        }

        const price = await this.pricingService.getEffectivePrice(item.productId, assignment.supplierId, new Date());
        return { assignment, item, price };
      }),
    );

    const replacementItems = request.items
      .filter((item) => !pricedAssignments.some((priced) => priced.item.id === item.id && priced.assignment.cancel))
      .map((item) => {
        const priced = pricedAssignments.find((candidate) => candidate.item.id === item.id && !candidate.assignment.cancel);
        if (!priced?.price || !priced.assignment.supplierId) {
          return item;
        }
        return {
          ...item,
          supplierId: priced.assignment.supplierId,
          priceVersionId: priced.price.versionId,
          salesUnitPrice: new Decimal(priced.price.salesPrice),
          supplyUnitPrice: new Decimal(priced.price.supplyPrice),
          salesLineAmount: lineAmount(item.quantity, priced.price.salesPrice),
          supplyLineAmount: lineAmount(item.quantity, priced.price.supplyPrice),
        };
      });
    const salesGoodsAmount = replacementItems.reduce((sum, item) => sum.plus(item.salesLineAmount), toMoney(0));
    const supplyGoodsAmount = replacementItems.reduce((sum, item) => sum.plus(item.supplyLineAmount), toMoney(0));
    const account = await this.database.client.storeAccount.findUnique({ where: { storeId: request.storeId } });
    const funding = evaluateStoredValueFunding(toMoney(account?.balance ?? 0), salesGoodsAmount);

    const updated = await this.database.client.$transaction(async (tx) => {
      for (const priced of pricedAssignments) {
        if (priced.assignment.cancel) {
          await tx.requestItem.delete({ where: { id: priced.item.id } });
          continue;
        }

        await tx.requestItem.update({
          where: { id: priced.item.id },
          data: {
            supplierId: priced.assignment.supplierId!,
            priceVersionId: priced.price!.versionId,
            salesUnitPrice: priced.price!.salesPrice,
            supplyUnitPrice: priced.price!.supplyPrice,
            salesLineAmount: lineAmount(priced.item.quantity, priced.price!.salesPrice).toFixed(2),
            supplyLineAmount: lineAmount(priced.item.quantity, priced.price!.supplyPrice).toFixed(2),
          },
        });

        let targetOrder = request.supplierOrders.find(
          (order) => order.supplierId === priced.assignment.supplierId && order.status !== SupplierOrderStatus.REJECTED,
        );
        const lineSalesAmount = lineAmount(priced.item.quantity, priced.price!.salesPrice).toFixed(2);
        const lineSupplyAmount = lineAmount(priced.item.quantity, priced.price!.supplyPrice).toFixed(2);
        if (!targetOrder) {
          targetOrder = await tx.supplierOrder.create({
            data: {
              supplierOrderNo: makeSupplierOrderNo(),
              requestId: request.id,
              storeId: request.storeId,
              supplierId: priced.assignment.supplierId!,
              status: SupplierOrderStatus.PUSHED,
              fulfillmentStatus: FulfillmentStatus.PENDING,
              pushedAt: new Date(),
              salesGoodsAmount: lineSalesAmount,
              supplyGoodsAmount: lineSupplyAmount,
            },
            include: { items: true },
          });
          request.supplierOrders.push(targetOrder);
        } else {
          await tx.supplierOrder.update({
            where: { id: targetOrder.id },
            data: {
              salesGoodsAmount: { increment: lineSalesAmount },
              supplyGoodsAmount: { increment: lineSupplyAmount },
              version: { increment: 1 },
            },
          });
        }

        await tx.orderItem.create({
          data: {
            supplierOrderId: targetOrder.id,
            productId: priced.item.productId,
            quantity: priced.item.quantity,
            salesUnitPrice: priced.price!.salesPrice,
            supplyUnitPrice: priced.price!.supplyPrice,
            salesLineAmount: lineSalesAmount,
            supplyLineAmount: lineSupplyAmount,
          },
        });
      }

      await tx.purchaseRequest.update({
        where: { id: request.id },
        data: {
          status: funding.canConfirm ? PurchaseRequestStatus.CONFIRMED : PurchaseRequestStatus.PENDING_FUNDS,
          paymentStatus: funding.canConfirm ? PaymentStatus.PAID : PaymentStatus.UNPAID,
          salesGoodsAmount: salesGoodsAmount.toFixed(2),
          supplyGoodsAmount: supplyGoodsAmount.toFixed(2),
          paidAmount: funding.paidAmount.toFixed(2),
          shortfallAmount: funding.shortfallAmount.toFixed(2),
          version: { increment: 1 },
        },
      });

      return tx.purchaseRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: {
          items: { orderBy: { createdAt: 'asc' } },
          supplierOrders: { orderBy: { createdAt: 'asc' } },
        },
      });
    });

    return toPurchaseRequestDetailView(updated);
  }

  private async loadEditableRequest(id: string, expectedVersion: number): Promise<PurchaseRequest & { items: RequestItem[]; supplierOrders: SupplierOrder[] }> {
    const request = await this.database.client.purchaseRequest.findUnique({
      where: { id },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        supplierOrders: true,
      },
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

    if (request.status !== PurchaseRequestStatus.PENDING_PROCUREMENT || request.supplierOrders.length > 0) {
      throw new ConflictException({
        code: 'PURCHASE_REQUEST_ITEMS_NOT_EDITABLE',
        message: 'Purchase request items cannot be edited in its current status',
        details: { status: request.status },
      });
    }

    return request;
  }

  private async previewReassignment(
    request: PurchaseRequest & { items: RequestItem[] },
    itemIds: string[],
    supplierId: string,
  ): Promise<ReassignPurchaseRequestPreviewItem[]> {
    const itemsById = new Map(request.items.map((item) => [item.id, item]));
    const templateItems = await this.database.client.templateItem.findMany({
      where: {
        templateId: request.templateId,
        isEnabled: true,
        product: { isActive: true },
      },
      include: { suppliers: true },
    });
    const allowedSuppliersByProduct = new Map(
      templateItems.map((item) => [item.productId, new Set(item.suppliers.map((supplier) => supplier.supplierId))]),
    );

    return Promise.all(
      itemIds.map(async (itemId) => {
        const item = itemsById.get(itemId);
        if (!item) {
          return toIneligibleReassignment(itemId, null, null, supplierId, 'ITEM_NOT_FOUND');
        }

        const allowedSuppliers = allowedSuppliersByProduct.get(item.productId);
        if (!allowedSuppliers?.has(supplierId)) {
          return toIneligibleReassignment(item.id, item.productId, item.supplierId, supplierId, 'SUPPLIER_NOT_ALLOWED_FOR_PRODUCT');
        }

        try {
          const price = await this.pricingService.getEffectivePrice(item.productId, supplierId, new Date());
          return {
            requestItemId: item.id,
            productId: item.productId,
            currentSupplierId: item.supplierId,
            targetSupplierId: supplierId,
            eligible: true,
            reason: null,
            salesUnitPrice: new Decimal(price.salesPrice).toString(),
            supplyUnitPrice: new Decimal(price.supplyPrice).toString(),
            salesLineAmount: lineAmount(item.quantity, price.salesPrice).toFixed(2),
            supplyLineAmount: lineAmount(item.quantity, price.supplyPrice).toFixed(2),
            priceVersionId: price.versionId,
          };
        } catch (error) {
          if (error instanceof NotFoundException) {
            return toIneligibleReassignment(item.id, item.productId, item.supplierId, supplierId, 'PRICE_NOT_AVAILABLE');
          }
          throw error;
        }
      }),
    );
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

function findDuplicate(values: string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return null;
}

function toIneligibleReassignment(
  requestItemId: string,
  productId: string | null,
  currentSupplierId: string | null,
  targetSupplierId: string,
  reason: string,
): ReassignPurchaseRequestPreviewItem {
  return {
    requestItemId,
    productId,
    currentSupplierId,
    targetSupplierId,
    eligible: false,
    reason,
    salesUnitPrice: null,
    supplyUnitPrice: null,
    salesLineAmount: null,
    supplyLineAmount: null,
    priceVersionId: null,
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
