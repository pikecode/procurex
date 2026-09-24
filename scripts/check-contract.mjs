import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing expected contract fragment: ${expected}`);
  }
}

const [
  apiDesign,
  packageJson,
  apiMain,
  healthController,
  prismaSchema,
  validation,
  authController,
  usersController,
  storesController,
  suppliersController,
  catalogController,
  clearingsController,
  discrepanciesController,
  freightConfirmationsController,
  paymentRecordsController,
  pricingService,
  pricingController,
  purchaseRequestsController,
  rechargesController,
  storeStatementsController,
  supplierOrdersController,
  supplierStoreStatementsController,
  supplierStatementsController,
  shipmentsController,
  templatesController,
] = await Promise.all([
  readProjectFile('docs/api-design.md'),
  readProjectFile('package.json'),
  readProjectFile('apps/api/main.ts'),
  readProjectFile('apps/api/src/health.controller.ts'),
  readProjectFile('database/schema.prisma'),
  readProjectFile('packages/domain/src/validation.ts'),
    readProjectFile('apps/api/src/auth/auth.controller.ts'),
    readProjectFile('apps/api/src/users/users.controller.ts'),
  readProjectFile('apps/api/src/stores/stores.controller.ts'),
    readProjectFile('apps/api/src/suppliers/suppliers.controller.ts'),
  readProjectFile('apps/api/src/catalog/catalog.controller.ts'),
  readProjectFile('apps/api/src/clearings/clearings.controller.ts'),
  readProjectFile('apps/api/src/discrepancies/discrepancies.controller.ts'),
  readProjectFile('apps/api/src/freight-confirmations/freight-confirmations.controller.ts'),
  readProjectFile('apps/api/src/payment-records/payment-records.controller.ts'),
  readProjectFile('apps/api/src/pricing/pricing.service.ts'),
    readProjectFile('apps/api/src/pricing/pricing.controller.ts'),
  readProjectFile('apps/api/src/purchase-requests/purchase-requests.controller.ts'),
  readProjectFile('apps/api/src/recharges/recharges.controller.ts'),
  readProjectFile('apps/api/src/store-statements/store-statements.controller.ts'),
    readProjectFile('apps/api/src/supplier-orders/supplier-orders.controller.ts'),
  readProjectFile('apps/api/src/supplier-store-statements/supplier-store-statements.controller.ts'),
  readProjectFile('apps/api/src/supplier-statements/supplier-statements.controller.ts'),
    readProjectFile('apps/api/src/shipments/shipments.controller.ts'),
    readProjectFile('apps/api/src/templates/templates.controller.ts'),
  ]);

const pkg = JSON.parse(packageJson);

assertIncludes(apiDesign, '基础路径 `/api/v1`', 'api design');
assertIncludes(apiMain, "app.setGlobalPrefix('api/v1')", 'api bootstrap');

assertIncludes(apiDesign, '成功 | 单对象 `{data, traceId}`', 'api design');
assertIncludes(apiMain, 'new ResponseEnvelopeInterceptor()', 'api bootstrap');
assertIncludes(apiMain, 'new ApiExceptionFilter()', 'api bootstrap');

assertIncludes(apiDesign, '`Idempotency-Key` 请求头', 'api design');
assertIncludes(prismaSchema, 'model CommandRecord', 'prisma schema');
assertIncludes(prismaSchema, '@@unique([actorUserId, action, idempotencyKey])', 'prisma schema');
assertIncludes(validation, 'validateIdempotencyKey', 'domain validation');
assertIncludes(validation, 'validateDecimalString', 'domain validation');
assertIncludes(prismaSchema, 'model UserSession', 'prisma schema');
assertIncludes(apiDesign, '`POST /auth/login`', 'api design');
assertIncludes(authController, "@Post('auth/login')", 'auth controller');
assertIncludes(authController, "@Get('me')", 'auth controller');
assertIncludes(apiDesign, '`GET/POST /users`、`PATCH /users/{id}`', 'api design');
assertIncludes(usersController, "@Controller('users')", 'users controller');
assertIncludes(usersController, "@RequireRoles('ADMIN')", 'users controller');
assertIncludes(apiDesign, '`GET/POST /stores`、`GET/PATCH /stores/{id}`', 'api design');
assertIncludes(storesController, "@Controller('stores')", 'stores controller');
assertIncludes(apiDesign, '`GET /stores/{id}/account`、`GET /stores/{id}/ledgers`', 'api design');
assertIncludes(storesController, "@Get(':id/account')", 'stores controller');
assertIncludes(storesController, "@Get(':id/ledgers')", 'stores controller');
assertIncludes(apiDesign, '`POST /stores/{id}/recharges`', 'api design');
assertIncludes(storesController, "@Post(':id/recharges')", 'stores controller');
assertIncludes(prismaSchema, 'model RechargeDocument', 'prisma schema');
assertIncludes(apiDesign, '`PATCH /stores/{id}/credit-limit`', 'api design');
assertIncludes(storesController, "@Patch(':id/credit-limit')", 'stores controller');
assertIncludes(apiDesign, '`POST /stores/{id}/clearings/preview`', 'api design');
assertIncludes(storesController, "@Post(':id/clearings/preview')", 'stores controller');
assertIncludes(prismaSchema, 'model FundingAllocation', 'prisma schema');
assertIncludes(apiDesign, '`POST /stores/{id}/clearings`', 'api design');
assertIncludes(storesController, "@Post(':id/clearings')", 'stores controller');
assertIncludes(prismaSchema, 'model ClearingDocument', 'prisma schema');
assertIncludes(prismaSchema, 'model ClearingItem', 'prisma schema');
assertIncludes(apiDesign, '`GET /recharges/{id}`', 'api design');
assertIncludes(rechargesController, "@Controller('recharges')", 'recharges controller');
assertIncludes(rechargesController, "@Get(':id')", 'recharges controller');
assertIncludes(apiDesign, '`GET /clearings/{id}`', 'api design');
assertIncludes(clearingsController, "@Controller('clearings')", 'clearings controller');
assertIncludes(clearingsController, "@Get(':id')", 'clearings controller');
assertIncludes(apiDesign, '`GET /store-statements`、`GET /store-statements/{id}`', 'api design');
assertIncludes(storeStatementsController, "@Controller('store-statements')", 'store statements controller');
assertIncludes(storeStatementsController, '@Get()', 'store statements controller');
assertIncludes(storeStatementsController, "@Get(':id')", 'store statements controller');
assertIncludes(apiDesign, '`GET /supplier-statements`、`GET /supplier-statements/{id}`', 'api design');
assertIncludes(supplierStatementsController, "@Controller('supplier-statements')", 'supplier statements controller');
assertIncludes(supplierStatementsController, '@Get()', 'supplier statements controller');
assertIncludes(supplierStatementsController, "@Get(':id')", 'supplier statements controller');
assertIncludes(apiDesign, '`GET /supplier-store-statements`、`GET /supplier-store-statements/{id}`', 'api design');
assertIncludes(supplierStoreStatementsController, "@Controller('supplier-store-statements')", 'supplier store statements controller');
assertIncludes(supplierStoreStatementsController, '@Get()', 'supplier store statements controller');
assertIncludes(supplierStoreStatementsController, "@Get(':id')", 'supplier store statements controller');
assertIncludes(apiDesign, '`POST /payment-records/preview`', 'api design');
assertIncludes(paymentRecordsController, "@Controller('payment-records')", 'payment records controller');
assertIncludes(paymentRecordsController, "@Post('preview')", 'payment records controller');
assertIncludes(apiDesign, '`POST /payment-records`', 'api design');
assertIncludes(paymentRecordsController, '@Post()', 'payment records controller');
assertIncludes(prismaSchema, 'model PaymentRecord', 'prisma schema');
assertIncludes(prismaSchema, 'model PaymentAllocation', 'prisma schema');
assertIncludes(apiDesign, '`GET/POST /suppliers`、`GET/PATCH /suppliers/{id}`', 'api design');
assertIncludes(suppliersController, "@Controller('suppliers')", 'suppliers controller');
assertIncludes(apiDesign, '`GET/PUT /suppliers/{id}/products`', 'api design');
assertIncludes(suppliersController, "@Put(':id/products')", 'suppliers controller');
assertIncludes(apiDesign, '`GET/POST /products`', 'api design');
assertIncludes(catalogController, "@Post('products')", 'catalog controller');
assertIncludes(catalogController, "@Post('categories')", 'catalog controller');
assertIncludes(catalogController, "@Post('units')", 'catalog controller');
assertIncludes(apiDesign, '`GET /stores/{id}/catalog`', 'api design');
assertIncludes(catalogController, "@Get('stores/:id/catalog')", 'catalog controller');
assertIncludes(apiDesign, '`POST /prices/impact-preview`', 'api design');
assertIncludes(pricingService, 'getEffectivePrice', 'pricing service');
assertIncludes(apiDesign, '`POST /price-changes`', 'api design');
assertIncludes(pricingController, "@Post('price-changes')", 'pricing controller');
assertIncludes(pricingController, "@Get('price-scopes/:id/versions')", 'pricing controller');
assertIncludes(apiDesign, '`POST /purchase-requests/preview`', 'api design');
assertIncludes(purchaseRequestsController, "@Post('preview')", 'purchase requests controller');
assertIncludes(apiDesign, '`POST /purchase-requests`', 'api design');
assertIncludes(purchaseRequestsController, '@Post()', 'purchase requests controller');
assertIncludes(apiDesign, '`GET /purchase-requests`、`GET /purchase-requests/{id}`', 'api design');
assertIncludes(purchaseRequestsController, '@Get()', 'purchase requests controller');
assertIncludes(purchaseRequestsController, "@Get(':id')", 'purchase requests controller');
assertIncludes(apiDesign, '`PATCH /purchase-requests/{id}/items`', 'api design');
assertIncludes(purchaseRequestsController, "@Patch(':id/items')", 'purchase requests controller');
assertIncludes(apiDesign, '`POST /purchase-requests/{id}/reassign-preview`', 'api design');
assertIncludes(purchaseRequestsController, "@Post(':id/reassign-preview')", 'purchase requests controller');
assertIncludes(apiDesign, '`POST /purchase-requests/{id}/assign`', 'api design');
assertIncludes(purchaseRequestsController, "@Post(':id/assign')", 'purchase requests controller');
assertIncludes(apiDesign, '`POST /purchase-requests/{id}/confirm`', 'api design');
assertIncludes(purchaseRequestsController, "@Post(':id/confirm')", 'purchase requests controller');
assertIncludes(apiDesign, '`POST /purchase-requests/{id}/reject`', 'api design');
assertIncludes(purchaseRequestsController, "@Post(':id/reject')", 'purchase requests controller');
assertIncludes(apiDesign, '`GET /supplier-orders`、`GET /supplier-orders/{id}`', 'api design');
assertIncludes(supplierOrdersController, "@Controller('supplier-orders')", 'supplier orders controller');
assertIncludes(supplierOrdersController, '@Get()', 'supplier orders controller');
assertIncludes(supplierOrdersController, "@Get(':id')", 'supplier orders controller');
assertIncludes(apiDesign, '`POST /supplier-orders/{id}/reject`', 'api design');
assertIncludes(supplierOrdersController, "@Post(':id/reject')", 'supplier orders controller');
assertIncludes(apiDesign, '`POST /supplier-orders/{id}/shipment-preview`', 'api design');
assertIncludes(supplierOrdersController, "@Post(':id/shipment-preview')", 'supplier orders controller');
assertIncludes(supplierOrdersController, 'freightConfirmationId', 'supplier orders controller');
assertIncludes(apiDesign, '`POST /supplier-orders/{id}/shipments`', 'api design');
assertIncludes(supplierOrdersController, "@Post(':id/shipments')", 'supplier orders controller');
assertIncludes(supplierOrdersController, 'gapAllocations', 'supplier orders controller');
assertIncludes(prismaSchema, 'model ShipmentGapAllocation', 'prisma schema');
assertIncludes(prismaSchema, 'freightConfirmationId String?', 'prisma schema');
assertIncludes(apiDesign, '`POST /shipments/{id}/receipts`', 'api design');
assertIncludes(shipmentsController, "@Post(':id/receipts')", 'shipments controller');
assertIncludes(apiDesign, '`POST /discrepancies/{id}/resolve`', 'api design');
assertIncludes(discrepanciesController, "@Post(':id/resolve')", 'discrepancies controller');
assertIncludes(prismaSchema, 'model ReplenishmentGap', 'prisma schema');
assertIncludes(prismaSchema, 'enum ReplenishmentGapStatus', 'prisma schema');
assertIncludes(prismaSchema, 'model DiscrepancyReturn', 'prisma schema');
assertIncludes(apiDesign, '`POST /supplier-orders/{id}/freight-confirmations`', 'api design');
assertIncludes(supplierOrdersController, "@Post(':id/freight-confirmations')", 'supplier orders controller');
assertIncludes(apiDesign, '`POST /freight-confirmations/{id}/confirm`', 'api design');
assertIncludes(freightConfirmationsController, "@Post(':id/confirm')", 'freight confirmations controller');
assertIncludes(freightConfirmationsController, "@Post(':id/reject')", 'freight confirmations controller');
assertIncludes(apiDesign, '`POST /purchase-requests/{id}/reallocate`', 'api design');
assertIncludes(purchaseRequestsController, "@Post(':id/reallocate')", 'purchase requests controller');
assertIncludes(apiDesign, '`POST /supplier-orders/{id}/reconcile-funding`', 'api design');
assertIncludes(supplierOrdersController, "@Post(':id/reconcile-funding')", 'supplier orders controller');
assertIncludes(apiDesign, '`GET/POST /templates`', 'api design');
assertIncludes(templatesController, "@Controller('templates')", 'templates controller');
assertIncludes(templatesController, "@Put(':id/stores')", 'templates controller');
assertIncludes(templatesController, "@Put(':id/items')", 'templates controller');
assertIncludes(templatesController, "@Put(':id/supplier-settings/:supplierId')", 'templates controller');

assertIncludes(apiDesign, '`GET /health/live`、`GET /health/ready`', 'api design');
assertIncludes(healthController, "@Get('live')", 'health controller');
assertIncludes(healthController, "@Get('ready')", 'health controller');

if (pkg.scripts?.['contract:check'] !== 'node scripts/check-contract.mjs') {
  throw new Error('package.json contract:check script must run scripts/check-contract.mjs');
}

console.log('Contract check passed.');
