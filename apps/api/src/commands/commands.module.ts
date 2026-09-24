import { Module } from '@nestjs/common';
import { CommandsService } from './commands.service.js';

@Module({
  providers: [CommandsService],
  exports: [CommandsService],
})
export class CommandsModule {}
