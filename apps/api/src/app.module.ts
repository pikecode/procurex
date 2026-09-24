import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CommandsModule } from './commands/commands.module.js';
import { TraceIdMiddleware } from './common/trace-id.middleware.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [DatabaseModule, CommandsModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceIdMiddleware).forRoutes('{*path}');
  }
}
