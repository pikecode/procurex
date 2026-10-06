import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, HttpException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { PurchaseRequestsController } from '../../apps/api/src/purchase-requests/purchase-requests.controller.js';
import { PurchaseRequestsService } from '../../apps/api/src/purchase-requests/purchase-requests.service.js';
import { PurchaseRequestPreviewService } from '../../apps/api/src/purchase-requests/purchase-request-preview.service.js';
import { CatalogService } from '../../apps/api/src/catalog/catalog.service.js';
import { PricingController } from '../../apps/api/src/pricing/pricing.controller.js';
import { PricingService } from '../../apps/api/src/pricing/pricing.service.js';
import { CommandsService } from '../../apps/api/src/commands/commands.service.js';
import { CommandsController } from '../../apps/api/src/commands/commands.controller.js';
import { AuditService } from '../../apps/api/src/audit/audit.service.js';
import { SupplierOrdersService } from '../../apps/api/src/supplier-orders/supplier-orders.service.js';
import { SupplierOrdersController } from '../../apps/api/src/supplier-orders/supplier-orders.controller.js';
import { ShipmentsService } from '../../apps/api/src/shipments/shipments.service.js';
import { ShipmentsController } from '../../apps/api/src/shipments/shipments.controller.js';
import { FreightConfirmationsService } from '../../apps/api/src/freight-confirmations/freight-confirmations.service.js';
import { FreightConfirmationsController } from '../../apps/api/src/freight-confirmations/freight-confirmations.controller.js';
import { DiscrepanciesService } from '../../apps/api/src/discrepancies/discrepancies.service.js';
import { DiscrepanciesController } from '../../apps/api/src/discrepancies/discrepancies.controller.js';
import { StoresService } from '../../apps/api/src/stores/stores.service.js';
import { effectivePriceVersion } from '../../apps/api/src/pricing/effective-price.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
type Mode = 'STORED_VALUE' | 'CREDIT' | 'COMPANY_TERM' | 'SUPPLIER_TERM';
type Failure = 'none' | 'completion' | 'audit' | 'connection';

async function withFixture(mode: Mode, run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>, poolMax?: number) {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, ...(poolMax ? { max: poolMax } : {}) }) });
  const code = `APQ${Date.now()}${mode[0]}`;
  try { await run(await fixture(db, code, mode)); }
  finally {
    const supplierCodes = [code, `${code}ALT`];
    const ids = (await db.store.findMany({ where: { code }, select: { id: true } })).map(row => row.id);
    const own = { storeId: { in: ids } };
    const orderIds = (await db.supplierOrder.findMany({ where: own, select: { id: true } })).map(row => row.id);
    await db.auditLog.deleteMany({ where: { actor: { username: code } } });
    await db.commandRecord.deleteMany({ where: { actor: { username: code } } });
    await db.notification.deleteMany({ where: { OR: [{ recipient: { username: code } }, { eventKey: { in: orderIds.map(id => `SUPPLIER_ORDER_REJECTED:${id}`) } }] } });
    await db.fileObject.deleteMany({ where: { owner: { username: code } } });
    await db.userScope.deleteMany({ where: { user: { username: code } } });
    await db.adjustmentDocument.deleteMany({ where: own });
    await db.priceChangeRun.deleteMany({ where: { versions: { some: { priceVersion: { scope: { supplier: { code: { in: supplierCodes } } } } } } } });
    await db.clearingDocument.deleteMany({ where: own });
    await db.rechargeDocument.deleteMany({ where: own });
    await db.fundingAllocation.deleteMany({ where: own });
    await db.accountLedger.deleteMany({ where: { account: own } });
    await db.replenishmentGap.deleteMany({ where: { orderItem: { supplierOrder: own } } });
    await db.discrepancyReturn.deleteMany({ where: { orderItem: { supplierOrder: own } } });
    await db.discrepancy.deleteMany({ where: { orderItem: { supplierOrder: own } } });
    await db.receipt.deleteMany({ where: { shipment: { supplierOrder: own } } });
    await db.shipment.deleteMany({ where: { supplierOrder: own } });
    await db.freightConfirmation.deleteMany({ where: { supplierOrder: own } });
    await db.supplierOrder.deleteMany({ where: own });
    await db.purchaseRequest.deleteMany({ where: own });
    await db.priceScope.deleteMany({ where: { supplier: { code: { in: supplierCodes } } } });
    await db.storeTemplateBinding.deleteMany({ where: own });
    await db.orderTemplate.deleteMany({ where: { code } });
    await db.supplierProduct.deleteMany({ where: { supplier: { code: { in: supplierCodes } } } });
    await db.product.deleteMany({ where: { sku: code } });
    await db.supplier.deleteMany({ where: { code: { in: supplierCodes } } });
    await db.storeAccount.deleteMany({ where: own });
    await db.store.deleteMany({ where: { code } });
    await db.category.deleteMany({ where: { code } });
    await db.unit.deleteMany({ where: { code } });
    await db.user.deleteMany({ where: { username: code } });
    await db.$disconnect();
  }
}

async function fixture(db: PrismaClient, code: string, mode: Mode) {
  const user = await db.user.create({ data: { username: code, displayName: code } });
  const store = await db.store.create({ data: { code, name: code } });
  await db.storeAccount.create({ data: { storeId: store.id, balance: '500', creditLimit: '1000' } });
  const category = await db.category.create({ data: { code, name: code } });
  const unit = await db.unit.create({ data: { code, name: 'piece' } });
  const product = await db.product.create({ data: { sku: code, name: code, defaultSalesPrice: '12', categoryId: category.id, baseUnitId: unit.id } });
  const supplier = await db.supplier.create({ data: { code, name: code, deliveryMode: 'SELF', defaultSettlementMode: mode, defaultSettlementCycle: 'MONTHLY' } });
  await db.supplierProduct.create({ data: { productId: product.id, supplierId: supplier.id } });
  const template = await db.orderTemplate.create({ data: { code, name: code, tag: 'Isolated procurement', items: { create: { productId: product.id, initialSalesPrice: '12', suppliers: { create: { supplierId: supplier.id } } } } } });
  await db.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } });
  const database = { client: db } as never;
  const pricing = new PricingService(database), catalog = new CatalogService(database, pricing);
  await pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '12', supplyPrice: mode === 'SUPPLIER_TERM' ? '12' : '9', effectiveAt: new Date('2000-01-01'), reason: 'Isolated baseline' });
  const preview = new PurchaseRequestPreviewService(database, catalog);
  const service = new PurchaseRequestsService(database, preview, pricing), commands = new CommandsService(database), audit = new AuditService(database);
  const controller = new PurchaseRequestsController(preview, service, commands, audit, catalog, database);
  const prices = new PricingController(pricing, commands, audit, database);
  const auth = { user: { id: user.id, roles: ['PURCHASER'] } } as never;
  const input = { storeId: store.id, items: [{ productId: product.id, quantity: '10' }] };
  return { db, code, mode, user, store, product, supplier, template, service, controller, pricing, prices, commands, audit, auth, input };
}

