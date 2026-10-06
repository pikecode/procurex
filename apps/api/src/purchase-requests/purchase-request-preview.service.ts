import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { evaluateStoredValueFunding } from '../../../../packages/domain/src/funding.js';
import { lineAmount, toMoney } from '../../../../packages/domain/src/money.js';
import { lockCatalog } from '../catalog/catalog-registries.service.js';
import { readTransactionUnits, transactionUnitView, type TransactionUnitSnapshot } from '../catalog/transaction-units.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { DatabaseService } from '../database/database.service.js';
import { resolveSettlementTerms } from './request-funding.js';
import type { Prisma } from '../../../../packages/backend/generated/prisma/client.js';

export type PreviewItemInput = {
  expectedPriceVersionId?: string;
  expectedSupplyPriceVersionId?: string;
  expectedProductVersion?: number;
  unitId?: string;
  productId: string;
  quantity: string;
};

export type PurchaseRequestPreviewInput = {
  expectedTemplateId?: string;
  storeId: string;
  items: PreviewItemInput[];
};

export type PurchaseRequestPreview = {
  storeId: string;
  templateId: string;
  items: Array<{
    unitSnapshot: TransactionUnitSnapshot;
    productId: string;
    supplierId: string;
    quantity: string;
    salesUnitPrice: string;
    supplyUnitPrice: string;
    salesLineAmount: string;
    supplyLineAmount: string;
    priceVersionId: string;
    supplyPriceVersionId: string;
  }>;
  totals: {
    salesGoodsAmount: string;
    supplyGoodsAmount: string;
  };
  funding: {
    stored: {
      required: string;
      paid: string;
      reserved?: string;
      available: string;
      shortfall: string;
    };
    canConfirm: boolean;
    credit?: { required: string; available: string; shortfall: string };
  };
};

@Injectable()
export class PurchaseRequestPreviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly catalogService: CatalogService,
  ) {}

  async preview(input: PurchaseRequestPreviewInput, transaction?: Prisma.TransactionClient): Promise<PurchaseRequestPreview> {
    const client = transaction ?? (this.database.client as Prisma.TransactionClient);
    const catalog = await this.catalogService.readStoreCatalog(input.storeId, new Date(), transaction);
    if (input.expectedTemplateId !== undefined && input.expectedTemplateId.toLowerCase() !== catalog.templateId.toLowerCase()) {
      throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Store template changed; preview again' });
    }
    const catalogItems = new Map(catalog.items.map((item) => [item.product.id, item]));

    const readUnits = async (tx: Prisma.TransactionClient) => {
      await lockCatalog(tx, true);
      return Promise.all(input.items.map(item => readTransactionUnits(tx, item.productId, item.quantity, item.unitId, item.expectedProductVersion, catalog.templateId)));
    };
    const units = transaction ? await readUnits(transaction) : await this.database.client.$transaction(readUnits);
    const items = input.items.map((inputItem, index) => {
      const catalogItem = catalogItems.get(inputItem.productId);
      if (!catalogItem) {
        throw new NotFoundException({
          code: 'PRODUCT_NOT_IN_CATALOG',
          message: 'Product is not available in the store catalog',
          details: { productId: inputItem.productId },
        });
      }

      const supplier = catalogItem.suppliers[0];
      if (!supplier || !supplier.salesPrice || !supplier.supplyPrice || !supplier.priceVersionId) {
        throw new ConflictException({
          code: 'PRICE_NOT_AVAILABLE',
          message: 'Product does not have an effective supplier price',
          details: { productId: inputItem.productId },
        });
      }

      const quantity = new Decimal(units[index]!.quantity);
      if ((inputItem.expectedPriceVersionId !== undefined && inputItem.expectedPriceVersionId !== supplier.priceVersionId)
        || (inputItem.expectedSupplyPriceVersionId !== undefined && inputItem.expectedSupplyPriceVersionId !== supplier.supplyPriceVersionId)) {
        throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Approved price changed; preview again' });
      }
      return {
        ...transactionUnitView(units[index]!.unitSnapshot, supplier.salesPrice, supplier.supplyPrice),
        unitSnapshot: units[index]!.unitSnapshot,
        productId: inputItem.productId,
        supplierId: supplier.supplierId,
        quantity: quantity.toString(),
        salesUnitPrice: new Decimal(supplier.salesPrice).toString(),
        supplyUnitPrice: new Decimal(supplier.supplyPrice).toString(),
        salesLineAmount: lineAmount(quantity, supplier.salesPrice).toFixed(2),
        supplyLineAmount: lineAmount(quantity, supplier.supplyPrice).toFixed(2),
        priceVersionId: supplier.priceVersionId,
        supplyPriceVersionId: supplier.supplyPriceVersionId!,
      };
    });

    const salesGoodsAmount = items.reduce((sum, item) => sum.plus(item.salesLineAmount), toMoney(0));
    const supplyGoodsAmount = items.reduce((sum, item) => sum.plus(item.supplyLineAmount), toMoney(0));
    const account = await client.storeAccount.findUnique({ where: { storeId: input.storeId } });
    const available = toMoney(account?.balance ?? 0).minus(account?.reservedBalance ?? 0);
    const terms = await resolveSettlementTerms(client, catalog.templateId, [...new Set(items.map(item => item.supplierId))]);
    const storedRequired = items.filter(item => terms.get(item.supplierId)?.mode === 'STORED_VALUE').reduce((sum, item) => sum.plus(item.salesLineAmount), toMoney(0));
    const creditRequired = items.filter(item => terms.get(item.supplierId)?.mode === 'CREDIT').reduce((sum, item) => sum.plus(item.salesLineAmount), toMoney(0));
    const creditAvailable = toMoney(account?.creditLimit ?? 0).minus(account?.creditUsed ?? 0);
    const creditShortfall = Decimal.max(0, creditRequired.minus(creditAvailable));
    const funding = evaluateStoredValueFunding(available, storedRequired);

    return {
      storeId: input.storeId,
      templateId: catalog.templateId,
      items,
      totals: {
        salesGoodsAmount: salesGoodsAmount.toFixed(2),
        supplyGoodsAmount: supplyGoodsAmount.toFixed(2),
      },
      funding: {
        stored: {
          required: storedRequired.toFixed(2),
          paid: '0.00',
          available: available.toFixed(2),
          shortfall: funding.shortfallAmount.toFixed(2),
        },
        canConfirm: funding.canConfirm && creditShortfall.isZero(),
        ...(creditRequired.isZero() ? {} : { credit: { required: creditRequired.toFixed(2), available: creditAvailable.toFixed(2), shortfall: creditShortfall.toFixed(2) } }),
      },
    };
  }
}
