import { randomInt } from 'node:crypto';
import { assignedStoreIds, storeFilter, type BusinessScope } from '../auth/store-scope.js';
import { lockCatalog } from '../catalog/catalog-registries.service.js';
import { readTransactionUnits, readUnitDisplayNames, readUnitSnapshot, requireTransactionUnitsUnchanged, transactionUnitView } from '../catalog/transaction-units.js';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { evaluateStoredValueFunding } from '../../../../packages/domain/src/funding.js';
import { lineAmount, toMoney } from '../../../../packages/domain/src/money.js';
import {
  FulfillmentStatus,
  PaymentStatus,
  PurchaseRequestStatus,
  SupplierOrderStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type { Prisma, PurchaseRequest, RequestItem, SupplierOrder } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { effectivePriceVersion } from '../pricing/effective-price.js';
import { lockPricePublication } from '../pricing/price-checkpoint.js';
import { lockFundingRequest, requireRequestVersion, synchronizeRequestFunding, resolveSettlementTerms } from './request-funding.js';
import { isHistoricalRejection, requestProgress } from './request-progress.js';
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
  procurementConfirmedAt: string | null;
  financeReviewedAt: string | null;
  financeReturnedReason: string | null;
  storedValueOnReceipt: boolean;
  storedReservedAmount?: string;
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
  supplierCount?: number;
  completedSupplierCount?: number;
  canceledSupplierCount?: number;
  rejectedSupplierCount?: number;
  fulfillmentStage?: string;
};

export type PurchaseRequestDetailView = PurchaseRequestSummaryView & {
  rejectedReason: string | null;
  items: PurchaseRequestItemView[];
  supplierOrders: SupplierOrderSummaryView[];
};

export type PurchaseRequestItemView = ReturnType<typeof transactionUnitView> & {
  supplyPriceVersionId: string | null;
  id: string;
  productId: string;
  productName?: string;
  imageFile?: { id: string } | null;
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
  supplierName?: string;
  rejectionHandled?: boolean;
  shipments?: Array<{ id: string; shipmentNo: string; kind: string; shippedAt: string; trackingNo: string | null; deliveryModeSnapshot: string | null; receivedAt: string | null; receiptRevision: number }>;
};

export type ListPurchaseRequestsInput = {
  storeIds?: string[];
  storeId?: string;
  status?: PurchaseRequestStatus;
};

