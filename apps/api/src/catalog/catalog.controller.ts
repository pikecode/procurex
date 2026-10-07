import { StorePricePrivacyInterceptor } from '../common/store-price-privacy.interceptor.js';
import { UseInterceptors } from '@nestjs/common';
import { masterDataAuditContext } from '../audit/master-data-audit.js';
import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { CatalogRegistriesService } from './catalog-registries.service.js';
import { profileText } from '../common/master-data-profile.js';
import { Decimal } from 'decimal.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { BusinessScopeGuard } from '../auth/business-scope.guard.js';
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
  supplierIds?: unknown;
  purchaseUnitConversion?: unknown;
  defaultSalesPrice?: unknown;
  sku?: unknown;
  name?: unknown;
  categoryId?: unknown;
  baseUnitId?: unknown;
  minOrderQty?: unknown;
  orderMultiple?: unknown;
  specification?: unknown;
  brand?: unknown;
  brandId?: unknown;
  barcode?: unknown;
  storageCondition?: unknown;
  imageFileId?: unknown;
};
type PatchProductBody = Partial<CreateProductBody> & { expectedVersion?: unknown; isActive?: unknown };

@Controller()
@UseGuards(AuthGuard, RolesGuard, BusinessScopeGuard)
@UseInterceptors(StorePricePrivacyInterceptor)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService, private readonly registries: CatalogRegistriesService) {}

  @Get('brands')
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE')
  listBrands() { return this.registries.listBrands(); }

  @Post('brands')
  @RequireRoles('ADMIN', 'PURCHASER')
  createBrand(@Body() body: { name?: unknown }, @Req() request: AuthenticatedRequest) {
    const issues: ValidationIssue[] = [];
    const name = profileText('name', body.name, 120, true, false, issues);
    throwIfInvalid(issues);
    return this.registries.createBrand(name!, masterDataAuditContext(request));
  }

  @Patch('brands/:id')
  @RequireRoles('ADMIN', 'PURCHASER')
  updateBrand(@Param('id') id: string, @Body() body: { expectedVersion?: unknown; name?: unknown }, @Req() request: AuthenticatedRequest) {
    const input = parseRegistryEdit(id, body, 120);
    return this.registries.updateBrand(id, input.expectedVersion, input.name, masterDataAuditContext(request));
  }

  @Patch('units/:id')
  @RequireRoles('ADMIN', 'PURCHASER')
  updateUnit(@Param('id') id: string, @Body() body: { expectedVersion?: unknown; name?: unknown }, @Req() request: AuthenticatedRequest) {
    const input = parseRegistryEdit(id, body, 80);
    return this.registries.updateUnit(id, input.expectedVersion, input.name, masterDataAuditContext(request));
  }

  @Patch('categories/:id')
  @RequireRoles('ADMIN', 'PURCHASER')
  updateCategory(@Param('id') id: string, @Body() body: CreateCategoryBody & { expectedVersion?: unknown }, @Req() request: AuthenticatedRequest) {
    const issues = [...validateUuid('id', id), ...validateExpectedVersion('expectedVersion', body.expectedVersion)];
    const name = profileText('name', body.name, 160, false, false, issues) ?? undefined;
    const parentId = body.parentId === null ? null : optionalUuid('parentId', body.parentId, issues);
    const sortOrder = optionalInteger('sortOrder', body.sortOrder, issues);
    throwIfInvalid(issues);
    return this.registries.updateCategory(id, body.expectedVersion as number, { name, parentId, sortOrder }, masterDataAuditContext(request));
  }

  @Delete('categories/:id')
  @RequireRoles('ADMIN', 'PURCHASER')
  deleteCategory(@Param('id') id: string, @Body() body: { expectedVersion?: unknown }, @Req() request: AuthenticatedRequest) { return this.removeRegistry('categories', id, body, request); }

  @Delete('units/:id')
  @RequireRoles('ADMIN', 'PURCHASER')
  deleteUnit(@Param('id') id: string, @Body() body: { expectedVersion?: unknown }, @Req() request: AuthenticatedRequest) { return this.removeRegistry('units', id, body, request); }

  @Delete('brands/:id')
  @RequireRoles('ADMIN', 'PURCHASER')
  deleteBrand(@Param('id') id: string, @Body() body: { expectedVersion?: unknown }, @Req() request: AuthenticatedRequest) { return this.removeRegistry('brands', id, body, request); }

  private removeRegistry(resource: 'categories' | 'units' | 'brands', id: string, body: { expectedVersion?: unknown }, request: AuthenticatedRequest) {
    throwIfInvalid([...validateUuid('id', id), ...validateExpectedVersion('expectedVersion', body.expectedVersion)]);
    return this.registries.remove(resource, id, body.expectedVersion as number, masterDataAuditContext(request));
  }

  @Get('categories')
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE')
  listCategories(): Promise<CategoryView[]> {
    return this.catalogService.listCategories();
  }

  @Post('categories')
  @RequireRoles('ADMIN', 'PURCHASER')
  createCategory(@Body() body: CreateCategoryBody, @Req() request: AuthenticatedRequest): Promise<CategoryView> {
    return this.catalogService.createCategory(parseCreateCategoryBody(body), masterDataAuditContext(request));
  }

  @Get('units')
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE')
  listUnits(): Promise<UnitView[]> {
    return this.catalogService.listUnits();
  }

  @Post('units')
  @RequireRoles('ADMIN', 'PURCHASER')
  createUnit(@Body() body: CreateUnitBody, @Req() request: AuthenticatedRequest): Promise<UnitView> {
    return this.catalogService.createUnit(parseCreateUnitBody(body), masterDataAuditContext(request));
  }

  @Get('products')
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE')
  listProducts(): Promise<ProductView[]> {
    return this.catalogService.listProducts();
  }

  @Post('products')
  @RequireRoles('ADMIN', 'PURCHASER')
  createProduct(@Body() body: CreateProductBody, @Req() request: AuthenticatedRequest): Promise<ProductView> {
    return this.catalogService.createProduct(parseCreateProductBody(body), request.auth?.user.id, masterDataAuditContext(request));
  }

  @Patch('products/:id')
  @RequireRoles('ADMIN', 'PURCHASER')
  updateProduct(@Param('id') id: string, @Body() body: PatchProductBody, @Req() request: AuthenticatedRequest): Promise<ProductView> {
    return this.catalogService.updateProduct(id, parsePatchProductBody(id, body), request.auth?.user.id, masterDataAuditContext(request));
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

  @Patch('products/:id/purchase-unit')
  @RequireRoles('ADMIN', 'PURCHASER')
  setPurchaseUnit(@Param('id') id: string, @Body() body: { expectedVersion?: unknown; conversion?: unknown }, @Req() request: AuthenticatedRequest) {
    const issues = [...validateUuid('id', id), ...validateExpectedVersion('expectedVersion', body.expectedVersion)];
    let conversion: { purchaseUnitId: string; salesUnitsPerPurchaseUnit: string } | null = null;
    if (body.conversion !== null) {
      if (!body.conversion || typeof body.conversion !== 'object' || Array.isArray(body.conversion)) {
        issues.push({ field: 'conversion', code: 'INVALID_CONVERSION', message: 'conversion must be an object or null' });
      } else {
        const row = body.conversion as Record<string, unknown>;
        issues.push(...validateUuid('conversion.purchaseUnitId', row.purchaseUnitId), ...validateDecimalString('conversion.salesUnitsPerPurchaseUnit', row.salesUnitsPerPurchaseUnit, 8));
        conversion = { purchaseUnitId: row.purchaseUnitId as string, salesUnitsPerPurchaseUnit: row.salesUnitsPerPurchaseUnit as string };
      }
    }
    throwIfInvalid(issues);
    return this.catalogService.setPurchaseUnitConversion(id, body.expectedVersion as number, conversion, masterDataAuditContext(request));
  }
}

