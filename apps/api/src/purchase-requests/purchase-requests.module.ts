import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { PurchaseRequestPreviewService } from './purchase-request-preview.service.js';
import { PurchaseRequestsController } from './purchase-requests.controller.js';
import { PurchaseRequestsService } from './purchase-requests.service.js';

@Module({
  imports: [AuthModule, AuditModule, CatalogModule, CommandsModule, PricingModule],
  controllers: [PurchaseRequestsController],
  providers: [PurchaseRequestPreviewService, PurchaseRequestsService],
})
export class PurchaseRequestsModule {}
