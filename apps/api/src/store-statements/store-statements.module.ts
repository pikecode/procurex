import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StoreStatementsController } from './store-statements.controller.js';
import { StoreStatementsService } from './store-statements.service.js';

@Module({
  imports: [AuthModule],
  controllers: [StoreStatementsController],
  providers: [StoreStatementsService],
})
export class StoreStatementsModule {}
