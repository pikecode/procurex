import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { DeliveryMode, FulfillmentStatus, PurchaseRequestStatus, SettlementMode, SupplierOrderStatus } from '../../packages/backend/generated/prisma/enums.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../packages/domain/src/password.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function appStart(): Promise<{ app: INestApplication; url: string }> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.listen(0, '127.0.0.1');
  return { app, url: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1` };
}

async function token(url: string, username: string): Promise<string> {
  const response = await fetch(`${url}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-password', client: 'web' }) });
  assert.equal(response.status, 201);
  return ((await response.json()) as { data: { accessToken: string } }).data.accessToken;
}

test('direct supplier-term statement pays and confirms goods plus freight over HTTP', async () => {
  const suffix = Date.now();
  const storeCode = `DIRSTORE${suffix}`, supplierCode = `DIRSUP${suffix}`, templateCode = `DIRTPL${suffix}`;
  const username = `it_direct_store_${suffix}`, supplierUsername = `it_direct_supplier_${suffix}`;
  const { app, url } = await appStart();
  let storeId: string | undefined;
  try {
    const [storeRole, supplierRole] = await Promise.all([
      prisma.role.upsert({ where: { code: 'STORE' }, update: {}, create: { code: 'STORE', name: 'Store' } }),
      prisma.role.upsert({ where: { code: 'SUPPLIER' }, update: {}, create: { code: 'SUPPLIER', name: 'Supplier' } }),
    ]);
    const [store, supplier, template] = await Promise.all([
      prisma.store.create({ data: { code: storeCode, name: 'Direct statement store' } }),
      prisma.supplier.create({ data: { code: supplierCode, name: 'Direct statement supplier', deliveryMode: DeliveryMode.SELF, defaultSettlementMode: SettlementMode.SUPPLIER_TERM, defaultSettlementCycle: 'MONTHLY' } }),
      prisma.orderTemplate.create({ data: { code: templateCode, name: 'Direct statement template' } }),
    ]);
    storeId = store.id;
    const [storeUser, supplierUser] = await Promise.all([
      prisma.user.create({ data: { username, displayName: username, passwordHash: await hashPassword('correct-password'), roles: { create: [{ roleId: storeRole.id }] }, scopes: { create: { scopeType: 'STORE', storeId: store.id } } } }),
      prisma.user.create({ data: { username: supplierUsername, displayName: supplierUsername, passwordHash: await hashPassword('correct-password'), roles: { create: [{ roleId: supplierRole.id }] }, scopes: { create: { scopeType: 'SUPPLIER', supplierId: supplier.id } } } }),
    ]);
    const request = await prisma.purchaseRequest.create({ data: { requestNo: `DIRREQ${suffix}`, storeId: store.id, templateId: template.id, status: PurchaseRequestStatus.CONFIRMED, salesGoodsAmount: '120.00', supplyGoodsAmount: '100.00' } });
    const order = await prisma.supplierOrder.create({ data: { supplierOrderNo: `DIRORDER${suffix}`, requestId: request.id, storeId: store.id, supplierId: supplier.id, settlementMode: SettlementMode.SUPPLIER_TERM, settlementCycleSnapshot: 'MONTHLY', status: SupplierOrderStatus.COMPLETED, fulfillmentStatus: FulfillmentStatus.COMPLETED, firstShippedAt: new Date('2026-09-10T00:00:00.000Z'), salesGoodsAmount: '120.00', supplyGoodsAmount: '100.00' } });
    await prisma.shipment.create({ data: { shipmentNo: `DIRSHIP${suffix}`, supplierOrderId: order.id, sequence: 1, kind: 'INITIAL', shippedAt: new Date('2026-09-10T00:00:00.000Z'), freight: '18.50' } });
    const storeToken = await token(url, storeUser.username);
    const supplierToken = await token(url, supplierUser.username);
    const listResponse = await fetch(`${url}/direct-statements?storeId=${store.id}&supplierId=${supplier.id}`, { headers: { authorization: `Bearer ${storeToken}` } });
    assert.equal(listResponse.status, 200);
    const list = (await listResponse.json()) as { data: Array<{ id: string; totalAmount: string; freightAmount: string; settlementStatus: string }> };
    assert.equal(list.data.length, 1);
    const statement = list.data[0]!;
    assert.equal(statement.freightAmount, '18.50');
    assert.equal(statement.totalAmount, '138.50');
    assert.equal(statement.settlementStatus, 'OPEN');
    const detailResponse = await fetch(`${url}/direct-statements/${statement.id}`, { headers: { authorization: `Bearer ${storeToken}` } });
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()) as { data: { lines: Array<{ settlementItemId: string; goodsAmount: string; freightAmount: string; totalAmount: string }> } };
    const line = detail.data.lines[0]!;
    assert.deepEqual([line.goodsAmount, line.freightAmount, line.totalAmount], ['120.00', '18.50', '138.50']);
    const previewResponse = await fetch(`${url}/payment-records/preview`, { method: 'POST', headers: { authorization: `Bearer ${storeToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ settlementItemIds: [line.settlementItemId] }) });
    assert.equal(previewResponse.status, 201);
    const preview = (await previewResponse.json()) as { data: { direction: string; channel: string; supplierId: string; totalPayableAmount: string; items: Array<{ sourceVersion: number; payableAmount: string }> } };
    assert.deepEqual([preview.data.direction, preview.data.channel, preview.data.supplierId, preview.data.totalPayableAmount], ['STORE_TO_SUPPLIER', 'DIRECT', supplier.id, '138.50']);
    const create = async () => fetch(`${url}/payment-records`, { method: 'POST', headers: { authorization: `Bearer ${storeToken}`, 'content-type': 'application/json', 'idempotency-key': `direct-payment-${suffix}` }, body: JSON.stringify({ direction: 'STORE_TO_SUPPLIER', businessDate: '2026-09-27', items: [{ settlementItemId: line.settlementItemId, expectedVersion: preview.data.items[0]!.sourceVersion, expectedAmount: preview.data.items[0]!.payableAmount }] }) });
    const paymentResponse = await create();
    assert.equal(paymentResponse.status, 201);
    const payment = (await paymentResponse.json()) as { data: { id: string; amount: string; status: string; version: number } };
    assert.deepEqual([payment.data.amount, payment.data.status], ['138.50', 'PENDING']);
    const replayResponse = await create();
    assert.equal(replayResponse.status, 201);
    assert.equal(((await replayResponse.json()) as { data: { id: string } }).data.id, payment.data.id);
    const confirmResponse = await fetch(`${url}/payment-records/${payment.data.id}/confirm`, { method: 'POST', headers: { authorization: `Bearer ${supplierToken}`, 'content-type': 'application/json', 'idempotency-key': `direct-confirm-${suffix}` }, body: JSON.stringify({ expectedVersion: payment.data.version }) });
    assert.equal(confirmResponse.status, 201);
    const confirmed = (await confirmResponse.json()) as { data: { status: string; version: number } };
    assert.deepEqual([confirmed.data.status, confirmed.data.version], ['CONFIRMED', 2]);
    const settledResponse = await fetch(`${url}/direct-statements/${statement.id}`, { headers: { authorization: `Bearer ${storeToken}` } });
    assert.equal(settledResponse.status, 200);
    const settled = (await settledResponse.json()) as { data: { settlementStatus: string; confirmedPaidAmount: string; totalAmount: string } };
    assert.deepEqual([settled.data.settlementStatus, settled.data.confirmedPaidAmount, settled.data.totalAmount], ['SETTLED', '138.50', '138.50']);
    const snapshot = await prisma.settlementItemSnapshot.findUnique({ where: { settlementItemId: line.settlementItemId } });
    assert.deepEqual([snapshot?.goodsAmount.toFixed(2), snapshot?.freightAmount.toFixed(2), snapshot?.totalAmount.toFixed(2)], ['120.00', '18.50', '138.50']);
  } finally {
    await app.close();
    await prisma.paymentRecord.deleteMany({ where: { supplierId: { in: await prisma.supplier.findMany({ where: { code: supplierCode }, select: { id: true } }).then((rows) => rows.map(({ id }) => id)) } } });
    if (storeId) {
      const orders = await prisma.supplierOrder.findMany({ where: { storeId }, select: { id: true } });
      await prisma.shipment.deleteMany({ where: { supplierOrderId: { in: orders.map(({ id }) => id) } } });
      await prisma.supplierOrder.deleteMany({ where: { storeId } });
    }
    await prisma.purchaseRequest.deleteMany({ where: { requestNo: `DIRREQ${suffix}` } });
    await prisma.store.deleteMany({ where: { code: storeCode } });
    await prisma.supplier.deleteMany({ where: { code: supplierCode } });
    await prisma.orderTemplate.deleteMany({ where: { code: templateCode } });
    await prisma.commandRecord.deleteMany({ where: { actor: { username: { in: [username, supplierUsername] } } } });
    await prisma.userSession.deleteMany({ where: { user: { username: { in: [username, supplierUsername] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [username, supplierUsername] } } });
    await prisma.$disconnect();
  }
});
