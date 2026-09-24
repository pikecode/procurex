import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentRecordsController } from './payment-records.controller.js';
import { PaymentRecordsService } from './payment-records.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PaymentRecordsController],
  providers: [PaymentRecordsService],
})
export class PaymentRecordsModule {}