test('atomic stored-value creation and exact replay need only one pooled connection', () => withFixture('STORED_VALUE', async f => {
  const key = `${f.code}-single-connection`;
  const request = { auth: f.auth, headers: { 'idempotency-key': key } } as never;
  const created = await f.controller.create(request, f.auth, f.input);
  assert.equal(created.funding.stored.paid, '0.00');
  assert.equal(created.funding.stored.reserved, '120.00');
  assert.equal(created.status, 'PENDING_PROCUREMENT');
  const before = await state(f);
  assert.equal(before.account.balance.toString(), '500');
  assert.equal(before.account.reservedBalance.toString(), '120');
  assert.equal(before.requests.length, 1); assert.equal(before.ledgers.length, 0);
  assert.equal((await f.controller.create(request, f.auth, f.input)).id, created.id);
  assert.deepEqual(await state(f), before);
  assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id, action: 'purchase-request.create' } }), 1);
}, 1));

test('bounded effective-price lookup preserves business time and revision selection in two SQL statements', () => withFixture('STORED_VALUE', async f => {
  const shared = await f.db.priceScope.findUniqueOrThrow({ where: { productId_supplierId_templateKey: {
    productId: f.product.id, supplierId: f.supplier.id, templateKey: '',
  } } });
  await f.db.priceVersion.create({ data: { scopeId: shared.id, revision: 2, salesPrice: '18', supplyPrice: '10', effectiveAt: new Date('2015-01-01') } });
  const template = await f.db.priceScope.create({ data: { productId: f.product.id, supplierId: f.supplier.id, templateKey: f.template.id,
    versions: { create: [
      { revision: 1, salesPrice: '14', supplyPrice: '99', effectiveAt: new Date('2010-01-01') },
      { revision: 2, salesPrice: '15', supplyPrice: '99', effectiveAt: new Date('2010-01-01') },
      { revision: 3, salesPrice: '16', supplyPrice: '99', effectiveAt: new Date('2030-01-01') },
    ] },
  } });
  const measured = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1 }), log: [{ level: 'query', emit: 'event' }] });
  const sql: string[] = [];
  measured.$on('query', event => sql.push(event.query));
  try {
    for (const [date, sales, cost, scopeId] of [
      ['2005-01-01', '12', '9', shared.id], ['2020-01-01', '15', '10', template.id], ['2035-01-01', '16', '10', template.id],
    ]) {
      sql.length = 0;
      const quote = await effectivePriceVersion(measured, f.product.id, f.supplier.id, new Date(date!), f.template.id.toUpperCase());
      assert.equal(quote?.salesPrice.toString(), sales); assert.equal(quote?.supplyPrice.toString(), cost);
      assert.equal(quote?.scopeId, scopeId); assert.ok(quote?.supplyVersionId);
      assert.equal(sql.length, 2);
      for (const statement of sql) assert.match(statement, /LIMIT/i, 'Latest versions must be bounded in SQL, not trimmed after reading all history');
    }
  } finally { await measured.$disconnect(); }
}));

function inject(f: Awaited<ReturnType<typeof fixture>>, failure: Failure) {
  if (failure === 'completion') {
    const succeed = f.commands.succeed.bind(f.commands);
    f.commands.succeed = async (...args) => { await succeed(...args); throw new Error('Injected completion failure'); };
  } else if (failure === 'audit' || failure === 'connection') {
    const record = f.audit.record.bind(f.audit);
    f.audit.record = async (...args) => {
      await record(...args);
      if (failure === 'audit') throw new Error('Injected audit failure');
      await args[1]!.$queryRaw`SELECT pg_terminate_backend(pg_backend_pid())`;
    };
  }
}

async function state(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    account: await f.db.storeAccount.findUniqueOrThrow({ where: { storeId: f.store.id } }),
    requests: await f.db.purchaseRequest.findMany({ where: { storeId: f.store.id }, include: { items: true }, orderBy: { id: 'asc' } }),
    allocations: await f.db.fundingAllocation.findMany({ where: { storeId: f.store.id }, orderBy: { id: 'asc' } }),
    ledgers: await f.db.accountLedger.findMany({ where: { account: { storeId: f.store.id } }, orderBy: { id: 'asc' } }),
    orders: await f.db.supplierOrder.findMany({ where: { storeId: f.store.id }, include: { items: true }, orderBy: { id: 'asc' } }),
  };
}

async function fulfillmentFixture(f: Awaited<ReturnType<typeof fixture>>, receipt: boolean) {
  const draft = await f.service.create(f.input); await f.service.confirm(draft.id, draft.version);
  const order = await f.db.supplierOrder.findFirstOrThrow({ where: { storeId: f.store.id }, include: { items: true } });
  const freight = await f.db.freightConfirmation.create({ data: { supplierOrderId: order.id, amount: '5', status: 'CONFIRMED', reason: 'Actual approved freight', confirmedAt: new Date() } });
  const shipping = new SupplierOrdersService({ client: f.db } as never), receiving = new ShipmentsService({ client: f.db } as never);
  const supplierController = new SupplierOrdersController(shipping, f.commands, {} as never, f.audit);
  const storeController = new ShipmentsController(receiving, f.commands, f.audit);
  const roles = await f.db.role.findMany({ where: { code: { in: ['STORE', 'SUPPLIER'] } } });
  assert.equal(roles.length, 2);
  await f.db.userRole.createMany({ data: roles.map(role => ({ userId: f.user.id, roleId: role.id })) });
  const scope = await f.db.userScope.create({ data: { userId: f.user.id, scopeType: 'STORE', storeId: f.store.id } });
  const preview = { freight: '5', freightConfirmationId: freight.id,
    items: [{ orderItemId: order.items[0]!.id, shipQuantity: receipt ? '10' : '8', permanentlyReduceQuantity: receipt ? '0' : '2' }] };
  const shipment = receipt ? await shipping.createShipment(order.id, order.version, preview) : null;
  if (receipt) await f.db.userScope.update({ where: { id: scope.id }, data: { scopeType: 'SUPPLIER', storeId: null, supplierId: f.supplier.id } });
  const file = receipt ? await f.db.fileObject.create({ data: { filename: 'receipt.png', mimeType: 'image/png', sizeBytes: 20n,
    objectKey: f.code, uploadTokenHash: 'isolated-proof', purpose: 'RECEIPT', status: 'READY', ownerId: f.user.id } }) : null;
  return { order, preview, shipment, file, supplierController, storeController };
}

async function fulfillmentState(f: Awaited<ReturnType<typeof fixture>>) {
  const business = await state(f);
  return { business,
    shipments: await f.db.shipment.findMany({ where: { supplierOrder: { storeId: f.store.id } }, include: { items: true }, orderBy: { id: 'asc' } }),
    receipts: await f.db.receipt.findMany({ where: { shipment: { supplierOrder: { storeId: f.store.id } } }, include: { items: true }, orderBy: { id: 'asc' } }),
    discrepancies: await f.db.discrepancy.findMany({ where: { orderItem: { supplierOrder: { storeId: f.store.id } } }, orderBy: { id: 'asc' } }),
    freight: await f.db.freightConfirmation.findMany({ where: { supplierOrder: { storeId: f.store.id } }, orderBy: { id: 'asc' } }),
    files: await f.db.fileObject.findMany({ where: { ownerId: f.user.id }, orderBy: { id: 'asc' } }),
    notifications: await f.db.notification.findMany({ where: { OR: [{ recipientId: f.user.id }, { eventKey: { in: business.orders.map(order => `SUPPLIER_ORDER_REJECTED:${order.id}`) } }] }, orderBy: { id: 'asc' } }),
    adjustments: await f.db.adjustmentDocument.findMany({ where: { storeId: f.store.id }, orderBy: { id: 'asc' } }) };
}

