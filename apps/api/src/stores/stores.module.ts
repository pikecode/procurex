import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { StoresController } from './stores.controller.js';
import { StoresService } from './stores.service.js';
import { StoreGroupsController } from './store-groups.controller.js';
import { StoreGroupsService } from './store-groups.service.js';
import { CollectionAccountsController } from './collection-accounts.controller.js';

@Module({
  imports: [AuthModule, AuditModule, CommandsModule],
  controllers: [StoresController, StoreGroupsController, CollectionAccountsController],
  providers: [StoresService, StoreGroupsService],
})
export class StoresModule {}
