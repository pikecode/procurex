import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import {
  TemplatesService,
  type TemplateItemsView,
  type TemplateStoresView,
  type TemplateSupplierSettingView,
  type TemplateView,
} from './templates.service.js';
import { SettlementMode } from '../../../../packages/backend/generated/prisma/enums.js';
import { validateExpectedVersion, validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';

type CreateTemplateBody = { code?: unknown; name?: unknown };
type PutTemplateStoresBody = { expectedVersion?: unknown; storeIds?: unknown };
type PutTemplateItemsBody = { expectedVersion?: unknown; items?: unknown };
type PutTemplateSupplierSettingBody = { expectedVersion?: unknown; settlementMode?: unknown; settlementCycle?: unknown };

@Controller('templates')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('ADMIN', 'PURCHASER')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  listTemplates(): Promise<TemplateView[]> {
    return this.templatesService.listTemplates();
  }

  @Post()
  createTemplate(@Body() body: CreateTemplateBody): Promise<TemplateView> {
    const input = parseCreateTemplateBody(body);
    return this.templatesService.createTemplate(input);
  }

  @Put(':id/stores')
  replaceStores(@Param('id') id: string, @Body() body: PutTemplateStoresBody): Promise<TemplateStoresView> {
    const input = parsePutTemplateStoresBody(id, body);
    return this.templatesService.replaceTemplateStores(id, input.expectedVersion, input.storeIds);
  }

  @Put(':id/items')
  replaceItems(@Param('id') id: string, @Body() body: PutTemplateItemsBody): Promise<TemplateItemsView> {
    const input = parsePutTemplateItemsBody(id, body);
    return this.templatesService.replaceTemplateItems(id, input.expectedVersion, input.items);
  }

  @Put(':id/supplier-settings/:supplierId')
  setSupplierSetting(
    @Param('id') id: string,
    @Param('supplierId') supplierId: string,
    @Body() body: PutTemplateSupplierSettingBody,
  ): Promise<TemplateSupplierSettingView> {
    const input = parsePutTemplateSupplierSettingBody(id, supplierId, body);
    return this.templatesService.setSupplierSetting(
      id,
      supplierId,
      input.expectedVersion,
      input.settlementMode,
      input.settlementCycle,
    );
  }
}

function parseCreateTemplateBody(body: CreateTemplateBody): { code: string; name: string } {
  const issues: ValidationIssue[] = [];
  const code = requiredTrimmedString('code', body.code, issues);
  const name = requiredTrimmedString('name', body.name, issues);
  throwIfInvalid(issues);
  return { code: code!, name: name! };
}

function parsePutTemplateStoresBody(id: string, body: PutTemplateStoresBody): { expectedVersion: number; storeIds: string[] } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const storeIds: string[] = [];
  if (!Array.isArray(body.storeIds)) {
    issues.push({ field: 'storeIds', code: 'INVALID_STORE_IDS', message: 'storeIds must be an array' });
  } else {
    for (const [index, storeId] of body.storeIds.entries()) {
      issues.push(...validateUuid(`storeIds.${index}`, storeId));
      if (typeof storeId === 'string') {
        storeIds.push(storeId);
      }
    }
  }

  throwIfInvalid(issues);
  return { expectedVersion: body.expectedVersion as number, storeIds };
}

function parsePutTemplateItemsBody(
  id: string,
  body: PutTemplateItemsBody,
): {
  expectedVersion: number;
  items: Array<{ productId: string; sortOrder?: number; suppliers: Array<{ supplierId: string; priority: number }> }>;
} {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const items: Array<{ productId: string; sortOrder?: number; suppliers: Array<{ supplierId: string; priority: number }> }> = [];

  if (!Array.isArray(body.items)) {
    issues.push({ field: 'items', code: 'INVALID_TEMPLATE_ITEMS', message: 'items must be an array' });
  } else {
    for (const [itemIndex, item] of body.items.entries()) {
      if (!isRecord(item)) {
        issues.push({ field: `items.${itemIndex}`, code: 'INVALID_TEMPLATE_ITEM', message: 'item must be an object' });
        continue;
      }

      issues.push(...validateUuid(`items.${itemIndex}.productId`, item.productId));
      const suppliers: Array<{ supplierId: string; priority: number }> = [];
      if (!Array.isArray(item.suppliers) || item.suppliers.length === 0) {
        issues.push({
          field: `items.${itemIndex}.suppliers`,
          code: 'INVALID_TEMPLATE_ITEM_SUPPLIERS',
          message: 'suppliers must be a non-empty array',
        });
      } else {
        for (const [supplierIndex, supplier] of item.suppliers.entries()) {
          if (!isRecord(supplier)) {
            issues.push({
              field: `items.${itemIndex}.suppliers.${supplierIndex}`,
              code: 'INVALID_TEMPLATE_ITEM_SUPPLIER',
              message: 'supplier must be an object',
            });
            continue;
          }
          issues.push(...validateUuid(`items.${itemIndex}.suppliers.${supplierIndex}.supplierId`, supplier.supplierId));
          const priority = optionalInteger(`items.${itemIndex}.suppliers.${supplierIndex}.priority`, supplier.priority, issues) ?? 100;
          if (typeof supplier.supplierId === 'string') {
            suppliers.push({ supplierId: supplier.supplierId, priority });
          }
        }
      }

      const sortOrder = optionalInteger(`items.${itemIndex}.sortOrder`, item.sortOrder, issues);
      if (typeof item.productId === 'string') {
        items.push({ productId: item.productId, sortOrder, suppliers });
      }
    }
  }

  throwIfInvalid(issues);
  return { expectedVersion: body.expectedVersion as number, items };
}

function parsePutTemplateSupplierSettingBody(
  id: string,
  supplierId: string,
  body: PutTemplateSupplierSettingBody,
): { expectedVersion: number; settlementMode: SettlementMode; settlementCycle: string } {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateUuid('supplierId', supplierId),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const settlementMode = requiredSettlementMode(body.settlementMode, issues);
  const settlementCycle = requiredTrimmedString('settlementCycle', body.settlementCycle, issues);

  throwIfInvalid(issues);
  return { expectedVersion: body.expectedVersion as number, settlementMode: settlementMode!, settlementCycle: settlementCycle! };
}

function requiredTrimmedString(field: string, value: unknown, issues: ValidationIssue[]): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ field, code: 'REQUIRED_STRING', message: `${field} is required` });
    return undefined;
  }
  return value.trim();
}

function optionalInteger(field: string, value: unknown, issues: ValidationIssue[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    issues.push({ field, code: 'INVALID_INTEGER', message: `${field} must be an integer` });
    return undefined;
  }
  return value;
}

function requiredSettlementMode(value: unknown, issues: ValidationIssue[]): SettlementMode | undefined {
  if (
    value === SettlementMode.STORED_VALUE ||
    value === SettlementMode.CREDIT ||
    value === SettlementMode.SUPPLIER_TERM ||
    value === SettlementMode.COMPANY_TERM
  ) {
    return value;
  }

  issues.push({ field: 'settlementMode', code: 'INVALID_SETTLEMENT_MODE', message: 'settlementMode is invalid' });
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
