import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SupplierStatementsController } from './supplier-statements.controller.js';
import { SupplierStatementsService } from './supplier-statements.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SupplierStatementsController],
  providers: [SupplierStatementsService],
})
export class SupplierStatementsModule {}
