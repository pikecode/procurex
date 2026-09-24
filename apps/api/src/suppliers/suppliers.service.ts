import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryMode, SettlementMode, SupplierStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import type { Supplier } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type SupplierView = {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  deliveryMode: DeliveryMode;
  defaultSettlementMode: SettlementMode;
  defaultSettlementCycle: string;
  status: SupplierStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateSupplierInput = {
  code: string;
  name: string;
  deliveryMode: DeliveryMode;
  defaultSettlementMode: SettlementMode;
  defaultSettlementCycle: string;
  contactName?: string;
  contactPhone?: string;
};

export type UpdateSupplierInput = {
  expectedVersion: number;
  name?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  deliveryMode?: DeliveryMode;
  defaultSettlementMode?: SettlementMode;
  defaultSettlementCycle?: string;
  status?: SupplierStatus;
};

@Injectable()
export class SuppliersService {
  constructor(private readonly database: DatabaseService) {}

  async listSuppliers(): Promise<SupplierView[]> {
    const suppliers = await this.database.client.supplier.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return suppliers.map(toSupplierView);
  }

  async createSupplier(input: CreateSupplierInput): Promise<SupplierView> {
    const supplier = await this.database.client.supplier.create({
      data: input,
    });

    return toSupplierView(supplier);
  }

  async updateSupplier(id: string, input: UpdateSupplierInput): Promise<SupplierView> {
    const existing = await this.database.client.supplier.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'SUPPLIER_NOT_FOUND',
        message: 'Supplier was not found',
      });
    }

    const version = supplierVersion(existing);
    if (version !== input.expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Supplier version has changed',
        details: { expectedVersion: input.expectedVersion, currentVersion: version },
      });
    }

    const updated = await this.database.client.supplier.update({
      where: { id },
      data: {
        name: input.name,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        deliveryMode: input.deliveryMode,
        defaultSettlementMode: input.defaultSettlementMode,
        defaultSettlementCycle: input.defaultSettlementCycle,
        status: input.status,
      },
    });

    return toSupplierView(updated);
  }
}

function toSupplierView(supplier: Supplier): SupplierView {
  return {
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    contactName: supplier.contactName,
    contactPhone: supplier.contactPhone,
    deliveryMode: supplier.deliveryMode,
    defaultSettlementMode: supplier.defaultSettlementMode,
    defaultSettlementCycle: supplier.defaultSettlementCycle,
    status: supplier.status,
    version: supplierVersion(supplier),
    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
  };
}

function supplierVersion(supplier: Pick<Supplier, 'updatedAt'>): number {
  return supplier.updatedAt.getTime();
}
