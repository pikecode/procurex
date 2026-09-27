import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ReconciliationService } from './reconciliation.service.js';

@Controller('reconciliation-issues')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('ADMIN', 'HQ_FINANCE')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get()
  list() {
    return this.reconciliation.listIssues();
  }
}
