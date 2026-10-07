import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../apps/api/src/app.module.js';
import { DatabaseService } from '../../apps/api/src/database/database.service.js';
import { PricingService } from '../../apps/api/src/pricing/pricing.service.js';
import { PurchaseRequestsService } from '../../apps/api/src/purchase-requests/purchase-requests.service.js';
import { StoresService } from '../../apps/api/src/stores/stores.service.js';
import { StoresController } from '../../apps/api/src/stores/stores.controller.js';
import { AuditService } from '../../apps/api/src/audit/audit.service.js';

for (const scenario of ['CLEAR', 'AUDIT_ROLLBACK', 'CONCURRENT', 'LEGACY_UNKNOWN', 'RELEASE'] as const) {
  test(`credit occurrence history: real 300+700 procurement ${scenario}`, async () => {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const db = app.get(DatabaseService).client;
    const code = `COH${Date.now()}${randomUUID().slice(0, 6)}`;
    try {
      const category = await db.category.create({ data: { code, name: code } });
      const unit = await db.unit.create({ data: { code, name: 'piece' } });
      const product = await db.product.create({ data: { sku: code, name: code, categoryId: category.id, baseUnitId: unit.id } });
      const supplier = await db.supplier.create({ data: { code, name: code, deliveryMode: 'SELF', defaultSettlementMode: 'CREDIT', defaultSettlementCycle: 'MONTHLY' } });
      await db.supplierProduct.create({ data: { productId: product.id, supplierId: supplier.id } });
      const store = await db.store.create({ data: { code, name: code } });
      await db.storeAccount.create({ data: { storeId: store.id, creditLimit: '2000', ...(scenario === 'LEGACY_UNKNOWN' ? { creditCumulative: null } : {}) } });
      await db.orderTemplate.create({ data: { code, name: code, bindings: { create: { storeId: store.id } }, items: { create: { productId: product.id, suppliers: { create: { supplierId: supplier.id } } } } } });
      const pricing = app.get(PricingService), requests = app.get(PurchaseRequestsService), stores = app.get(StoresService);
      await pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '100', supplyPrice: '80', effectiveAt: new Date('2000-01-01'), reason: code });
      const first = await requests.create({ storeId: store.id, items: [{ productId: product.id, quantity: '3' }] });
      const second = await requests.create({ storeId: store.id, items: [{ productId: product.id, quantity: '7' }] });
      await requests.confirm(first.id, first.version); await requests.confirm(second.id, second.version);
      const account = await db.storeAccount.findUniqueOrThrow({ where: { storeId: store.id } });
      assert.equal(account.creditUsed.toFixed(2), '1000.00');
      assert.equal(account.creditCumulative?.toFixed(2) ?? null, scenario === 'LEGACY_UNKNOWN' ? null : '1000.00');
      const history = await db.creditMovement.findMany({ where: { accountId: account.id }, orderBy: { amount: 'asc' } });
      assert.deepEqual(history.map(row => [row.kind, row.amount.toFixed(2)]), [['BOOKING', '300.00'], ['BOOKING', '700.00']]);
      const funding = await db.fundingAllocation.findFirstOrThrow({ where: { requestId: first.id } });
      assert.ok(funding.supplierOrderId);
      if (scenario === 'RELEASE') {
        const changed = await pricing.publishPrice({ productId: product.id, supplierId: supplier.id, salesPrice: '90', supplyPrice: '80', effectiveAt: new Date('2000-01-02'), reason: code });
        await pricing.processRun(changed.runId!);
        const after = await db.storeAccount.findUniqueOrThrow({ where: { id: account.id } });
        assert.deepEqual([after.creditUsed.toFixed(2), after.creditCumulative!.toFixed(2)], ['900.00', '1000.00']);
        assert.equal(await db.creditMovement.count({ where: { accountId: account.id, kind: 'RELEASE' } }), 2);
        return;
      }
      const user = await db.user.create({ data: { username: code, displayName: code } });
      const file = await db.fileObject.create({ data: { filename: 'clearing.png', mimeType: 'image/png', sizeBytes: 8n, purpose: 'CLEARING', status: 'READY', ownerId: user.id, objectKey: randomUUID(), uploadTokenHash: 'isolated' } });
      const auth = { user: { id: user.id, roles: ['HQ_FINANCE'] } } as never;
      const controller = app.get(StoresController);
      const submit = (key = code) => controller.createClearing({ auth, headers: { 'idempotency-key': key } } as never, auth, store.id,
        { businessDate: '2026-10-05', evidenceFileIds: [file.id], items: [{ fundingAllocationId: funding.id, expectedVersion: funding.version, expectedAmount: '300' }] });
      if (scenario === 'AUDIT_ROLLBACK') {
        const audit = app.get(AuditService), original = audit.record.bind(audit);
        audit.record = async (...args: Parameters<AuditService['record']>) => { await original(...args); throw new Error('Injected credit audit rollback'); };
        await assert.rejects(submit()); await assert.rejects(submit());
        assert.deepEqual(await db.storeAccount.findUniqueOrThrow({ where: { id: account.id } }), account);
        assert.deepEqual(await db.creditMovement.findMany({ where: { accountId: account.id }, orderBy: { amount: 'asc' } }), history);
        assert.deepEqual(await db.fundingAllocation.findUniqueOrThrow({ where: { id: funding.id } }), funding);
        assert.deepEqual(await db.fileObject.findUniqueOrThrow({ where: { id: file.id } }), file);
        assert.equal(await db.clearingDocument.count({ where: { storeId: store.id } }), 0);
        assert.equal(await db.accountLedger.count({ where: { accountId: account.id } }), 0);
        return;
      }
      if (scenario === 'CONCURRENT') {
        const attempts = await Promise.allSettled([submit(`${code}-a`), submit(`${code}-b`)]);
        assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1);
      } else { const result = await submit(); assert.deepEqual(await submit(), result); }
      const after = await db.storeAccount.findUniqueOrThrow({ where: { id: account.id } });
      assert.equal(after.creditUsed.toFixed(2), '700.00');
      assert.equal(after.creditLimit.minus(after.creditUsed).toFixed(2), '1300.00');
      assert.equal(after.creditCumulative?.toFixed(2) ?? null, scenario === 'LEGACY_UNKNOWN' ? null : '1000.00');
      assert.equal(await db.creditMovement.count({ where: { accountId: account.id, kind: 'CLEARING', amount: '300' } }), 1);
      assert.equal(await db.creditMovement.count({ where: { accountId: account.id, kind: 'BOOKING' } }), 2);
      const clearing = await db.clearingDocument.findFirstOrThrow({ where: { storeId: store.id } });
      const detail = await stores.getAccountDocument(store.id, clearing.id, 'CLEARING');
      assert.equal(detail.evidenceFiles[0]!.id, file.id); assert.equal(detail.operatorName, code);
      const ledger = await db.accountLedger.findFirstOrThrow({ where: { accountId: account.id, sourceType: 'CLEARING' } });
      assert.equal(ledger.amount.toFixed(2), '300.00'); assert.equal(ledger.sourceId, clearing.id);
      const paid = await db.purchaseRequest.findUniqueOrThrow({ where: { id: first.id } });
      assert.deepEqual([paid.paidAmount.toFixed(2), paid.paymentStatus], ['300.00', 'PAID']);
      assert.equal((await db.purchaseRequest.findUniqueOrThrow({ where: { id: second.id } })).paidAmount.toFixed(2), '0.00');
    } finally {
      const own = { store: { code } };
      await db.auditLog.deleteMany({ where: { actor: { username: code } } }); await db.commandRecord.deleteMany({ where: { actor: { username: code } } });
      await db.fileObject.deleteMany({ where: { owner: { username: code } } });
      await db.priceChangeRun.deleteMany({ where: { versions: { some: { priceVersion: { scope: { supplier: { code } } } } } } });
      await db.clearingDocument.deleteMany({ where: own }); await db.accountLedger.deleteMany({ where: { account: own } });
      await db.fundingAllocation.deleteMany({ where: { store: own } }); await db.supplierOrder.deleteMany({ where: own }); await db.purchaseRequest.deleteMany({ where: own });
      await db.storeTemplateBinding.deleteMany({ where: { template: { code } } }); await db.orderTemplate.deleteMany({ where: { code } });
      await db.priceScope.deleteMany({ where: { supplier: { code } } }); await db.supplierProduct.deleteMany({ where: { supplier: { code } } });
      await db.product.deleteMany({ where: { sku: code } }); await db.supplier.deleteMany({ where: { code } });
      await db.storeAccount.deleteMany({ where: own }); await db.store.deleteMany({ where: { code } }); await db.category.deleteMany({ where: { code } }); await db.unit.deleteMany({ where: { code } });
      await db.user.deleteMany({ where: { username: code } }); await db.$disconnect(); await app.close();
    }
  });
}
