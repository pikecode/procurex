import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesService } from './templates.service.js';
import { PricingModule } from '../pricing/pricing.module.js';

@Module({
  imports: [AuditModule, AuthModule, PricingModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