function parseCreateCategoryBody(body: CreateCategoryBody): {
  code?: string;
  name: string;
  parentId?: string;
  sortOrder?: number;
} {
  const issues: ValidationIssue[] = [];
  const code = profileText('code', body.code, 80, false, false, issues) ?? undefined;
  const name = requiredTrimmedString('name', body.name, issues);
  profileText('name', body.name, 160, true, false, issues);
  const parentId = optionalUuid('parentId', body.parentId, issues);
  const sortOrder = optionalInteger('sortOrder', body.sortOrder, issues);
  throwIfInvalid(issues);
  return { code: code!, name: name!, parentId, sortOrder };
}

function parseCreateUnitBody(body: CreateUnitBody): { code?: string; name: string } {
  const issues: ValidationIssue[] = [];
  const code = profileText('code', body.code, 40, false, false, issues) ?? undefined;
  const name = requiredTrimmedString('name', body.name, issues);
  profileText('name', body.name, 80, true, false, issues);
  throwIfInvalid(issues);
  return { code: code!, name: name! };
}

function parseCreateProductBody(body: CreateProductBody): {
  supplierIds?: string[];
  purchaseUnitConversion?: { purchaseUnitId: string; salesUnitsPerPurchaseUnit: string } | null;
  defaultSalesPrice: string;
  brandId?: string | null;
  barcode?: string | null;
  sku?: string | null;
  name: string;
  categoryId: string;
  baseUnitId: string;
  minOrderQty: string;
  orderMultiple: string;
  specification?: string | null;
  brand?: string | null;
  storageCondition?: string | null;
  imageFileId?: string | null;
} {
  const issues: ValidationIssue[] = [];
  const sku = optionalSku(body.sku, issues);
  const defaultSalesPrice = parseDefaultSalesPrice(body.defaultSalesPrice, true, issues);
  const name = requiredTrimmedString('name', body.name, issues);
  const categoryId = requiredUuid('categoryId', body.categoryId, issues);
  const baseUnitId = requiredUuid('baseUnitId', body.baseUnitId, issues);
  const minOrderQty = optionalDecimal('minOrderQty', body.minOrderQty, 6, issues) ?? '1';
  const orderMultiple = optionalDecimal('orderMultiple', body.orderMultiple, 6, issues) ?? '1';
  const metadata = parseMetadata(body, issues);
  const configuration = parseProductConfiguration(body, issues);
  throwIfInvalid(issues);
  return { sku, defaultSalesPrice: defaultSalesPrice!, name: name!, categoryId: categoryId!, baseUnitId: baseUnitId!, minOrderQty, orderMultiple, ...metadata, ...configuration };
}

