import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesService } from './templates.service.js';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