type Remedy = 'freight-create' | 'freight-confirm' | 'freight-reject' | 'reject' | 'funding' | 'ACCEPT' | 'REPLENISH' | 'RETURN';
async function remedyFixture(f: Awaited<ReturnType<typeof fixture>>, operation: Remedy, paidCredit = false) {
  const discrepancyOperation = ['ACCEPT', 'REPLENISH', 'RETURN'].includes(operation);
  const setup = await fulfillmentFixture(f, discrepancyOperation);
  const database = { client: f.db } as never;
  const freight = new FreightConfirmationsService(database), discrepancies = new DiscrepanciesService(database), stores = new StoresService(database);
  const supplier = new SupplierOrdersController(new SupplierOrdersService(database), f.commands, freight, f.audit);
  const reviewer = new FreightConfirmationsController(freight, f.commands, f.audit), resolver = new DiscrepanciesController(discrepancies, f.commands, f.audit);
  let discrepancyId: string | undefined, confirmationId: string | undefined;
  if (discrepancyOperation) {
    const receiving = new ShipmentsService(database), order = await f.db.supplierOrder.findUniqueOrThrow({ where: { id: setup.order.id } });
    await receiving.createReceipt(setup.shipment!.id, { expectedOrderVersion: order.version, expectedReceiptRevision: 0,
      items: setup.shipment!.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: '8' })) });
    discrepancyId = (await f.db.discrepancy.findFirstOrThrow({ where: { orderItem: { supplierOrderId: order.id } } })).id;
    await f.db.userScope.update({ where: { userId: f.user.id }, data: { scopeType: 'STORE', storeId: f.store.id, supplierId: null } });
  }
  if (operation === 'freight-confirm' || operation === 'freight-reject') {
    confirmationId = (await freight.createForSupplierOrder(setup.order.id, { expectedVersion: setup.order.version, amount: '3', reason: 'Actual pending freight' })).id;
  }
  if (operation === 'reject') {
    const role = await f.db.role.findUniqueOrThrow({ where: { code: 'PURCHASER' } });
    await f.db.userRole.create({ data: { userId: f.user.id, roleId: role.id } });
    if (paidCredit) {
      const allocation = await f.db.fundingAllocation.findFirstOrThrow({ where: { requestId: setup.order.requestId } });
      await stores.createClearing(f.store.id, { businessDate: new Date(), items: [{ fundingAllocationId: allocation.id,
        expectedVersion: allocation.version, expectedAmount: '120.00' }] });
    }
  }
  if (operation === 'funding') {
    const change = await f.pricing.publishPrice({ productId: f.product.id, supplierId: f.supplier.id, salesPrice: '60',
      supplyPrice: f.mode === 'SUPPLIER_TERM' ? '60' : '9', effectiveAt: new Date('2001-01-01'), reason: 'Actual funding shortfall source' });
    await f.pricing.processRun(change.runId!);
    if (f.mode === 'STORED_VALUE') {
      assert.equal((await f.db.purchaseRequest.findUniqueOrThrow({ where: { id: setup.order.requestId } })).shortfallAmount.toString(), '100');
      await stores.createRecharge(f.store.id, { amount: '150', businessDate: new Date(), collectionAccountId: f.user.id, remark: 'Isolated shortfall recovery' });
    }
  }
  const order = await f.db.supplierOrder.findUniqueOrThrow({ where: { id: setup.order.id } });
  const confirmation = confirmationId ? await f.db.freightConfirmation.findUniqueOrThrow({ where: { id: confirmationId } }) : null;
  const discrepancy = discrepancyId ? await f.db.discrepancy.findUniqueOrThrow({ where: { id: discrepancyId } }) : null;
  const auth = { user: { id: f.user.id, roles: ['ADMIN'] } } as never;
  const run = (key: string) => {
    const request = { headers: { 'idempotency-key': key }, auth } as never;
    if (operation === 'freight-create') return supplier.createFreightConfirmation(request, auth, order.id, { expectedVersion: order.version, amount: '3', reason: 'Actual freight request' });
    if (operation === 'freight-confirm') return reviewer.confirm(request, auth, confirmation!.id, { expectedVersion: confirmation!.version, reason: 'Approved' });
    if (operation === 'freight-reject') return reviewer.reject(request, auth, confirmation!.id, { expectedVersion: confirmation!.version, reason: 'Declined' });
    if (operation === 'reject') return supplier.reject(request, auth, order.id, { expectedVersion: order.version, reason: 'Actual supplier refusal' });
    if (operation === 'funding') return supplier.reconcileFunding(request, auth, order.id, { expectedVersion: order.version });
    return resolver.resolve(request, auth, discrepancy!.id, { expectedVersion: discrepancy!.version, action: operation, reason: 'Actual receipt discrepancy remedy' });
  };
  return { run, order, confirmation, discrepancy, reviewer, resolver, supplier, auth };
}

async function remedyState(f: Awaited<ReturnType<typeof fixture>>) {
  const where = { orderItem: { supplierOrder: { storeId: f.store.id } } };
  return { fulfillment: await fulfillmentState(f),
    gaps: await f.db.replenishmentGap.findMany({ where, orderBy: { id: 'asc' } }),
    returns: await f.db.discrepancyReturn.findMany({ where, orderBy: { id: 'asc' } }),
    actions: await f.db.discrepancyAction.findMany({ where: { discrepancy: where }, orderBy: { id: 'asc' } }),
    clearings: await f.db.clearingDocument.findMany({ where: { storeId: f.store.id }, include: { items: true }, orderBy: { id: 'asc' } }),
    recharges: await f.db.rechargeDocument.findMany({ where: { storeId: f.store.id }, orderBy: { id: 'asc' } }) };
}

for (const failure of ['none', 'completion', 'audit', 'connection'] as const) {
  test(`atomic remedy CREDIT paid refusal: ${failure}`, () => withFixture('CREDIT', async f => {
    const setup = await remedyFixture(f, 'reject', true), before = await remedyState(f);
    assert.equal(before.fulfillment.business.account.balance.toString(), '500');
    inject(f, failure); const run = () => setup.run(`${f.code}-paid-refusal`);
    if (failure === 'none') {
      const result = await run(), after = await remedyState(f); assert.deepEqual(await run(), result); assert.deepEqual(await remedyState(f), after);
      assert.equal(after.fulfillment.business.account.balance.toString(), '500');
      assert.deepEqual(after.clearings, before.clearings);
      assert.equal(after.fulfillment.business.allocations[0]!.netPaid.toString(), '120');
      assert.equal(after.fulfillment.adjustments.find(row => row.sourceRejectedOrderId === setup.order.id)!.amount.toString(), '-120');
      assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
    } else {
      await assert.rejects(run); assert.deepEqual(await remedyState(f), before); await assert.rejects(run, ConflictException);
      assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
    }
  }));
}

