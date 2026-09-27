import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommandsModule } from '../commands/commands.module.js';
import { PaymentRecordsController } from './payment-records.controller.js';
import { PaymentRecordsService } from './payment-records.service.js';

@Module({
  imports: [AuthModule, AuditModule, CommandsModule],
  controllers: [PaymentRecordsController],
  providers: [PaymentRecordsService],
})
export class PaymentRecordsModule {}
