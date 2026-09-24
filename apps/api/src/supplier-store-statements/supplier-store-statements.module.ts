import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SupplierStoreStatementsController } from './supplier-store-statements.controller.js';
import { SupplierStoreStatementsService } from './supplier-store-statements.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SupplierStoreStatementsController],
  providers: [SupplierStoreStatementsService],
})
export class SupplierStoreStatementsModule {}