for (const operation of ['freight-confirm', 'reject', 'funding', 'ACCEPT'] as const) {
  test(`atomic remedy ${operation} concurrent decisions commit once`, () => withFixture('STORED_VALUE', async f => {
    const setup = await remedyFixture(f, operation);
    const competing = () => operation === 'freight-confirm'
      ? setup.reviewer.reject({ headers: { 'idempotency-key': `${f.code}-race-two` }, auth: setup.auth } as never, setup.auth,
        setup.confirmation!.id, { expectedVersion: setup.confirmation!.version, reason: 'Competing rejection' })
      : operation === 'ACCEPT'
        ? setup.resolver.resolve({ headers: { 'idempotency-key': `${f.code}-race-two` }, auth: setup.auth } as never, setup.auth,
          setup.discrepancy!.id, { expectedVersion: setup.discrepancy!.version, action: 'RETURN', reason: 'Competing return' })
        : setup.run(`${f.code}-race-two`);
    const results = await Promise.allSettled([setup.run(`${f.code}-race-one`), competing()]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
    assert.deepEqual((await f.db.commandRecord.findMany({ where: { actorUserId: f.user.id } })).map(row => row.status).sort(), ['FAILED', 'SUCCEEDED']);
    if (operation === 'ACCEPT') assert.equal((await remedyState(f)).actions.length, 1);
    if (operation === 'funding') {
      assert.equal((await state(f)).account.balance.toString(), '650');
      assert.equal((await state(f)).account.reservedBalance.toString(), '600');
    }
  }));
}

test('atomic remedy funding definite failure replays error rather than empty success', () => withFixture('STORED_VALUE', async f => {
  const setup = await remedyFixture(f, 'funding'), before = await remedyState(f);
  const run = () => setup.supplier.reconcileFunding({ headers: { 'idempotency-key': `${f.code}-stale-funding` }, auth: setup.auth } as never,
    setup.auth, setup.order.id, { expectedVersion: setup.order.version + 1 });
  await assert.rejects(run, ConflictException);
  await assert.rejects(run, error => error instanceof HttpException && error.getStatus() === 409 && (error.getResponse() as { code: string }).code === 'VERSION_CONFLICT');
  assert.deepEqual(await remedyState(f), before);
  assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
  assert.equal((await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } })).status, 'FAILED');
}));

for (const mode of ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM'] as const) {
  for (const operation of ['freight-create', 'freight-confirm', 'freight-reject', 'reject', 'funding', 'ACCEPT', 'REPLENISH', 'RETURN'] as const) {
    for (const failure of ['none', 'completion', 'audit', 'connection'] as const) {
      test(`atomic remedy ${mode} ${operation}: ${failure}`, () => withFixture(mode, async f => {
        const setup = await remedyFixture(f, operation), before = await remedyState(f);
        inject(f, failure); const run = () => setup.run(`${f.code}-${operation}`);
        if (failure === 'none') {
          const result = await run(), after = await remedyState(f); assert.deepEqual(await run(), result); assert.deepEqual(await remedyState(f), after);
          assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
          const command = await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } });
          assert.equal(command.status, 'SUCCEEDED'); assert.deepEqual(command.responseBody, result);
          if (operation.startsWith('freight')) {
            assert.equal(after.fulfillment.freight.length, operation === 'freight-create' ? 2 : before.fulfillment.freight.length);
            if (setup.confirmation) assert.equal(after.fulfillment.freight.find(row => row.id === setup.confirmation!.id)!.status, operation === 'freight-confirm' ? 'CONFIRMED' : 'REJECTED');
          }
          if (operation === 'reject') {
            assert.equal(after.fulfillment.business.orders[0]!.status, 'REJECTED');
            assert.equal(after.fulfillment.business.account.balance.toString(), '500'); assert.equal(after.fulfillment.business.account.creditUsed.toString(), '0');
            assert.ok(after.fulfillment.notifications.length > before.fulfillment.notifications.length);
          }
          if (operation === 'funding') {
            assert.equal(after.fulfillment.business.account.balance.toString(), mode === 'STORED_VALUE' ? '650' : '500');
            assert.equal(after.fulfillment.business.account.reservedBalance.toString(), mode === 'STORED_VALUE' ? '600' : '0');
            assert.equal(after.fulfillment.business.account.creditUsed.toString(), mode === 'CREDIT' ? '600' : '0');
            assert.equal(after.fulfillment.business.requests[0]!.shortfallAmount.toString(), '0');
          }
          if (['ACCEPT', 'REPLENISH', 'RETURN'].includes(operation)) {
            assert.equal(after.actions.length, 1); assert.equal(after.gaps.length, operation === 'REPLENISH' ? 1 : 0); assert.equal(after.returns.length, operation === 'RETURN' ? 1 : 0);
            const total = operation === 'ACCEPT' ? '101' : '125';
            assert.equal(after.fulfillment.business.account.balance.toString(), mode === 'STORED_VALUE' && operation === 'ACCEPT' ? '399' : '500');
            assert.equal(after.fulfillment.business.account.reservedBalance.toString(), mode === 'STORED_VALUE' && operation !== 'ACCEPT' ? '125' : '0');
            assert.equal(after.fulfillment.business.account.creditUsed.toString(), mode === 'CREDIT' ? total : '0');
            assert.equal(after.fulfillment.notifications.length, before.fulfillment.notifications.length + 1);
          }
        } else {
          await assert.rejects(run); assert.deepEqual(await remedyState(f), before);
          assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
          const command = await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } }); assert.equal(command.status, 'PROCESSING'); assert.equal(command.responseBody, null);
          await assert.rejects(run, ConflictException); assert.deepEqual(await remedyState(f), before);
        }
      }));
    }
  }
}

for (const operation of ['shipment', 'receipt'] as const) {
  test(`atomic fulfillment ${operation} concurrent version commands commit once`, () => withFixture('STORED_VALUE', async f => {
    const setup = await fulfillmentFixture(f, operation === 'receipt');
    const order = await f.db.supplierOrder.findUniqueOrThrow({ where: { id: setup.order.id } });
    const auth = { user: { id: f.user.id, roles: ['ADMIN'] } } as never;
    const run = (key: string) => {
      const request = { headers: { 'idempotency-key': key }, auth } as never;
      return operation === 'shipment' ? setup.supplierController.createShipment(request, auth, order.id, { expectedVersion: order.version, ...setup.preview })
        : setup.storeController.createReceipt(request, auth, setup.shipment!.id, { expectedOrderVersion: order.version, expectedReceiptRevision: 0,
          items: setup.shipment!.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: '8' })), evidenceFileIds: [setup.file!.id] });
    };
    const results = await Promise.allSettled([run(`${f.code}-one`), run(`${f.code}-two`)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
    const after = await fulfillmentState(f);
    assert.equal(after.shipments.length, 1); assert.equal(after.receipts.length, operation === 'receipt' ? 1 : 0);
    assert.equal(after.notifications.length, operation === 'receipt' ? 2 : 1);
    assert.deepEqual((await f.db.commandRecord.findMany({ where: { actorUserId: f.user.id } })).map(row => row.status).sort(), ['FAILED', 'SUCCEEDED']);
  }));
}

