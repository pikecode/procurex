import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { AuditService } from './audit.service.js';

@Controller('audit-logs')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('ADMIN', 'HQ_FINANCE')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list() {
    return this.audit.listRecent();
  }
}
