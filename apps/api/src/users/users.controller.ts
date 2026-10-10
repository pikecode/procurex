import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { masterDataAuditContext } from '../audit/master-data-audit.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { UsersService, type UserView } from './users.service.js';
import { UserScopeType, UserStatus } from '../../../../packages/backend/generated/prisma/enums.js';
import { validateExpectedVersion, validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';

type PatchUserBody = {
  expectedVersion?: unknown;
  status?: unknown;
  displayName?: unknown;
  scope?: unknown;
  role?: unknown;
};

@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('ADMIN')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  listUsers(): Promise<UserView[]> {
    return this.usersService.listUsers();
  }

  @Post()
  createUser(@Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest): Promise<UserView> {
    const issues: ValidationIssue[] = [];
    if (typeof body.username !== 'string' || !/^[a-zA-Z0-9_\-.]{3,80}$/.test(body.username)) issues.push({ field: 'username', code: 'INVALID_USERNAME', message: '账号需为3至80位字母、数字、下划线、点或短横线' });
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) issues.push({ field: 'password', code: 'INVALID_PASSWORD', message: '密码需为8至128位' });
    if (typeof body.displayName !== 'string' || !body.displayName.trim() || body.displayName.trim().length > 120) issues.push({ field: 'displayName', code: 'INVALID_DISPLAY_NAME', message: '请填写姓名，最多120字' });
    const roles = ['ADMIN', 'PURCHASER', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER'];
    if (typeof body.role !== 'string' || !roles.includes(body.role)) issues.push({ field: 'role', code: 'INVALID_ROLE', message: '请选择有效角色' });
    const type = body.role === 'SUPPLIER' ? UserScopeType.SUPPLIER : ['STORE', 'STORE_FINANCE'].includes(String(body.role)) ? UserScopeType.STORE : UserScopeType.COMPANY;
    if (type === UserScopeType.STORE) issues.push(...validateUuid('storeId', body.storeId));
    if (type === UserScopeType.SUPPLIER) issues.push(...validateUuid('supplierId', body.supplierId));
    if ((type !== UserScopeType.STORE && body.storeId != null) || (type !== UserScopeType.SUPPLIER && body.supplierId != null)) issues.push({ field: 'scope', code: 'INVALID_SCOPE', message: '角色与所属门店或供应商不匹配' });
    throwIfInvalid(issues);
    return this.usersService.createUser({ username: body.username as string, password: body.password as string, displayName: (body.displayName as string).trim(), role: body.role as string,
      scope: { type, ...(type === UserScopeType.STORE ? { storeId: body.storeId as string } : {}), ...(type === UserScopeType.SUPPLIER ? { supplierId: body.supplierId as string } : {}) } }, masterDataAuditContext(request));
  }

  @Patch(':id')
  updateUser(@Param('id') id: string, @Body() body: PatchUserBody, @Req() request: AuthenticatedRequest): Promise<UserView> {
    const input = parsePatchUserInput(id, body);
    return this.usersService.updateUser(id, input, masterDataAuditContext(request));
  }

  @Post(':id/password')
  resetPassword(@Param('id') id: string, @Body() body: { password?: unknown; expectedVersion?: unknown }, @Req() request: AuthenticatedRequest) {
    throwIfInvalid([...validateUuid('id', id), ...validateExpectedVersion('expectedVersion', body.expectedVersion), ...passwordIssues(body.password)]);
    return this.usersService.resetPassword(id, body.password as string, body.expectedVersion as number, masterDataAuditContext(request));
  }

  @Post(':id/revoke-sessions')
  revokeSessions(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    throwIfInvalid(validateUuid('id', id));
    return this.usersService.revokeSessions(id, masterDataAuditContext(request));
  }
}

@Controller('auth')
@UseGuards(AuthGuard)
export class OwnPasswordController {
  constructor(private readonly usersService: UsersService) {}

