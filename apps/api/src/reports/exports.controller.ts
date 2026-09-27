import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { ReportFilters, ReportType } from './reports.service.js';
import { ReportsService } from './reports.service.js';

@Controller('exports')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('ADMIN', 'HQ_FINANCE', 'PURCHASER', 'STORE', 'STORE_FINANCE', 'SUPPLIER')
export class ExportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @HttpCode(202)
  async create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const type = body.reportType;
    if (type !== 'order-amounts' && type !== 'product-quantities' && type !== 'profit') throw new BadRequestException({ code: 'INVALID_REPORT_TYPE', message: 'Unsupported reportType' });
    const roles = request.auth!.user.roles;
    if (type === 'profit' && !roles.some((role) => ['ADMIN', 'HQ_FINANCE', 'PURCHASER'].includes(role))) throw new ForbiddenException();
    const filters = applyScope(parseFilters((body.filters ?? {}) as Record<string, unknown>, type === 'product-quantities'), request);
    return this.reports.createExport(request.auth!.user.id, request.auth!.user.scope, type, filters);
  }

  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    return this.reports.listExports(request.auth!.user.id, request.auth!.user.roles, request.auth!.user.scope);
  }

  @Get(':id')
  async status(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const job = await this.reports.exportStatus(id, request.auth!.user.id, request.auth!.user.roles, request.auth!.user.scope);
    if (!job) throw new NotFoundException({ code: 'EXPORT_NOT_FOUND', message: 'Export job was not found or expired' });
    return job;
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Req() request: AuthenticatedRequest, @Res() response: { setHeader(name: string, value: string): void; send(body: string): void }) {
    const csv = await this.reports.exportContent(id, request.auth!.user.id, request.auth!.user.roles, request.auth!.user.scope);
    if (csv === null || csv === undefined) throw new NotFoundException({ code: 'EXPORT_NOT_READY', message: 'Export is unavailable, expired, or not ready' });
    response.setHeader('Content-Type', 'text/csv; charset=utf-8'); response.setHeader('Content-Disposition', `attachment; filename="procurex-${id}.csv"`); response.send(`\uFEFF${csv}`);
  }
}

function parseFilters(query: Record<string, unknown>, required = false): ReportFilters {
  const from = date(query.from), to = date(query.to);
  if ((required && (!from || !to)) || (!!from !== !!to) || (from && to && from > to)) throw new BadRequestException({ code: 'INVALID_REPORT_RANGE', message: 'from and to must be valid dates with from not after to' });
  if (required && from && to && addMonths(from, 3) < to) throw new BadRequestException({ code: 'REPORT_RANGE_TOO_LARGE', message: 'Date range cannot exceed three months' });
  return { from, to, storeId: id(query.storeId), supplierId: id(query.supplierId), productId: id(query.productId) };
}
function date(value: unknown): string | undefined { if (value === undefined) return; if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value) return value; throw new BadRequestException({ code: 'INVALID_REPORT_DATE', message: 'Dates must be valid YYYY-MM-DD values' }); }
function id(value: unknown): string | undefined { if (value === undefined) return; if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value; throw new BadRequestException({ code: 'INVALID_REPORT_FILTER', message: 'Filters must be UUIDs' }); }
function applyScope(filters: ReportFilters, request: AuthenticatedRequest): ReportFilters {
  const roles = request.auth!.user.roles;
  if (roles.some((r) => ['STORE', 'STORE_FINANCE'].includes(r))) { const storeId = request.auth!.user.scope?.storeId; if (!storeId || (filters.storeId && filters.storeId !== storeId)) throw new ForbiddenException(); return { ...filters, storeId }; }
  if (roles.includes('SUPPLIER')) { const supplierId = request.auth!.user.scope?.supplierId; if (!supplierId || (filters.supplierId && filters.supplierId !== supplierId)) throw new ForbiddenException(); return { ...filters, supplierId }; }
  return filters;
}
function addMonths(date: string, months: number): string { const result = new Date(`${date}T00:00:00Z`); result.setUTCMonth(result.getUTCMonth() + months); return result.toISOString().slice(0, 10); }
