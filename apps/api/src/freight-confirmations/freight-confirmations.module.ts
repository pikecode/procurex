import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { FreightConfirmationsController } from './freight-confirmations.controller.js';
import { FreightConfirmationsService } from './freight-confirmations.service.js';

@Module({
  imports: [AuthModule, AuditModule, CommandsModule],
  controllers: [FreightConfirmationsController],
  providers: [FreightConfirmationsService],
  exports: [FreightConfirmationsService],
})
export class FreightConfirmationsModule {}
