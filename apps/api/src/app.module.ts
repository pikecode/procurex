import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TraceIdMiddleware } from './common/trace-id.middleware.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceIdMiddleware).forRoutes('{*path}');
  }
}
