import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { CommandsModule } from './commands/commands.module.js';
import { TraceIdMiddleware } from './common/trace-id.middleware.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health.controller.js';
import { PricingModule } from './pricing/pricing.module.js';
import { PurchaseRequestsModule } from './purchase-requests/purchase-requests.module.js';
import { ShipmentsModule } from './shipments/shipments.module.js';
import { StoresModule } from './stores/stores.module.js';
import { SupplierOrdersModule } from './supplier-orders/supplier-orders.module.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';
import { TemplatesModule } from './templates/templates.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    DatabaseModule,
    CommandsModule,
    AuthModule,
    UsersModule,
    StoresModule,
    SuppliersModule,
    CatalogModule,
    PricingModule,
    TemplatesModule,
    PurchaseRequestsModule,
    SupplierOrdersModule,
    ShipmentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceIdMiddleware).forRoutes('{*path}');
  }
}
