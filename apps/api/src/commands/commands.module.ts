import { Module } from '@nestjs/common';
import { CommandsService } from './commands.service.js';
import { CommandsController } from './commands.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CommandsController],
  providers: [CommandsService],
  exports: [CommandsService],
})
export class CommandsModule {}
