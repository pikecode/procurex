import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
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

  @Patch(':id')
  updateUser(@Param('id') id: string, @Body() body: PatchUserBody): Promise<UserView> {
    const input = parsePatchUserInput(id, body);
    return this.usersService.updateUser(id, input);
  }
}

function parsePatchUserInput(id: string, body: PatchUserBody): {
  expectedVersion: number;
  status?: UserStatus;
  displayName?: string;
  scope?: { type: UserScopeType; storeId?: string; supplierId?: string };
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
    if (typeof body.displayName === 'string' && body.displayName.trim().length > 0) {
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
    if (type) scope = { type, ...(typeof storeId === 'string' ? { storeId } : {}), ...(typeof supplierId === 'string' ? { supplierId } : {}) };
  }

  throwIfInvalid(issues);

  return {
    expectedVersion: body.expectedVersion as number,
    status,
    displayName,
    scope,
  };
}
