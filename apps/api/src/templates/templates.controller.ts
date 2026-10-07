import { masterDataAuditContext } from '../audit/master-data-audit.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { profileText } from '../common/master-data-profile.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import {
  TemplatesService,
  type TemplateItemInput,
  type TemplateItemsView,
  type TemplateListView,
  type TemplateStoresView,
  type TemplateSupplierSettingView,
  type TemplateView,
} from './templates.service.js';
import { SettlementMode } from '../../../../packages/backend/generated/prisma/enums.js';
import { Decimal } from 'decimal.js';
import { validateDecimalString, validateExpectedVersion, validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';

type CreateTemplateBody = { code?: unknown; name?: unknown; tag?: unknown; remark?: unknown };
type TemplateVersionBody = { expectedVersion?: unknown };
type PutTemplateStoresBody = { expectedVersion?: unknown; storeIds?: unknown };
type PutTemplateItemsBody = { expectedVersion?: unknown; items?: unknown };
type PutTemplateSupplierSettingBody = { expectedVersion?: unknown; settlementMode?: unknown; settlementCycle?: unknown };

@Controller('templates')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('ADMIN', 'PURCHASER')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  listTemplates(): Promise<TemplateListView[]> {
    return this.templatesService.listTemplates();
  }

  @Get(':id')
  getTemplate(@Param('id') id: string) {
    throwIfInvalid(validateUuid('id', id));
    return this.templatesService.getTemplate(id);
  }

  @Post()
  createTemplate(@Body() body: CreateTemplateBody, @Req() request: AuthenticatedRequest): Promise<TemplateView> {
    const input = parseCreateTemplateBody(body);
    return this.templatesService.createTemplate(input, masterDataAuditContext(request));
  }

  @Put(':id/stores')
  replaceStores(@Param('id') id: string, @Body() body: PutTemplateStoresBody, @Req() request: AuthenticatedRequest): Promise<TemplateStoresView> {
    const input = parsePutTemplateStoresBody(id, body);
    return this.templatesService.replaceTemplateStores(id, input.expectedVersion, input.storeIds, masterDataAuditContext(request));
  }

  @Patch(':id')
  updateTemplate(@Param('id') id: string, @Body() body: CreateTemplateBody & TemplateVersionBody, @Req() request: AuthenticatedRequest) {
    const expectedVersion = parseVersion(id, body);
    const issues: ValidationIssue[] = [];
    const name = profileText('name', body.name, 200, false, false, issues) ?? undefined;
    const tag = profileText('tag', body.tag, 120, false, false, issues) ?? undefined;
    const remark = profileText('remark', body.remark, 500, false, true, issues);
    throwIfInvalid(issues);
    return this.templatesService.updateTemplate(id, expectedVersion, { name, tag, remark }, masterDataAuditContext(request));
  }

  @Post(':id/copy')
  copyTemplate(@Param('id') id: string, @Body() body: CreateTemplateBody & TemplateVersionBody, @Req() request: AuthenticatedRequest) {
    const expectedVersion = parseVersion(id, body);
    return this.templatesService.copyTemplate(id, expectedVersion, parseCreateTemplateBody(body), masterDataAuditContext(request));
  }

  @Post(':id/archive')
  archiveTemplate(@Param('id') id: string, @Body() body: TemplateVersionBody, @Req() request: AuthenticatedRequest) {
    return this.templatesService.archiveTemplate(id, parseVersion(id, body), masterDataAuditContext(request));
  }

  @Delete(':id/supplier-settings/:supplierId')
  clearSupplierSetting(@Param('id') id: string, @Param('supplierId') supplierId: string, @Body() body: TemplateVersionBody, @Req() request: AuthenticatedRequest) {
    throwIfInvalid(validateUuid('supplierId', supplierId));
    return this.templatesService.clearSupplierSetting(id, supplierId, parseVersion(id, body), masterDataAuditContext(request));
  }

  @Put(':id/items')
  replaceItems(@Param('id') id: string, @Body() body: PutTemplateItemsBody, @Req() request: AuthenticatedRequest): Promise<TemplateItemsView> {
    const input = parsePutTemplateItemsBody(id, body);
    return this.templatesService.replaceTemplateItems(id, input.expectedVersion, input.items, masterDataAuditContext(request));
  }

  @Put(':id/supplier-settings/:supplierId')
  setSupplierSetting(
    @Param('id') id: string,
    @Param('supplierId') supplierId: string,
    @Body() body: PutTemplateSupplierSettingBody,
    @Req() request: AuthenticatedRequest,
  ): Promise<TemplateSupplierSettingView> {
    const input = parsePutTemplateSupplierSettingBody(id, supplierId, body);
    return this.templatesService.setSupplierSetting(
      id,
      supplierId,
      input.expectedVersion,
      input.settlementMode,
      input.settlementCycle,
      masterDataAuditContext(request),
    );
  }
}

function parseVersion(id: string, body: TemplateVersionBody): number {
  throwIfInvalid([...validateUuid('id', id), ...validateExpectedVersion('expectedVersion', body.expectedVersion)]);
  return body.expectedVersion as number;
}

function parseCreateTemplateBody(body: CreateTemplateBody): { code?: string; name: string; tag: string; remark?: string | null } {
  const issues: ValidationIssue[] = [];
  const code = profileText('code', body.code, 80, false, false, issues) ?? undefined;
  const name = requiredTrimmedString('name', body.name, issues);
  profileText('name', body.name, 200, true, false, issues);
  const tag = profileText('tag', body.tag, 120, true, false, issues);
  const remark = profileText('remark', body.remark, 500, false, true, issues);
  throwIfInvalid(issues);
  return { code: code!, name: name!, tag: tag!, remark };
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
  items: TemplateItemInput[];
} {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const items: TemplateItemInput[] = [];

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
      if (item.isEnabled !== undefined && typeof item.isEnabled !== 'boolean') issues.push({ field: `items.${itemIndex}.isEnabled`, code: 'INVALID_BOOLEAN', message: 'isEnabled must be boolean' });
      for (const field of ['minOrderQty', 'orderMultiple'] as const) {
        const value = item[field];
        if (value === undefined || value === null) continue;
        const invalid = validateDecimalString(`items.${itemIndex}.${field}`, value, 6);
        issues.push(...invalid);
        if (!invalid.length && (!new Decimal(value as string).isInteger() || new Decimal(value as string).lte(0) || new Decimal(value as string).gte('100000000000000'))) issues.push({ field: `items.${itemIndex}.${field}`, code: 'INVALID_QUANTITY_RULE', message: '起订量和订货倍数必须为正整数，最多14位' });
      }
      if (typeof item.productId === 'string') {
        items.push({ productId: item.productId, sortOrder, suppliers, isEnabled: item.isEnabled as boolean | undefined,
          minOrderQty: item.minOrderQty as string | null | undefined, orderMultiple: item.orderMultiple as string | null | undefined });
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
  if (!['IMMEDIATE', 'WEEKLY', 'HALF_MONTHLY', 'MONTHLY'].includes(String(body.settlementCycle))) issues.push({ field: 'settlementCycle', code: 'INVALID_SETTLEMENT_CYCLE', message: 'Invalid settlement cycle' });

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
