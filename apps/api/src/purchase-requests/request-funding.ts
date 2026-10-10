import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import type { SettlementMode } from '../../../../packages/backend/generated/prisma/enums.js';
import type { DatabaseService } from '../database/database.service.js';
import { settlementPeriod, type SettlementCycle } from '../../../../packages/domain/src/settlement-period.js';
import { recordCreditMovement } from '../stores/credit-movements.js';

type Client = DatabaseService['client'] | Prisma.TransactionClient;
type Terms = { mode: SettlementMode; cycle: string };

export async function resolveSettlementTerms(client: Client, templateId: string, supplierIds: string[], storeId?: string): Promise<Map<string, Terms>> {
  const suppliers = await client.supplier.findMany({ where: { id: { in: supplierIds } } });
  const overrides = storeId ? await client.templateStoreSupplierCycle.findMany({ where: { templateId, storeId, supplierId: { in: supplierIds }, template: { bindings: { some: { storeId, expiredAt: null } } } } }) : [];
  return new Map(supplierIds.map(id => {
    const supplier = suppliers.find(supplier => supplier.id === id);
    if (!supplier) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Funding supplier was not found' });
    const term = supplier.defaultSettlementMode === 'SUPPLIER_TERM' || supplier.defaultSettlementMode === 'COMPANY_TERM';
    return [id, { mode: supplier.defaultSettlementMode, cycle: term ? overrides.find(row => row.supplierId === id)?.settlementCycle ?? supplier.defaultSettlementCycle : 'IMMEDIATE' }];
  }));
}

