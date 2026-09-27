import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { FreightConfirmationsModule } from '../freight-confirmations/freight-confirmations.module.js';
import { SupplierOrdersController } from './supplier-orders.controller.js';
import { SupplierOrdersService } from './supplier-orders.service.js';

@Module({
  imports: [AuthModule, AuditModule, CommandsModule, FreightConfirmationsModule],
  controllers: [SupplierOrdersController],
  providers: [SupplierOrdersService],
})
export class SupplierOrdersModule {}