export type ReplacePurchaseRequestItemInput = {
  expectedPriceVersionId?: string;
  expectedSupplyPriceVersionId?: string;
  expectedProductVersion?: number;
  unitId?: string;
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
  supplyPriceVersionId: string | null;
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
        storeId: storeFilter(input.storeId, input.storeIds),
        status: input.status,
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      include: { items: { select: { productId: true, supplierId: true } }, supplierOrders: { select: { id: true, createdAt: true, status: true, supplierId: true, items: { select: { productId: true } } } } },
    });

    return requests.map(request => ({ ...toPurchaseRequestSummaryView(request), ...requestProgress(request) }));
  }

  async get(id: string, scope?: BusinessScope, transaction?: Prisma.TransactionClient): Promise<PurchaseRequestDetailView> {
    const request = await (transaction ?? (this.database.client as Prisma.TransactionClient)).purchaseRequest.findUnique({
      where: { id, storeId: scope?.type === 'MULTI_STORE' ? storeFilter(undefined, assignedStoreIds(scope)) : isStoreScope(scope?.type) ? scope?.storeId : undefined },
      include: {
        items: { orderBy: { createdAt: 'asc' }, include: { product: { select: { name: true, imageFile: { select: { id: true } } } }, supplier: { select: { name: true, deliveryContactPhone: true, contactName: true, contactPhone: true, address: true } } } },
        supplierOrders: { orderBy: { createdAt: 'asc' }, include: { items: { select: { productId: true } }, supplier: { select: { name: true, deliveryContactPhone: true } }, shipments: { orderBy: { sequence: 'asc' }, include: { receipts: { where: { isCurrent: true }, select: { submittedAt: true, revision: true } } } } } },
      },
    });
    if (!request) {
      throw new NotFoundException({
        code: 'PURCHASE_REQUEST_NOT_FOUND',
        message: 'Purchase request was not found',
      });
    }

    const names = await readUnitDisplayNames(transaction ?? (this.database.client as Prisma.TransactionClient), request.items.map(item => item.unitSnapshot));
    const reservations = await (transaction ?? (this.database.client as Prisma.TransactionClient)).fundingAllocation.aggregate({
      where: { requestId: request.id, active: true, method: 'STORED_VALUE' }, _sum: { reservedAmount: true },
    });
    return { ...toPurchaseRequestDetailView(request), storedReservedAmount: reservations._sum.reservedAmount?.toFixed(2) ?? '0.00', ...requestProgress(request), items: request.items.map(item => ({ ...toPurchaseRequestItemView(item), ...transactionUnitView(item.unitSnapshot, item.salesUnitPrice.toString(), item.supplyUnitPrice.toString(), names), productName: item.product.name, imageFile: item.product.imageFile, supplierName: item.supplier.name, deliveryContactPhone: item.supplier.deliveryContactPhone, supplierContactName: item.supplier.contactName, supplierContactPhone: item.supplier.contactPhone, supplierAddress: item.supplier.address })),
      supplierOrders: request.supplierOrders.map(order => ({ ...toSupplierOrderSummaryView(order), supplierName: order.supplier.name, deliveryContactPhone: order.supplier.deliveryContactPhone, rejectionHandled: isHistoricalRejection(request, order),
        shipments: order.shipments.map(shipment => ({ id: shipment.id, shipmentNo: shipment.shipmentNo, kind: shipment.kind, shippedAt: shipment.shippedAt.toISOString(), trackingNo: shipment.trackingNo, carrierName: shipment.carrierName, deliveryModeSnapshot: shipment.deliveryModeSnapshot,
          receivedAt: shipment.receipts[0]?.submittedAt.toISOString() ?? null, receiptRevision: shipment.receipts[0]?.revision ?? 0 })) })) };
  }

  async rejectionTodos() {
    const orders = await this.database.client.supplierOrder.findMany({
      where: { status: 'REJECTED', request: { status: { not: 'CANCELED' } } },
      orderBy: [{ rejectedAt: 'desc' }, { id: 'desc' }],
      include: { items: { select: { productId: true } }, supplier: { select: { name: true } },
        request: { include: { store: { select: { name: true } }, items: { select: { productId: true, supplierId: true } },
          supplierOrders: { select: { id: true, createdAt: true, status: true, supplierId: true, items: { select: { productId: true } } } } } } },
    });
    return orders.filter(order => !isHistoricalRejection(order.request, order)).map(order => ({
      id: order.id, supplierOrderId: order.id, supplierOrderNo: order.supplierOrderNo,
      purchaseRequestId: order.requestId, requestNo: order.request.requestNo,
      storeName: order.request.store.name, supplierName: order.supplier.name,
      reason: order.rejectedReason || '', createdAt: order.rejectedAt?.toISOString() ?? order.createdAt.toISOString(),
    }));
  }

  async create(input: PurchaseRequestPreviewInput, transaction?: Prisma.TransactionClient): Promise<PurchaseRequestView> {
    const execute = async (tx: Prisma.TransactionClient) => {
      await lockPricePublication(tx);
      await lockCatalog(tx, true);
      // Reuse the command transaction; a second pooled connection can starve under load.
      const preview = await this.previewService.preview(input, tx);
      const status = preview.funding.canConfirm ? PurchaseRequestStatus.PENDING_PROCUREMENT : PurchaseRequestStatus.PENDING_FUNDS;
      for (const item of preview.items) await requireTransactionUnitsUnchanged(tx, item.productId, item.unitSnapshot);
      for (const item of preview.items) {
        const price = await effectivePriceVersion(tx, item.productId, item.supplierId, new Date(), preview.templateId);
        if (price?.id !== item.priceVersionId || price?.supplyVersionId !== item.supplyPriceVersionId) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Effective price changed; preview again' });
      }
      await lockFundingRequest(tx, preview.storeId);
      const created = await tx.purchaseRequest.create({
        data: {
          requestNo: makeRequestNo(),
          storedValueOnReceipt: true,
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
          unitSnapshot: item.unitSnapshot,
          productId: item.productId,
          supplierId: item.supplierId,
          priceVersionId: item.priceVersionId,
          supplyPriceVersionId: item.supplyPriceVersionId,
          quantity: item.quantity,
          salesUnitPrice: item.salesUnitPrice,
          supplyUnitPrice: item.supplyUnitPrice,
          salesLineAmount: item.salesLineAmount,
          supplyLineAmount: item.supplyLineAmount,
        })),
      });

      const funding = await synchronizeRequestFunding(tx, created.id, { initial: true, sourceId: created.id, deferCreditShortfall: true });
      const request = await tx.purchaseRequest.update({ where: { id: created.id }, data: {
        status: funding.canConfirm ? PurchaseRequestStatus.PENDING_PROCUREMENT : PurchaseRequestStatus.PENDING_FUNDS,
      } });
      return { request, funding, preview };
    };
    const { request, funding, preview } = transaction ? await execute(transaction) : await this.database.client.$transaction(execute);

    return {
      ...preview,
      funding: { ...preview.funding, canConfirm: funding.canConfirm, stored: {
        required: funding.storedRequired.toFixed(2), paid: funding.storedPaid.toFixed(2), reserved: funding.storedReserved.toFixed(2), available: funding.available.toFixed(2), shortfall: funding.storedShortfall.toFixed(2),
      }, ...(funding.creditRequired.isZero() ? {} : { credit: { required: funding.creditRequired.toFixed(2), available: funding.creditAvailable.toFixed(2), shortfall: funding.creditShortfall.toFixed(2) } }) },
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
    transaction?: Prisma.TransactionClient,
  ): Promise<PurchaseRequestDetailView> {
    const { request, pricedItems, salesGoodsAmount, supplyGoodsAmount, funding } = await this.prepareReplacement(id, expectedVersion, items);
    return this.saveReplacement(request, expectedVersion, pricedItems, salesGoodsAmount, supplyGoodsAmount, funding, transaction);
  }

  async previewReplacement(id: string, expectedVersion: number, items: ReplacePurchaseRequestItemInput[]) {
    const { request, pricedItems, salesGoodsAmount, supplyGoodsAmount, funding, fundingDetail } = await this.prepareReplacement(id, expectedVersion, items);
    return { requestId: request.id, templateId: request.templateId, version: request.version, items: pricedItems,
      totals: { salesGoodsAmount: salesGoodsAmount.toFixed(2), supplyGoodsAmount: supplyGoodsAmount.toFixed(2) },
      funding: { canConfirm: funding.canConfirm, ...fundingDetail } };
  }

  async replaceStoreItems(id: string, expectedVersion: number, input: PurchaseRequestPreviewInput, transaction: Prisma.TransactionClient) {
    await lockPricePublication(transaction);
    await lockCatalog(transaction, true);
    const request = await transaction.purchaseRequest.findUniqueOrThrow({ where: { id } });
    if (request.procurementConfirmedAt || !['PENDING_PROCUREMENT', 'PENDING_FUNDS'].includes(request.status)) {
      throw new ConflictException({ code: 'PURCHASE_REQUEST_ITEMS_NOT_EDITABLE', message: '采购已确认，门店不能再修改该下货单' });
    }
    const preview = await this.previewService.preview(input, transaction);
    if (preview.templateId !== request.templateId) throw new ConflictException({ code: 'STORE_TEMPLATE_CHANGED', message: '门店订货模板已变更，请联系采购处理原下货单' });
    const prepared = await this.prepareReplacement(id, expectedVersion, preview.items.map(item => ({
      productId: item.productId, supplierId: item.supplierId, quantity: item.quantity,
    })), true);
    return this.saveReplacement(prepared.request, expectedVersion, prepared.pricedItems, prepared.salesGoodsAmount, prepared.supplyGoodsAmount, prepared.funding, transaction);
  }

  private async prepareReplacement(id: string, expectedVersion: number, items: ReplacePurchaseRequestItemInput[], storeEdit = false) {
    const request = await this.database.client.purchaseRequest.findUnique({
      where: { id },
      include: { supplierOrders: true, items: { select: { productId: true, quantity: true, unitSnapshot: true } } },
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

    if ((request.status !== PurchaseRequestStatus.PENDING_PROCUREMENT && request.status !== PurchaseRequestStatus.PENDING_FUNDS && request.status !== PurchaseRequestStatus.PENDING_FINANCE) || request.supplierOrders.length > 0) {
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
      include: { suppliers: { where: { supplier: { status: 'ACTIVE', isArchived: false } } } },
    });
    const enabledLinks = await this.database.client.supplierProduct.findMany({
      where: { supplyEnabled: true, productId: { in: templateItems.map(item => item.productId) }, supplierId: { in: templateItems.flatMap(item => item.suppliers.map(link => link.supplierId)) } },
      select: { productId: true, supplierId: true },
    });
    const enabledSupplierProducts = new Set(enabledLinks.map(link => `${link.productId}:${link.supplierId}`));
    const allowedSuppliersByProduct = new Map(
      templateItems.map((item) => [item.productId, new Set(item.suppliers.filter(supplier => enabledSupplierProducts.has(`${item.productId}:${supplier.supplierId}`)).map((supplier) => supplier.supplierId))]),
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

        const units = await this.database.client.$transaction(async tx => {
          await lockCatalog(tx, true);
          return readTransactionUnits(tx, item.productId, item.quantity, item.unitId, item.expectedProductVersion, request.templateId);
        });
        const quantity = new Decimal(units.quantity);
        if (quantity.lte(0)) {
          throw new ConflictException({
            code: 'INVALID_ITEM_QUANTITY',
            message: 'Purchase request item quantity must be greater than zero',
            details: { productId: item.productId },
          });
        }

        const originalItem = request.items.find(original => original.productId === item.productId);
        const originalSnapshot = readUnitSnapshot(originalItem?.unitSnapshot);
        const originalRequestedQuantity = new Decimal(originalSnapshot?.originalRequestedQuantity ?? originalItem?.quantity ?? quantity);
        if (!storeEdit && originalItem && quantity.gt(originalRequestedQuantity)) {
          throw new ConflictException({
            code: 'PURCHASE_REQUEST_QUANTITY_EXCEEDS_ORIGINAL',
            message: '采购调整数量不能超过门店原下单数量',
            details: {
              productId: item.productId,
              originalQuantity: originalRequestedQuantity.toString(),
              requestedQuantity: quantity.toString(),
            },
          });
        }

        const price = await this.pricingService.getEffectivePrice(item.productId, item.supplierId, new Date(), request.templateId);
        if ((item.expectedPriceVersionId !== undefined && item.expectedPriceVersionId !== price.versionId)
          || (item.expectedSupplyPriceVersionId !== undefined && item.expectedSupplyPriceVersionId !== price.supplyVersionId)) {
          throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Approved price changed; preview again' });
        }
        return {
          unitSnapshot: originalItem && !storeEdit ? {
            ...units.unitSnapshot,
            originalRequestedQuantity: originalRequestedQuantity.toString(),
            originalInputQuantity: originalSnapshot?.originalInputQuantity ?? originalSnapshot?.inputQuantity,
          } : units.unitSnapshot,
          productId: item.productId,
          supplierId: item.supplierId,
          priceVersionId: price.versionId,
          supplyPriceVersionId: price.supplyVersionId,
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
    const [account, allocations, terms] = await Promise.all([
      this.database.client.storeAccount.findUnique({ where: { storeId: request.storeId } }),
      this.database.client.fundingAllocation.findMany({ where: { requestId: request.id, active: true } }),
      resolveSettlementTerms(this.database.client, request.templateId, [...new Set(pricedItems.map(item => item.supplierId))], request.storeId),
    ]);
    const storedRequired = pricedItems.filter(item => terms.get(item.supplierId)?.mode === 'STORED_VALUE')
      .reduce((sum, item) => sum.plus(item.salesLineAmount), toMoney(0));
    const creditTargets = new Map<string, Decimal>();
    for (const item of pricedItems.filter(row => terms.get(row.supplierId)?.mode === 'CREDIT')) {
      creditTargets.set(item.supplierId, (creditTargets.get(item.supplierId) ?? toMoney(0)).plus(item.salesLineAmount));
    }
    const priorStored = allocations.filter(item => item.method === 'STORED_VALUE').reduce((sum, item) => sum.plus(item.netPaid), toMoney(0));
    const priorReserved = allocations.reduce((sum, item) => sum.plus(item.reservedAmount), toMoney(0));
    const priorCredit = allocations.reduce((sum, item) => sum.plus(item.creditOutstanding), toMoney(0));
    const storedAvailable = toMoney(account?.balance ?? 0).minus(account?.reservedBalance ?? 0).plus(priorStored).plus(priorReserved);
    const creditRequired = [...creditTargets].reduce((sum, [supplierId, target]) => {
      const paid = allocations.filter(item => item.method === 'CREDIT' && item.supplierId === supplierId).reduce((total, item) => total.plus(item.netPaid), toMoney(0));
      return sum.plus(Decimal.max(0, target.minus(paid)));
    }, toMoney(0));
    const creditAvailable = toMoney(account?.creditLimit ?? 0).minus(account?.creditUsed ?? 0).plus(priorCredit);
    const storedFunding = evaluateStoredValueFunding(storedAvailable, storedRequired);
    const creditShortfall = Decimal.max(0, creditRequired.minus(creditAvailable));
    const funding = { ...storedFunding, canConfirm: storedFunding.canConfirm && creditShortfall.isZero(),
      shortfallAmount: storedFunding.shortfallAmount.plus(creditShortfall) };
    const funds = (required: Decimal, available: Decimal) => ({ required: required.toFixed(2), available: available.toFixed(2), shortfall: Decimal.max(0, required.minus(available)).toFixed(2) });
    return { request, pricedItems, salesGoodsAmount, supplyGoodsAmount, funding,
      fundingDetail: { stored: funds(storedRequired, storedAvailable), credit: funds(creditRequired, creditAvailable) } };
  }

  private async saveReplacement(request: PurchaseRequest, expectedVersion: number,
    pricedItems: Awaited<ReturnType<PurchaseRequestsService['prepareReplacement']>>['pricedItems'],
    salesGoodsAmount: Decimal, supplyGoodsAmount: Decimal, funding: ReturnType<typeof evaluateStoredValueFunding>, transaction?: Prisma.TransactionClient) {
    const execute = async (tx: Prisma.TransactionClient) => {
      await lockPricePublication(tx);
      await lockCatalog(tx, true);
      for (const item of pricedItems) await requireTransactionUnitsUnchanged(tx, item.productId, item.unitSnapshot);
      for (const item of pricedItems) {
        const allowed = await tx.templateItem.findFirst({ where: { templateId: request.templateId, productId: item.productId, isEnabled: true,
          product: { isActive: true }, suppliers: { some: { supplierId: item.supplierId, supplier: { status: 'ACTIVE', isArchived: false } } } } });
        const enabled = await tx.supplierProduct.findUnique({ where: { supplierId_productId: { supplierId: item.supplierId, productId: item.productId } }, select: { supplyEnabled: true } });
        if (!allowed || !enabled?.supplyEnabled) throw new ConflictException({ code: 'SUPPLIER_NOT_ALLOWED_FOR_PRODUCT', message: 'Supplier eligibility changed; preview again' });
        const price = await effectivePriceVersion(tx, item.productId, item.supplierId, new Date(), request.templateId);
        if (price?.id !== item.priceVersionId || price?.supplyVersionId !== item.supplyPriceVersionId) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Effective price changed; preview again' });
      }
      await lockFundingRequest(tx, request.storeId, request.id);
      await requireRequestVersion(tx, request.id, expectedVersion);
      await tx.requestItem.deleteMany({ where: { requestId: request.id } });
      await tx.requestItem.createMany({
        data: pricedItems.map((item) => ({
          requestId: request.id,
          unitSnapshot: item.unitSnapshot,
          productId: item.productId,
          supplierId: item.supplierId,
          priceVersionId: item.priceVersionId,
          supplyPriceVersionId: item.supplyPriceVersionId,
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
      const actualFunding = await synchronizeRequestFunding(tx, request.id, { deferCreditShortfall: true });
      await tx.purchaseRequest.update({ where: { id: request.id }, data: { status: actualFunding.canConfirm ? PurchaseRequestStatus.PENDING_PROCUREMENT : PurchaseRequestStatus.PENDING_FUNDS } });

      return this.get(request.id, undefined, tx);
    };
    const updated = transaction ? await execute(transaction) : await this.database.client.$transaction(execute);

    return updated;
  }

  async reassignPreview(id: string, expectedVersion: number, itemIds: string[], supplierId: string): Promise<ReassignPurchaseRequestPreview> {
    const request = await this.loadEditableRequest(id, expectedVersion);
    const previewItems = await this.previewReassignment(request, itemIds, supplierId);
    return { requestId: request.id, supplierId, items: previewItems };
  }

  async assign(id: string, expectedVersion: number, itemIds: string[], supplierId: string,
    expectedPrices?: Array<{ requestItemId: string; priceVersionId: string; supplyPriceVersionId: string }>, transaction?: Prisma.TransactionClient): Promise<PurchaseRequestDetailView> {
    const request = await this.loadEditableRequest(id, expectedVersion);
    const previewItems = await this.previewReassignment(request, itemIds, supplierId);
    for (const expected of expectedPrices ?? []) {
      const price = previewItems.find(item => item.requestItemId === expected.requestItemId);
      if (price?.priceVersionId !== expected.priceVersionId || price?.supplyPriceVersionId !== expected.supplyPriceVersionId) {
        throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Approved assignment price changed; preview again' });
      }
    }
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
        supplyPriceVersionId: preview.supplyPriceVersionId,
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

    const execute = async (tx: Prisma.TransactionClient) => {
      await lockPricePublication(tx);
      await lockCatalog(tx, true);
      for (const preview of previewItems) {
        const allowed = await tx.templateItem.findFirst({ where: { templateId: request.templateId, productId: preview.productId!, isEnabled: true,
          product: { isActive: true }, suppliers: { some: { supplierId, supplier: { status: 'ACTIVE', isArchived: false } } } } });
        const enabled = await tx.supplierProduct.findUnique({ where: { supplierId_productId: { supplierId, productId: preview.productId! } }, select: { supplyEnabled: true } });
        if (!allowed || !enabled?.supplyEnabled) throw new ConflictException({ code: 'REASSIGNMENT_NOT_ELIGIBLE', message: 'Supplier eligibility changed; preview again' });
        const price = await effectivePriceVersion(tx, preview.productId!, supplierId, new Date(), request.templateId);
        if (price?.id !== preview.priceVersionId || price?.supplyVersionId !== preview.supplyPriceVersionId) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Effective price changed; preview again' });
      }
      await lockFundingRequest(tx, request.storeId, request.id);
      await requireRequestVersion(tx, request.id, expectedVersion);
      for (const preview of previewItems) {
        await tx.requestItem.update({
          where: { id: preview.requestItemId },
          data: {
            supplierId,
            settlementModeSnapshot: null,
            settlementCycleSnapshot: null,
            priceVersionId: preview.priceVersionId,
            supplyPriceVersionId: preview.supplyPriceVersionId,
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

      const actualFunding = await synchronizeRequestFunding(tx, request.id, { deferCreditShortfall: true });
      await tx.purchaseRequest.update({ where: { id: request.id }, data: { status: actualFunding.canConfirm ? PurchaseRequestStatus.PENDING_PROCUREMENT : PurchaseRequestStatus.PENDING_FUNDS } });

      return this.get(request.id, undefined, tx);
    };
    const updated = transaction ? await execute(transaction) : await this.database.client.$transaction(execute);

    return updated;
  }

  async reallocate(
    id: string,
    expectedVersion: number,
    rejectedOrderId: string,
    assignments: ReallocatePurchaseRequestAssignmentInput[],
    transaction?: Prisma.TransactionClient,
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
      include: { suppliers: { where: { supplier: { status: 'ACTIVE', isArchived: false } } } },
    });
    const enabledLinks = await this.database.client.supplierProduct.findMany({
      where: { supplyEnabled: true, productId: { in: templateItems.map(item => item.productId) }, supplierId: { in: templateItems.flatMap(item => item.suppliers.map(link => link.supplierId)) } },
      select: { productId: true, supplierId: true },
    });
    const enabledSupplierProducts = new Set(enabledLinks.map(link => `${link.productId}:${link.supplierId}`));
    const allowedSuppliersByProduct = new Map(
      templateItems.map((item) => [item.productId, new Set(item.suppliers.filter(supplier => enabledSupplierProducts.has(`${item.productId}:${supplier.supplierId}`)).map((supplier) => supplier.supplierId))]),
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

        const price = await this.pricingService.getEffectivePrice(item.productId, assignment.supplierId, new Date(), request.templateId);
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
          supplyPriceVersionId: priced.price.supplyVersionId,
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
    const reassignmentSupplierIds = [...new Set(pricedAssignments.filter((item) => !item.assignment.cancel).map((item) => item.assignment.supplierId!))];
    const reassignmentSuppliers = await this.database.client.supplier.findMany({ where: { id: { in: reassignmentSupplierIds } } });
    const reassignmentSuppliersById = new Map(reassignmentSuppliers.map((supplier) => [supplier.id, supplier]));

    const execute = async (tx: Prisma.TransactionClient) => {
      await lockPricePublication(tx);
      await lockCatalog(tx, true);
      for (const priced of pricedAssignments) {
        if (!priced.price || !priced.assignment.supplierId) continue;
        const price = await effectivePriceVersion(tx, priced.item.productId, priced.assignment.supplierId, new Date(), request.templateId);
        if (price?.id !== priced.price.versionId || price?.supplyVersionId !== priced.price.supplyVersionId) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Effective price changed; preview again' });
      }
      await lockFundingRequest(tx, request.storeId, request.id);
      await requireRequestVersion(tx, request.id, expectedVersion);
      for (const priced of pricedAssignments) {
        if (!priced.assignment.cancel && priced.assignment.supplierId) {
          await tx.$queryRaw`SELECT "id" FROM "Supplier" WHERE "id" = ${priced.assignment.supplierId}::uuid FOR SHARE`;
          const allowed = await tx.templateItem.findFirst({ where: { templateId: request.templateId, productId: priced.item.productId, isEnabled: true,
            product: { isActive: true }, suppliers: { some: { supplierId: priced.assignment.supplierId, supplier: { status: 'ACTIVE', isArchived: false } } } } });
          const enabled = await tx.supplierProduct.findUnique({ where: { supplierId_productId: { supplierId: priced.assignment.supplierId, productId: priced.item.productId } }, select: { supplyEnabled: true } });
          if (!allowed || !enabled?.supplyEnabled) throw new ConflictException({ code: 'SUPPLIER_NOT_ALLOWED_FOR_PRODUCT', message: 'Supplier eligibility changed; reload the rejected order' });
          const target = await tx.supplierOrder.findFirst({ where: { requestId: request.id, supplierId: priced.assignment.supplierId,
            status: { not: SupplierOrderStatus.REJECTED }, firstShippedAt: { not: null } } });
          if (target) throw new ConflictException({ code: 'TARGET_SUPPLIER_ALREADY_SHIPPED', message: 'Target supplier order has already shipped' });
        }
        if (priced.assignment.cancel) {
          await tx.requestItem.delete({ where: { id: priced.item.id } });
          continue;
        }

        await tx.requestItem.update({
          where: { id: priced.item.id },
          data: {
            supplierId: priced.assignment.supplierId!,
            settlementModeSnapshot: null,
            settlementCycleSnapshot: null,
            priceVersionId: priced.price!.versionId,
            supplyPriceVersionId: priced.price!.supplyVersionId,
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
              requiresFreightSnapshot: reassignmentSuppliersById.get(priced.assignment.supplierId!)!.requiresFreight,
              settlementMode: reassignmentSuppliersById.get(priced.assignment.supplierId!)!.defaultSettlementMode,
              settlementCycleSnapshot: (await resolveSettlementTerms(tx, request.templateId, [priced.assignment.supplierId!], request.storeId)).get(priced.assignment.supplierId!)!.cycle,
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
            ...(priced.item.unitSnapshot ? { unitSnapshot: priced.item.unitSnapshot as never } : {}),
            salesPriceVersionId: priced.price!.versionId, supplyPriceVersionId: priced.price!.supplyVersionId,
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
          status: replacementItems.length === 0 ? PurchaseRequestStatus.CANCELED
            : funding.canConfirm ? PurchaseRequestStatus.CONFIRMED : PurchaseRequestStatus.PENDING_FUNDS,
          paymentStatus: funding.canConfirm ? PaymentStatus.PAID : PaymentStatus.UNPAID,
          salesGoodsAmount: salesGoodsAmount.toFixed(2),
          supplyGoodsAmount: supplyGoodsAmount.toFixed(2),
          paidAmount: funding.paidAmount.toFixed(2),
          shortfallAmount: funding.shortfallAmount.toFixed(2),
          version: { increment: 1 },
        },
      });

      const actualFunding = await synchronizeRequestFunding(tx, request.id);
      await tx.purchaseRequest.update({ where: { id: request.id }, data: { status: replacementItems.length === 0 ? PurchaseRequestStatus.CANCELED
        : actualFunding.canConfirm ? PurchaseRequestStatus.CONFIRMED : PurchaseRequestStatus.PENDING_FUNDS } });

      return this.get(request.id, undefined, tx);
    };
    const updated = transaction ? await execute(transaction) : await this.database.client.$transaction(execute);

    return updated;
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

    if ((request.status !== PurchaseRequestStatus.PENDING_PROCUREMENT && request.status !== PurchaseRequestStatus.PENDING_FUNDS && request.status !== PurchaseRequestStatus.PENDING_FINANCE) || request.supplierOrders.length > 0) {
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
    const target = await this.database.client.supplier.findUnique({ where: { id: supplierId }, select: { status: true, isArchived: true } });
    if (!target || target.status !== 'ACTIVE' || target.isArchived) {
      return itemIds.map(itemId => { const item = itemsById.get(itemId); return toIneligibleReassignment(itemId, item?.productId ?? null, item?.supplierId ?? null, supplierId, 'SUPPLIER_NOT_ACTIVE'); });
    }
    const templateItems = await this.database.client.templateItem.findMany({
      where: {
        templateId: request.templateId,
        isEnabled: true,
        product: { isActive: true },
      },
      include: { suppliers: true },
    });
    const enabledLinks = await this.database.client.supplierProduct.findMany({
      where: { supplyEnabled: true, productId: { in: templateItems.map(item => item.productId) }, supplierId: { in: templateItems.flatMap(item => item.suppliers.map(link => link.supplierId)) } },
      select: { productId: true, supplierId: true },
    });
    const enabledSupplierProducts = new Set(enabledLinks.map(link => `${link.productId}:${link.supplierId}`));
    const allowedSuppliersByProduct = new Map(
      templateItems.map((item) => [item.productId, new Set(item.suppliers.filter(supplier => enabledSupplierProducts.has(`${item.productId}:${supplier.supplierId}`)).map((supplier) => supplier.supplierId))]),
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
          const price = await this.pricingService.getEffectivePrice(item.productId, supplierId, new Date(), request.templateId);
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
            supplyPriceVersionId: price.supplyVersionId,
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

  async confirmAdjusted(id: string, expectedVersion: number, items: ReplacePurchaseRequestItemInput[], transaction?: Prisma.TransactionClient): Promise<ConfirmPurchaseRequestResult> {
    const prepared = await this.prepareReplacement(id, expectedVersion, items);
    const execute = async (tx: Prisma.TransactionClient) => {
      const saved = await this.saveReplacement(prepared.request, expectedVersion, prepared.pricedItems,
        prepared.salesGoodsAmount, prepared.supplyGoodsAmount, prepared.funding, tx);
      return this.confirm(id, saved.version, tx);
    };
    return transaction ? execute(transaction) : this.database.client.$transaction(execute);
  }

  async confirm(id: string, expectedVersion: number, transaction?: Prisma.TransactionClient): Promise<ConfirmPurchaseRequestResult> {
    return this.generateOrders(id, expectedVersion, transaction);
  }
  async returnFinance(id: string, expectedVersion: number, reason: string, transaction: Prisma.TransactionClient): Promise<ConfirmPurchaseRequestResult> {
    throw new ConflictException({ code: 'PROCUREMENT_CONFIRMATION_REQUIRED', message: '独立财务审核已取消，请由采购处理下货单' });
  }

  async financeReview(id: string, scope?: BusinessScope) {
    const detail = await this.get(id, scope);
    const [account, allocations, items] = await Promise.all([
      this.database.client.storeAccount.findUnique({ where: { storeId: detail.storeId } }),
      this.database.client.fundingAllocation.findMany({ where: { requestId: id, active: true } }),
      this.database.client.requestItem.findMany({ where: { requestId: id }, include: { supplier: true } }),
    ]);
    const terms = await resolveSettlementTerms(this.database.client, detail.templateId, [...new Set(items.map(item => item.supplierId))], detail.storeId);
    const groups = new Map<string, { supplierId: string; supplierName: string; mode: string; cycle: string; amount: Decimal }>();
    for (const item of items) {
      const term = terms.get(item.supplierId)!;
      const group = groups.get(item.supplierId) ?? { supplierId: item.supplierId, supplierName: item.supplier.name,
        mode: item.settlementModeSnapshot ?? term.mode, cycle: item.settlementCycleSnapshot ?? term.cycle, amount: new Decimal(0) };
      group.amount = group.amount.plus(item.salesLineAmount);
      groups.set(item.supplierId, group);
    }
    const total = (mode: string) => [...groups.values()].filter(group => group.mode === mode).reduce((sum, group) => sum.plus(group.amount), new Decimal(0));
    const ownStored = allocations.filter(row => row.method === 'STORED_VALUE').reduce((sum, row) => sum.plus(row.netPaid).plus(row.reservedAmount), new Decimal(0));
    const ownCredit = allocations.filter(row => row.method === 'CREDIT').reduce((sum, row) => sum.plus(row.creditOutstanding).plus(row.netPaid), new Decimal(0));
    const amountView = (required: Decimal, available: Decimal) => ({ required: required.toFixed(2), available: available.toFixed(2), shortfall: Decimal.max(0, required.minus(available)).toFixed(2) });
    const stored = amountView(total('STORED_VALUE'), new Decimal(account?.balance ?? 0).minus(account?.reservedBalance ?? 0).plus(ownStored));
    const credit = amountView(total('CREDIT'), new Decimal(account?.creditLimit ?? 0).minus(account?.creditUsed ?? 0).plus(ownCredit));
    return { ...detail, funding: { stored, credit, canConfirm: stored.shortfall === '0.00' && credit.shortfall === '0.00' },
      settlementGroups: [...groups.values()].map(group => ({ ...group, amount: group.amount.toFixed(2) })) };
  }

  async approveFinance(id: string, expectedVersion: number, transaction?: Prisma.TransactionClient): Promise<ConfirmPurchaseRequestResult> {
    throw new ConflictException({ code: 'PROCUREMENT_CONFIRMATION_REQUIRED', message: '已改为采购确认生成订单，请由采购处理下货单' });
  }

  private async generateOrders(id: string, expectedVersion: number, transaction?: Prisma.TransactionClient): Promise<ConfirmPurchaseRequestResult> {
    const client = transaction ?? (this.database.client as Prisma.TransactionClient);
    const request = await client.purchaseRequest.findUnique({
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

    if (!['PENDING_PROCUREMENT', 'PENDING_FUNDS', 'PENDING_FINANCE'].includes(request.status) || request.supplierOrders.length > 0) {
      throw new ConflictException({
        code: 'PURCHASE_REQUEST_NOT_CONFIRMABLE',
        message: 'Purchase request cannot be confirmed in its current status',
        details: { status: request.status },
      });
    }

    const effectiveItems = request.items;
    const supplierGroups = new Map<string, Array<(typeof effectiveItems)[number]>>();
    for (const item of effectiveItems) {
      const group = supplierGroups.get(item.supplierId) ?? [];
      group.push(item);
      supplierGroups.set(item.supplierId, group);
    }
    const suppliers = await client.supplier.findMany({ where: { id: { in: [...supplierGroups.keys()] } } });
    const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

    const execute = async (tx: Prisma.TransactionClient) => {
      await lockCatalog(tx, true);
      for (const item of effectiveItems) {
        const available = await tx.supplierProduct.findFirst({ where: { supplierId: item.supplierId, productId: item.productId,
          supplyEnabled: true, product: { isActive: true }, supplier: { status: 'ACTIVE', isArchived: false } } });
        if (!available) throw new ConflictException({ code: 'SUPPLIER_NOT_ALLOWED_FOR_PRODUCT', message: '商品或供应商已停用，请退回采购调整' });
      }
      await lockFundingRequest(tx, request.storeId, request.id);
      await requireRequestVersion(tx, request.id, expectedVersion);
      await synchronizeRequestFunding(tx, request.id, { requireFull: true });
      const snapshotItems = await tx.requestItem.findMany({ where: { requestId: request.id } });
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
            settlementMode: snapshotItems.find(item => item.supplierId === supplierId)?.settlementModeSnapshot ?? suppliersById.get(supplierId)!.defaultSettlementMode,
            requiresFreightSnapshot: suppliersById.get(supplierId)!.requiresFreight,
            settlementCycleSnapshot: snapshotItems.find(item => item.supplierId === supplierId)?.settlementCycleSnapshot ?? (await resolveSettlementTerms(tx, request.templateId, [supplierId], request.storeId)).get(supplierId)!.cycle,
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
            ...(item.unitSnapshot ? { unitSnapshot: item.unitSnapshot as never } : {}),
            salesPriceVersionId: item.priceVersionId, supplyPriceVersionId: item.supplyPriceVersionId,
            productId: item.productId,
            quantity: item.quantity,
            salesUnitPrice: item.salesUnitPrice,
            supplyUnitPrice: item.supplyUnitPrice,
            salesLineAmount: item.salesLineAmount,
            supplyLineAmount: item.supplyLineAmount,
          })),
        });

        createdOrderIds.push(supplierOrder.id);
        await tx.fundingAllocation.updateMany({ where: { requestId: request.id, supplierId, active: true }, data: { supplierOrderId: supplierOrder.id } });
      }

      await tx.purchaseRequest.update({
        where: { id: request.id },
        data: {
          status: PurchaseRequestStatus.CONFIRMED,
          confirmedAt: new Date(),
          procurementConfirmedAt: new Date(),
          financeReturnedReason: null,
          version: { increment: 1 },
        },
      });

      return createdOrderIds;
    };
    const supplierOrderIds = transaction ? await execute(transaction) : await this.database.client.$transaction(execute);

    return {
      requestId: request.id,
      status: PurchaseRequestStatus.CONFIRMED,
      supplierOrderIds: supplierOrderIds.sort(),
    };
  }

  async reject(id: string, expectedVersion: number, reason: string, transaction?: Prisma.TransactionClient): Promise<RejectPurchaseRequestResult> {
    const request = await (transaction ?? (this.database.client as Prisma.TransactionClient)).purchaseRequest.findUnique({ where: { id } });
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

    if (request.status !== PurchaseRequestStatus.PENDING_PROCUREMENT && request.status !== PurchaseRequestStatus.PENDING_FUNDS && request.status !== PurchaseRequestStatus.PENDING_FINANCE) {
      throw new ConflictException({
        code: 'PURCHASE_REQUEST_NOT_REJECTABLE',
        message: 'Purchase request cannot be rejected in its current status',
        details: { status: request.status },
      });
    }

    const execute = async (tx: Prisma.TransactionClient) => {
      await lockFundingRequest(tx, request.storeId, request.id);
      await requireRequestVersion(tx, request.id, expectedVersion);
      const rejected = await tx.purchaseRequest.update({
      where: { id: request.id },
      data: {
        status: PurchaseRequestStatus.CANCELED,
        rejectedAt: new Date(),
        rejectedReason: reason,
        version: { increment: 1 },
      },
      });
      await synchronizeRequestFunding(tx, request.id);
      return rejected;
    };
    const rejected = transaction ? await execute(transaction) : await this.database.client.$transaction(execute);

    return {
      requestId: rejected.id,
      status: rejected.status,
      version: rejected.version,
      rejectedAt: rejected.rejectedAt?.toISOString() ?? null,
    };
  }
}

function isStoreScope(type?: string): boolean {
  return type === 'STORE' || type === 'STORE_FINANCE';
}

function toPurchaseRequestSummaryView(request: PurchaseRequest): PurchaseRequestSummaryView {
  return {
    procurementConfirmedAt: request.procurementConfirmedAt?.toISOString() ?? null,
    financeReviewedAt: request.financeReviewedAt?.toISOString() ?? null,
    financeReturnedReason: request.financeReturnedReason ?? null,
    storedValueOnReceipt: request.storedValueOnReceipt,
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
    ...transactionUnitView(item.unitSnapshot, item.salesUnitPrice.toString(), item.supplyUnitPrice.toString()),
    id: item.id,
    productId: item.productId,
    supplierId: item.supplierId,
    priceVersionId: item.priceVersionId,
    supplyPriceVersionId: item.supplyPriceVersionId,
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
    supplyPriceVersionId: null,
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
