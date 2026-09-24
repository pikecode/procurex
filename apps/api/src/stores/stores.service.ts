import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { StoreStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import type { Store } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type StoreView = {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  address: string | null;
  status: StoreStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateStoreInput = {
  code: string;
  name: string;
  contactName?: string;
  contactPhone?: string;
  address?: string;
};

export type UpdateStoreInput = {
  expectedVersion: number;
  name?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  status?: StoreStatus;
};

@Injectable()
export class StoresService {
  constructor(private readonly database: DatabaseService) {}

  async listStores(): Promise<StoreView[]> {
    const stores = await this.database.client.store.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return stores.map(toStoreView);
  }

  async createStore(input: CreateStoreInput): Promise<StoreView> {
    const store = await this.database.client.store.create({
      data: {
        code: input.code,
        name: input.name,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        address: input.address,
      },
    });

    return toStoreView(store);
  }

  async updateStore(id: string, input: UpdateStoreInput): Promise<StoreView> {
    const existing = await this.database.client.store.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'STORE_NOT_FOUND',
        message: 'Store was not found',
      });
    }

    const version = storeVersion(existing);
    if (version !== input.expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Store version has changed',
        details: { expectedVersion: input.expectedVersion, currentVersion: version },
      });
    }

    const updated = await this.database.client.store.update({
      where: { id },
      data: {
        name: input.name,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        address: input.address,
        status: input.status,
      },
    });

    return toStoreView(updated);
  }
}

function toStoreView(store: Store): StoreView {
  return {
    id: store.id,
    code: store.code,
    name: store.name,
    contactName: store.contactName,
    contactPhone: store.contactPhone,
    address: store.address,
    status: store.status,
    version: storeVersion(store),
    createdAt: store.createdAt.toISOString(),
    updatedAt: store.updatedAt.toISOString(),
  };
}

function storeVersion(store: Pick<Store, 'updatedAt'>): number {
  return store.updatedAt.getTime();
}
