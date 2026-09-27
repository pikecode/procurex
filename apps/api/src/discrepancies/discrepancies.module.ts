import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { DiscrepanciesController } from './discrepancies.controller.js';
import { DiscrepanciesService } from './discrepancies.service.js';

@Module({
  imports: [AuthModule, AuditModule, CommandsModule],
  controllers: [DiscrepanciesController],
  providers: [DiscrepanciesService],
})
export class DiscrepanciesModule {}
