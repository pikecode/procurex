import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { StoresController } from './stores.controller.js';
import { StoresService } from './stores.service.js';

@Module({
  imports: [AuthModule, CommandsModule],
  controllers: [StoresController],
  providers: [StoresService],
})
export class StoresModule {}
