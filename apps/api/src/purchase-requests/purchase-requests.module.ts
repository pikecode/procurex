import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { PurchaseRequestPreviewService } from './purchase-request-preview.service.js';
import { PurchaseRequestsController } from './purchase-requests.controller.js';

@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [PurchaseRequestsController],
  providers: [PurchaseRequestPreviewService],
})
export class PurchaseRequestsModule {}
