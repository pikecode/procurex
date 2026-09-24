import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { FreightConfirmationsController } from './freight-confirmations.controller.js';
import { FreightConfirmationsService } from './freight-confirmations.service.js';

@Module({
  imports: [AuthModule, CommandsModule],
  controllers: [FreightConfirmationsController],
  providers: [FreightConfirmationsService],
  exports: [FreightConfirmationsService],
})
export class FreightConfirmationsModule {}