function parsePatchProductBody(id: string, body: PatchProductBody): {
  supplierIds?: string[];
  purchaseUnitConversion?: { purchaseUnitId: string; salesUnitsPerPurchaseUnit: string } | null;
  defaultSalesPrice?: string;
  sku?: string | null;
  brandId?: string | null;
  barcode?: string | null;
  expectedVersion: number;
  name?: string;
  categoryId?: string;
  baseUnitId?: string;
  minOrderQty?: string;
  orderMultiple?: string;
  isActive?: boolean;
  specification?: string | null;
  brand?: string | null;
  storageCondition?: string | null;
  imageFileId?: string | null;
} {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];
  const name = optionalTrimmedString('name', body.name, issues);
  const sku = optionalSku(body.sku, issues);
  const defaultSalesPrice = parseDefaultSalesPrice(body.defaultSalesPrice, false, issues);
  const categoryId = optionalUuid('categoryId', body.categoryId, issues);
  const baseUnitId = optionalUuid('baseUnitId', body.baseUnitId, issues);
  const minOrderQty = optionalDecimal('minOrderQty', body.minOrderQty, 6, issues);
  const orderMultiple = optionalDecimal('orderMultiple', body.orderMultiple, 6, issues);
  const isActive = optionalBoolean('isActive', body.isActive, issues);
  const metadata = parseMetadata(body, issues);
  const configuration = parseProductConfiguration(body, issues);
  throwIfInvalid(issues);
  return { expectedVersion: body.expectedVersion as number, name, sku, defaultSalesPrice, categoryId, baseUnitId, minOrderQty, orderMultiple, isActive, ...metadata, ...configuration };
}

