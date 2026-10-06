import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards, ConflictException } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { auditedMasterDataTransaction, masterDataAuditContext } from '../audit/master-data-audit.js';
import { profileText } from '../common/master-data-profile.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { validateExpectedVersion, validateUuid, type ValidationIssue } from '../../../../packages/domain/src/validation.js';

@Controller('collection-accounts')
@UseGuards(AuthGuard, RolesGuard)
export class CollectionAccountsController {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService) {}

  @Get()
  @RequireRoles('ADMIN', 'HQ_FINANCE')
  list() { return this.database.client.collectionAccount.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] }); }

  @Post()
  @RequireRoles('ADMIN', 'HQ_FINANCE')
  create(@Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.write(undefined, body, request);
  }

  @Patch(':id')
  @RequireRoles('ADMIN', 'HQ_FINANCE')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.write(id, body, request);
  }

  private write(id: string | undefined, body: Record<string, unknown>, request: AuthenticatedRequest) {
    const issues: ValidationIssue[] = id ? [...validateUuid('id', id), ...validateExpectedVersion('expectedVersion', body.expectedVersion)] : [];
    const data = {
      name: profileText('name', body.name, 120, true, false, issues)!,
      bankName: profileText('bankName', body.bankName, 120, true, false, issues)!,
      accountName: profileText('accountName', body.accountName, 120, true, false, issues)!,
      accountNo: profileText('accountNo', body.accountNo, 80, true, false, issues)!,
      status: (body.status ?? 'ACTIVE') as 'ACTIVE' | 'DISABLED',
    };
    if (!['ACTIVE', 'DISABLED'].includes(data.status)) issues.push({ field: 'status', code: 'INVALID_PROFILE_CHOICE', message: 'Invalid account status' });
    throwIfInvalid(issues);
    return auditedMasterDataTransaction(this.database, this.audit, masterDataAuditContext(request),
      id ? 'collection-account.update' : 'collection-account.create', 'CollectionAccount', async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.collection-accounts'))`;
        if (await tx.collectionAccount.findFirst({ where: { name: data.name, ...(id ? { id: { not: id } } : {}) } }))
          throw new ConflictException({ code: 'COLLECTION_ACCOUNT_NAME_EXISTS', message: 'Account name already exists' });
        if (!id) return tx.collectionAccount.create({ data });
        const changed = await tx.collectionAccount.updateMany({ where: { id, version: body.expectedVersion as number }, data: { ...data, version: { increment: 1 } } });
        if (!changed.count) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Collection account has changed' });
        return tx.collectionAccount.findUniqueOrThrow({ where: { id } });
      });
  }
}
