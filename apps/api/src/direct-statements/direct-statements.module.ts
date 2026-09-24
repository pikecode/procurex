import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DirectStatementsController } from './direct-statements.controller.js';
import { DirectStatementsService } from './direct-statements.service.js';

@Module({ imports: [AuthModule], controllers: [DirectStatementsController], providers: [DirectStatementsService] })
export class DirectStatementsModule {}
