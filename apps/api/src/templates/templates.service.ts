import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { OrderTemplate } from '../../../../packages/backend/generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type TemplateView = {
  id: string;
  code: string;
  name: string;
  isArchived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TemplateStoresView = {
  templateId: string;
  storeIds: string[];
  version: number;
};

export type CreateTemplateInput = {
  code: string;
  name: string;
};

@Injectable()
export class TemplatesService {
  constructor(private readonly database: DatabaseService) {}

  async listTemplates(): Promise<TemplateView[]> {
    const templates = await this.database.client.orderTemplate.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return templates.map(toTemplateView);
  }

  async createTemplate(input: CreateTemplateInput): Promise<TemplateView> {
    const template = await this.database.client.orderTemplate.create({ data: input });
    return toTemplateView(template);
  }

  async replaceTemplateStores(templateId: string, expectedVersion: number, storeIds: string[]): Promise<TemplateStoresView> {
    const template = await this.database.client.orderTemplate.findUnique({ where: { id: templateId } });
    if (!template || template.isArchived) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: 'Template was not found',
      });
    }

    const version = templateVersion(template);
    if (version !== expectedVersion) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'Template version has changed',
        details: { expectedVersion, currentVersion: version },
      });
    }

    const uniqueStoreIds = [...new Set(storeIds)];
    const stores = await this.database.client.store.findMany({
      where: { id: { in: uniqueStoreIds } },
      select: { id: true },
    });
    if (stores.length !== uniqueStoreIds.length) {
      throw new NotFoundException({
        code: 'STORE_NOT_FOUND',
        message: 'One or more stores were not found',
      });
    }

    const conflictingBinding = await this.database.client.storeTemplateBinding.findFirst({
      where: {
        storeId: { in: uniqueStoreIds },
        expiredAt: null,
        templateId: { not: templateId },
      },
    });
    if (conflictingBinding) {
      throw new ConflictException({
        code: 'STORE_ALREADY_BOUND',
        message: 'One or more stores already have an active template',
        details: { storeId: conflictingBinding.storeId, templateId: conflictingBinding.templateId },
      });
    }

    await this.database.client.$transaction([
      this.database.client.storeTemplateBinding.updateMany({
        where: {
          templateId,
          expiredAt: null,
        },
        data: { expiredAt: new Date() },
      }),
      this.database.client.storeTemplateBinding.createMany({
        data: uniqueStoreIds.map((storeId) => ({ templateId, storeId })),
      }),
    ]);

    const activeBindings = await this.database.client.storeTemplateBinding.findMany({
      where: { templateId, expiredAt: null },
      orderBy: { storeId: 'asc' },
      select: { storeId: true },
    });
    const updated = await this.database.client.orderTemplate.update({ where: { id: templateId }, data: {} });

    return {
      templateId,
      storeIds: activeBindings.map((binding) => binding.storeId),
      version: templateVersion(updated),
    };
  }
}

function toTemplateView(template: OrderTemplate): TemplateView {
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    isArchived: template.isArchived,
    version: templateVersion(template),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

function templateVersion(template: Pick<OrderTemplate, 'updatedAt'>): number {
  return template.updatedAt.getTime();
}