test('atomic receipt invalid evidence rejects without receipt or audit side effects', () => withFixture('STORED_VALUE', async f => {
  const setup = await fulfillmentFixture(f, true);
  await f.db.fileObject.update({ where: { id: setup.file!.id }, data: { purpose: 'PAYMENT' } });
  const before = await fulfillmentState(f), order = await f.db.supplierOrder.findUniqueOrThrow({ where: { id: setup.order.id } });
  const auth = { user: { id: f.user.id, roles: ['ADMIN'] } } as never;
  const run = () => setup.storeController.createReceipt({ headers: { 'idempotency-key': `${f.code}-bad-file` }, auth } as never, auth,
    setup.shipment!.id, { expectedOrderVersion: order.version, expectedReceiptRevision: 0,
      items: setup.shipment!.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: '10' })), evidenceFileIds: [setup.file!.id] });
  await assert.rejects(run, ConflictException);
  await assert.rejects(run, error => error instanceof HttpException && error.getStatus() === 409
    && (error.getResponse() as { code: string }).code === 'RECEIPT_EVIDENCE_INVALID');
  assert.deepEqual(await fulfillmentState(f), before);
  assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
  assert.equal((await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } })).status, 'FAILED');
}));

for (const mode of ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM'] as const) {
  for (const operation of ['shipment', 'receipt-full', 'receipt-short'] as const) {
    for (const failure of ['none', 'completion', 'audit', 'connection'] as const) {
      test(`atomic fulfillment ${mode} ${operation}: ${failure}`, () => withFixture(mode, async f => {
        const setup = await fulfillmentFixture(f, operation !== 'shipment'), before = await fulfillmentState(f);
        const order = await f.db.supplierOrder.findUniqueOrThrow({ where: { id: setup.order.id } });
        const auth = { user: { id: f.user.id, roles: ['ADMIN'] } } as never;
        const request = { headers: { 'idempotency-key': `${f.code}-${operation}` }, auth } as never;
        const run = operation === 'shipment'
          ? () => setup.supplierController.createShipment(request, auth, order.id, { expectedVersion: order.version, ...setup.preview })
          : () => setup.storeController.createReceipt(request, auth, setup.shipment!.id, { expectedOrderVersion: order.version, expectedReceiptRevision: 0,
            items: setup.shipment!.items.map(item => ({ shipmentItemId: item.id, receivedQuantity: operation === 'receipt-short' ? '8' : '10' })), evidenceFileIds: [setup.file!.id] });
        inject(f, failure);
        if (failure === 'none') {
          const result = await run(), after = await fulfillmentState(f); assert.deepEqual(await run(), result);
          assert.deepEqual(await fulfillmentState(f), after);
          assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
          assert.equal(after.shipments.length, 1);
          assert.equal(after.receipts.length, operation === 'shipment' ? 0 : 1);
          assert.equal(after.discrepancies.length, operation === 'receipt-short' ? 1 : 0);
          assert.equal(after.notifications.length, operation === 'receipt-short' ? 2 : 1);
          const account = after.business.account, total = operation === 'shipment' ? '101' : '125';
          assert.equal(account.balance.toString(), mode === 'STORED_VALUE' && operation === 'receipt-full' ? '375' : '500');
          assert.equal(account.reservedBalance.toString(), mode === 'STORED_VALUE' && operation !== 'receipt-full' ? total : '0');
          assert.equal(account.creditUsed.toString(), mode === 'CREDIT' ? total : '0');
          if (setup.file) assert.equal(after.files[0]!.receiptId, result.id);
          const saved = await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } });
          assert.equal(saved.status, 'SUCCEEDED'); assert.deepEqual(saved.responseBody, result);
        } else {
          await assert.rejects(run); assert.deepEqual(await fulfillmentState(f), before);
          assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
          const saved = await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } });
          assert.equal(saved.status, 'PROCESSING'); assert.equal(saved.responseBody, null);
          await assert.rejects(run, ConflictException); assert.deepEqual(await fulfillmentState(f), before);
        }
      }));
    }
  }
}

for (const mode of ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM'] as const) {
  for (const failure of ['none', 'completion', 'audit', 'connection'] as const) {
    test(`atomic price processing ${mode}: ${failure}`, () => withFixture(mode, async f => {
      const draft = await f.service.create(f.input);
      await f.service.confirm(draft.id, draft.version);
      const quote = await f.pricing.publishPrice({ productId: f.product.id, supplierId: f.supplier.id,
        salesPrice: '13', supplyPrice: mode === 'SUPPLIER_TERM' ? '13' : '10',
        effectiveAt: new Date('2001-01-01'), reason: 'Processing atomic acceptance' });
      const before = await state(f);
      const pending = await f.pricing.getRun(quote.runId!);
      assert.equal(pending.affectedOrderCount, 1);
      const originalAudit = f.audit.record.bind(f.audit), originalSucceed = f.commands.succeed.bind(f.commands);
      inject(f, failure);
      const request = { headers: { 'idempotency-key': `${f.code}-process` }, auth: f.auth } as never;
      const process = () => f.prices.processRun(quote.runId!, request);
      if (failure === 'none') {
        const result = await process();
        assert.equal(result.status, 'SUCCEEDED');
        assert.deepEqual(result, await f.pricing.getRun(quote.runId!));
        assert.deepEqual(await process(), result);
        assert.equal(await f.db.priceChangeAdjustment.count({ where: { runId: quote.runId! } }), 1);
        assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id, action: 'price.process' } }), 1);
        assert.equal((await f.service.get(draft.id)).salesGoodsAmount, '130.00');
      } else {
        await assert.rejects(process);
        assert.deepEqual(await state(f), before);
        assert.deepEqual(await f.pricing.getRun(quote.runId!), pending);
        assert.equal(await f.db.priceChangeAdjustment.count({ where: { runId: quote.runId! } }), 0);
        assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
        await assert.rejects(process, ConflictException);
        assert.equal((await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } })).status, 'PROCESSING');
      }
      const submissions = await f.prices.listSubmissions(quote.runId!, { auth: f.auth } as never);
      assert.equal(submissions.length, 1);
      assert.equal(submissions[0]!.resourceId, quote.runId);
      assert.equal(submissions[0]!.status, failure === 'none' ? 'SUCCEEDED' : 'PROCESSING');
      assert.equal(submissions[0]!.errorCode, failure === 'none' ? null : 'COMMAND_ROLLBACK_CONFIRMED');
      assert.deepEqual(await f.prices.listSubmissions(quote.runId!, { auth: { user: { id: f.store.id, roles: ['PURCHASER'] } } } as never), []);
      assert.equal((await f.prices.listSubmissions(quote.runId!, { auth: { user: { id: f.store.id, roles: ['ADMIN'] } } } as never)).length, 1);
      if (failure !== 'none') {
        f.audit.record = originalAudit; f.commands.succeed = originalSucceed;
        const blocked = await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id, action: 'price.process' } });
        const recovery = new CommandsController(f.commands, f.audit);
        const closeRequest = { headers: { 'idempotency-key': `${f.code}-close` }, auth: { user: { id: f.user.id, roles: ['ADMIN'] } } } as never;
        if (failure === 'connection') {
          await f.db.commandRecord.update({ where: { id: blocked.id }, data: { errorBody: Prisma.DbNull } });
          await recovery.closeUncommittedPrice(blocked.id, { reason: 'Atomic contract and locked processing status verified' }, closeRequest);
        } else await recovery.closeRolledBackPrice(blocked.id, { reason: 'Verified actual pricing callback rollback' }, closeRequest);
        await assert.rejects(process, error => (error as { getResponse(): { code: string } }).getResponse().code === (failure === 'connection' ? 'COMMAND_NOT_COMMITTED' : 'COMMAND_ROLLED_BACK'));
        const completed = await f.prices.processRun(quote.runId!, { headers: { 'idempotency-key': `${f.code}-fresh-process` }, auth: f.auth } as never);
        assert.equal(completed.status, 'SUCCEEDED');
        assert.equal(await f.db.priceChangeAdjustment.count({ where: { runId: quote.runId! } }), 1);
        assert.equal((await f.service.get(draft.id)).salesGoodsAmount, '130.00');
        const history = await f.prices.listSubmissions(quote.runId!, { auth: f.auth } as never);
        assert.deepEqual(history.map(row => row.status).sort(), ['FAILED', 'SUCCEEDED']);
      }
      const finalAccount = await f.db.storeAccount.findUniqueOrThrow({ where: { storeId: f.store.id } });
      assert.equal(finalAccount.balance.toString(), '500');
      assert.equal(finalAccount.reservedBalance.toString(), mode === 'STORED_VALUE' ? '130' : '0');
      assert.equal(finalAccount.creditUsed.toString(), mode === 'CREDIT' ? '130' : '0');
    }));
  }
}

