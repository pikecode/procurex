import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AdjustmentsModule } from './adjustments/adjustments.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { ClearingsModule } from './clearings/clearings.module.js';
import { CommandsModule } from './commands/commands.module.js';
import { TraceIdMiddleware } from './common/trace-id.middleware.js';
import { DatabaseModule } from './database/database.module.js';
import { DirectStatementsModule } from './direct-statements/direct-statements.module.js';
import { DifferenceDisposalsModule } from './difference-disposals/difference-disposals.module.js';
import { DiscrepanciesModule } from './discrepancies/discrepancies.module.js';
import { FreightConfirmationsModule } from './freight-confirmations/freight-confirmations.module.js';
import { HealthController } from './health.controller.js';
import { PaymentRecordsModule } from './payment-records/payment-records.module.js';
import { PricingModule } from './pricing/pricing.module.js';
import { PurchaseRequestsModule } from './purchase-requests/purchase-requests.module.js';
import { RechargesModule } from './recharges/recharges.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ShipmentsModule } from './shipments/shipments.module.js';
import { StoreStatementsModule } from './store-statements/store-statements.module.js';
import { StoresModule } from './stores/stores.module.js';
import { SupplierOrdersModule } from './supplier-orders/supplier-orders.module.js';
import { SupplierStoreStatementsModule } from './supplier-store-statements/supplier-store-statements.module.js';
import { SupplierStatementsModule } from './supplier-statements/supplier-statements.module.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';
import { TemplatesModule } from './templates/templates.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    DatabaseModule,
    DirectStatementsModule,
    AdjustmentsModule,
    CommandsModule,
    AuthModule,
    UsersModule,
    StoresModule,
    SuppliersModule,
    CatalogModule,
    ClearingsModule,
    PaymentRecordsModule,
    PricingModule,
    TemplatesModule,
    PurchaseRequestsModule,
    SupplierOrdersModule,
    ShipmentsModule,
    DifferenceDisposalsModule,
    DiscrepanciesModule,
    FreightConfirmationsModule,
    RechargesModule,
    ReportsModule,
    StoreStatementsModule,
    SupplierStatementsModule,
    SupplierStoreStatementsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceIdMiddleware).forRoutes('{*path}');
  }
}
