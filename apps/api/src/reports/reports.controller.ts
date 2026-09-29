import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ReportsService, type ReportFilters } from './reports.service.js';

@Controller('reports')
@UseGuards(AuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('order-amounts')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'PURCHASER', 'STORE', 'STORE_FINANCE', 'SUPPLIER')
  orderAmounts(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) { return this.reports.orderAmounts(scopedFilters(parseFilters(query), request)); }

  @Get('product-quantities')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'PURCHASER', 'STORE', 'STORE_FINANCE', 'SUPPLIER')
  productQuantities(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    const filters = parseFilters(query, true);
    if (filters.from && filters.to && addMonths(filters.from, 3) < filters.to) {
      throw new BadRequestException({ code: 'REPORT_RANGE_TOO_LARGE', message: 'Date range cannot exceed three months' });
    }
    return this.reports.productQuantities(scopedFilters(filters, request));
  }

  @Get('profit')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'PURCHASER')
  profit(@Query() query: Record<string, unknown>) { return this.reports.profit(parseFilters(query)); }

}

function parseFilters(query: Record<string, unknown>, requiredRange = false): ReportFilters {
  const from = parseDate('from', query.from);
  const to = parseDate('to', query.to);
  if ((requiredRange && (!from || !to)) || (!!from !== !!to) || (from && to && from > to)) {
    throw new BadRequestException({ code: 'INVALID_REPORT_RANGE', message: 'from and to must be valid dates with from not after to' });
  }
  return { from, to, storeId: optionalId('storeId', query.storeId), supplierId: optionalId('supplierId', query.supplierId), productId: optionalId('productId', query.productId) };
}

function scopedFilters(filters: ReportFilters, request: AuthenticatedRequest): ReportFilters {
  const roles = request.auth?.user.roles ?? [];
  if (roles.some((role) => ['ADMIN', 'HQ_FINANCE', 'PURCHASER'].includes(role))) return filters;
  if (roles.includes('STORE') || roles.includes('STORE_FINANCE')) {
    const storeId = request.auth?.user.scope?.storeId;
    if (!storeId || (filters.storeId && filters.storeId !== storeId)) throw new BadRequestException({ code: 'SCOPE_MISMATCH', message: 'Report is outside the current store scope' });
    return { ...filters, storeId };
  }
  if (roles.includes('SUPPLIER')) {
    const supplierId = request.auth?.user.scope?.supplierId;
    if (!supplierId || (filters.supplierId && filters.supplierId !== supplierId)) throw new BadRequestException({ code: 'SCOPE_MISMATCH', message: 'Report is outside the current supplier scope' });
    return { ...filters, supplierId };
  }
  return filters;
}

function parseDate(name: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value) return value;
  throw new BadRequestException({ code: 'INVALID_REPORT_DATE', message: `${name} must be YYYY-MM-DD` });
}

function optionalId(name: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
  throw new BadRequestException({ code: 'INVALID_REPORT_FILTER', message: `${name} must be a UUID` });
}

function addMonths(date: string, months: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}