function parseProductConfiguration(body: CreateProductBody, issues: ValidationIssue[]) {
  let supplierIds: string[] | undefined;
  if (body.supplierIds !== undefined) {
    if (!Array.isArray(body.supplierIds) || body.supplierIds.length > 100) issues.push({ field: 'supplierIds', code: 'INVALID_ARRAY', message: 'Select at most 100 suppliers' });
    else { supplierIds = body.supplierIds as string[]; supplierIds.forEach((id, index) => issues.push(...validateUuid(`supplierIds.${index}`, id))); }
  }
  let purchaseUnitConversion: { purchaseUnitId: string; salesUnitsPerPurchaseUnit: string } | null | undefined;
  if (body.purchaseUnitConversion === null) purchaseUnitConversion = null;
  else if (body.purchaseUnitConversion !== undefined) {
    if (typeof body.purchaseUnitConversion !== 'object' || Array.isArray(body.purchaseUnitConversion)) issues.push({ field: 'purchaseUnitConversion', code: 'INVALID_CONVERSION', message: 'Invalid conversion' });
    else {
      const row = body.purchaseUnitConversion as Record<string, unknown>;
      issues.push(...validateUuid('purchaseUnitConversion.purchaseUnitId', row.purchaseUnitId), ...validateDecimalString('purchaseUnitConversion.salesUnitsPerPurchaseUnit', row.salesUnitsPerPurchaseUnit, 8));
      purchaseUnitConversion = { purchaseUnitId: row.purchaseUnitId as string, salesUnitsPerPurchaseUnit: row.salesUnitsPerPurchaseUnit as string };
    }
  }
  return { supplierIds, purchaseUnitConversion };
}

function optionalSku(value: unknown, issues: ValidationIssue[]) {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || value.trim().length > 100) {
    issues.push({ field: 'sku', code: 'INVALID_STRING', message: 'sku must be at most 100 characters' });
    return undefined;
  }
  return value.trim() || null;
}

function parseDefaultSalesPrice(value: unknown, required: boolean, issues: ValidationIssue[]) {
  if (value === undefined && !required) return undefined;
  const priceIssues = validateDecimalString('defaultSalesPrice', value, 6);
  issues.push(...priceIssues);
  if (priceIssues.length) return undefined;
  if (new Decimal(value as string).gte('100000000000000')) {
    issues.push({ field: 'defaultSalesPrice', code: 'DECIMAL_PRECISION_EXCEEDED', message: 'Default sales price exceeds storage precision' });
    return undefined;
  }
  return value as string;
}

function parseMetadata(body: CreateProductBody, issues: ValidationIssue[]) {
  const optionalText = (field: string, value: unknown, max: number): string | null | undefined => {
    if (value === undefined || value === null) return value;
    if (typeof value !== 'string' || value.trim().length > max) { issues.push({ field, code: 'INVALID_STRING', message: `${field} must be at most ${max} characters` }); return undefined; }
    return value.trim() || null;
  };
  const specification = optionalText('specification', body.specification, 240);
  const brand = optionalText('brand', body.brand, 120);
  const barcode = optionalText('barcode', body.barcode, 100);
  const brandId = body.brandId === null ? null : optionalUuid('brandId', body.brandId, issues);
  if (body.brand !== undefined && body.brandId !== undefined) issues.push({ field: 'brandId', code: 'AMBIGUOUS_BRAND', message: 'Use brandId or legacy brand text, not both' });
  const storageCondition = optionalText('storageCondition', body.storageCondition, 24);
  if (storageCondition && !['AMBIENT', 'CHILLED', 'FROZEN', 'WARM'].includes(storageCondition)) issues.push({ field: 'storageCondition', code: 'INVALID_STORAGE', message: 'Unsupported storage condition' });
  const imageFileId = body.imageFileId === null ? null : optionalUuid('imageFileId', body.imageFileId, issues);
  return { specification, brand, brandId, barcode, storageCondition, imageFileId };
}

function parseRegistryEdit(id: string, body: { expectedVersion?: unknown; name?: unknown }, max: number) {
  const issues = [...validateUuid('id', id), ...validateExpectedVersion('expectedVersion', body.expectedVersion)];
  const name = profileText('name', body.name, max, true, false, issues);
  throwIfInvalid(issues);
  return { name: name!, expectedVersion: body.expectedVersion as number };
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
  const invalid = validateDecimalString(field, value, maxScale);
  issues.push(...invalid);
  if (!invalid.length) {
    const quantity = new Decimal(value as string);
    if (!quantity.isInteger() || quantity.lte(0) || quantity.gte('100000000000000')) issues.push({ field, code: 'INVALID_QUANTITY_RULE', message: '最小起订量和订购倍数必须为正整数，最多14位' });
  }
  return typeof value === 'string' ? value : undefined;
}

function optionalInteger(field: string, value: unknown, issues: ValidationIssue[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
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