for (const mode of ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM'] as const) {
  for (const operation of ['create', 'confirm', 'reject'] as const) {
    for (const failure of ['none', 'completion', 'audit', 'connection'] as const) {
      test(`atomic procurement ${mode} ${operation}: ${failure}`, () => withFixture(mode, async f => {
        const draft = operation === 'create' ? undefined : await f.service.create(f.input);
        const before = await state(f);
        inject(f, failure);
        const request = { headers: { 'idempotency-key': `${f.code}-${operation}` }, auth: f.auth } as never;
        const run = () => operation === 'create' ? f.controller.create(request, f.auth, f.input)
          : operation === 'confirm' ? f.controller.confirm(request, f.auth, draft!.id, { expectedVersion: draft!.version })
            : f.controller.reject(request, f.auth, draft!.id, { expectedVersion: draft!.version, reason: 'Isolated cancellation' });
        if (failure === 'none') {
          const result = await run();
          assert.deepEqual(await run(), result);
          const after = await state(f);
          assert.equal(after.requests.length, 1);
          assert.equal(after.requests[0]!.status, operation === 'create' ? 'PENDING_PROCUREMENT' : operation === 'confirm' ? 'CONFIRMED' : 'CANCELED');
          assert.equal(after.orders.length, operation === 'confirm' ? 1 : 0);
          assert.equal(after.account.balance.toFixed(2), '500.00');
          assert.equal(after.account.reservedBalance.toFixed(2), mode === 'STORED_VALUE' && operation !== 'reject' ? '120.00' : '0.00');
          assert.equal(after.account.creditUsed.toFixed(2), mode === 'CREDIT' && operation !== 'reject' ? '120.00' : '0.00');
          if (operation === 'confirm') assert.deepEqual(after.ledgers, before.ledgers);
          if (operation === 'reject') {
            assert.ok(after.allocations.every(allocation => !allocation.active && allocation.netPaid.isZero() && allocation.creditOutstanding.isZero()));
            assert.deepEqual(after.allocations.map(allocation => allocation.targetAmount.toFixed(2)), before.allocations.map(allocation => allocation.targetAmount.toFixed(2)));
          }
          const command = await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } });
          assert.equal(command.status, 'SUCCEEDED');
          assert.deepEqual(command.responseBody, result);
          assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
        } else {
          await assert.rejects(run());
          await assert.rejects(run(), ConflictException);
          assert.deepEqual(await state(f), before);
          assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
          const command = await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } });
          assert.equal(command.status, 'PROCESSING');
          assert.equal(command.responseBody, null);
        }
      }));
    }
  }
}

for (const scope of ['SHARED', 'TEMPLATE'] as const) {
  for (const failure of ['none', 'completion', 'audit', 'connection'] as const) {
    test(`atomic keyed price publication ${scope}: ${failure}`, () => withFixture('CREDIT', async f => {
      const draft = await f.service.create(f.input);
      await f.service.confirm(draft.id, draft.version);
      const before = await state(f);
      const template = await f.db.orderTemplate.findUniqueOrThrow({ where: { id: f.template.id } });
      const versionsBefore = await f.db.priceVersion.count({ where: { scope: { supplierId: f.supplier.id } } });
      const runsBefore = await f.db.priceChangeRun.count({ where: { versions: { some: { priceVersion: { scope: { supplierId: f.supplier.id } } } } } });
      inject(f, failure);
      const request = { headers: { 'idempotency-key': f.code }, auth: f.auth } as never;
      const run = () => f.prices.publishPrice({ templateId: scope === 'TEMPLATE' ? f.template.id : undefined, productId: f.product.id, supplierId: f.supplier.id,
        salesPrice: '13', supplyPrice: scope === 'TEMPLATE' ? '9' : '10', effectiveAt: '2001-01-01T00:00:00.000Z', reason: 'Audited actual publication' }, request);
      if (failure === 'none') {
        const result = await run();
        assert.deepEqual(await run(), result);
        assert.equal(await f.db.priceVersion.count({ where: { scope: { supplierId: f.supplier.id } } }), versionsBefore + 1);
        assert.equal((await f.pricing.getRun(result.runId!)).affectedOrderCount, 1);
        const audit = await f.db.auditLog.findFirstOrThrow({ where: { actorUserId: f.user.id } });
        assert.equal(audit.action, 'price.publish');
        assert.equal(audit.entityId, result.versionId);
        assert.equal(audit.reason, 'Audited actual publication');
        assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
        const command = await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } });
        assert.equal(command.status, 'SUCCEEDED');
        assert.deepEqual(command.responseBody, result);
      } else {
        await assert.rejects(run());
        await assert.rejects(run(), ConflictException);
        assert.equal(await f.db.priceVersion.count({ where: { scope: { supplierId: f.supplier.id } } }), versionsBefore);
        assert.equal(await f.db.priceChangeRun.count({ where: { versions: { some: { priceVersion: { scope: { supplierId: f.supplier.id } } } } } }), runsBefore);
        assert.deepEqual(await f.db.orderTemplate.findUniqueOrThrow({ where: { id: f.template.id } }), template);
        assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
        assert.equal((await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } })).status, 'PROCESSING');
      }
      assert.deepEqual(await state(f), before);
    }));
  }
}

