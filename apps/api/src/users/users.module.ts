import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OwnPasswordController, UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [UsersController, OwnPasswordController],
  providers: [UsersService],
})
export class UsersModule {}