export async function lockFundingRequest(tx: Prisma.TransactionClient, storeId: string, requestId?: string): Promise<void> {
  await tx.storeAccount.upsert({ where: { storeId }, create: { storeId }, update: {} });
  await tx.$queryRaw`SELECT id FROM "StoreAccount" WHERE "storeId" = ${storeId}::uuid FOR UPDATE`;
  if (!requestId) return;
  await tx.$queryRaw`SELECT id FROM "PurchaseRequest" WHERE id = ${requestId}::uuid FOR UPDATE`;
  const orders = await tx.supplierOrder.findMany({ where: { requestId }, select: { id: true } });
  const settlementIds = orders.flatMap(order => ['DIRECT', 'STORE_RECEIVABLE', 'SUPPLIER_PAYABLE'].map(kind =>
    Buffer.from(JSON.stringify({ kind, supplierOrderId: order.id })).toString('base64url'))).sort();
  for (const id of settlementIds) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}::text, 0))`;
  await tx.$queryRaw`SELECT id FROM "SupplierOrder" WHERE "requestId" = ${requestId}::uuid ORDER BY id FOR UPDATE`;
}

export async function requireRequestVersion(tx: Prisma.TransactionClient, id: string, expectedVersion: number): Promise<void> {
  const request = await tx.purchaseRequest.findUniqueOrThrow({ where: { id } });
  if (request.version !== expectedVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Purchase request changed during funding update' });
}

export type RequestFundingResult = { canConfirm: boolean; paidAmount: Decimal; shortfallAmount: Decimal; storedRequired: Decimal; storedPaid: Decimal; storedReserved: Decimal; available: Decimal };

export function requestFundingWhere(requestId: string): Prisma.FundingAllocationWhereInput {
  return { AND: [
    { OR: [{ active: true }, { method: 'CREDIT', netPaid: { gt: 0 }, clearingItems: { some: {} } }] },
    { OR: [{ requestId }, { supplierOrder: { requestId } }] },
  ] };
}

export async function loadFundingPaymentStates(tx: Prisma.TransactionClient, allocations: Array<{ id: string; method: string; netPaid: Prisma.Decimal; supplierOrderId?: string | null }>) {
  const orderIds = allocations.filter(row => row.method === 'CREDIT').flatMap(row => row.supplierOrderId ? [row.supplierOrderId] : []);
  const documents = orderIds.length ? await tx.adjustmentDocument.findMany({ where: {
    supplierOrderId: { in: orderIds }, side: 'STORE', amount: { lt: 0 },
    OR: [{ sourceDiscrepancyId: { not: null } }, { sourcePriceChangeId: { not: null } }, { sourceRejectedOrderId: { not: null } }],
  }, include: { disposalItems: { include: { disposal: true } } } }) : [];
  return new Map(allocations.map(allocation => {
    const credits = allocation.method === 'CREDIT' ? documents.filter(row => row.supplierOrderId === allocation.supplierOrderId) : [];
    const confirmed = credits.reduce((sum, document) => sum.plus(document.disposalItems
      .filter(item => item.disposal.status === 'CONFIRMED').reduce((total, item) => total.plus(item.amount), new Decimal(0))), new Decimal(0));
    if (confirmed.gt(allocation.netPaid)) throw new ConflictException({ code: 'FUNDING_ALLOCATION_RECONCILIATION_REQUIRED', message: 'Confirmed credit returns exceed actual paid funding' });
    return [allocation.id, { effectivePaid: new Decimal(allocation.netPaid).minus(confirmed),
      pendingCredit: credits.reduce((sum, document) => sum.plus(new Decimal(document.amount).abs()), new Decimal(0)).minus(confirmed), documents: credits }];
  }));
}

export async function refreshRequestPaymentSummary(tx: Prisma.TransactionClient, requestId: string): Promise<void> {
  const request = await tx.purchaseRequest.findUniqueOrThrow({ where: { id: requestId }, include: { supplierOrders: { include: { shipments: true } } } });
  const allocations = await tx.fundingAllocation.findMany({ where: { AND: [requestFundingWhere(requestId), {
    OR: [{ supplierOrderId: null }, { supplierOrder: { status: { notIn: ['REJECTED', 'CANCELED'] } } }],
  }] } });
  const states = await loadFundingPaymentStates(tx, allocations);
  const paidAmount = allocations.reduce((sum, row) => sum.plus(states.get(row.id)!.effectivePaid), new Decimal(0));
  const freight = request.supplierOrders.filter(order => order.status !== 'REJECTED' && order.status !== 'CANCELED')
    .reduce((sum, order) => sum.plus(order.shipments.reduce((total, shipment) => total.plus(shipment.freight), new Decimal(0))), new Decimal(0));
  await tx.purchaseRequest.update({ where: { id: requestId }, data: {
    paidAmount, paymentStatus: paidAmount.gte(new Decimal(request.salesGoodsAmount).plus(freight)) ? 'PAID' : 'UNPAID',
  } });
}

// Account and request are locked by the caller. All cash movements are net changes, never a second split-order debit.
export async function synchronizeRequestFunding(tx: Prisma.TransactionClient, requestId: string, options: { requireFull?: boolean; sourceId?: string; priceAdjustmentId?: string; initial?: boolean; deferCreditShortfall?: boolean; excludeShipmentFreightId?: string } = {}): Promise<RequestFundingResult> {
  const request = await tx.purchaseRequest.findUniqueOrThrow({ where: { id: requestId }, include: { items: true, supplierOrders: { include: { shipments: true } } } });
  const account = await tx.storeAccount.findUniqueOrThrow({ where: { storeId: request.storeId } });
  const creditMovement = (id: string, before: Decimal.Value, after: Decimal.Value) => recordCreditMovement(tx, {
    accountId: account.id, fundingAllocationId: id, before, after,
    sourceType: options.initial ? 'PURCHASE_REQUEST' : 'ADJUSTMENT', sourceId: options.sourceId ?? requestId,
  });
  const terms = await resolveSettlementTerms(tx, request.templateId, [...new Set(request.items.map(item => item.supplierId))], request.storeId);
  const targets = new Map<string, { method: 'STORED_VALUE' | 'CREDIT'; amount: Decimal; orderId?: string }>();
  for (const item of request.items) {
    const policy = terms.get(item.supplierId)!;
    const mode = item.settlementModeSnapshot ?? policy.mode;
    if (!item.settlementModeSnapshot || !item.settlementCycleSnapshot) await tx.requestItem.update({ where: { id: item.id }, data: {
      settlementModeSnapshot: mode, settlementCycleSnapshot: item.settlementCycleSnapshot ?? policy.cycle,
    } });
    if (request.status === 'CANCELED' || (mode !== 'STORED_VALUE' && mode !== 'CREDIT')) continue;
    const activeOrder = request.supplierOrders.find(order => order.supplierId === item.supplierId && order.status !== 'REJECTED' && order.status !== 'CANCELED');
    if (!activeOrder && request.supplierOrders.some(order => order.supplierId === item.supplierId)) continue;
    const target = targets.get(item.supplierId) ?? { method: mode, amount: new Decimal(0), orderId: activeOrder?.id };
    if (target.method !== mode) throw new ConflictException({ code: 'MIXED_SUPPLIER_FUNDING_MODE', message: 'Supplier request lines must share a settlement mode' });
    target.amount = target.amount.plus(item.salesLineAmount);
    targets.set(item.supplierId, target);
  }
  for (const target of targets.values()) {
    const order = request.supplierOrders.find(order => order.id === target.orderId);
    if (order) target.amount = target.amount.plus(order.shipments.reduce((sum, shipment) => shipment.id === options.excludeShipmentFreightId ? sum : sum.plus(shipment.freight), new Decimal(0)));
  }
  // Fully cleared credit is inactive, but its actual payment still funds this request.
  const allocations = await tx.fundingAllocation.findMany({ where: requestFundingWhere(requestId), include: { supplierOrder: true }, orderBy: { id: 'asc' } });
  const paymentStates = await loadFundingPaymentStates(tx, allocations);
  const existing = new Map<string, typeof allocations[number]>();
  for (const allocation of allocations) {
    if (allocation.method === 'CREDIT' && allocation.supplierOrder?.status === 'REJECTED') {
      const state = paymentStates.get(allocation.id)!;
      const credit = Decimal.max(0, state.effectivePaid.minus(state.pendingCredit));
      if (credit.gt(0)) {
        const order = allocation.supplierOrder;
        const clearings = await tx.clearingItem.findMany({ where: { fundingAllocationId: allocation.id } });
        const actuallyCleared = clearings.reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
        if (!order.rejectedAt || actuallyCleared.lt(allocation.netPaid) || state.documents.some(document => document.sourceRejectedOrderId === order.id)) {
          throw new ConflictException({ code: 'FUNDING_ALLOCATION_RECONCILIATION_REQUIRED', message: 'Rejected paid credit lacks reconciled clearing evidence' });
        }
        const items = await tx.orderItem.findMany({ where: { supplierOrderId: order.id }, orderBy: { id: 'asc' } });
        const goods = items.reduce((sum, item) => sum.plus(item.salesLineAmount), new Decimal(0));
        if (!items.length || goods.lte(0)) throw new ConflictException({ code: 'FUNDING_ALLOCATION_RECONCILIATION_REQUIRED', message: 'Rejected paid credit requires original goods evidence' });
        const period = settlementPeriod(order.settlementCycleSnapshot as SettlementCycle, request.submittedAt);
        const end = new Date(`${period.endDate}T00:00:00.000Z`);
        end.setUTCDate(end.getUTCDate() + 1);
        const originalPeriodKey = `${order.settlementCycleSnapshot}:${period.startDate}:${end.toISOString().slice(0, 10)}`;
        const current = settlementPeriod(order.settlementCycleSnapshot as SettlementCycle, new Date());
        const currentEnd = new Date(`${current.endDate}T00:00:00.000Z`);
        currentEnd.setUTCDate(currentEnd.getUTCDate() + 1);
        let remaining = credit;
        await tx.adjustmentDocument.create({ data: {
          sourceRejectedOrderId: order.id, supplierOrderId: order.id, storeId: order.storeId, supplierId: order.supplierId,
          side: 'STORE', amount: credit.negated(), sourceRevision: order.version, originalPeriodKey,
          settlementPeriodKey: `${order.settlementCycleSnapshot}:${current.startDate}:${currentEnd.toISOString().slice(0, 10)}`,
          items: { create: items.map((item, index) => {
            const amount = index === items.length - 1 ? remaining : Decimal.min(remaining, credit.mul(item.salesLineAmount).div(goods).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
            remaining = remaining.minus(amount);
            return { orderItemId: item.id, amount: amount.negated(), unitPriceSnapshot: item.salesUnitPrice,
              quantitySnapshot: new Decimal(item.salesUnitPrice).isZero() ? null : amount.div(item.salesUnitPrice).toDecimalPlaces(6, Decimal.ROUND_HALF_UP) };
          }) },
        } });
      }
      if (allocation.active || new Decimal(allocation.targetAmount).gt(0) || new Decimal(allocation.creditOutstanding).gt(0)) {
        await tx.fundingAllocation.update({ where: { id: allocation.id }, data: { active: false, targetAmount: 0, creditOutstanding: 0, version: { increment: 1 } } });
        await creditMovement(allocation.id, allocation.creditOutstanding, 0);
      }
      continue;
    }
    const supplierId = allocation.supplierId ?? allocation.supplierOrder?.supplierId;
    if (!supplierId || existing.has(supplierId)) throw new ConflictException({ code: 'FUNDING_ALLOCATION_RECONCILIATION_REQUIRED', message: 'Existing allocations require reconciliation before funding changes' });
    if (allocation.method === 'STORED_VALUE' && new Decimal(allocation.netPaid).gt(allocation.targetAmount)) {
      throw new ConflictException({ code: 'FUNDING_ALLOCATION_RECONCILIATION_REQUIRED', message: 'Overpaid allocations require a separate reconciliation, not an automatic request refund' });
    }
    existing.set(supplierId, allocation);
  }
  const storedRequired = [...targets.values()].filter(target => target.method === 'STORED_VALUE').reduce((sum, target) => sum.plus(target.amount), new Decimal(0));
  const priorStored = allocations.filter(allocation => allocation.method === 'STORED_VALUE').reduce((sum, allocation) => sum.plus(allocation.netPaid), new Decimal(0));
  const priorReserved = allocations.reduce((sum, allocation) => sum.plus(allocation.reservedAmount), new Decimal(0));
  const priorCredit = allocations.reduce((sum, allocation) => sum.plus(allocation.creditOutstanding), new Decimal(0));
  const available = new Decimal(account.balance).minus(account.reservedBalance).plus(priorStored).plus(priorReserved);
  let shortfallAmount = Decimal.max(0, storedRequired.minus(available));
  let canConfirm = shortfallAmount.isZero();
  if (options.requireFull && !canConfirm) throw new ConflictException({ code: 'PURCHASE_REQUEST_FUNDING_SHORTFALL', message: 'Available stored value does not cover the request', details: { required: storedRequired.toFixed(2), available: available.toFixed(2), shortfall: shortfallAmount.toFixed(2) } });
  let storedBudget = canConfirm ? storedRequired : Decimal.min(storedRequired, priorStored.plus(priorReserved));
  let creditNeeded = new Decimal(0);
  for (const [supplierId, target] of targets) {
    const prior = existing.get(supplierId);
    if (target.method === 'CREDIT' && prior?.method === 'CREDIT' && new Decimal(prior.netPaid).gt(0)) {
      const state = paymentStates.get(prior.id)!;
      const adjustments = state.documents;
      if (state.pendingCredit.gt(0) && target.amount.gt(prior.targetAmount)) {
        throw new ConflictException({ code: 'CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED', message: 'Pending credit returns or offsets must be confirmed before increasing this target' });
      }
      let documentedCredit = state.pendingCredit;
      const existingExcess = Decimal.max(0, state.effectivePaid.minus(prior.targetAmount));
      const nextExcess = Decimal.max(0, state.effectivePaid.minus(target.amount));
      const increaseInCredit = nextExcess.minus(existingExcess);
      if (increaseInCredit.gt(0) && documentedCredit.gte(existingExcess) && options.priceAdjustmentId && prior.supplierOrderId) {
        const source = await tx.priceChangeAdjustment.findUnique({ where: { id: options.priceAdjustmentId }, include: {
          orderItem: { include: { supplierOrder: { include: { request: { select: { submittedAt: true } } } } } },
        } });
        const clearings = await tx.clearingItem.findMany({ where: { fundingAllocationId: prior.id } });
        const clearedAmount = clearings.reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
        if (source && source.supplierOrderId === prior.supplierOrderId && new Decimal(source.salesDelta).negated().gte(increaseInCredit)
          && clearedAmount.gte(prior.netPaid) && !adjustments.some(document => document.sourcePriceChangeId === source.id)) {
          const order = source.orderItem.supplierOrder;
          const periodKey = (date: Date) => {
            const period = settlementPeriod(order.settlementCycleSnapshot as SettlementCycle, date);
            const end = new Date(`${period.endDate}T00:00:00.000Z`);
            end.setUTCDate(end.getUTCDate() + 1);
            return `${order.settlementCycleSnapshot}:${period.startDate}:${end.toISOString().slice(0, 10)}`;
          };
          await tx.adjustmentDocument.create({ data: {
            sourcePriceChangeId: source.id, supplierOrderId: order.id, storeId: order.storeId, supplierId: order.supplierId,
            side: 'STORE', amount: increaseInCredit.negated(), sourceRevision: order.version,
            originalPeriodKey: periodKey(order.firstShippedAt ?? order.request.submittedAt), settlementPeriodKey: periodKey(new Date()),
            items: { create: { orderItemId: source.orderItemId, amount: increaseInCredit.negated(),
              quantitySnapshot: effectivePriceAdjustmentQuantity(source), unitPriceSnapshot: source.newSalesPrice } },
          } });
          documentedCredit = documentedCredit.plus(increaseInCredit);
        }
      }
      if (documentedCredit.lt(nextExcess) || (target.amount.lt(prior.targetAmount) && increaseInCredit.gt(0) && !options.priceAdjustmentId)) {
        throw new ConflictException({ code: 'CLEARED_CREDIT_ADJUSTMENT_REQUIRED', message: 'A decrease below cleared credit requires a settlement adjustment' });
      }
    }
    if (target.method === 'CREDIT') creditNeeded = creditNeeded.plus(Decimal.max(0, target.amount.minus(prior?.method === 'CREDIT' ? paymentStates.get(prior.id)!.effectivePaid : 0)));
  }
  let nextCreditUsed = new Decimal(account.creditUsed).minus(priorCredit).plus(creditNeeded);
  if (nextCreditUsed.lt(0)) throw new ConflictException({ code: 'FUNDING_ALLOCATION_RECONCILIATION_REQUIRED', message: 'Account credit usage disagrees with its funding allocations' });
  const creditShortfall = Decimal.max(0, nextCreditUsed.minus(account.creditLimit));
  if (creditShortfall.gt(0) && !options.deferCreditShortfall) throw new ConflictException({ code: 'CREDIT_LIMIT_EXCEEDED', message: 'Available credit limit does not cover the request', details: { required: creditNeeded.toFixed(2), available: new Decimal(account.creditLimit).minus(account.creditUsed).plus(priorCredit).toFixed(2) } });
  let creditBudget = creditNeeded;
  if (creditShortfall.gt(0)) {
    creditBudget = Decimal.min(creditNeeded, priorCredit);
    nextCreditUsed = new Decimal(account.creditUsed).minus(priorCredit).plus(creditBudget);
    shortfallAmount = shortfallAmount.plus(creditShortfall);
    canConfirm = false;
  }
  for (const [supplierId, allocation] of existing) {
    const target = targets.get(supplierId);
    if (!target || target.method !== allocation.method) {
      if (allocation.method === 'CREDIT' && new Decimal(allocation.netPaid).gt(0)) throw new ConflictException({ code: 'CLEARED_CREDIT_ADJUSTMENT_REQUIRED', message: 'Cleared credit must be handled through a settlement adjustment' });
      await tx.fundingAllocation.update({ where: { id: allocation.id }, data: { active: false, netPaid: 0, reservedAmount: 0, creditOutstanding: 0, version: { increment: 1 } } });
      if (allocation.method === 'CREDIT') await creditMovement(allocation.id, allocation.creditOutstanding, 0);
    }
  }
  let storedPaid = new Decimal(0);
  let storedReserved = new Decimal(0);
  let paidAmount = new Decimal(0);
  for (const [supplierId, target] of [...targets].sort(([a], [b]) => a.localeCompare(b))) {
    const prior = existing.get(supplierId);
    const same = prior?.method === target.method;
    const funded = target.method === 'STORED_VALUE' ? Decimal.min(target.amount, storedBudget) : new Decimal(0);
    const completed = request.supplierOrders.some(order => order.id === target.orderId && order.fulfillmentStatus === 'COMPLETED');
    const reserve = target.method === 'STORED_VALUE' && request.storedValueOnReceipt && !completed;
    const netPaid = target.method === 'STORED_VALUE' ? (reserve ? new Decimal(0) : funded) : new Decimal(same ? prior.netPaid : 0);
    const reservedAmount = reserve ? funded : new Decimal(0);
    if (target.method === 'STORED_VALUE') { storedBudget = storedBudget.minus(funded); storedPaid = storedPaid.plus(netPaid); storedReserved = storedReserved.plus(reservedAmount); }
    const effectivePaid = target.method === 'CREDIT' && same ? paymentStates.get(prior.id)!.effectivePaid : netPaid;
    paidAmount = paidAmount.plus(effectivePaid);
    const creditOutstanding = target.method === 'CREDIT' ? Decimal.min(creditBudget, Decimal.max(0, target.amount.minus(effectivePaid))) : new Decimal(0);
    const data = { requestId, supplierId, supplierOrderId: target.orderId ?? null, targetAmount: target.amount, netPaid, reservedAmount, creditOutstanding,
      active: target.method === 'STORED_VALUE' || creditOutstanding.gt(0) };
    if (target.method === 'CREDIT') creditBudget = creditBudget.minus(data.creditOutstanding);
    const saved = same ? await tx.fundingAllocation.update({ where: { id: prior.id }, data: { ...data, version: { increment: 1 } } })
      : await tx.fundingAllocation.create({ data: { ...data, storeId: request.storeId, method: target.method } });
    if (target.method === 'CREDIT') await creditMovement(saved.id, same ? prior.creditOutstanding : 0, creditOutstanding);
  }
  const cashDelta = storedPaid.minus(priorStored);
  const updatedAccount = await tx.storeAccount.update({ where: { storeId: request.storeId }, data: {
    balance: { decrement: cashDelta }, reservedBalance: { increment: storedReserved.minus(priorReserved) }, creditUsed: nextCreditUsed, version: { increment: 1 },
  } });
  if (!cashDelta.isZero()) await tx.accountLedger.create({ data: {
    accountId: account.id, requestId, direction: cashDelta.gt(0) ? 'DEBIT' : 'CREDIT', amount: cashDelta.abs(), balanceAfter: updatedAccount.balance,
    sourceType: options.initial ? 'PURCHASE_REQUEST' : 'ADJUSTMENT', sourceId: options.sourceId ?? randomUUID(), note: 'Purchase request funding reconciliation',
  } });
  const totalFreight = request.supplierOrders.filter(order => order.status !== 'REJECTED' && order.status !== 'CANCELED')
    .reduce((sum, order) => sum.plus(order.shipments.reduce((freight, shipment) => shipment.id === options.excludeShipmentFreightId ? freight : freight.plus(shipment.freight), new Decimal(0))), new Decimal(0));
  await tx.purchaseRequest.update({ where: { id: requestId }, data: {
    paidAmount, shortfallAmount, paymentStatus: paidAmount.gte(new Decimal(request.salesGoodsAmount).plus(totalFreight)) ? 'PAID' : 'UNPAID',
  } });
  return { canConfirm, paidAmount, shortfallAmount, storedRequired, storedPaid, storedReserved, available: new Decimal(updatedAccount.balance).minus(updatedAccount.reservedBalance) };
}

function effectivePriceAdjustmentQuantity(source: { salesDelta: Decimal | Prisma.Decimal; previousSalesPrice: Decimal | Prisma.Decimal; newSalesPrice: Decimal | Prisma.Decimal }): Decimal | null {
  const priceDelta = new Decimal(source.newSalesPrice).minus(source.previousSalesPrice);
  return priceDelta.isZero() ? null : new Decimal(source.salesDelta).div(priceDelta).abs().toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}
