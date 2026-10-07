import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { CatalogRegistriesService } from './catalog-registries.service.js';

@Module({
  imports: [AuditModule, AuthModule, PricingModule],
  controllers: [CatalogController],
  providers: [CatalogService, CatalogRegistriesService],
  exports: [CatalogService],
})
export class CatalogModule {}
