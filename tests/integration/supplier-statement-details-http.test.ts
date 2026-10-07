import assert from 'node:assert/strict';
import test from 'node:test';
import { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../packages/domain/src/password.js';

test('supplier statement details scope stores/products and preserve frozen base with separate adjustments', async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
  const prefix = `ITBILL${Date.now()}`;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  try {
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    const supplier = await db.supplier.create({ data: { code: prefix, name: 'Bill supplier', deliveryMode: 'SELF', defaultSettlementMode: 'STORED_VALUE', defaultSettlementCycle: 'MONTHLY' } });
    const foreign = await db.supplier.create({ data: { code: `${prefix}OTHER`, name: 'Other supplier', deliveryMode: 'SELF', defaultSettlementMode: 'STORED_VALUE', defaultSettlementCycle: 'MONTHLY' } });
    const role = await db.role.upsert({ where: { code: 'SUPPLIER' }, update: {}, create: { code: 'SUPPLIER', name: 'Supplier' } });
    const tokenFor = async (id: string, name: string) => {
      const username = `${prefix}${name}`;
      await db.user.create({ data: { username, displayName: name, passwordHash: await hashPassword('correct-password'),
        roles: { create: { roleId: role.id } }, scopes: { create: { scopeType: 'SUPPLIER', supplierId: id } } } });
      const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-password', client: 'WEB' }) });
      assert.equal(response.status, 201); return (await response.json() as { data: { accessToken: string } }).data.accessToken;
    };
    const token = await tokenFor(supplier.id, 'owner'), foreignToken = await tokenFor(foreign.id, 'foreign');
    const category = await db.category.create({ data: { code: prefix, name: 'Bill category' } });
    const unit = await db.unit.create({ data: { code: prefix, name: 'bottle' } });
    const product = await db.product.create({ data: { sku: prefix, name: 'Bill water', specification: '500 mL', categoryId: category.id, baseUnitId: unit.id } });
    const template = await db.orderTemplate.create({ data: { code: prefix, name: 'Bill template' } });
    const orders = [];
    for (const [index, goods] of ['12.34', '5.00'].entries()) {
      const store = await db.store.create({ data: { code: `${prefix}${index}`, name: `Bill hotel ${index}` } });
      const request = await db.purchaseRequest.create({ data: { requestNo: `${prefix}PR${index}`, storeId: store.id, templateId: template.id } });
      const order = await db.supplierOrder.create({ data: { supplierOrderNo: `${prefix}SO${index}`, requestId: request.id, storeId: store.id, supplierId: supplier.id,
        settlementMode: 'STORED_VALUE', settlementCycleSnapshot: 'MONTHLY', status: 'COMPLETED', firstShippedAt: new Date('2026-09-10T00:00:00Z'), supplyGoodsAmount: goods,
        items: { create: { productId: product.id, quantity: index ? '1' : '1.234', receivedQuantity: index ? '1' : '1.234', salesUnitPrice: '20', supplyUnitPrice: index ? '5' : '10', salesLineAmount: '25', supplyLineAmount: goods } } } });
      orders.push(order);
    }
    const first = orders[0]!, second = orders[1]!;
    const settlementId = Buffer.from(JSON.stringify({ kind: 'SUPPLIER_PAYABLE', supplierOrderId: first.id })).toString('base64url');
    await db.settlementItemSnapshot.create({ data: { settlementItemId: settlementId, supplierOrderId: first.id, kind: 'SUPPLIER_PAYABLE', goodsAmount: '20', freightAmount: '2', totalAmount: '22', sourceVersion: 1 } });
    await db.adjustmentDocument.create({ data: { supplierOrderId: second.id, storeId: second.storeId, supplierId: supplier.id,
      side: 'SUPPLIER', amount: '3', sourceRevision: 2, sourcePriceChangeId: '11111111-1111-4111-8111-111111111111',
      originalPeriodKey: 'MONTHLY:2026-09-01:2026-10-01', settlementPeriodKey: 'MONTHLY:2026-10-01:2026-11-01' } });
    const get = async (path: string, access = token) => {
      const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${access}` } });
      assert.equal(response.status, 200); return (await response.json() as { data: any }).data;
    };
    const totals = await get('/supplier-statements');
    const september = totals.find((item: any) => item.periodStart === '2026-09-01');
    const october = totals.find((item: any) => item.periodStart === '2026-10-01');
    assert.equal(september.storeCount, 2); assert.equal(september.goodsAmount, '25.00'); assert.equal(september.totalAmount, '27.00');
    assert.equal(october.storeCount, 1); assert.equal(october.lineCount, 0); assert.equal(october.adjustmentAmount, '3.00');
    const stores = await get(`/supplier-store-statements?supplierId=${supplier.id}`);
    const children = stores.filter((item: any) => item.parentStatementId === september.id);
    assert.equal(children.length, 2); assert.equal(children.find((item: any) => item.storeId === first.storeId).storeName, 'Bill hotel 0');
    const child = children.find((item: any) => item.storeId === first.storeId);
    const detail = await get(`/supplier-store-statements/${child.id}`);
    assert.equal(detail.parentStatementId, september.id); assert.equal(detail.goodsAmount, '20.00');
    assert.equal(detail.lines.length, 1); assert.equal(detail.lines[0].supplierOrderId, first.id);
    assert.equal(detail.lines[0].amountBasis, 'FROZEN'); assert.equal(detail.lines[0].productAmountBasis, 'CURRENT_ORDER');
    assert.equal(detail.lines[0].productGoodsAmount, '12.34'); assert.equal(detail.lines[0].goodsReconciliationAmount, '7.66');
    assert.equal(detail.lines[0].products[0].effectiveQuantity, '1.234000');
    assert.equal(detail.lines[0].products[0].productName, 'Bill water'); assert.equal(detail.lines[0].products[0].specification, '500 mL');
    assert.ok(!('salesUnitPrice' in detail.lines[0].products[0]));
    const parent = await get(`/supplier-statements/${september.id}`);
    assert.equal(parent.lines.find((item: any) => item.supplierOrderId === first.id).productGoodsAmount, '12.34');
    const adjustmentChild = stores.find((item: any) => item.parentStatementId === october.id);
    const adjustmentDetail = await get(`/supplier-store-statements/${adjustmentChild.id}`);
    assert.equal(adjustmentDetail.storeName, 'Bill hotel 1'); assert.equal(adjustmentDetail.lines.length, 0);
    assert.equal(adjustmentDetail.adjustmentItems[0].supplierOrderId, second.id);
    assert.equal(JSON.parse(Buffer.from(adjustmentDetail.adjustmentItems[0].adjustmentId, 'base64url').toString()).kind, 'PRICE_DOCUMENT');
    for (const path of [`/supplier-statements/${september.id}`, `/supplier-store-statements/${child.id}`]) {
      assert.equal((await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${foreignToken}` } })).status, 404);
    }
    assert.equal((await fetch(`${base}/supplier-store-statements?supplierId=${supplier.id}`, { headers: { authorization: `Bearer ${foreignToken}` } })).status, 403);
    const malformed = Buffer.from(JSON.stringify({ storeId: 'bad', supplierId: supplier.id, cycle: 'MONTHLY', periodStart: '2026-09-01', periodEndExclusive: '2026-10-01' })).toString('base64url');
    assert.equal((await fetch(`${base}/supplier-store-statements/${malformed}`, { headers: { authorization: `Bearer ${token}` } })).status, 404);
    assert.equal((await db.settlementItemSnapshot.findUniqueOrThrow({ where: { settlementItemId: settlementId } })).goodsAmount.toFixed(2), '20.00');
  } finally {
    await app.close();
    await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await db.adjustmentDocument.deleteMany({ where: { supplierId: { in: (await db.supplier.findMany({ where: { code: { startsWith: prefix } }, select: { id: true } })).map(item => item.id) } } });
    await db.supplierOrder.deleteMany({ where: { supplierOrderNo: { startsWith: prefix } } });
    await db.purchaseRequest.deleteMany({ where: { requestNo: { startsWith: prefix } } });
    await db.orderTemplate.deleteMany({ where: { code: prefix } }); await db.product.deleteMany({ where: { sku: prefix } });
    await db.category.deleteMany({ where: { code: prefix } }); await db.unit.deleteMany({ where: { code: prefix } });
    await db.store.deleteMany({ where: { code: { startsWith: prefix } } }); await db.supplier.deleteMany({ where: { code: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
