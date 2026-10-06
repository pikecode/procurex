import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import type { Prisma } from '../../packages/backend/generated/prisma/client.js';
import { adjustAcceptedShortage } from '../../apps/api/src/discrepancies/shortage-financials.js';

for (const frozen of [false, true]) {
 for (const scenario of ['NONE', 'COMPANY_TERM_UNPAID', 'COMPANY_TERM_OTHER_GAP', 'STORED_VALUE', 'STORED_VALUE_OVERPAID', 'STORED_VALUE_WITH_FREIGHT', 'CREDIT', 'CREDIT_CLEARED', 'CREDIT_PARTIAL']) {
  const method = scenario.startsWith('COMPANY_TERM') ? 'NONE' : scenario.startsWith('STORED_VALUE') ? 'STORED_VALUE' : scenario.startsWith('CREDIT') ? 'CREDIT' : scenario;
  const clearedPaid = scenario === 'CREDIT_CLEARED' ? 36 : scenario === 'CREDIT_PARTIAL' ? 30 : 0;
  const freight = scenario === 'STORED_VALUE_WITH_FREIGHT' ? 7 : 0;
  test(`accepted shortage updates ${frozen ? 'frozen' : 'unfrozen'} billing with ${scenario} funding`, async () => {
    const updates: Record<string, any> = {};
    const documents: any[] = [];
    const tx = {
      orderItem: {
        findUniqueOrThrow: async () => ({ id: 'item', productId: 'product', quantity: new Decimal(3), salesUnitPrice: new Decimal(12), supplyUnitPrice: new Decimal(9.5), salesLineAmount: new Decimal(36), supplyLineAmount: new Decimal(28.5), shipmentItems: [],
          discrepancies: [{ status: 'RESOLVED', missingQuantity: new Decimal(1), returnRecord: null }],
          supplierOrder: { id: 'order', requestId: 'request', storeId: 'store', supplierId: 'supplier', version: 2, settlementMode: method === 'NONE' ? 'COMPANY_TERM' : method, settlementCycleSnapshot: 'MONTHLY', firstShippedAt: null, request: { submittedAt: new Date('2026-09-01') }, settlementItemSnapshots: frozen ? [{ kind: 'SUPPLIER_PAYABLE' }, ...(method === 'CREDIT' ? [{ kind: 'STORE_RECEIVABLE' }] : [])] : [] },
        }),
        update: async ({ data }: any) => { updates.item = data; },
      },
      supplierOrder: { update: async ({ data }: any) => { updates.order = data; } },
      requestItem: { updateMany: async () => ({ count: 1 }) },
      purchaseRequest: { update: async ({ data }: any) => {
        if (data.paidAmount !== undefined) updates.requestFunding = data;
        return { id: 'request', paidAmount: new Decimal(method === 'CREDIT' ? clearedPaid : scenario.startsWith('COMPANY_TERM') ? 0 : 36 + freight), salesGoodsAmount: new Decimal(24), shortfallAmount: new Decimal(scenario === 'COMPANY_TERM_OTHER_GAP' ? 7 : 0), supplierOrders: [{ status: 'PUSHED', shipments: [{ freight: new Decimal(freight) }] }] };
      } },
      adjustmentDocument: { create: async ({ data }: any) => { documents.push(data); } },
      $queryRaw: async () => [],
      fundingAllocation: {
        findMany: async () => method === 'NONE' ? [] : [{ id: 'allocation', method, reservedAmount: new Decimal(0), targetAmount: new Decimal(36 + freight), netPaid: new Decimal(scenario === 'STORED_VALUE_OVERPAID' ? 50 : method === 'STORED_VALUE' ? 36 + freight : clearedPaid), creditOutstanding: new Decimal(method === 'CREDIT' ? 36 - clearedPaid : 0) }],
        update: async ({ data }: any) => { updates.allocation = data; },
      },
      storeAccount: { findUnique: async () => ({ id: 'account' }), update: async ({ data }: any) => { assert.notEqual(method, 'NONE'); updates.account = data; return { id: 'account', balance: new Decimal(100) }; } },
      creditMovement: { create: async ({ data }: any) => { updates.creditMovement = data; } },
      accountLedger: { create: async ({ data }: any) => { updates.ledger = data; } },
    };
    await adjustAcceptedShortage(tx as unknown as Prisma.TransactionClient, 'discrepancy', 'item');
    if (method === 'CREDIT' && scenario !== 'CREDIT_CLEARED') {
      assert.equal(updates.creditMovement.kind, 'RELEASE');
      assert.equal(updates.creditMovement.amount, scenario === 'CREDIT_PARTIAL' ? '6.00' : '12.00');
      assert.equal(updates.creditMovement.sourceId, 'discrepancy');
    } else assert.equal(updates.creditMovement, undefined);
    assert.equal(updates.item.salesLineAmount.toFixed(2), '24.00');
    assert.equal(updates.item.supplyLineAmount.toFixed(2), '19.00');
    assert.equal(updates.order.supplyGoodsAmount.increment.toFixed(2), '-9.50');
    assert.equal(documents.length, (frozen ? 1 : 0) + (clearedPaid > 0 ? 1 : 0));
    if (clearedPaid > 0) {
      const creditDocument = documents.find(document => document.side === 'STORE');
      assert.equal(creditDocument.amount.toFixed(2), scenario === 'CREDIT_CLEARED' ? '-12.00' : '-6.00');
      assert.equal(creditDocument.sourceDiscrepancyId, 'discrepancy');
      assert.equal(updates.allocation.netPaid.decrement.toFixed(2), '0.00');
      assert.equal(updates.allocation.active, false);
      assert.equal(updates.ledger, undefined);
    }
    if (method !== 'NONE') {
      assert.equal(updates.allocation.targetAmount.toFixed(2), new Decimal(24 + freight).toFixed(2));
      if (scenario === 'CREDIT_CLEARED') assert.equal(updates.account, undefined);
      else {
        assert.equal(updates.account.balance.increment.toFixed(2), method === 'STORED_VALUE' ? '12.00' : '0.00');
        assert.equal(updates.account.creditUsed.decrement.toFixed(2), method === 'CREDIT' ? scenario === 'CREDIT_PARTIAL' ? '6.00' : '12.00' : '0.00');
      }
      if (method === 'STORED_VALUE') assert.equal(updates.ledger.sourceId, 'discrepancy');
    }
    assert.equal(updates.requestFunding.paidAmount.toFixed(2), new Decimal(scenario.startsWith('COMPANY_TERM') ? 0 : method === 'NONE' ? 36 : method === 'CREDIT' ? clearedPaid : 24 + freight).toFixed(2));
    if (method !== 'NONE') assert.equal(updates.requestFunding.paymentStatus, method === 'CREDIT' && clearedPaid === 0 ? 'UNPAID' : 'PAID');
    if (method === 'NONE') assert.equal(updates.requestFunding.shortfallAmount.toFixed(2), scenario === 'COMPANY_TERM_OTHER_GAP' ? '7.00' : '0.00');
    if (frozen) {
      assert.equal(documents[0].sourceDiscrepancyId, 'discrepancy');
      assert.equal(documents[0].side, 'SUPPLIER');
      assert.equal(documents[0].amount.toFixed(2), '-9.50');
    }
  });
 }
}