  @Post('password')
  changePassword(@Body() body: { currentPassword?: unknown; password?: unknown }, @Req() request: AuthenticatedRequest) {
    const issues = passwordIssues(body.password);
    if (typeof body.currentPassword !== 'string' || !body.currentPassword || body.currentPassword.length > 128) issues.push({ field: 'currentPassword', code: 'INVALID_PASSWORD', message: '请填写当前密码' });
    throwIfInvalid(issues);
    const context = masterDataAuditContext(request);
    return this.usersService.changePassword(context.actorUserId, body.currentPassword as string, body.password as string, context);
  }
}

function passwordIssues(password: unknown): ValidationIssue[] {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128 ? [] : [{ field: 'password', code: 'INVALID_PASSWORD', message: '密码需为8至128位' }];
}

function parsePatchUserInput(id: string, body: PatchUserBody): {
  expectedVersion: number;
  status?: UserStatus;
  displayName?: string;
  scope?: { type: UserScopeType; storeId?: string; supplierId?: string };
  role?: string;
} {
  const issues: ValidationIssue[] = [
    ...validateUuid('id', id),
    ...validateExpectedVersion('expectedVersion', body.expectedVersion),
  ];

  let status: UserStatus | undefined;
  if (body.status !== undefined) {
    if (body.status === UserStatus.ACTIVE || body.status === UserStatus.DISABLED) {
      status = body.status;
    } else {
      issues.push({ field: 'status', code: 'INVALID_USER_STATUS', message: 'status must be ACTIVE or DISABLED' });
    }
  }

  let displayName: string | undefined;
  if (body.displayName !== undefined) {
    if (typeof body.displayName === 'string' && body.displayName.trim().length > 0 && body.displayName.trim().length <= 120) {
      displayName = body.displayName.trim();
    } else {
      issues.push({ field: 'displayName', code: 'INVALID_DISPLAY_NAME', message: 'displayName must be a non-empty string' });
    }
  }

  let scope: { type: UserScopeType; storeId?: string; supplierId?: string } | undefined;
  if (body.scope !== undefined) {
    const value = body.scope as Record<string, unknown>;
    const type = value && (value.type === UserScopeType.COMPANY || value.type === UserScopeType.STORE || value.type === UserScopeType.SUPPLIER) ? value.type : undefined;
    const storeId = value?.storeId;
    const supplierId = value?.supplierId;
    if (!type) issues.push({ field: 'scope.type', code: 'INVALID_SCOPE_TYPE', message: 'scope.type must be COMPANY, STORE or SUPPLIER' });
    if (type === UserScopeType.STORE && (typeof storeId !== 'string' || validateUuid('scope.storeId', storeId).length > 0)) issues.push({ field: 'scope.storeId', code: 'INVALID_SCOPE_ID', message: 'store scope requires a valid storeId' });
    if (type === UserScopeType.SUPPLIER && (typeof supplierId !== 'string' || validateUuid('scope.supplierId', supplierId).length > 0)) issues.push({ field: 'scope.supplierId', code: 'INVALID_SCOPE_ID', message: 'supplier scope requires a valid supplierId' });
    if ((type !== UserScopeType.STORE && storeId != null) || (type !== UserScopeType.SUPPLIER && supplierId != null)) issues.push({ field: 'scope', code: 'INVALID_SCOPE', message: '所属范围与门店或供应商不匹配' });
    if (type) scope = { type, ...(typeof storeId === 'string' ? { storeId } : {}), ...(typeof supplierId === 'string' ? { supplierId } : {}) };
  }

  if (body.role !== undefined && (typeof body.role !== 'string' || !['ADMIN', 'PURCHASER', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER'].includes(body.role))) issues.push({ field: 'role', code: 'INVALID_ROLE', message: '请选择有效角色' });
  throwIfInvalid(issues);

  return {
    expectedVersion: body.expectedVersion as number,
    status,
    displayName,
    scope,
    role: body.role as string | undefined,
  };
}
