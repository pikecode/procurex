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
  pricingService,
  pricingController,
  purchaseRequestsController,
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
    readProjectFile('apps/api/src/pricing/pricing.service.ts'),
    readProjectFile('apps/api/src/pricing/pricing.controller.ts'),
    readProjectFile('apps/api/src/purchase-requests/purchase-requests.controller.ts'),
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
assertIncludes(apiDesign, '`POST /purchase-requests/{id}/confirm`', 'api design');
assertIncludes(purchaseRequestsController, "@Post(':id/confirm')", 'purchase requests controller');
assertIncludes(apiDesign, '`POST /purchase-requests/{id}/reject`', 'api design');
assertIncludes(purchaseRequestsController, "@Post(':id/reject')", 'purchase requests controller');
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
