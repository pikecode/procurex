import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { AppModule } from '../../apps/api/src/app.module.js';
import { FilesService } from '../../apps/api/src/files/files.service.js';
import { PricingService } from '../../apps/api/src/pricing/pricing.service.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../../packages/domain/src/password.js';
import { requestHash } from '../../packages/domain/src/idempotency.js';

const roles = ['ADMIN', 'PURCHASER', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER'] as const;
const central = ['ADMIN', 'PURCHASER', 'HQ_FINANCE'];
const stores = ['ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE'];
const suppliers = ['ADMIN', 'PURCHASER', 'HQ_FINANCE', 'SUPPLIER'];
const bills = ['ADMIN', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE'];
const supplierBills = ['ADMIN', 'HQ_FINANCE', 'SUPPLIER'];
const directBills = [...bills, 'SUPPLIER'];

for (const roleCode of roles) test(`role privacy HTTP ${roleCode}: scope states, field projection, private documents and exports`, async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
  const prefix = `RPM${Date.now()}`;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  const fileKeys: string[] = [];
  try {
    const category = await db.category.create({ data: { code: prefix, name: prefix } });
    const unit = await db.unit.create({ data: { code: prefix, name: 'piece' } });
    const product = await db.product.create({ data: { sku: prefix, name: prefix, categoryId: category.id, baseUnitId: unit.id } });
    const template = await db.orderTemplate.create({ data: { code: prefix, name: prefix } });
    const fixtures = [];
    for (const suffix of ['A', 'B']) {
      const store = await db.store.create({ data: { code: `${prefix}${suffix}`, name: `${prefix}${suffix}` } });
      const supplier = await db.supplier.create({ data: { code: `${prefix}${suffix}`, name: `${prefix}${suffix}`, deliveryMode: 'SELF', defaultSettlementMode: 'COMPANY_TERM', defaultSettlementCycle: 'MONTHLY' } });
      await db.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } });
      await db.supplierProduct.create({ data: { supplierId: supplier.id, productId: product.id } });
      const item = await db.templateItem.upsert({ where: { templateId_productId: { templateId: template.id, productId: product.id } }, update: {}, create: { templateId: template.id, productId: product.id } });
      await db.templateItemSupplier.create({ data: { templateItemId: item.id, supplierId: supplier.id } });
      const price = await app.get(PricingService).publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '12', supplyPrice: '9', effectiveAt: new Date('2000-01-01'), reason: prefix });
      const request = await db.purchaseRequest.create({ data: { requestNo: `${prefix}${suffix}`, storeId: store.id, templateId: template.id, status: 'CONFIRMED', salesGoodsAmount: '120', supplyGoodsAmount: '90',
        items: { create: { productId: product.id, supplierId: supplier.id, quantity: '10', salesUnitPrice: '12', supplyUnitPrice: '9', salesLineAmount: '120', supplyLineAmount: '90', priceVersionId: price.versionId, supplyPriceVersionId: price.supplyVersionId } } } });
      const order = await db.supplierOrder.create({ data: { supplierOrderNo: `${prefix}${suffix}`, requestId: request.id, storeId: store.id, supplierId: supplier.id,
        settlementMode: 'COMPANY_TERM', settlementCycleSnapshot: 'MONTHLY', status: 'COMPLETED', firstShippedAt: new Date('2026-09-10'), completedAt: new Date('2026-09-11'), salesGoodsAmount: '120', supplyGoodsAmount: '90',
        items: { create: { productId: product.id, quantity: '10', shippedQuantity: '10', receivedQuantity: '10', salesUnitPrice: '12', supplyUnitPrice: '9', salesLineAmount: '120', supplyLineAmount: '90' } } }, include: { items: true } });
      const direct = await db.supplierOrder.create({ data: { supplierOrderNo: `${prefix}${suffix}D`, requestId: request.id, storeId: store.id, supplierId: supplier.id,
        settlementMode: 'SUPPLIER_TERM', settlementCycleSnapshot: 'MONTHLY', status: 'COMPLETED', firstShippedAt: new Date('2026-09-10'), completedAt: new Date('2026-09-11'), salesGoodsAmount: '90', supplyGoodsAmount: '90',
        items: { create: { productId: product.id, quantity: '10', receivedQuantity: '10', salesUnitPrice: '9', supplyUnitPrice: '9', salesLineAmount: '90', supplyLineAmount: '90' } } } });
      const undated = await db.supplierOrder.create({ data: { supplierOrderNo: `${prefix}${suffix}U`, requestId: request.id, storeId: store.id, supplierId: supplier.id,
        status: 'COMPLETED', settlementMode: 'COMPANY_TERM', settlementCycleSnapshot: 'MONTHLY' } });
      const shipment = await db.shipment.create({ data: { shipmentNo: `${prefix}${suffix}`, supplierOrderId: order.id, sequence: 1, kind: 'INITIAL',
        items: { create: { orderItemId: order.items[0]!.id, quantity: '10', salesPriceSnapshot: '12', supplyPriceSnapshot: '9', salesLineAmount: '120', supplyLineAmount: '90' } } }, include: { items: true } });
      await db.freightConfirmation.create({ data: { supplierOrderId: order.id, amount: '5', reason: prefix } });
      const recharge = await db.rechargeDocument.create({ data: { rechargeNo: `${prefix}${suffix}`, storeId: store.id, amount: '10', businessDate: new Date('2026-09-11'), collectionAccountId: 'test-account' } });
      const clearing = await db.clearingDocument.create({ data: { clearingNo: `${prefix}${suffix}`, storeId: store.id, amount: '10', businessDate: new Date('2026-09-11') } });
      const payments = [];
      for (const direction of ['STORE_TO_COMPANY', 'COMPANY_TO_SUPPLIER', 'STORE_TO_SUPPLIER'] as const) {
        payments.push(await db.paymentRecord.create({ data: { paymentNo: `${prefix}${suffix}${direction}`, direction, storeId: store.id, supplierId: supplier.id,
          amount: direction === 'STORE_TO_COMPANY' ? '120' : '90', businessDate: new Date('2026-09-11'), status: 'CONFIRMED', version: 2 } }));
      }
      const disposals = [];
      for (const direction of ['COMPANY_TO_STORE', 'SUPPLIER_TO_COMPANY'] as const) disposals.push(await db.differenceDisposal.create({ data: {
        disposalNo: `${prefix}${suffix}${direction}`, direction, method: 'OFFLINE_RETURN', storeId: store.id, supplierId: supplier.id,
        amount: '5', businessDate: new Date('2026-09-11'), status: 'CONFIRMED', version: 2,
      } }));
      const receipt = await db.receipt.create({ data: { receiptNo: `${prefix}${suffix}`, shipmentId: shipment.id, revision: 1,
        items: { create: { shipmentItemId: shipment.items[0]!.id, receivedQuantity: '9' } } }, include: { items: true } });
      const discrepancy = await db.discrepancy.create({ data: { receiptItemId: receipt.items[0]!.id, orderItemId: order.items[0]!.id,
        missingQuantity: '1', status: 'RESOLVED', version: 2 } });
      fixtures.push({ store, supplier, request, order, direct, undated, shipment, recharge, clearing, payments, disposals, discrepancy });
    }
    const own = fixtures[0]!, foreign = fixtures[1]!;
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    const login = async (code: string, suffix: string) => {
      const role = await db.role.upsert({ where: { code }, update: {}, create: { code, name: code } });
      const user = await db.user.create({ data: { username: `${prefix}${suffix}`, displayName: prefix, passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } } } });
      const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user.username, password: 'correct-password', client: 'WEB' }) });
      assert.equal(response.status, 201);
      const result = await response.json() as { data: { accessToken: string } };
      return { user, token: result.data.accessToken };
    };
    const actor = await login(roleCode, 'ACTOR'), owner = await login('ADMIN', 'OWNER');
    const call = (path: string, token = actor.token, method = 'GET', body?: object, key?: string) => fetch(`${base}${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const get = async (path: string, token = actor.token) => {
      const response = await call(path, token); assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
      return (await response.json() as { data: any }).data;
    };
    const fileService = app.get(FilesService), bytes = Buffer.from([137,80,78,71,13,10,26,10]);
    const files = [];
    for (const fixture of fixtures) {
      const upload = await fileService.create(owner.user.id, { purpose: 'RECHARGE', filename: 'proof.png', mimeType: 'image/png', sizeBytes: bytes.length }, ['ADMIN']);
      const file = await db.fileObject.findUniqueOrThrow({ where: { id: upload.id } }); fileKeys.push(file.objectKey);
      await fileService.upload(owner.user.id, upload.id, upload.uploadToken, bytes); await fileService.complete(owner.user.id, upload.id);
      await db.fileObject.update({ where: { id: upload.id }, data: { rechargeId: fixture.recharge.id } }); files.push(upload.id);
    }
    const paymentFiles = [];
    for (const payment of own.payments) {
      const upload = await fileService.create(owner.user.id, { purpose: 'PAYMENT', filename: 'payment.png', mimeType: 'image/png', sizeBytes: bytes.length }, ['ADMIN']);
      const file = await db.fileObject.findUniqueOrThrow({ where: { id: upload.id } }); fileKeys.push(file.objectKey);
      await fileService.upload(owner.user.id, upload.id, upload.uploadToken, bytes); await fileService.complete(owner.user.id, upload.id);
      await db.fileObject.update({ where: { id: upload.id }, data: { paymentId: payment.id } }); paymentFiles.push(upload.id);
    }
    const endpoints: Array<[string, string[]]> = [
      ['/categories', central], ['/units', central], ['/brands', central], ['/products', central], ['/templates', ['ADMIN', 'PURCHASER']], ['/users', ['ADMIN']],
      ['/suppliers', central], [`/suppliers/${own.supplier.id}`, [...central, 'SUPPLIER']], [`/suppliers/${own.supplier.id}/catalog`, [...central, 'SUPPLIER']],
      ['/purchase-requests', ['ADMIN', 'PURCHASER', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE']], [`/stores/${own.store.id}/catalog`, [...central, 'STORE', 'STORE_FINANCE']],
      ['/supplier-orders', suppliers], ['/freight-confirmations', ['ADMIN', 'PURCHASER', 'SUPPLIER']], [`/shipments/${own.shipment.id}`, stores],
      ['/store-statements', bills], ['/supplier-statements', supplierBills], ['/supplier-store-statements', supplierBills], ['/direct-statements', directBills],
      [`/recharges/${own.recharge.id}`, bills], [`/clearings/${own.clearing.id}`, bills],
      ['/reports/order-amounts', [...roles]], ['/reports/product-quantities?from=2026-09-01&to=2026-09-30', [...roles]], ['/reports/profit', central], ['/exports', [...roles]],
      ['/audit-logs', ['ADMIN', 'HQ_FINANCE']], ['/commands/stale', ['ADMIN']],
      ['/payment-records', directBills], ['/adjustments', directBills], ['/discrepancies', ['ADMIN', 'SUPPLIER']], ['/reconciliation-issues', ['ADMIN', 'HQ_FINANCE']],
      [`/stores/${own.store.id}/account`, bills], [`/stores/${own.store.id}/ledgers`, bills], [`/stores/${own.store.id}/credit-items`, bills],
      [`/stores/${own.store.id}/credit-movements`, bills],
      [`/stores/${own.store.id}/recharges/${own.recharge.id}`, bills], [`/stores/${own.store.id}/clearings/${own.clearing.id}`, bills],
    ];
    const business = ['STORE', 'STORE_FINANCE', 'SUPPLIER'].includes(roleCode);
    for (const state of business ? ['missing', 'wrong', 'valid'] : ['valid']) {
      if (state === 'wrong') await db.userScope.create({ data: { userId: actor.user.id, scopeType: 'COMPANY' } });
      if (state === 'valid' && business) await db.userScope.upsert({ where: { userId: actor.user.id },
        create: { userId: actor.user.id, scopeType: roleCode === 'SUPPLIER' ? 'SUPPLIER' : 'STORE', storeId: roleCode === 'SUPPLIER' ? null : own.store.id, supplierId: roleCode === 'SUPPLIER' ? own.supplier.id : null },
        update: { scopeType: roleCode === 'SUPPLIER' ? 'SUPPLIER' : 'STORE', storeId: roleCode === 'SUPPLIER' ? null : own.store.id, supplierId: roleCode === 'SUPPLIER' ? own.supplier.id : null } });
      for (const [path, allowed] of endpoints) {
        const response = await call(path);
        assert.equal(response.status, allowed.includes(roleCode) && !(business && state !== 'valid') ? 200 : 403, `${roleCode} ${state} ${path}: ${await response.clone().text()}`);
      }
      if (business && state !== 'valid') {
        assert.equal((await call(`/files/${files[0]}/download`)).status, 403);
        continue;
      }
    }
    assert.equal((await call('/notifications')).status, 200);
    assert.equal((await call('/commands')).status, 200);
    for (const [index, payment] of own.payments.entries()) {
      const visible = roleCode !== 'PURCHASER' && !(roleCode === 'SUPPLIER' && payment.direction === 'STORE_TO_COMPANY')
        && !(['STORE', 'STORE_FINANCE'].includes(roleCode) && payment.direction === 'COMPANY_TO_SUPPLIER');
      assert.equal((await call(`/payment-records/${payment.id}`)).status, roleCode === 'PURCHASER' ? 403 : visible ? 200 : 404);
      assert.equal((await call(`/files/${paymentFiles[index]}/download`)).status, visible ? 200 : 404);
      if (roleCode !== 'PURCHASER') {
        const list = await get(`/payment-records?direction=${payment.direction}`);
        assert.equal(list.some((row: any) => row.id === payment.id), visible);
        if (business) {
          assert.ok(list.every((row: any) => roleCode === 'SUPPLIER' ? row.supplierId === own.supplier.id : row.storeId === own.store.id));
          assert.equal((await call(`/payment-records/${foreign.payments[index]!.id}`)).status, 404);
        }
      }
    }
    if (business) {
      const payment = own.payments.find(row => row.direction === (roleCode === 'SUPPLIER' ? 'COMPANY_TO_SUPPLIER' : 'STORE_TO_COMPANY'))!;
      const disposal = own.disposals.find(row => row.direction === (roleCode === 'SUPPLIER' ? 'SUPPLIER_TO_COMPANY' : 'COMPANY_TO_STORE'))!;
      const cases: Array<{ action: string; path: string; body: object; resourceId: string; root?: boolean }> = [
        { action: 'difference-disposal.confirm', path: `/difference-disposals/${disposal.id}/confirm`, body: { expectedVersion: 1 }, resourceId: disposal.id },
      ];
      if (roleCode === 'SUPPLIER') cases.push(
        { action: 'supplier-order.shipment.create', path: `/supplier-orders/${own.order.id}/shipments`, resourceId: own.order.id,
          body: { expectedVersion: 1, items: [{ orderItemId: own.order.items[0]!.id, shipQuantity: '1', permanentlyReduceQuantity: '0' }] } },
        { action: 'supplier-order.freight-confirmation.create', path: `/supplier-orders/${own.order.id}/freight-confirmations`, resourceId: own.order.id,
          body: { expectedVersion: 1, amount: '5', reason: 'original freight' } },
        { action: 'supplier-order.reject', path: `/supplier-orders/${own.order.id}/reject`, resourceId: own.order.id, body: { expectedVersion: 1, reason: 'original rejection' } },
        { action: 'discrepancy.resolve', path: `/discrepancies/${own.discrepancy.id}/resolve`, resourceId: own.discrepancy.id, body: { expectedVersion: 1, action: 'ACCEPT' } },
        { action: 'payment-record.confirm', path: `/payment-records/${payment.id}/confirm`, resourceId: payment.id, body: { expectedVersion: 1 } },
        { action: 'payment-record.reject', path: `/payment-records/${payment.id}/reject`, resourceId: payment.id, body: { expectedVersion: 1, reason: 'original proof' } },
      );
      else {
        cases.push({ action: 'payment-record.create', path: '/payment-records', resourceId: payment.id, root: true, body: { direction: 'STORE_TO_COMPANY',
          businessDate: '2026-09-11', evidenceFileIds: [paymentFiles[0]], items: [{ settlementItemId: 'saved-original-item', expectedVersion: 1, expectedAmount: '120' }] } },
        { action: 'payment-record.cancel', path: `/payment-records/${payment.id}/cancel`, resourceId: payment.id, body: { expectedVersion: 1, reason: 'original cancel' } });
        if (roleCode === 'STORE') cases.push({ action: 'shipment.receipt.create', path: `/shipments/${own.shipment.id}/receipts`, resourceId: own.shipment.id,
          body: { expectedOrderVersion: 1, expectedReceiptRevision: 0, items: [{ shipmentItemId: own.shipment.items[0]!.id, receivedQuantity: '9' }] } });
      }
      for (const entry of cases) {
        const id = entry.root ? undefined : entry.path.split('/')[2]!;
        const saved = { id: entry.resourceId, originalScopeMarker: 'private-old-scope' };
        const key = `${prefix}-${entry.action}`;
        const command = await db.commandRecord.create({ data: { actorUserId: actor.user.id, action: entry.action, idempotencyKey: key,
          requestHash: requestHash(entry.root ? entry.body as never : { id, ...entry.body } as never), traceId: prefix,
          status: 'SUCCEEDED', responseBody: saved, finishedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } });
        const before = JSON.stringify(command);
        const replay = await call(entry.path, actor.token, 'POST', entry.body, key);
        assert.equal(replay.status, 201, `${entry.action} own replay: ${await replay.clone().text()}`);
        assert.deepEqual((await replay.json() as any).data, saved);
        await db.userScope.update({ where: { userId: actor.user.id }, data: roleCode === 'SUPPLIER' ? { supplierId: foreign.supplier.id } : { storeId: foreign.store.id } });
        const denied = await call(entry.path, actor.token, 'POST', entry.body, key);
        assert.equal(denied.status, 404, `${entry.action} changed scope: ${await denied.clone().text()}`);
        assert.doesNotMatch(await denied.text(), /private-old-scope/);
        assert.equal(JSON.stringify(await db.commandRecord.findUniqueOrThrow({ where: { id: command.id } })), before);
        await db.userScope.update({ where: { userId: actor.user.id }, data: roleCode === 'SUPPLIER' ? { supplierId: own.supplier.id } : { storeId: own.store.id } });
        const restored = await call(entry.path, actor.token, 'POST', entry.body, key);
        assert.equal(restored.status, 201); assert.deepEqual((await restored.json() as any).data, saved);
        assert.equal(await db.auditLog.count({ where: { actorUserId: actor.user.id, action: entry.action } }), 0);
      }
    }
    if (roleCode === 'STORE' || roleCode === 'STORE_FINANCE') {
      for (const path of ['/purchase-requests', `/purchase-requests/${own.request.id}`, `/stores/${own.store.id}/catalog`, `/shipments/${own.shipment.id}`]) {
        const data = await get(path);
        assert.doesNotMatch(JSON.stringify(data), /"(?:supplyGoodsAmount|supplyUnitPrice|supplyLineAmount|supplyPrice|supplyPriceSnapshot|purchaseSupplyPrice|purchaseSupplyUnitPrice|profit)"/);
      }
      assert.equal((await call(`/purchase-requests/${foreign.request.id}`)).status, 404);
      assert.equal((await call(`/shipments/${foreign.shipment.id}`)).status, 404);
      assert.equal((await call(`/recharges/${foreign.recharge.id}`)).status, 404);
      assert.equal((await call(`/clearings/${foreign.clearing.id}`)).status, 404);
      assert.equal((await call(`/files/${files[0]}/download`)).status, 200);
      assert.equal((await call(`/files/${files[1]}/download`)).status, 404);
      for (const route of ['/store-statements', '/direct-statements']) {
        const data = await get(route); assert.ok(data.length);
        assert.ok(data.every((row: any) => row.storeId === own.store.id));
        assert.equal((await call(`${route}?storeId=${foreign.store.id}`)).status, 403);
        const foreignList = await get(`${route}?storeId=${foreign.store.id}`, owner.token);
        assert.equal((await call(`${route}/${foreignList[0].id}`)).status, 404);
      }
      if (roleCode === 'STORE') {
        const body = { storeId: own.store.id, items: [{ productId: product.id, quantity: '1' }] };
        const preview = await call('/purchase-requests/preview', actor.token, 'POST', body);
        assert.equal(preview.status, 201); const quote = (await preview.json() as any).data;
        assert.equal(quote.items[0].supplyUnitPrice, undefined); assert.ok(quote.items[0].supplyPriceVersionId);
        const input = { ...body, items: [{ ...body.items[0], expectedPriceVersionId: quote.items[0].priceVersionId, expectedSupplyPriceVersionId: quote.items[0].supplyPriceVersionId }] };
        const create = await call('/purchase-requests', actor.token, 'POST', input, `${prefix}-create`); assert.equal(create.status, 201);
        const result = await create.json(); assert.doesNotMatch(JSON.stringify(result), /"supplyUnitPrice"|"supplyGoodsAmount"/);
        const replay = await call('/purchase-requests', actor.token, 'POST', input, `${prefix}-create`); assert.equal(replay.status, 201);
        assert.deepEqual((await replay.json() as any).data, (result as any).data);
      }
    }
    if (roleCode === 'SUPPLIER') {
      const detail = await get(`/supplier-orders/${own.order.id}`);
      assert.equal(detail.salesGoodsAmount, undefined); assert.equal(detail.items[0].salesUnitPrice, undefined); assert.equal(detail.items[0].supplyUnitPrice, '9');
      assert.equal((await call(`/supplier-orders/${foreign.order.id}`)).status, 404);
      assert.equal((await call(`/files/${files[0]}/download`)).status, 404);
      for (const route of ['/supplier-statements', '/supplier-store-statements', '/direct-statements']) {
        const data = await get(route); assert.ok(data.length);
        assert.ok(data.every((row: any) => row.supplierId === own.supplier.id));
        assert.equal((await call(`${route}?supplierId=${foreign.supplier.id}`)).status, 403);
        const foreignList = await get(`${route}?supplierId=${foreign.supplier.id}`, owner.token);
        assert.equal((await call(`${route}/${foreignList[0].id}`)).status, 404);
      }
      const report = await get('/reports/order-amounts?from=2026-09-01&to=2026-09-30');
      assert.equal(report.amountBasis, 'SUPPLY'); assert.equal(report.orders.find((row: any) => row.supplierOrderId === own.order.id).goodsAmount, '90.00');
      assert.equal((await call('/exports', actor.token, 'POST', { reportType: 'profit' })).status, 403);
      const exported = await call('/exports', actor.token, 'POST', { reportType: 'order-amounts', filters: { from: '2026-09-01', to: '2026-09-30', amountBasis: 'SALES' } });
      assert.equal(exported.status, 202); const jobId = (await exported.json() as any).data.jobId;
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await get(`/exports/${jobId}`)).status === 'READY') break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const download = await call(`/exports/${jobId}/download`); assert.equal(download.status, 200);
      const csv = await download.text(); assert.match(csv, /"90.00"/); assert.doesNotMatch(csv, /"120.00"/);
      const legacy = await db.exportJob.create({ data: { requestedById: actor.user.id, reportType: 'order-amounts', status: 'READY', filters: { supplierId: own.supplier.id },
        permissionScope: { type: 'SUPPLIER', supplierId: own.supplier.id }, csvContent: 'private-sales-120', asOf: new Date(), expiresAt: new Date(Date.now() + 60000) } });
      for (const path of [`/exports/${legacy.id}`, `/exports/${legacy.id}/download`]) assert.equal((await call(path)).status, 404);
      assert.ok(!(await get('/exports')).some((row: any) => row.jobId === legacy.id));
    }
    if (central.includes(roleCode)) {
      const report = await get(`/reports/order-amounts?storeId=${own.store.id}`); assert.equal(report.amountBasis, 'SALES');
      assert.equal(report.orders.length, 2); assert.ok(!report.orders.some((row: any) => row.supplierOrderId === own.undated.id));
      assert.equal(report.orders.find((row: any) => row.supplierOrderId === own.order.id).goodsAmount, '120.00');
      assert.equal((await get(`/purchase-requests/${own.request.id}`)).items[0].supplyUnitPrice, '9');
      if (roleCode === 'HQ_FINANCE') {
        for (const fixture of fixtures) {
          assert.equal((await get(`/purchase-requests/${fixture.request.id}`)).status, 'CONFIRMED');
          assert.equal((await get(`/supplier-orders/${fixture.order.id}`)).status, 'COMPLETED');
          assert.equal((await get(`/shipments/${fixture.shipment.id}`)).supplierOrderId, fixture.order.id);
        }
        for (const path of [`/purchase-requests/${own.request.id}/confirm`, `/supplier-orders/${own.order.id}/shipments`, `/shipments/${own.shipment.id}/receipts`]) {
          assert.equal((await call(path, actor.token, 'POST', {})).status, 403);
        }
      }
      assert.equal((await call(`/files/${files[0]}/download`)).status, roleCode === 'PURCHASER' ? 404 : 200);
    }
  } finally {
    await app.close();
    const storeIds = (await db.store.findMany({ where: { code: { startsWith: prefix } }, select: { id: true } })).map(row => row.id);
    const supplierIds = (await db.supplier.findMany({ where: { code: { startsWith: prefix } }, select: { id: true } })).map(row => row.id);
    await db.commandRecord.deleteMany({ where: { actor: { username: { startsWith: prefix } } } });
    await db.fileObject.deleteMany({ where: { owner: { username: { startsWith: prefix } } } });
    await db.paymentRecord.deleteMany({ where: { paymentNo: { startsWith: prefix } } });
    await db.differenceDisposal.deleteMany({ where: { disposalNo: { startsWith: prefix } } });
    await db.fundingAllocation.deleteMany({ where: { storeId: { in: storeIds } } });
    await db.accountLedger.deleteMany({ where: { account: { storeId: { in: storeIds } } } });
    await db.discrepancy.deleteMany({ where: { orderItem: { supplierOrder: { storeId: { in: storeIds } } } } });
    await db.receipt.deleteMany({ where: { shipment: { supplierOrder: { storeId: { in: storeIds } } } } });
    await db.shipment.deleteMany({ where: { supplierOrder: { storeId: { in: storeIds } } } });
    await db.freightConfirmation.deleteMany({ where: { supplierOrder: { storeId: { in: storeIds } } } });
    await db.supplierOrder.deleteMany({ where: { storeId: { in: storeIds } } });
    await db.purchaseRequest.deleteMany({ where: { storeId: { in: storeIds } } });
    await db.rechargeDocument.deleteMany({ where: { storeId: { in: storeIds } } }); await db.clearingDocument.deleteMany({ where: { storeId: { in: storeIds } } });
    await db.storeTemplateBinding.deleteMany({ where: { template: { code: prefix } } });
    await db.orderTemplate.deleteMany({ where: { code: prefix } });
    await db.priceScope.deleteMany({ where: { supplierId: { in: supplierIds } } });
    await db.supplierProduct.deleteMany({ where: { supplierId: { in: supplierIds } } });
    await db.product.deleteMany({ where: { sku: prefix } }); await db.category.deleteMany({ where: { code: prefix } }); await db.unit.deleteMany({ where: { code: prefix } });
    await db.storeAccount.deleteMany({ where: { storeId: { in: storeIds } } });
    await db.userScope.deleteMany({ where: { user: { username: { startsWith: prefix } } } });
    await db.store.deleteMany({ where: { id: { in: storeIds } } }); await db.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await db.user.deleteMany({ where: { username: { startsWith: prefix } } }); await db.$disconnect();
    for (const key of fileKeys) await unlink(join(resolve(process.env.PRIVATE_FILE_DIR ?? 'var/private-files'), key)).catch(() => undefined);
  }
});
