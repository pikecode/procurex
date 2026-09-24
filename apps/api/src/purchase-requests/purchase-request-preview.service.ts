import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { evaluateStoredValueFunding } from '../../../../packages/domain/src/funding.js';
import { lineAmount, toMoney, toQuantity } from '../../../../packages/domain/src/money.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { DatabaseService } from '../database/database.service.js';

export type PreviewItemInput = {
  productId: string;
  quantity: string;
};

export type PurchaseRequestPreviewInput = {
  storeId: string;
  items: PreviewItemInput[];
};

export type PurchaseRequestPreview = {
  storeId: string;
  items: Array<{
    productId: string;
    supplierId: string;
    quantity: string;
    salesUnitPrice: string;
    supplyUnitPrice: string;
    salesLineAmount: string;
    supplyLineAmount: string;
    priceVersionId: string;
  }>;
  totals: {
    salesGoodsAmount: string;
    supplyGoodsAmount: string;
  };
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

@Injectable()
export class PurchaseRequestPreviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly catalogService: CatalogService,
  ) {}

  async preview(input: PurchaseRequestPreviewInput): Promise<PurchaseRequestPreview> {
    const catalog = await this.catalogService.readStoreCatalog(input.storeId);
    const catalogItems = new Map(catalog.items.map((item) => [item.product.id, item]));

    const items = input.items.map((inputItem) => {
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

      const quantity = toQuantity(inputItem.quantity);
      return {
        productId: inputItem.productId,
        supplierId: supplier.supplierId,
        quantity: quantity.toString(),
        salesUnitPrice: new Decimal(supplier.salesPrice).toString(),
        supplyUnitPrice: new Decimal(supplier.supplyPrice).toString(),
        salesLineAmount: lineAmount(quantity, supplier.salesPrice).toFixed(2),
        supplyLineAmount: lineAmount(quantity, supplier.supplyPrice).toFixed(2),
        priceVersionId: supplier.priceVersionId,
      };
    });

    const salesGoodsAmount = items.reduce((sum, item) => sum.plus(item.salesLineAmount), toMoney(0));
    const supplyGoodsAmount = items.reduce((sum, item) => sum.plus(item.supplyLineAmount), toMoney(0));
    const account = await this.database.client.storeAccount.findUnique({ where: { storeId: input.storeId } });
    const available = toMoney(account?.balance ?? 0);
    const funding = evaluateStoredValueFunding(available, salesGoodsAmount);

    return {
      storeId: input.storeId,
      items,
      totals: {
        salesGoodsAmount: salesGoodsAmount.toFixed(2),
        supplyGoodsAmount: supplyGoodsAmount.toFixed(2),
      },
      funding: {
        stored: {
          required: salesGoodsAmount.toFixed(2),
          paid: funding.paidAmount.toFixed(2),
          available: available.toFixed(2),
          shortfall: funding.shortfallAmount.toFixed(2),
        },
        canConfirm: funding.canConfirm,
      },
    };
  }
}
