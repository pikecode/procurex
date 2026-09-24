import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

export type PriceQuote = {
  scopeId: string;
  versionId: string;
  productId: string;
  supplierId: string;
  salesPrice: string;
  supplyPrice: string;
  effectiveAt: string;
};

export type PublishPriceInput = {
  productId: string;
  supplierId: string;
  salesPrice: string;
  supplyPrice: string;
  effectiveAt: Date;
};

@Injectable()
export class PricingService {
  constructor(private readonly database: DatabaseService) {}

  async publishPrice(input: PublishPriceInput): Promise<PriceQuote> {
    const scope = await this.database.client.priceScope.upsert({
      where: { productId_supplierId: { productId: input.productId, supplierId: input.supplierId } },
      update: {},
      create: {
        productId: input.productId,
        supplierId: input.supplierId,
      },
    });

    const version = await this.database.client.priceVersion.create({
      data: {
        scopeId: scope.id,
        salesPrice: input.salesPrice,
        supplyPrice: input.supplyPrice,
        effectiveAt: input.effectiveAt,
      },
    });

    return {
      scopeId: scope.id,
      versionId: version.id,
      productId: scope.productId,
      supplierId: scope.supplierId,
      salesPrice: version.salesPrice.toString(),
      supplyPrice: version.supplyPrice.toString(),
      effectiveAt: version.effectiveAt.toISOString(),
    };
  }

  async getEffectivePrice(productId: string, supplierId: string, at: Date): Promise<PriceQuote> {
    const scope = await this.database.client.priceScope.findUnique({
      where: { productId_supplierId: { productId, supplierId } },
    });

    if (!scope) {
      throw new NotFoundException({
        code: 'PRICE_SCOPE_NOT_FOUND',
        message: 'Price scope was not found',
      });
    }

    const version = await this.database.client.priceVersion.findFirst({
      where: {
        scopeId: scope.id,
        effectiveAt: { lte: at },
      },
      orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });

    if (!version) {
      throw new NotFoundException({
        code: 'PRICE_VERSION_NOT_FOUND',
        message: 'No effective price was found',
      });
    }

    return {
      scopeId: scope.id,
      versionId: version.id,
      productId: scope.productId,
      supplierId: scope.supplierId,
      salesPrice: version.salesPrice.toString(),
      supplyPrice: version.supplyPrice.toString(),
      effectiveAt: version.effectiveAt.toISOString(),
    };
  }

  async listVersions(scopeId: string): Promise<PriceQuote[]> {
    const scope = await this.database.client.priceScope.findUnique({ where: { id: scopeId } });
    if (!scope) {
      throw new NotFoundException({
        code: 'PRICE_SCOPE_NOT_FOUND',
        message: 'Price scope was not found',
      });
    }

    const versions = await this.database.client.priceVersion.findMany({
      where: { scopeId },
      orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });

    return versions.map((version) => ({
      scopeId: scope.id,
      versionId: version.id,
      productId: scope.productId,
      supplierId: scope.supplierId,
      salesPrice: version.salesPrice.toString(),
      supplyPrice: version.supplyPrice.toString(),
      effectiveAt: version.effectiveAt.toISOString(),
    }));
  }
}
