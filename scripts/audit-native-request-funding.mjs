import assert from 'node:assert/strict';
import { Decimal } from 'decimal.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';

export async function auditNativeRequestFunding(requestId, apiBase) {
  const connectionString = process.env.DATABASE_URL || 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname), 'Native funding audit requires a local database');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const request = await db.purchaseRequest.findUniqueOrThrow({ where: { id: requestId }, include: { supplierOrders: { include: { shipments: true } } } });
    const orders = request.supplierOrders.filter(order => order.status !== 'REJECTED' && order.status !== 'CANCELED');
    assert.ok(orders.length && orders.every(order => order.settlementMode === 'STORED_VALUE'), 'This native scenario audits stored-value orders');
    const allocations = await db.fundingAllocation.findMany({ where: { requestId } });
    const ledger = await db.accountLedger.findMany({ where: { requestId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const freight = orders.reduce((sum, order) => sum.plus(order.shipments.reduce((total, shipment) => total.plus(shipment.freight), new Decimal(0))), new Decimal(0));
    const expected = new Decimal(request.salesGoodsAmount).plus(freight);
    const active = allocations.filter(allocation => allocation.active);
    const paid = active.reduce((sum, allocation) => sum.plus(allocation.netPaid), new Decimal(0));
    const netDebit = ledger.reduce((sum, row) => row.direction === 'DEBIT' ? sum.plus(row.amount) : sum.minus(row.amount), new Decimal(0));
    assert.equal(paid.toFixed(2), expected.toFixed(2));
    assert.equal(netDebit.toFixed(2), expected.toFixed(2));
    assert.equal(request.paidAmount.toFixed(2), expected.toFixed(2));
    assert.equal(request.shortfallAmount.toFixed(2), '0.00');
    assert.equal(active.length, orders.length);
    for (const allocation of active) {
      assert.ok(orders.some(order => order.id === allocation.supplierOrderId));
      assert.equal(allocation.targetAmount.toFixed(2), allocation.netPaid.toFixed(2));
    }
    assert.ok(allocations.filter(allocation => !allocation.active).every(allocation => new Decimal(allocation.netPaid).isZero()));
    return { status: 'PASSED', scope: 'Stored-value goods and shipment freight; not full M4 funding closure', apiBase,
      realDevice: false, realPayment: false, requestId, requestStatus: request.status,
      salesGoodsAmount: request.salesGoodsAmount.toFixed(2), freightAmount: freight.toFixed(2),
      paidAmount: paid.toFixed(2), netDebit: netDebit.toFixed(2),
      ledger: ledger.map(row => ({ direction: row.direction, amount: row.amount.toFixed(2), sourceType: row.sourceType, sourceId: row.sourceId })),
    };
  } finally {
    await db.$disconnect();
  }
}
