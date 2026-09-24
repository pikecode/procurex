import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SupplierOrdersController } from './supplier-orders.controller.js';
import { SupplierOrdersService } from './supplier-orders.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SupplierOrdersController],
  providers: [SupplierOrdersService],
})
export class SupplierOrdersModule {}
