import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { DifferenceDisposalsController } from './difference-disposals.controller.js';
import { DifferenceDisposalsService } from './difference-disposals.service.js';

@Module({
  imports: [AuthModule, AuditModule, CommandsModule],
  controllers: [DifferenceDisposalsController],
  providers: [DifferenceDisposalsService],
})
export class DifferenceDisposalsModule {}
