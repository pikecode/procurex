import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { throwIfInvalid } from '../common/request-contract.js';
import { validateUuid } from '../../../../packages/domain/src/validation.js';
import { type ClearingDocumentDetailView, ClearingsService } from './clearings.service.js';

@Controller('clearings')
@UseGuards(AuthGuard, RolesGuard)
export class ClearingsController {
  constructor(private readonly clearingsService: ClearingsService) {}

  @Get(':id')
  @RequireRoles('ADMIN', 'HQ_FINANCE', 'STORE')
  get(@Param('id') id: string): Promise<ClearingDocumentDetailView> {
    throwIfInvalid(validateUuid('id', id));
    return this.clearingsService.get(id);
  }
}
