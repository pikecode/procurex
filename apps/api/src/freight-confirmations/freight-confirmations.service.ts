import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FreightConfirmationStatus,
  SupplierOrderStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type { FreightConfirmation } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type CreateFreightConfirmationInput = {
  expectedVersion: number;
  amount: string;
  reason: string;
};

export type ReviewFreightConfirmationInput = {
  expectedVersion: number;
  reason?: string;
};

export type FreightConfirmationView = {
  id: string;
  supplierOrderId: string;
  amount: string;
  reason: string;
  status: FreightConfirmationStatus;
  version: number;
  confirmedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
};

@Injectable()
export class FreightConfirmationsService {
  constructor(private readonly database: DatabaseService) {}

  async createForSupplierOrder(supplierOrderId: string, input: CreateFreightConfirmationInput): Promise<FreightConfirmationView> {
    const order = await this.database.client.supplierOrder.findUnique({ where: { id: supplierOrderId } });
    if (!order) {
      throw new NotFoundException({
        code: 'SUPPLIER_ORDER_NOT_FOUND',
        message: 'Supplier order was not found',
      });
    }

    if (order.version !== input.expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Supplier order version has changed',
        details: { expectedVersion: input.expectedVersion, currentVersion: order.version },
      });
    }

    if (order.status === SupplierOrderStatus.REJECTED || order.status === SupplierOrderStatus.CANCELED) {
      throw new ConflictException({
        code: 'SUPPLIER_ORDER_NOT_FREIGHT_CONFIRMABLE',
        message: 'Supplier order cannot request freight confirmation in its current status',
        details: { status: order.status },
      });
    }

    const created = await this.database.client.freightConfirmation.create({
      data: {
        supplierOrderId: order.id,
        amount: input.amount,
        reason: input.reason,
      },
    });

    return toFreightConfirmationView(created);
  }

  async confirm(id: string, input: ReviewFreightConfirmationInput): Promise<FreightConfirmationView> {
    return this.review(id, input, FreightConfirmationStatus.CONFIRMED);
  }

  async reject(id: string, input: ReviewFreightConfirmationInput): Promise<FreightConfirmationView> {
    return this.review(id, input, FreightConfirmationStatus.REJECTED);
  }

  private async review(
    id: string,
    input: ReviewFreightConfirmationInput,
    status: FreightConfirmationStatus,
  ): Promise<FreightConfirmationView> {
    const confirmation = await this.database.client.freightConfirmation.findUnique({ where: { id } });
    if (!confirmation) {
      throw new NotFoundException({
        code: 'FREIGHT_CONFIRMATION_NOT_FOUND',
        message: 'Freight confirmation was not found',
      });
    }

    if (confirmation.version !== input.expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Freight confirmation version has changed',
        details: { expectedVersion: input.expectedVersion, currentVersion: confirmation.version },
      });
    }

    if (confirmation.status === status) {
      return toFreightConfirmationView(confirmation);
    }

    if (confirmation.status !== FreightConfirmationStatus.PENDING) {
      throw new ConflictException({
        code: 'FREIGHT_CONFIRMATION_NOT_REVIEWABLE',
        message: 'Freight confirmation cannot be reviewed in its current status',
        details: { status: confirmation.status },
      });
    }

    const reviewed = await this.database.client.freightConfirmation.update({
      where: { id: confirmation.id },
      data: {
        status,
        confirmedAt: status === FreightConfirmationStatus.CONFIRMED ? new Date() : undefined,
        rejectedAt: status === FreightConfirmationStatus.REJECTED ? new Date() : undefined,
        version: { increment: 1 },
      },
    });

    return toFreightConfirmationView(reviewed);
  }
}

function toFreightConfirmationView(confirmation: FreightConfirmation): FreightConfirmationView {
  return {
    id: confirmation.id,
    supplierOrderId: confirmation.supplierOrderId,
    amount: confirmation.amount.toFixed(2),
    reason: confirmation.reason,
    status: confirmation.status,
    version: confirmation.version,
    confirmedAt: confirmation.confirmedAt?.toISOString() ?? null,
    rejectedAt: confirmation.rejectedAt?.toISOString() ?? null,
    createdAt: confirmation.createdAt.toISOString(),
  };
}
