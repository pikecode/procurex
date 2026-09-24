import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { validateUuid } from '../../../../packages/domain/src/validation.js';
import { type RechargeDocumentDetailView, RechargesService } from './recharges.service.js';

@Controller('recharges')
@UseGuards(AuthGuard, RolesGuard)
export class RechargesController {
  constructor(private readonly rechargesService: RechargesService) {}

  @Get(':id')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE')
  get(@Param('id') id: string): Promise<RechargeDocumentDetailView> {
    throwIfInvalid(validateUuid('id', id));
    return this.rechargesService.get(id);
  }
}
