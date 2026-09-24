import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RechargesController } from './recharges.controller.js';
import { RechargesService } from './recharges.service.js';

@Module({
  imports: [AuthModule],
  controllers: [RechargesController],
  providers: [RechargesService],
})
export class RechargesModule {}