test('concurrent procurement confirm and reject produce one terminal result without duplicate funding', () => withFixture('STORED_VALUE', async f => {
  const draft = await f.service.create(f.input);
  const request = (suffix: string) => ({ headers: { 'idempotency-key': `${f.code}-${suffix}` }, auth: f.auth }) as never;
  const results = await Promise.allSettled([
    f.controller.confirm(request('confirm'), f.auth, draft.id, { expectedVersion: draft.version }),
    f.controller.reject(request('reject'), f.auth, draft.id, { expectedVersion: draft.version, reason: 'Concurrent terminal decision' }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(failure.reason instanceof ConflictException);
  const current = await state(f);
  assert.equal(current.account.balance.toFixed(2), '500.00');
  assert.equal(current.account.reservedBalance.toFixed(2), current.requests[0]!.status === 'CONFIRMED' ? '120.00' : '0.00');
  assert.equal(current.orders.length, current.requests[0]!.status === 'CONFIRMED' ? 1 : 0);
  assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
  assert.deepEqual((await f.db.commandRecord.findMany({ where: { actorUserId: f.user.id } })).map(row => row.status).sort(), ['FAILED', 'SUCCEEDED']);
}));

for (const mode of ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM'] as const) {
  for (const operation of ['publish', 'process'] as const) for (const failure of ['none', 'audit', 'connection'] as const) {
    test(`legacy headerless price ${mode} ${operation}: ${failure}`, () => withFixture(mode, async f => {
      const draft = await f.service.create(f.input);
      await f.service.confirm(draft.id, draft.version);
      const input = { productId: f.product.id, supplierId: f.supplier.id, salesPrice: '13',
        supplyPrice: mode === 'SUPPLIER_TERM' ? '13' : '10', effectiveAt: '2001-01-01T00:00:00.000Z', reason: 'Legacy audit acceptance' };
      const quote = operation === 'process' ? await f.pricing.publishPrice({ ...input, effectiveAt: new Date(input.effectiveAt) }) : undefined;
      const before = await state(f);
      const versionsBefore = await f.db.priceVersion.count({ where: { scope: { productId: f.product.id } } });
      const templateBefore = await f.db.orderTemplate.findUniqueOrThrow({ where: { id: f.template.id } });
      const pending = quote ? await f.pricing.getRun(quote.runId!) : undefined;
      const originalAudit = f.audit.record.bind(f.audit);
      inject(f, failure);
      const request = { headers: {}, auth: f.auth } as never;
      const execute = () => operation === 'publish' ? f.prices.publishPrice(input, request) : f.prices.processRun(quote!.runId!, request);
      if (failure !== 'none') {
        await assert.rejects(execute);
        assert.deepEqual(await state(f), before);
        assert.equal(await f.db.priceVersion.count({ where: { scope: { productId: f.product.id } } }), versionsBefore);
        assert.deepEqual(await f.db.orderTemplate.findUniqueOrThrow({ where: { id: f.template.id } }), templateBefore);
        if (quote) {
          assert.deepEqual(await f.pricing.getRun(quote.runId!), pending);
          assert.equal(await f.db.priceChangeAdjustment.count({ where: { runId: quote.runId! } }), 0);
        }
        assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
        f.audit.record = originalAudit;
      }
      await execute();
      const logs = await f.db.auditLog.findMany({ where: { actorUserId: f.user.id, action: `price.${operation}` } });
      assert.equal(logs.length, 1);
      assert.equal((logs[0]!.after as { submissionMode: string }).submissionMode, 'LEGACY_HEADERLESS');
      assert.equal(await f.db.commandRecord.count({ where: { actorUserId: f.user.id } }), 0);
      if (quote) {
        assert.equal((await f.pricing.getRun(quote.runId!)).status, 'SUCCEEDED');
        assert.equal((await f.service.get(draft.id)).salesGoodsAmount, '130.00');
        await assert.rejects(execute, ConflictException);
        assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
      }
    }));
  }
}

test('headerless price integrations retain audited publication compatibility without claiming keyed recovery', () => withFixture('CREDIT', async f => {
  const result = await f.prices.publishPrice({ productId: f.product.id, supplierId: f.supplier.id, salesPrice: '13', supplyPrice: '10', effectiveAt: '2001-01-01T00:00:00.000Z', reason: 'Legacy standalone' }, { headers: {}, auth: f.auth } as never);
  assert.ok(result.versionId);
  assert.equal(await f.db.commandRecord.count({ where: { actorUserId: f.user.id } }), 0);
  assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id, action: 'price.publish' } }), 1);
}));

async function alternate(f: Awaited<ReturnType<typeof fixture>>, mode: Mode = f.mode) {
  const database = { client: f.db } as never;
  const supplier = await f.db.supplier.create({ data: { code: `${f.code}ALT`, name: 'Isolated alternate', deliveryMode: 'SELF', defaultSettlementMode: mode, defaultSettlementCycle: 'MONTHLY' } });
  const item = await f.db.templateItem.findFirstOrThrow({ where: { templateId: f.template.id } });
  await f.db.templateItemSupplier.create({ data: { templateItemId: item.id, supplierId: supplier.id, priority: 2 } });
  await f.db.supplierProduct.create({ data: { productId: f.product.id, supplierId: supplier.id } });
  await f.pricing.publishPrice({ productId: f.product.id, supplierId: supplier.id, salesPrice: '13', supplyPrice: mode === 'SUPPLIER_TERM' ? '13' : '9', effectiveAt: new Date('2000-01-01'), reason: 'Actual alternate quote' });
  return { supplier, shipping: new SupplierOrdersService(database) };
}

for (const mode of ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM'] as const) {
  for (const operation of ['replace', 'assign', 'reallocate', 'cancel'] as const) {
    for (const failure of ['none', 'completion', 'audit', 'connection'] as const) {
      test(`atomic purchase edit ${mode} ${operation}: ${failure}`, () => withFixture(mode, async f => {
        const alt = await alternate(f);
        const draft = await f.service.create(f.input);
        let rejectedOrderId: string | undefined;
        if (operation === 'reallocate' || operation === 'cancel') {
          const confirmed = await f.service.confirm(draft.id, draft.version);
          const order = await f.db.supplierOrder.findUniqueOrThrow({ where: { id: confirmed.supplierOrderIds[0]! } });
          await alt.shipping.reject(order.id, order.version, 'Actual refusal before purchaser remedy');
          rejectedOrderId = order.id;
        }
        const current = await f.service.get(draft.id);
        const before = await state(f);
        inject(f, failure);
        const request = { headers: { 'idempotency-key': `${f.code}-${operation}` }, auth: f.auth } as never;
        const run = () => operation === 'replace'
          ? f.controller.replaceItems(draft.id, { expectedVersion: current.version, reason: 'Actual quantity edit', items: [{ productId: f.product.id, supplierId: f.supplier.id, quantity: '12' }] }, request, f.auth)
          : operation === 'assign'
            ? f.controller.assign(draft.id, { expectedVersion: current.version, supplierId: alt.supplier.id, itemIds: current.items.map(item => item.id) }, request, f.auth)
            : f.controller.reallocate(request, f.auth, draft.id, { expectedVersion: current.version, rejectedOrderId, reason: 'Actual refusal remedy', assignments: current.items.map(item => operation === 'cancel' ? { requestItemId: item.id, cancel: true } : { requestItemId: item.id, supplierId: alt.supplier.id }) });
        if (failure === 'none') {
          const result = await run();
          assert.deepEqual(await run(), result);
          assert.deepEqual(result, await f.service.get(draft.id));
          const after = await state(f);
          const amount = operation === 'replace' ? '144.00' : operation === 'cancel' ? '0.00' : '130.00';
          assert.equal(result.salesGoodsAmount, amount);
          assert.equal(result.version, current.version + 1);
          assert.equal(result.status, operation === 'reallocate' ? 'CONFIRMED' : operation === 'cancel' ? 'CANCELED' : 'PENDING_PROCUREMENT');
          assert.equal(result.items.length, operation === 'cancel' ? 0 : 1);
          if (operation === 'assign' || operation === 'reallocate') assert.equal(result.items[0]!.supplierId, alt.supplier.id);
          assert.equal(after.orders.filter(order => order.status === 'PUSHED').length, operation === 'reallocate' ? 1 : 0);
          assert.equal(after.account.balance.toFixed(2), '500.00');
          assert.equal(after.account.reservedBalance.toFixed(2), mode === 'STORED_VALUE' ? amount : '0.00');
          assert.equal(after.account.creditUsed.toFixed(2), mode === 'CREDIT' ? amount : '0.00');
          const command = await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } });
          assert.equal(command.status, 'SUCCEEDED');
          assert.deepEqual(command.responseBody, result);
          assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
        } else {
          await assert.rejects(run());
          await assert.rejects(run(), ConflictException);
          assert.deepEqual(await state(f), before);
          assert.deepEqual(await f.service.get(draft.id), current);
          assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
          const command = await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } });
          assert.equal(command.status, 'PROCESSING');
          assert.equal(command.responseBody, null);
        }
      }));
    }
  }
}

