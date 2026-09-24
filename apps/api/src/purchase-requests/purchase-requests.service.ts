import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PaymentStatus, PurchaseRequestStatus } from '../../../../packages/backend/generated/prisma/enums.js';
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

@Injectable()
export class PurchaseRequestsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly previewService: PurchaseRequestPreviewService,
  ) {}

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
