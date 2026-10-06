import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { DatabaseService } from '../dist/apps/api/src/database/database.service.js';
import { PricingService } from '../dist/apps/api/src/pricing/pricing.service.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';

const phase = process.argv[2]; assert.ok(['seed', 'verify'].includes(phase));
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, phase === 'seed' ? '/drill_source' : '/drill_restore'); assert.notEqual(url.port, '55438');
const root = process.env.RESTORE_DRILL_ROOT; assert.match(root, /^\/private\/tmp\/procurex-restore-[0-9a-f-]{36}$/);
assert.equal(resolve(process.env.PRIVATE_FILE_DIR), join(root, phase === 'seed' ? 'source-files' : 'restored-files'));
assert.ok(process.env.RESTORE_DRILL_PASSWORD);
const app = await NestFactory.create(AppModule, { logger: false });
app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
const db = app.get(DatabaseService).client;
const hash = value => createHash('sha256').update(value).digest('hex');
async function databaseSnapshot() {
  const tables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const result = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[A-Za-z_][A-Za-z0-9_]*$/);
    const rows = await db.$queryRawUnsafe(`SELECT row_to_json(t) AS row FROM public."${tablename}" t ORDER BY row_to_json(t)::text`);
    result[tablename] = { rows: rows.length, checksum: hash(JSON.stringify(rows)) };
  }
  return result;
}
try {
  await app.listen(0, '127.0.0.1'); const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  let token;
  const call = async (path, body, key = randomUUID()) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), 'idempotency-key': key }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json(); assert.ok(response.ok, `${path}: ${response.status} ${result.code}`); return result.data;
  };
  const login = async username => (await call('/auth/login', { username, password: process.env.RESTORE_DRILL_PASSWORD, client: 'WEB' })).accessToken;
  if (phase === 'seed') {
    assert.equal(await db.store.count(), 0);
    const category = await db.category.create({ data: { code: 'DRILL', name: 'Recovery fixture' } }), unit = await db.unit.create({ data: { code: 'DRILL', name: 'piece' } });
    const product = await db.product.create({ data: { sku: 'DRILL', name: 'Recovery item', categoryId: category.id, baseUnitId: unit.id } });
    const supplier = await db.supplier.create({ data: { code: 'DRILL', name: 'Recovery supplier', deliveryMode: 'SELF', defaultSettlementMode: 'CREDIT', defaultSettlementCycle: 'MONTHLY' } });
    const store = await db.store.create({ data: { code: 'DRILL', name: 'Recovery store' } });
    const foreign = await db.store.create({ data: { code: 'FOREIGN', name: 'Unrelated recovery store' } });
    await db.storeAccount.create({ data: { storeId: store.id, creditLimit: '2000' } });
    await db.supplierProduct.create({ data: { productId: product.id, supplierId: supplier.id } });
    await db.orderTemplate.create({ data: { code: 'DRILL', name: 'Recovery template', bindings: { create: { storeId: store.id } }, items: { create: { productId: product.id, suppliers: { create: { supplierId: supplier.id } } } } } });
    for (const [username, code, storeId] of [['restore_admin', 'ADMIN'], ['restore_store', 'STORE', store.id], ['restore_foreign', 'STORE', foreign.id], ['restore_supplier', 'SUPPLIER']]) {
      const role = await db.role.upsert({ where: { code }, update: {}, create: { code, name: code } });
      const user = await db.user.create({ data: { username, displayName: username, passwordHash: await hashPassword(process.env.RESTORE_DRILL_PASSWORD), roles: { create: { roleId: role.id } } } });
      if (storeId) await db.userScope.create({ data: { userId: user.id, scopeType: 'STORE', storeId } });
      if (code === 'SUPPLIER') await db.userScope.create({ data: { userId: user.id, scopeType: 'SUPPLIER', supplierId: supplier.id } });
    }
    await app.get(PricingService).publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '100', supplyPrice: '80', effectiveAt: new Date('2000-01-01'), reason: 'Isolated restore master price' });
    token = await login('restore_admin');
    const bytes = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#248b72' } }).png().toBuffer();
    const upload = async purpose => {
      const session = await call('/files/upload-sessions', { purpose, filename: `${purpose.toLowerCase()}.png`, mimeType: 'image/png', sizeBytes: bytes.length });
      const response = await fetch(`${base}/files/${session.id}/content`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-upload-token': session.uploadToken }, body: bytes }); assert.ok(response.ok);
      await call(`/files/${session.id}/complete`, {}); return session.id;
    };
    const collection = await call('/collection-accounts', { name: '恢复演练账户', bankName: '演练银行', accountName: '演练公司', accountNo: 'ISOLATED-ONLY' });
    await call(`/stores/${store.id}/recharges`, { amount: '1000', businessDate: '2026-10-05', collectionAccountId: collection.id, evidenceFileIds: [await upload('RECHARGE')] });
    const requests = [];
    for (const quantity of ['3', '7']) { const request = await call('/purchase-requests', { storeId: store.id, items: [{ productId: product.id, quantity }] }); await call(`/purchase-requests/${request.id}/confirm`, { expectedVersion: request.version }); requests.push(request); }
    const order = await db.supplierOrder.findFirstOrThrow({ where: { requestId: requests[0].id }, include: { items: true } });
    const shipment = await call(`/supplier-orders/${order.id}/shipments`, { expectedVersion: order.version, freight: '0', items: [{ orderItemId: order.items[0].id, shipQuantity: '3', permanentlyReduceQuantity: '0' }] });
    const detail = await call(`/shipments/${shipment.id}`);
    await call(`/shipments/${shipment.id}/receipts`, { expectedOrderVersion: detail.supplierOrderVersion, expectedReceiptRevision: 0, items: [{ shipmentItemId: detail.items[0].id, receivedQuantity: '3' }], evidenceFileIds: [await upload('RECEIPT')] });
    const funding = await db.fundingAllocation.findFirstOrThrow({ where: { requestId: requests[0].id } });
    const clearingKey = randomUUID(), clearingBody = { businessDate: '2026-10-05', items: [{ fundingAllocationId: funding.id, expectedVersion: funding.version, expectedAmount: '300' }], evidenceFileIds: [await upload('CLEARING')] };
    const clearing = await call(`/stores/${store.id}/clearings`, clearingBody, clearingKey);
    const bill = (await call('/supplier-statements')).find(row => row.supplierId === supplier.id); assert.ok(bill);
    const line = (await call(`/supplier-statements/${bill.id}`)).lines.find(row => row.supplierOrderId === order.id);
    const quote = await call('/payment-records/preview', { settlementItemIds: [line.settlementItemId] });
    const payment = await call('/payment-records', { direction: quote.direction, businessDate: '2026-10-05', evidenceFileIds: [await upload('PAYMENT')], items: quote.items.map(row => ({ settlementItemId: row.settlementItemId, expectedVersion: row.sourceVersion, expectedAmount: row.payableAmount })) });
    token = await login('restore_supplier'); await call(`/payment-records/${payment.id}/confirm`, { expectedVersion: payment.version });
    const files = await db.fileObject.findMany({ where: { status: 'READY' }, select: { id: true, purpose: true, objectKey: true, checksum: true } });
    const checkpoint = { snapshot: await databaseSnapshot(), migrations: await db.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
      storeId: store.id, orderId: order.id, requestId: requests[0].id, clearing, clearingBody, clearingKey, paymentId: payment.id, billId: bill.id, files };
    assert.equal(files.length, 4); await writeFile(join(root, 'checkpoint.json'), JSON.stringify(checkpoint), { mode: 0o600 });
  } else {
    const checkpoint = JSON.parse(await readFile(join(root, 'checkpoint.json'), 'utf8'));
    const checks = []; const checked = name => checks.push({ name, status: 'PASS' });
    assert.deepEqual(await databaseSnapshot(), checkpoint.snapshot); checked('All public tables: exact row counts and SHA-256 contents match checkpoint; post-backup probe absent');
    for (const file of checkpoint.files) { assert.equal(hash(await readFile(join(process.env.PRIVATE_FILE_DIR, file.objectKey))), file.checksum); }
    await assert.rejects(stat(join(root, 'source-files'))); checked('Source directory destroyed; all four restored private image bytes match original checksums');
    token = await login('restore_admin');
    const account = await call(`/stores/${checkpoint.storeId}/account`);
    assert.deepEqual([account.balance, account.creditUsed, account.creditCumulative, account.creditAvailable], ['1000.00', '700.00', '1000.00', '1300.00']);
    assert.equal((await call(`/supplier-orders/${checkpoint.orderId}`)).status, 'COMPLETED');
    assert.equal((await call(`/payment-records/${checkpoint.paymentId}`)).status, 'CONFIRMED');
    assert.equal((await call(`/supplier-statements/${checkpoint.billId}`)).payableAmount, '0.00'); checked('Recovered source order, account, credit cumulative/outstanding, actual confirmed supplier payment and frozen payable reconcile');
    const beforeReplay = await databaseSnapshot();
    assert.deepEqual(await call(`/stores/${checkpoint.storeId}/clearings`, checkpoint.clearingBody, checkpoint.clearingKey), checkpoint.clearing);
    const afterReplay = await databaseSnapshot();
    // Authentication updates lastSeenAt; the initial restore check still compares the entire session table.
    delete beforeReplay.UserSession; delete afterReplay.UserSession;
    assert.deepEqual(afterReplay, beforeReplay); checked('Recovered original successful clearing command replays exactly without duplicate funds, files or audit; authentication heartbeat excluded only here');
    token = await login('restore_store');
    for (const file of checkpoint.files.filter(row => row.purpose !== 'PAYMENT')) {
      const response = await fetch(`${base}/files/${file.id}/download`, { headers: { authorization: `Bearer ${token}` } }); assert.equal(response.status, 200); assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.checksum);
    }
    const privatePayment = checkpoint.files.find(row => row.purpose === 'PAYMENT');
    assert.equal((await fetch(`${base}/files/${privatePayment.id}/download`, { headers: { authorization: `Bearer ${token}` } })).status, 404);
    token = await login('restore_foreign');
    for (const file of checkpoint.files) assert.equal((await fetch(`${base}/files/${file.id}/download`, { headers: { authorization: `Bearer ${token}` } })).status, 404);
    checked('Restored own-store authenticated receipt/recharge/clearing downloads succeed; foreign store and company-supplier payment forbidden');
    token = await login('restore_supplier');
    const paymentProof = await fetch(`${base}/files/${privatePayment.id}/download`, { headers: { authorization: `Bearer ${token}` } }); assert.equal(paymentProof.status, 200); assert.equal(hash(Buffer.from(await paymentProof.arrayBuffer())), privatePayment.checksum);
    checked('Restored supplier payment proof remains authenticated and checksum-correct');
    assert.ok(await db.notification.count() > 0); checked('Real fulfillment notifications included in restored data checkpoint');
    await writeFile(join(root, 'verified.json'), JSON.stringify({ checks }), { mode: 0o600 });
  }
} finally { await app.close(); await db.$disconnect(); }