for (const [mode, targetMode] of [['STORED_VALUE', 'CREDIT'], ['CREDIT', 'STORED_VALUE']] as const) {
  for (const failure of ['none', 'completion', 'audit', 'connection'] as const) {
    test(`atomic reallocation switches ${mode} to ${targetMode}: ${failure}`, () => withFixture(mode, async f => {
      const alt = await alternate(f, targetMode);
      const draft = await f.service.create(f.input);
      const confirmed = await f.service.confirm(draft.id, draft.version);
      const order = await f.db.supplierOrder.findUniqueOrThrow({ where: { id: confirmed.supplierOrderIds[0]! } });
      await alt.shipping.reject(order.id, order.version, 'Actual mixed-channel refusal');
      const current = await f.service.get(draft.id), before = await state(f);
      inject(f, failure);
      const request = { headers: { 'idempotency-key': `${f.code}-switch` }, auth: f.auth } as never;
      const run = () => f.controller.reallocate(request, f.auth, draft.id, { expectedVersion: current.version, rejectedOrderId: order.id, reason: 'Switch actual settlement channel', assignments: [{ requestItemId: current.items[0]!.id, supplierId: alt.supplier.id }] });
      if (failure === 'none') {
        const result = await run();
        assert.deepEqual(await run(), result);
        assert.deepEqual(result, await f.service.get(draft.id));
        const after = await state(f);
        assert.equal(after.account.balance.toFixed(2), '500.00');
        assert.equal(after.account.reservedBalance.toFixed(2), targetMode === 'STORED_VALUE' ? '130.00' : '0.00');
        assert.equal(after.account.creditUsed.toFixed(2), targetMode === 'CREDIT' ? '130.00' : '0.00');
        assert.equal(after.orders.find(order => order.status === 'PUSHED')!.settlementMode, targetMode);
        assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
      } else {
        await assert.rejects(run());
        await assert.rejects(run(), ConflictException);
        assert.deepEqual(await state(f), before);
        assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
        assert.equal((await f.db.commandRecord.findFirstOrThrow({ where: { actorUserId: f.user.id } })).status, 'PROCESSING');
      }
    }));
  }
}

test('concurrent quantity edit and supplier assignment commit one version and one audit', () => withFixture('STORED_VALUE', async f => {
  const alt = await alternate(f), draft = await f.service.create(f.input), current = await f.service.get(draft.id);
  const request = (key: string) => ({ headers: { 'idempotency-key': `${f.code}-${key}` }, auth: f.auth }) as never;
  const results = await Promise.allSettled([
    f.controller.replaceItems(draft.id, { expectedVersion: current.version, reason: 'Concurrent edit', items: [{ productId: f.product.id, supplierId: f.supplier.id, quantity: '12' }] }, request('edit'), f.auth),
    f.controller.assign(draft.id, { expectedVersion: current.version, supplierId: alt.supplier.id, itemIds: current.items.map(item => item.id) }, request('assign'), f.auth),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(failed.reason instanceof ConflictException);
  const after = await state(f);
  assert.equal(after.requests[0]!.version, current.version + 1);
  assert.equal(after.account.balance.toFixed(2), '500.00');
  assert.equal(after.account.reservedBalance.toFixed(2), after.requests[0]!.salesGoodsAmount.toFixed(2));
  assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
  assert.deepEqual((await f.db.commandRecord.findMany({ where: { actorUserId: f.user.id } })).map(row => row.status).sort(), ['FAILED', 'SUCCEEDED']);
}));

for (const mode of ['STORED_VALUE', 'CREDIT', 'COMPANY_TERM', 'SUPPLIER_TERM'] as const) {
  for (const operation of ['replace', 'assign'] as const) for (const failure of ['none', 'audit', 'connection'] as const) {
    test(`legacy headerless purchase ${mode} ${operation}: ${failure}`, () => withFixture(mode, async f => {
      const alt = await alternate(f), draft = await f.service.create(f.input);
      const current = await f.service.get(draft.id), before = await state(f);
      const originalAudit = f.audit.record.bind(f.audit);
      inject(f, failure);
      const request = { headers: {}, auth: f.auth } as never;
      const execute = () => operation === 'replace'
        ? f.controller.replaceItems(draft.id, { expectedVersion: current.version, reason: 'Legacy atomic edit', items: [{ productId: f.product.id, supplierId: f.supplier.id, quantity: '12' }] }, request, f.auth)
        : f.controller.assign(draft.id, { expectedVersion: current.version, supplierId: alt.supplier.id, itemIds: current.items.map(item => item.id) }, request, f.auth);
      if (failure !== 'none') {
        await assert.rejects(execute);
        assert.deepEqual(await state(f), before);
        assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 0);
        f.audit.record = originalAudit;
      }
      const result = await execute();
      assert.deepEqual(result, await f.service.get(draft.id));
      const logs = await f.db.auditLog.findMany({ where: { actorUserId: f.user.id } });
      assert.equal(logs.length, 1);
      assert.equal((logs[0]!.after as { submissionMode: string }).submissionMode, 'LEGACY_HEADERLESS');
      assert.equal(await f.db.commandRecord.count({ where: { actorUserId: f.user.id } }), 0);
      await assert.rejects(execute, ConflictException);
      assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 1);
    }));
  }
}

test('headerless purchase editing and assignment retain compatibility without claiming command recovery', () => withFixture('CREDIT', async f => {
  const alt = await alternate(f), draft = await f.service.create(f.input);
  const request = { headers: {}, auth: f.auth } as never;
  const edited = await f.controller.replaceItems(draft.id, { expectedVersion: draft.version, reason: 'Legacy edit', items: [{ productId: f.product.id, supplierId: f.supplier.id, quantity: '12' }] }, request, f.auth);
  const assigned = await f.controller.assign(draft.id, { expectedVersion: edited.version, supplierId: alt.supplier.id, itemIds: edited.items.map(item => item.id) }, request, f.auth);
  assert.equal(assigned.salesGoodsAmount, '156.00');
  assert.equal(await f.db.commandRecord.count({ where: { actorUserId: f.user.id } }), 0);
  assert.equal(await f.db.auditLog.count({ where: { actorUserId: f.user.id } }), 2);
}));
