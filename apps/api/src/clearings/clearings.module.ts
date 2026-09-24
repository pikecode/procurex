import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClearingsController } from './clearings.controller.js';
import { ClearingsService } from './clearings.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ClearingsController],
  providers: [ClearingsService],
})
export class ClearingsModule {}
