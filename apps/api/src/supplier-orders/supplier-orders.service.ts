import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { readUnitDisplayNames, transactionUnitView } from '../catalog/transaction-units.js';
import { evaluateStoredValueFunding } from '../../../../packages/domain/src/funding.js';
import { lineAmount, toMoney } from '../../../../packages/domain/src/money.js';
import { effectiveOrderItemQuantity, remainingNormalShipmentQuantity, resolveSupplierOrderFulfillmentStatus } from './fulfillment-status.js';
import { applyEffectiveOrderPrices, lockPricePublication } from '../pricing/price-checkpoint.js';
import { createReductionDocuments, createFrozenFreightDocuments } from './reduction-adjustments.js';
import {
  FreightConfirmationStatus,
  DiscrepancyStatus,
  DeliveryMode,
  FulfillmentStatus,
  PaymentStatus,
  PurchaseRequestStatus,
  ReplenishmentGapStatus,
  ShipmentKind,
  SupplierOrderStatus,
  UserScopeType,
  UserStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type {
  Prisma,
  OrderItem,
  ReplenishmentGap,
  Shipment,
  ShipmentGapAllocation,
  ShipmentItem,
  SupplierOrder,
} from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { storeDestination } from '../common/master-data-profile.js';
import { assignedStoreIds, storeFilter, type BusinessScope } from '../auth/store-scope.js';
import { lockFundingRequest, synchronizeRequestFunding } from '../purchase-requests/request-funding.js';
import { toFreightConfirmationView, type FreightConfirmationView } from '../freight-confirmations/freight-confirmations.service.js';

export type ListSupplierOrdersInput = {
  storeIds?: string[];
  storeId?: string;
  supplierId?: string;
  status?: SupplierOrderStatus;
};

export type SupplierOrderSummaryView = {
  supplierName?: string;
  storeName?: string;
  productSummary?: string;
  id: string;
  supplierOrderNo: string;
  requestId: string;
  requestNo?: string;
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
  supplierContact?: { contactName: string | null; contactPhone: string | null; deliveryContactPhone: string | null; address: string | null };
  defaultDeliveryMode: DeliveryMode;
  requiresFreightSnapshot?: boolean | null;
  destination?: { name: string; address: string | null; contactName: string | null; contactPhone: string | null };
  items: SupplierOrderItemView[];
  freightConfirmations?: FreightConfirmationView[];
  shipments: Array<ShipmentView & { revision: number; currentReceiptRevision: number }>;
};

export type SupplierOrderItemView = ReturnType<typeof transactionUnitView> & {
  remainingToShipQuantity?: string;
  salesPriceVersionId: string | null;
  supplyPriceVersionId: string | null;
  id: string;
  productId: string;
  productName?: string;
  imageFile?: { id: string } | null;
  replenishmentGaps?: Array<{ id: string; quantity: string; remainingQuantity: string; status: ReplenishmentGapStatus }>;
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
  deliveryMode?: DeliveryMode;
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
  deliveryMode: DeliveryMode;
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
  deliveryModeSnapshot: DeliveryMode | null;
  id: string;
  shipmentNo: string;
  supplierOrderId: string;
  sequence: number;
  kind: ShipmentKind;
  shippedAt: string;
  trackingNo: string | null;
  freight: string;
  freightConfirmationId: string | null;
  revision?: number;
  currentReceiptRevision?: number;
  canRevise?: boolean;
  items: ShipmentItemView[];
};

export type ShipmentRevisionInput = {
  expectedOrderVersion: number;
  expectedRevision: number;
  note?: string;
  evidenceFileIds?: string[];
  items: Array<{ shipmentItemId: string; quantity: string }>;
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
        storeId: storeFilter(input.storeId, input.storeIds),
        supplierId: input.supplierId,
        status: input.status,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { request: { select: { requestNo: true } }, supplier: { select: { name: true } }, store: { select: { name: true } }, items: {
        orderBy: { createdAt: 'asc' }, select: { product: { select: { name: true } } },
      } },
    });

    return orders.map(order => ({ ...toSupplierOrderSummaryView(order), requestNo: order.request.requestNo, supplierName: order.supplier.name, storeName: order.store.name,
      productSummary: order.items.map(item => item.product.name).join('、') }));
  }

  async get(id: string, scope?: BusinessScope): Promise<SupplierOrderDetailView> {
    const order = await this.database.client.supplierOrder.findUnique({
      where: { id, supplierId: scope?.type === 'SUPPLIER' ? scope?.supplierId : undefined,
        ...(['STORE', 'STORE_FINANCE'].includes(scope?.type ?? '') ? { storeId: scope?.storeId ?? '' } : {}),
        ...(scope?.type === 'MULTI_STORE' ? { storeId: storeFilter(undefined, assignedStoreIds(scope)) } : {}) },
      include: {
        request: { select: { requestNo: true } },
        supplier: { select: { deliveryMode: true, name: true, contactName: true, contactPhone: true, deliveryContactPhone: true, address: true } },
        store: { select: { name: true, address: true, contactName: true, contactPhone: true, receiptAddress: true, receiptContactName: true, receiptContactPhone: true } },
        items: { orderBy: { createdAt: 'asc' }, include: { product: { select: { name: true, imageFile: { select: { id: true } } } }, shipmentItems: { select: { permanentlyReduced: true, gapAllocations: { select: { quantity: true } } } }, replenishmentGaps: { orderBy: { createdAt: 'asc' } } } },
        freightConfirmations: { orderBy: { createdAt: 'desc' } },
        shipments: { orderBy: { sequence: 'asc' }, include: {
          items: { include: { orderItem: true, gapAllocations: true } },
          receipts: { where: { isCurrent: true }, include: { items: { include: { discrepancy: { include: { returnRecord: { select: { id: true } } } } } } } },
          revisions: { orderBy: { revision: 'desc' }, take: 1, select: { revision: true } },
        } },
      },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'SUPPLIER_ORDER_NOT_FOUND',
        message: 'Supplier order was not found',
      });
    }

    const names = await readUnitDisplayNames(this.database.client as Prisma.TransactionClient, order.items.map(item => item.unitSnapshot));
    return {
      ...toSupplierOrderDetailView(order),
      requestNo: order.request.requestNo,
      defaultDeliveryMode: order.supplier.deliveryMode,
      supplierName: order.supplier.name,
      supplierContact: { contactName: order.supplier.contactName, contactPhone: order.supplier.contactPhone, deliveryContactPhone: order.supplier.deliveryContactPhone, address: order.supplier.address },
      storeName: order.store.name,
      destination: storeDestination(order.store),
      requiresFreightSnapshot: order.requiresFreightSnapshot,
      items: order.items.map(item => ({ ...toSupplierOrderItemView(item), ...transactionUnitView(item.unitSnapshot, item.salesUnitPrice.toString(), item.supplyUnitPrice.toString(), names), productName: item.product.name, imageFile: item.product.imageFile,
        remainingToShipQuantity: remainingNormalShipmentQuantity(item).toString(),
        replenishmentGaps: item.replenishmentGaps.map(gap => ({ id: gap.id, quantity: gap.quantity.toString(), remainingQuantity: gap.remainingQuantity.toString(), status: gap.status })) })),
      freightConfirmations: order.freightConfirmations.map(toFreightConfirmationView),
      shipments: order.shipments.map(shipment => {
        const currentReceipt = shipment.receipts[0];
        const canRevise = !currentReceipt || (currentReceipt.items.length > 0 && currentReceipt.items.every(item =>
          item.discrepancy?.status === DiscrepancyStatus.OPEN ||
          (item.discrepancy?.status === DiscrepancyStatus.RESOLVED && Boolean(item.discrepancy.returnRecord))));
        return { ...toShipmentView(shipment), revision: shipment.revisions[0]?.revision ?? 0,
          currentReceiptRevision: currentReceipt?.revision ?? 0, canRevise };
      }),
    };
  }

  async shipmentPreview(id: string, expectedVersion: number, input: ShipmentPreviewInput, scope?: { type: string; supplierId?: string }): Promise<ShipmentPreviewView> {
    const order = await this.database.client.supplierOrder.findUnique({
      where: { id, supplierId: scope?.type === 'SUPPLIER' ? scope?.supplierId : undefined },
      include: {
        supplier: { select: { deliveryMode: true } },
        items: {
          orderBy: { createdAt: 'asc' },
          include: { shipmentItems: { include: { gapAllocations: { select: { quantity: true } } } } },
        },
      },
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
      order.status !== SupplierOrderStatus.PARTIAL_SHIPPED &&
      order.status !== SupplierOrderStatus.SHIPPED
    ) {
      throw new ConflictException({
        code: 'SUPPLIER_ORDER_NOT_SHIPPABLE',
        message: 'Supplier order cannot be shipped in its current status',
        details: { status: order.status },
      });
    }

    if (order.requiresFreightSnapshot === false && new Decimal(input.freight).gt(0)) {
      throw new ConflictException({ code: 'FREIGHT_NOT_ALLOWED', message: 'This order does not allow freight charges' });
    }
    const freightConfirmationId = await this.validateFreightConfirmation(order.id, input.freight, input.freightConfirmationId);
    const orderItemsById = new Map(order.items.map((item) => [item.id, item]));
    const requestedGapIds = input.items.flatMap((item) => item.gapAllocations?.map((allocation) => allocation.gapId) ?? []);
    if (new Set(requestedGapIds).size !== requestedGapIds.length) {
      throw new ConflictException({ code: 'INVALID_REPLENISHMENT_GAP_QUANTITY', message: 'Each replenishment gap may be allocated only once per shipment' });
    }
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
      const remainingBefore = remainingNormalShipmentQuantity(item);
      const handledQuantity = shipQuantity.plus(permanentlyReduceQuantity);
      if (shipQuantity.lt(0) || permanentlyReduceQuantity.lt(0) || handledQuantity.lte(0)) {
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

      if (handledQuantity.minus(allocatedGapQuantity).gt(remainingBefore)) {
        throw new ConflictException({ code: 'INVALID_SHIPMENT_QUANTITY', message: 'Shipment quantities cannot exceed remaining quantity plus allocated replenishment gaps' });
      }
      const remainingAfter = Decimal.max(0, remainingBefore.minus(handledQuantity).plus(allocatedGapQuantity));
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

    const deliveryMode = input.deliveryMode ?? order.supplier.deliveryMode;
    if (![DeliveryMode.SELF, DeliveryMode.LOGISTICS].includes(deliveryMode)) throw new ConflictException({ code: 'INVALID_DELIVERY_MODE', message: '请选择自配送或物流' });
    if (input.trackingNo && (deliveryMode !== DeliveryMode.LOGISTICS || input.trackingNo.length > 100)) throw new ConflictException({ code: 'INVALID_TRACKING_NO', message: '物流单号仅适用于物流配送，最多100字' });
    return {
      deliveryMode,
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

  async createShipment(id: string, expectedVersion: number, input: ShipmentPreviewInput, scope?: { type: string; supplierId?: string }, transaction?: Prisma.TransactionClient, actorUserId?: string): Promise<ShipmentView> {
    const preview = await this.shipmentPreview(id, expectedVersion, input, scope);
    const order = await this.database.client.supplierOrder.findUniqueOrThrow({
      where: { id, supplierId: scope?.type === 'SUPPLIER' ? scope?.supplierId : undefined },
      include: { items: true, shipments: true },
    });
    const orderItemsById = new Map(order.items.map((item) => [item.id, item]));
    const sequence = order.shipments.length + 1;
    const kind = sequence === 1 ? ShipmentKind.INITIAL : ShipmentKind.REPLENISHMENT;
    const hasRemainingAfter = preview.items.some((item) => new Decimal(item.remainingQuantityAfter).gt(0));

    const execute = async (tx: Prisma.TransactionClient) => {
      await lockPricePublication(tx);
      await lockFundingRequest(tx, order.storeId, order.requestId);
      const current = await tx.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
      if (current.version !== expectedVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Supplier order changed during shipment submission' });
      if (preview.freightConfirmationId) {
        const confirmation = await tx.freightConfirmation.findUniqueOrThrow({ where: { id: preview.freightConfirmationId } });
        if (confirmation.status !== FreightConfirmationStatus.CONFIRMED || !new Decimal(confirmation.amount).eq(preview.totals.freight)) {
          throw new ConflictException({ code: 'FREIGHT_CONFIRMATION_NOT_AVAILABLE', message: 'Freight confirmation changed before shipment submission' });
        }
      }
      const hasReduction = preview.items.some(item => new Decimal(item.permanentlyReduceQuantity).gt(0));
      const firstShippedAt = current.firstShippedAt ?? new Date();
      if (!current.firstShippedAt) {
        await applyEffectiveOrderPrices(tx, order.id, firstShippedAt);
        const pricedItems = await tx.orderItem.findMany({ where: { supplierOrderId: order.id } });
        for (const item of pricedItems) orderItemsById.set(item.id, item);
      }
      const created = await tx.shipment.create({
        data: {
          shipmentNo: makeShipmentNo(),
          supplierOrderId: order.id,
          sequence,
          kind,
          trackingNo: input.trackingNo,
          deliveryModeSnapshot: preview.deliveryMode,
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
            salesLineAmount: lineAmount(previewItem.shipQuantity, orderItem.salesUnitPrice),
            supplyLineAmount: lineAmount(previewItem.shipQuantity, orderItem.supplyUnitPrice),
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

      const initialRevision = await tx.shipmentRevision.create({ data: {
        shipmentId: created.id, revision: 1, expectedOrderVersion: expectedVersion, actorUserId: actorUserId ?? null,
      } });
      const createdShipmentItems = await tx.shipmentItem.findMany({ where: { shipmentId: created.id } });
      if (createdShipmentItems.length) await tx.shipmentRevisionItem.createMany({ data: createdShipmentItems.map(item => ({
        shipmentRevisionId: initialRevision.id, shipmentItemId: item.id, quantity: item.quantity,
      })) });

      if (hasReduction) {
        const reducedItems = await tx.orderItem.findMany({ where: { supplierOrderId: order.id }, include: {
          shipmentItems: true, discrepancies: { include: { returnRecord: true } },
        } });
        let salesDelta = new Decimal(0);
        let supplyDelta = new Decimal(0);
        const reductionLines: Parameters<typeof createReductionDocuments>[1]['lines'] = [];
        for (const item of reducedItems) {
          const quantity = effectiveOrderItemQuantity(item);
          const sales = lineAmount(quantity, item.salesUnitPrice);
          const supply = lineAmount(quantity, item.supplyUnitPrice);
          const salesChange = sales.minus(item.salesLineAmount);
          const supplyChange = supply.minus(item.supplyLineAmount);
          salesDelta = salesDelta.plus(salesChange);
          supplyDelta = supplyDelta.plus(supplyChange);
          const reductionQuantity = new Decimal(preview.items.find(line => line.orderItemId === item.id)?.permanentlyReduceQuantity ?? 0);
          if (reductionQuantity.gt(0)) reductionLines.push({ itemId: item.id, quantity: reductionQuantity, salesChange, supplyChange,
            salesPrice: new Decimal(item.salesUnitPrice), supplyPrice: new Decimal(item.supplyUnitPrice) });
          await tx.orderItem.update({ where: { id: item.id }, data: { salesLineAmount: sales, supplyLineAmount: supply } });
          await tx.requestItem.updateMany({ where: { requestId: order.requestId, supplierId: order.supplierId, productId: item.productId }, data: {
            salesLineAmount: { increment: salesChange }, supplyLineAmount: { increment: supplyChange },
          } });
        }
        await tx.supplierOrder.update({ where: { id: order.id }, data: {
          salesGoodsAmount: { increment: salesDelta }, supplyGoodsAmount: { increment: supplyDelta },
        } });
        await tx.purchaseRequest.update({ where: { id: order.requestId }, data: {
          salesGoodsAmount: { increment: salesDelta }, supplyGoodsAmount: { increment: supplyDelta }, version: { increment: 1 },
        } });
        await createReductionDocuments(tx, { order: current, shipmentId: created.id, baseline: firstShippedAt, lines: reductionLines });
        // Release the goods reduction before booking this shipment's freight, preserving refund provenance.
        await synchronizeRequestFunding(tx, order.requestId, { sourceId: created.id, excludeShipmentFreightId: created.id });
      }
      await createFrozenFreightDocuments(tx, { order: current, shipmentId: created.id, baseline: firstShippedAt, freight: new Decimal(preview.totals.freight) });
      await synchronizeRequestFunding(tx, order.requestId, { requireFull: true, sourceId: created.id });

      await tx.supplierOrder.update({
        where: { id: order.id },
        data: {
          status: hasRemainingAfter ? SupplierOrderStatus.PARTIAL_SHIPPED : SupplierOrderStatus.SHIPPED,
          fulfillmentStatus: hasRemainingAfter ? FulfillmentStatus.PARTIAL_SHIPPED : FulfillmentStatus.SHIPPED,
          firstShippedAt,
          version: { increment: 1 },
        },
      });

      const recipients = await tx.user.findMany({
        where: {
          status: UserStatus.ACTIVE,
          scopes: { some: { scopeType: UserScopeType.STORE, storeId: order.storeId } },
          roles: { some: { role: { code: { in: ['STORE', 'STORE_FINANCE'] } } } },
        },
        select: { id: true },
      });
      if (recipients.length) {
        await tx.notification.createMany({
          data: recipients.map((recipient) => ({
            recipientId: recipient.id,
            eventKey: `SHIPMENT_CREATED:${created.id}`,
            channel: 'IN_APP',
            title: '待收货提醒',
            body: `供应商订单 ${order.supplierOrderNo} 已发货，请复核收货。`,
            payload: {
              type: 'SHIPMENT_CREATED',
              route: '/main-flow-demo.html',
              supplierOrderId: order.id,
              shipmentId: created.id,
              shipmentNo: created.shipmentNo,
            },
          })),
          skipDuplicates: true,
        });
      }

      return tx.shipment.findUniqueOrThrow({
        where: { id: created.id },
        include: { items: { include: { orderItem: true, gapAllocations: true }, orderBy: { createdAt: 'asc' } } },
      });
    };
    const shipment = transaction ? await execute(transaction) : await this.database.client.$transaction(execute);
    return toShipmentView(shipment);
  }

  async reviseShipment(id: string, shipmentId: string, input: ShipmentRevisionInput, scope?: { type: string; supplierId?: string }, transaction?: Prisma.TransactionClient, actorUserId?: string) {
    const shipment = await this.database.client.shipment.findFirst({
      where: { id: shipmentId, supplierOrderId: id, supplierOrder: { supplierId: scope?.type === 'SUPPLIER' ? scope.supplierId : undefined } },
      include: {
        supplierOrder: { include: { items: { include: { shipmentItems: { include: { gapAllocations: true } } } } } },
        items: { include: { gapAllocations: true, receiptItems: { include: { discrepancy: { include: { returnRecord: true } } } } } },
        revisions: { orderBy: { revision: 'desc' }, take: 1 },
        receipts: { where: { isCurrent: true }, include: { items: true }, orderBy: { revision: 'desc' }, take: 1 },
      },
    });
    if (!shipment) throw new NotFoundException({ code: 'SHIPMENT_NOT_FOUND', message: 'Shipment was not found' });
    if (shipment.supplierOrder.version !== input.expectedOrderVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Supplier order version has changed' });
    const currentRevision = shipment.revisions[0]?.revision ?? 0;
    if (input.expectedRevision !== currentRevision) throw new ConflictException({ code: 'SHIPMENT_REVISION_CONFLICT', message: 'Shipment has a newer revision', details: { currentRevision } });
    if (shipment.items.some(item => new Decimal(item.permanentlyReduced).gt(0))) throw new ConflictException({ code: 'SHIPMENT_REVISION_NOT_ALLOWED', message: 'Previously finalized quantity reductions cannot be revised' });
    const itemById = new Map(shipment.items.map(item => [item.id, item]));
    if (input.items.length !== shipment.items.length || new Set(input.items.map(item => item.shipmentItemId)).size !== shipment.items.length) {
      throw new ConflictException({ code: 'INVALID_SHIPMENT_REVISION_ITEMS', message: 'Revision must include each shipment item exactly once' });
    }
    const orderItemById = new Map(shipment.supplierOrder.items.map(item => [item.id, item]));
    const revisedItems = input.items.map(line => {
      const shipmentItem = itemById.get(line.shipmentItemId);
      if (!shipmentItem) throw new ConflictException({ code: 'SHIPMENT_ITEM_NOT_FOUND', message: 'Shipment item does not belong to this shipment' });
      const orderItem = orderItemById.get(shipmentItem.orderItemId)!;
      const quantity = new Decimal(line.quantity);
      if (quantity.lt(0) || quantity.gt(orderItem.quantity)) throw new ConflictException({ code: 'INVALID_SHIPMENT_QUANTITY', message: 'Shipment quantity cannot exceed the original ordered quantity', details: { shipmentItemId: shipmentItem.id, orderedQuantity: orderItem.quantity.toString() } });
      assertShipmentRevisionCapacity(orderItem, shipmentItem.id, quantity);
      const isLocked = shipmentItem.receiptItems.some(receiptItem => {
        const discrepancy = receiptItem.discrepancy;
        return !discrepancy || (discrepancy.status !== DiscrepancyStatus.OPEN && !(discrepancy.status === DiscrepancyStatus.RESOLVED && discrepancy.returnRecord));
      });
      if (isLocked) throw new ConflictException({ code: 'SHIPMENT_ALREADY_RECEIVED', message: 'A shipment with finally confirmed receipt cannot be revised' });
      return { shipmentItem, orderItem, quantity };
    });
    const needsEvidence = revisedItems.some(item => item.quantity.lt(item.orderItem.quantity));
    if (needsEvidence && (!input.note?.trim() || !input.evidenceFileIds?.length)) throw new ConflictException({ code: 'SHIPMENT_SHORTAGE_EVIDENCE_REQUIRED', message: '少于门店下单数量时必须上传凭证并填写备注' });
    if (input.note && input.note.trim().length > 500) throw new ConflictException({ code: 'INVALID_SHIPMENT_NOTE', message: '备注最多500字' });
    if (input.evidenceFileIds && (input.evidenceFileIds.length > 6 || new Set(input.evidenceFileIds).size !== input.evidenceFileIds.length)) throw new ConflictException({ code: 'SHIPMENT_EVIDENCE_INVALID', message: '最多上传6张不同凭证' });

    const execute = async (tx: Prisma.TransactionClient) => {
      await lockPricePublication(tx);
      await lockFundingRequest(tx, shipment.supplierOrder.storeId, shipment.supplierOrder.requestId);
      await tx.$queryRaw`SELECT id FROM "SupplierOrder" WHERE id = ${id}::uuid FOR UPDATE`;
      const currentOrder = await tx.supplierOrder.findUniqueOrThrow({ where: { id } });
      const latest = await tx.shipmentRevision.findFirst({ where: { shipmentId }, orderBy: { revision: 'desc' } });
      if (currentOrder.version !== input.expectedOrderVersion || (latest?.revision ?? 0) !== input.expectedRevision) throw new ConflictException({ code: 'VERSION_CONFLICT', message: '发货或收货信息已更新，请刷新后重试' });
      const created = await tx.shipmentRevision.create({ data: { shipmentId, revision: currentRevision + 1, expectedOrderVersion: input.expectedOrderVersion, note: input.note?.trim() || null, actorUserId: actorUserId ?? null } });
      if (input.evidenceFileIds?.length) {
        const attached = await tx.fileObject.updateMany({
          where: { id: { in: input.evidenceFileIds }, ownerId: actorUserId, purpose: 'SHIPMENT_ADJUSTMENT', status: 'READY', shipmentRevisionId: null, receiptId: null, paymentId: null },
          data: { shipmentRevisionId: created.id },
        });
        if (attached.count !== input.evidenceFileIds.length) throw new ConflictException({ code: 'SHIPMENT_EVIDENCE_INVALID', message: '发货凭证无效、未完成上传、已使用或不属于当前账号' });
      }
      if (needsEvidence && (!actorUserId || !input.evidenceFileIds?.length)) throw new ConflictException({ code: 'SHIPMENT_EVIDENCE_INVALID', message: '缺少发货差异凭证' });
      await tx.shipmentRevisionItem.createMany({ data: revisedItems.map(item => ({ shipmentRevisionId: created.id, shipmentItemId: item.shipmentItem.id, quantity: item.quantity.toDecimalPlaces(6).toString() })) });
      for (const item of revisedItems) {
        const delta = item.quantity.minus(item.shipmentItem.quantity);
        await tx.shipmentItem.update({ where: { id: item.shipmentItem.id }, data: {
          quantity: item.quantity.toDecimalPlaces(6).toString(),
          salesLineAmount: lineAmount(item.quantity, item.shipmentItem.salesPriceSnapshot),
          supplyLineAmount: lineAmount(item.quantity, item.shipmentItem.supplyPriceSnapshot),
        } });
        await tx.orderItem.update({ where: { id: item.orderItem.id }, data: { shippedQuantity: { increment: delta.toDecimalPlaces(6).toString() } } });
      }
      const receipt = shipment.receipts[0];
      if (receipt) {
        await tx.receipt.update({ where: { id: receipt.id }, data: { isCurrent: false } });
        for (const receiptItem of receipt.items) {
          await tx.orderItem.update({ where: { id: itemById.get(receiptItem.shipmentItemId)!.orderItemId }, data: { receivedQuantity: { decrement: receiptItem.receivedQuantity } } });
        }
        await tx.discrepancy.updateMany({ where: { receiptItem: { receiptId: receipt.id }, status: DiscrepancyStatus.OPEN }, data: { status: DiscrepancyStatus.SUPERSEDED } });
      }
      const orderItems = await tx.orderItem.findMany({ where: { supplierOrderId: id }, include: { shipmentItems: true, discrepancies: { include: { replenishmentGap: true, returnRecord: true } } } });
      const status = resolveSupplierOrderFulfillmentStatus(orderItems);
      await tx.supplierOrder.update({ where: { id }, data: { version: { increment: 1 }, fulfillmentStatus: status, status: status === FulfillmentStatus.COMPLETED ? SupplierOrderStatus.COMPLETED : SupplierOrderStatus.PARTIAL_SHIPPED, completedAt: status === FulfillmentStatus.COMPLETED ? new Date() : null } });
      const recipients = await tx.user.findMany({ where: { status: UserStatus.ACTIVE, scopes: { some: { scopeType: UserScopeType.STORE, storeId: shipment.supplierOrder.storeId } }, roles: { some: { role: { code: { in: ['STORE', 'STORE_FINANCE'] } } } } }, select: { id: true } });
      if (recipients.length) await tx.notification.createMany({ data: recipients.map(recipient => ({ recipientId: recipient.id, eventKey: `SHIPMENT_REVISED:${created.id}`, channel: 'IN_APP', title: '供应商更新发货数量', body: `供应商订单 ${shipment.supplierOrder.supplierOrderNo} 的发货数量已更新，请重新核对。`, payload: { type: 'SHIPMENT_REVISED', route: '/main-flow-demo.html', supplierOrderId: id, shipmentId, revision: created.revision } })), skipDuplicates: true });
      return { shipmentId, revision: created.revision, supplierOrderVersion: currentOrder.version + 1, items: revisedItems.map(item => ({ shipmentItemId: item.shipmentItem.id, quantity: item.quantity.toDecimalPlaces(6).toString() })), evidenceFileIds: input.evidenceFileIds ?? [], note: created.note };
    };
    return transaction ? execute(transaction) : this.database.client.$transaction(execute);
  }

  async reject(id: string, expectedVersion: number, reason: string, scope?: { type: string; supplierId?: string }, transaction?: Prisma.TransactionClient): Promise<RejectSupplierOrderResult> {
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

    const execute = async (tx: Prisma.TransactionClient) => {
      await lockFundingRequest(tx, order.storeId, order.requestId);
      const current = await tx.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
      if (current.version !== expectedVersion || current.firstShippedAt || current.status !== order.status) {
        throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Supplier order changed during rejection' });
      }
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
      await synchronizeRequestFunding(tx, order.requestId);

      const recipients = await tx.user.findMany({
        where: {
          status: UserStatus.ACTIVE,
          roles: { some: { role: { code: { in: ['ADMIN', 'PURCHASER'] } } } },
        },
        select: { id: true },
      });
      if (recipients.length) {
        await tx.notification.createMany({
          data: recipients.map((recipient) => ({
            recipientId: recipient.id,
            eventKey: `SUPPLIER_ORDER_REJECTED:${updated.id}`,
            channel: 'IN_APP',
            title: '供应商拒单待处理',
            body: `供应商订单 ${updated.supplierOrderNo} 已拒单，请采购跟进重分配。`,
            payload: {
              type: 'SUPPLIER_ORDER_REJECTED',
              route: '/main-flow-demo.html',
              supplierOrderId: updated.id,
              supplierOrderNo: updated.supplierOrderNo,
              purchaseRequestId: updated.requestId,
              reason,
            },
          })),
          skipDuplicates: true,
        });
      }

      return updated;
    };
    const rejected = transaction ? await execute(transaction) : await this.database.client.$transaction(execute);
    return toRejectSupplierOrderResult(rejected);
  }

  async reconcileFunding(id: string, expectedVersion: number, transaction?: Prisma.TransactionClient): Promise<ReconcileSupplierOrderFundingResult> {
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

    const execute = async (tx: Prisma.TransactionClient) => {
      await lockFundingRequest(tx, order.storeId, order.requestId);
      const current = await tx.supplierOrder.findUniqueOrThrow({ where: { id: order.id } });
      if (current.version !== expectedVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Supplier order changed during funding reconciliation' });
      const funding = await synchronizeRequestFunding(tx, order.requestId);
      const request = await tx.purchaseRequest.update({
        where: { id: order.requestId },
        data: {
          status: funding.canConfirm && order.request.status === PurchaseRequestStatus.PENDING_FUNDS ? PurchaseRequestStatus.CONFIRMED : order.request.status,
          version: { increment: 1 },
        },
      });

      const supplierOrder = await tx.supplierOrder.update({
        where: { id: order.id },
        data: { version: { increment: 1 } },
      });

      return { request, supplierOrder, funding };
    };
    const updated = transaction ? await execute(transaction) : await this.database.client.$transaction(execute);
    return { ...toReconcileSupplierOrderFundingResult(updated.supplierOrder, updated.request, updated.funding.available), funding: {
      stored: { required: updated.funding.storedRequired.toFixed(2), paid: updated.funding.storedPaid.toFixed(2), available: updated.funding.available.toFixed(2), shortfall: updated.funding.shortfallAmount.toFixed(2) },
      canConfirm: updated.funding.canConfirm,
    } };
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

export function assertShipmentRevisionCapacity(
  orderItem: { id: string; quantity: Decimal.Value; shipmentItems: Array<{ id: string; quantity: Decimal.Value; permanentlyReduced: Decimal.Value; gapAllocations: Array<{ quantity: Decimal.Value }> }> },
  shipmentItemId: string,
  revisedQuantity: Decimal,
) {
  const current = orderItem.shipmentItems.find(item => item.id === shipmentItemId);
  if (!current) throw new ConflictException({ code: 'SHIPMENT_ITEM_NOT_FOUND', message: 'Shipment item does not belong to this order item' });
  const currentGapQuantity = current.gapAllocations.reduce((sum, allocation) => sum.plus(allocation.quantity), new Decimal(0));
  if (revisedQuantity.lt(currentGapQuantity)) throw new ConflictException({ code: 'INVALID_SHIPMENT_QUANTITY', message: 'Shipment quantity cannot be less than its authorized replenishment allocation' });
  const otherCommittedQuantity = orderItem.shipmentItems.filter(item => item.id !== shipmentItemId).reduce((sum, item) => {
    const gapQuantity = item.gapAllocations.reduce((allocated, gap) => allocated.plus(gap.quantity), new Decimal(0));
    return sum.plus(new Decimal(item.quantity).minus(gapQuantity)).plus(item.permanentlyReduced);
  }, new Decimal(0));
  if (otherCommittedQuantity.plus(revisedQuantity.minus(currentGapQuantity)).gt(orderItem.quantity)) {
    throw new ConflictException({ code: 'INVALID_SHIPMENT_QUANTITY', message: 'All regular shipment batches together cannot exceed the original ordered quantity', details: { orderItemId: orderItem.id, orderedQuantity: String(orderItem.quantity) } });
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

function toSupplierOrderDetailView(order: SupplierOrder & { items: OrderItem[] }): Omit<SupplierOrderDetailView, 'defaultDeliveryMode' | 'shipments'> {
  return {
    ...toSupplierOrderSummaryView(order),
    items: order.items.map(toSupplierOrderItemView),
  };
}

function toSupplierOrderItemView(item: OrderItem): SupplierOrderItemView {
  return {
    salesPriceVersionId: item.salesPriceVersionId, supplyPriceVersionId: item.supplyPriceVersionId,
    ...transactionUnitView(item.unitSnapshot, item.salesUnitPrice.toString(), item.supplyUnitPrice.toString()),
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
    deliveryModeSnapshot: shipment.deliveryModeSnapshot,
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
