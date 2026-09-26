import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { CatalogService, type CategoryView, type ProductView, type StoreCatalogView, type UnitView } from './catalog.service.js';
import {
  validateDecimalString,
  validateExpectedVersion,
  validateUuid,
  type ValidationIssue,
} from '../../../../packages/domain/src/validation.js';

type CreateCategoryBody = { code?: unknown; name?: unknown; parentId?: unknown; sortOrder?: unknown };
type CreateUnitBody = { code?: unknown; name?: unknown };
type CreateProductBody = {
  sku?: unknown;
  name?: unknown;
  categoryId?: unknown;
  baseUnitId?: unknown;
  minOrderQty?: unknown;
  orderMultiple?: unknown;
};
type PatchProductBody = Partial<CreateProductBody> & { expectedVersion?: unknown; isActive?: unknown };

@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('categories')
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE')
  listCategories(): Promise<CategoryView[]> {
    return this.catalogService.listCategories();
  }

  @Post('categories')
  @RequireRoles('ADMIN', 'PURCHASER')
  createCategory(@Body() body: CreateCategoryBody): Promise<CategoryView> {
    return this.catalogService.createCategory(parseCreateCategoryBody(body));
  }

  @Get('units')
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE')
  listUnits(): Promise<UnitView[]> {
    return this.catalogService.listUnits();
  }

  @Post('units')
  @RequireRoles('ADMIN', 'PURCHASER')
  createUnit(@Body() body: CreateUnitBody): Promise<UnitView> {
    return this.catalogService.createUnit(parseCreateUnitBody(body));
  }

  @Get('products')
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE')
  listProducts(): Promise<ProductView[]> {
    return this.catalogService.listProducts();
  }

  @Post('products')
  @RequireRoles('ADMIN', 'PURCHASER')
  createProduct(@Body() body: CreateProductBody): Promise<ProductView> {
    return this.catalogService.createProduct(parseCreateProductBody(body));
  }

  @Patch('products/:id')
  @RequireRoles('ADMIN', 'PURCHASER')
  updateProduct(@Param('id') id: string, @Body() body: PatchProductBody): Promise<ProductView> {
    return this.catalogService.updateProduct(id, parsePatchProductBody(id, body));
  }

  @Get('stores/:id/catalog')
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE')
  readStoreCatalog(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<StoreCatalogView> {
    throwIfInvalid(validateUuid('id', id));
    const scope = request.auth?.user.scope;
    if (scope?.type === 'STORE' || scope?.type === 'STORE_FINANCE') {
      if (!scope.storeId) throw new ForbiddenException({ code: 'SCOPE_REQUIRED', message: 'Store scope is not configured' });
      if (scope.storeId !== id) throw new ForbiddenException({ code: 'SCOPE_MISMATCH', message: 'Store is outside the current store scope' });
    }
    return this.catalogService.readStoreCatalog(id);
  }
}

function parseCreateCategoryBody(body: CreateCategoryBody): {
  code: string;
  name: string;
  parentId?: string;
  sortOrder?: number;
} {
  const issues: ValidationIssue[] = [];
  const code = requiredTrimmedString('code', body.code, issues);
  const name = requiredTrimmedString('name', body.name, issues);
  const parentId = optionalUuid('parentId', body.parentId, issues);
  const sortOrder = optionalInteger('sortOrder', body.sortOrder, issues);
  throwIfInvalid(issues);
  return { code: code!, name: name!, parentId, sortOrder };
}

function parseCreateUnitBody(body: CreateUnitBody): { code: string; name: string } {
  const issues: ValidationIssue[] = [];
  const code = requiredTrimmedString('code', body.code, issues);
  const name = requiredTrimmedString('name', body.name, issues);
  throwIfInvalid(issues);
  return { code: code!, name: name! };
}

function parseCreateProductBody(body: CreateProductBody): {
  sku: string;
  name: string;
  categoryId: string;
  baseUnitId: string;
  minOrderQty: string;
  orderMultiple: string;
} {
  const issues: ValidationIssue[] = [];
  const sku = requiredTrimmedString('sku', body.sku, issues);
  const name = requiredTrimmedString('name', body.name, issues);
  const categoryId = requiredUuid('categoryId', body.categoryId, issues);
  const baseUnitId = requiredUuid('baseUnitId', body.baseUnitId, issues);
  const minOrderQty = optionalDecimal('minOrderQty', body.minOrderQty, 6, issues) ?? '1';
  const orderMultiple = optionalDecimal('orderMultiple', body.orderMultiple, 6, issues) ?? '1';
  throwIfInvalid(issues);
  return { sku: sku!, name: name!, categoryId: categoryId!, baseUnitId: baseUnitId!, minOrderQty, orderMultiple };
}

function parsePatchProductBody(id: string, body: PatchProductBody): {
  expectedVersion: number;
  name?: string;
  categoryId?: string;
  baseUnitId?: string;
  minOrderQty?: string;
  orderMultiple?: string;
  isActive?: boolean;
} {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const name = optionalTrimmedString('name', body.name, issues);
  const categoryId = optionalUuid('categoryId', body.categoryId, issues);
  const baseUnitId = optionalUuid('baseUnitId', body.baseUnitId, issues);
  const minOrderQty = optionalDecimal('minOrderQty', body.minOrderQty, 6, issues);
  const orderMultiple = optionalDecimal('orderMultiple', body.orderMultiple, 6, issues);
  const isActive = optionalBoolean('isActive', body.isActive, issues);
  throwIfInvalid(issues);
  return { expectedVersion: body.expectedVersion as number, name, categoryId, baseUnitId, minOrderQty, orderMultiple, isActive };
}

function requiredTrimmedString(field: string, value: unknown, issues: ValidationIssue[]): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ field, code: 'REQUIRED_STRING', message: `${field} is required` });
    return undefined;
  }
  return value.trim();
}

function optionalTrimmedString(field: string, value: unknown, issues: ValidationIssue[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ field, code: 'INVALID_STRING', message: `${field} must be a non-empty string` });
    return undefined;
  }
  return value.trim();
}

function requiredUuid(field: string, value: unknown, issues: ValidationIssue[]): string | undefined {
  issues.push(...validateUuid(field, value));
  return typeof value === 'string' ? value : undefined;
}

function optionalUuid(field: string, value: unknown, issues: ValidationIssue[]): string | undefined {
  if (value === undefined) return undefined;
  issues.push(...validateUuid(field, value));
  return typeof value === 'string' ? value : undefined;
}

function optionalDecimal(field: string, value: unknown, maxScale: number, issues: ValidationIssue[]): string | undefined {
  if (value === undefined) return undefined;
  issues.push(...validateDecimalString(field, value, maxScale));
  return typeof value === 'string' ? value : undefined;
}

function optionalInteger(field: string, value: unknown, issues: ValidationIssue[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    issues.push({ field, code: 'INVALID_INTEGER', message: `${field} must be an integer` });
    return undefined;
  }
  return value;
}

function optionalBoolean(field: string, value: unknown, issues: ValidationIssue[]): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    issues.push({ field, code: 'INVALID_BOOLEAN', message: `${field} must be a boolean` });
    return undefined;
  }
  return value;
}
