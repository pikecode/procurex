import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FreightConfirmationStatus,
  SupplierOrderStatus,
} from '../../../../packages/backend/generated/prisma/enums.js';
import type { FreightConfirmation, Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import { Decimal } from 'decimal.js';
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
  usedAt: string | null;
  createdAt: string;
  supplierOrderNo?: string;
  supplierName?: string;
  storeName?: string;
};

@Injectable()
export class FreightConfirmationsService {
  constructor(private readonly database: DatabaseService) {}

  async list(input: { supplierOrderId?: string; status?: FreightConfirmationStatus }, scope?: { type: string; supplierId?: string }): Promise<FreightConfirmationView[]> {
    const confirmations = await this.database.client.freightConfirmation.findMany({
      where: { supplierOrderId: input.supplierOrderId, status: input.status,
        supplierOrder: scope?.type === 'SUPPLIER' ? { supplierId: scope.supplierId } : undefined },
      include: { supplierOrder: { select: { supplierOrderNo: true, supplier: { select: { name: true } }, store: { select: { name: true } } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return confirmations.map(confirmation => ({ ...toFreightConfirmationView(confirmation),
      supplierOrderNo: confirmation.supplierOrder.supplierOrderNo, supplierName: confirmation.supplierOrder.supplier.name, storeName: confirmation.supplierOrder.store.name }));
  }

  async createForSupplierOrder(supplierOrderId: string, input: CreateFreightConfirmationInput, scope?: { type: string; supplierId?: string }, transaction?: Prisma.TransactionClient): Promise<FreightConfirmationView> {
    const execute = async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "SupplierOrder" WHERE id = ${supplierOrderId}::uuid FOR UPDATE`;
      const order = await tx.supplierOrder.findUnique({ where: { id: supplierOrderId, supplierId: scope?.type === 'SUPPLIER' ? scope?.supplierId : undefined } });
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

      if (order.requiresFreightSnapshot === false && new Decimal(input.amount).gt(0)) {
        throw new ConflictException({ code: 'FREIGHT_NOT_ALLOWED', message: 'This order does not allow freight charges' });
      }

      const created = await tx.freightConfirmation.create({
        data: {
          supplierOrderId: order.id,
          amount: input.amount,
          reason: input.reason,
        },
      });

      return toFreightConfirmationView(created);
    };
    return transaction ? execute(transaction) : this.database.client.$transaction(execute);
  }

  async confirm(id: string, input: ReviewFreightConfirmationInput, transaction?: Prisma.TransactionClient): Promise<FreightConfirmationView> {
    return this.review(id, input, FreightConfirmationStatus.CONFIRMED, transaction);
  }

  async reject(id: string, input: ReviewFreightConfirmationInput, transaction?: Prisma.TransactionClient): Promise<FreightConfirmationView> {
    return this.review(id, input, FreightConfirmationStatus.REJECTED, transaction);
  }

  private async review(
    id: string,
    input: ReviewFreightConfirmationInput,
    status: FreightConfirmationStatus,
    transaction?: Prisma.TransactionClient,
  ): Promise<FreightConfirmationView> {
    const execute = async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "FreightConfirmation" WHERE id = ${id}::uuid FOR UPDATE`;
      const confirmation = await tx.freightConfirmation.findUnique({ where: { id } });
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

      const reviewed = await tx.freightConfirmation.update({
        where: { id: confirmation.id },
        data: {
          status,
          confirmedAt: status === FreightConfirmationStatus.CONFIRMED ? new Date() : undefined,
          rejectedAt: status === FreightConfirmationStatus.REJECTED ? new Date() : undefined,
          version: { increment: 1 },
        },
      });

      return toFreightConfirmationView(reviewed);
    };
    return transaction ? execute(transaction) : this.database.client.$transaction(execute);
  }
}

export function toFreightConfirmationView(confirmation: FreightConfirmation): FreightConfirmationView {
  return {
    id: confirmation.id,
    supplierOrderId: confirmation.supplierOrderId,
    amount: confirmation.amount.toFixed(2),
    reason: confirmation.reason,
    status: confirmation.status,
    version: confirmation.version,
    confirmedAt: confirmation.confirmedAt?.toISOString() ?? null,
    rejectedAt: confirmation.rejectedAt?.toISOString() ?? null,
    usedAt: confirmation.usedAt?.toISOString() ?? null,
    createdAt: confirmation.createdAt.toISOString(),
  };
}
