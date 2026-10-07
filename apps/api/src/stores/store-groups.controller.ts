import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { masterDataAuditContext } from '../audit/master-data-audit.js';
import { profileText } from '../common/master-data-profile.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { validateExpectedVersion, validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';
import { StoreGroupsService } from './store-groups.service.js';

@Controller('store-groups')
@UseGuards(AuthGuard, RolesGuard)
export class StoreGroupsController {
  constructor(private readonly groups: StoreGroupsService) {}

  @Get()
  @RequireRoles('ADMIN', 'PURCHASER', 'HQ_FINANCE')
  list() { return this.groups.list(); }

  @Post()
  @RequireRoles('ADMIN')
  create(@Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    const issues: ValidationIssue[] = [];
    const name = profileText('name', body.name, 120, true, false, issues);
    throwIfInvalid(issues);
    return this.groups.create(name!, masterDataAuditContext(request));
  }

  @Patch(':id')
  @RequireRoles('ADMIN')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    const issues = [...validateUuid('id', id), ...validateExpectedVersion('expectedVersion', body.expectedVersion)];
    const name = profileText('name', body.name, 120, false, false, issues) ?? undefined;
    if (body.status !== undefined && body.status !== 'ACTIVE' && body.status !== 'DISABLED') issues.push({ field: 'status', code: 'INVALID_PROFILE_CHOICE', message: 'Invalid group status' });
    throwIfInvalid(issues);
    return this.groups.update(id, body.expectedVersion as number, { name, status: body.status as 'ACTIVE' | 'DISABLED' | undefined }, masterDataAuditContext(request));
  }

  @Delete(':id')
  @RequireRoles('ADMIN')
  remove(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    throwIfInvalid([...validateUuid('id', id), ...validateExpectedVersion('expectedVersion', body.expectedVersion)]);
    return this.groups.remove(id, body.expectedVersion as number, masterDataAuditContext(request));
  }
}
