import { ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import { lineAmount } from '../../../../packages/domain/src/money.js';
import { lockFundingRequest, synchronizeRequestFunding } from '../purchase-requests/request-funding.js';
import { applyEffectiveOrderPrices, lockPricePublication } from '../pricing/price-checkpoint.js';
import { effectiveOrderItemQuantity, remainingNormalShipmentQuantity } from './fulfillment-status.js';
import { createReductionDocuments } from './reduction-adjustments.js';
import { unagreedShortages } from './receipt-agreement.js';

export type DeliveryReview = {
  reason: string; response?: string; requestedAt: string; respondedAt?: string;
  items: Array<{ orderItemId: string; quantity: string; shippedBefore: string }>;
};
export type DeliveryAction = 'finish-delivery' | 'confirm-receipt' | 'raise-objection' | 'respond-objection' | 'submit-receipt-exception' | 'respond-receipt-exception' | 'confirm-receipt-exception';
export type DeliveryInput = { expectedVersion: number; reason?: string; receiptId?: string; decision?: 'HANDLED' | 'DECLINED' | 'REPLENISH' | 'ACCEPT_SHORTAGE'; evidenceFileIds?: string[]; response?: 'REPLENISH' | 'DECLINE'; items?: Array<{ orderItemId: string; quantity: string }> };

export function readDeliveryReview(value: unknown): DeliveryReview | null {
  if (!value || typeof value !== 'object' || !Array.isArray((value as DeliveryReview).items)) return null;
  return value as DeliveryReview;
}

export async function transitionDelivery(tx: Prisma.TransactionClient, id: string, action: DeliveryAction, input: DeliveryInput,
  scope?: { type: string; storeId?: string; supplierId?: string }, actorUserId?: string) {
  const initial = await tx.supplierOrder.findFirst({ where: { id,
    ...(scope?.type === 'SUPPLIER' ? { supplierId: scope.supplierId } : scope?.type === 'STORE' ? { storeId: scope.storeId } : {}) } });
  if (!initial) throw new NotFoundException({ code: 'SUPPLIER_ORDER_NOT_FOUND', message: '订单不存在或无权访问' });
  await lockPricePublication(tx);
  await lockFundingRequest(tx, initial.storeId, initial.requestId);
  for (const key of ['DIRECT', 'STORE_RECEIVABLE', 'SUPPLIER_PAYABLE'].map(kind => Buffer.from(JSON.stringify({ kind, supplierOrderId: id })).toString('base64url')).sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`;
  }
  const order = await tx.supplierOrder.findUniqueOrThrow({ where: { id }, include: {
    items: { include: { shipmentItems: { include: { gapAllocations: true } }, discrepancies: { include: { returnRecord: true } }, replenishmentGaps: true } },
    shipments: { orderBy: { sequence: 'asc' }, include: { items: true, receipts: { where: { isCurrent: true }, include: { items: { include: { discrepancy: true } } } } } },
  } });
  const fail = (code: string, message: string): never => { throw new ConflictException({ code, message }); };
  if (order.version !== input.expectedVersion) fail('VERSION_CONFLICT', '订单已变化，请刷新后重新操作');
  if (['COMPLETED', 'CANCELED', 'REJECTED', 'DRAFT'].includes(order.status)) fail('ORDER_NOT_OPERABLE', '当前订单不能执行此操作');
  const review = readDeliveryReview(order.deliveryReview);
  const now = new Date();
  let data: Prisma.SupplierOrderUpdateInput = { version: { increment: 1 } };
  if (['submit-receipt-exception', 'respond-receipt-exception', 'confirm-receipt-exception'].includes(action)) {
    const receipt = order.shipments.flatMap(shipment => shipment.receipts).find(row => row.id === input.receiptId);
    if (!receipt?.exceptionStatus) fail('RECEIPT_EXCEPTION_NOT_FOUND', '本订单没有这条待处理的收货异常');
    if (!input.reason?.trim() || input.reason.trim().length > 500) fail('EXCEPTION_REASON_REQUIRED', '请填写处理说明（最多500字）');
    if (action === 'submit-receipt-exception') {
      if (!['REGISTERED', 'RESPONDED'].includes(receipt!.exceptionStatus!)) fail('EXCEPTION_NOT_SUBMITTABLE', '该异常不能重复提交');
      if (receipt!.exceptionDecision === 'REPLENISH') fail('REPLENISHMENT_IN_PROGRESS', '补发方案正在执行，如补发仍有问题请登记补发批次异常；不再补发需由供应商调整方案');
      await tx.receipt.update({ where: { id: receipt!.id }, data: { exceptionStatus: 'SUBMITTED', exceptionResolution: input.reason!.trim(), exceptionDecision: null, exceptionResponse: null } });
    } else if (action === 'respond-receipt-exception') {
      const changingPlan = receipt!.exceptionStatus === 'RESPONDED' && receipt!.exceptionDecision === 'REPLENISH' && ['ACCEPT_SHORTAGE', 'DECLINED'].includes(input.decision ?? '');
      if (receipt!.exceptionStatus !== 'SUBMITTED' && !changingPlan) fail('EXCEPTION_NOT_PENDING', '该异常不在待供应商处理状态');
      const shipment = order.shipments.find(batch => batch.receipts.some(row => row.id === receipt!.id))!;
      const shortages = receipt!.items.flatMap(line => {
        const source = shipment.items.find(item => item.id === line.shipmentItemId)!;
        const quantity = source.quantity.minus(line.receivedQuantity);
        return quantity.gt(0) ? [{ line, source, quantity }] : [];
      });
      if (!(shortages.length ? ['REPLENISH', 'ACCEPT_SHORTAGE', 'DECLINED'] : ['HANDLED', 'DECLINED']).includes(input.decision ?? '')) fail('INVALID_EXCEPTION_DECISION', shortages.length ? '少收异常请选择安排补发或不再补发' : '请选择已处理或无法处理');
      if (input.decision === 'REPLENISH') {
        if (['DISPUTED', 'REPLENISHING', 'DECLINED'].includes(order.deliveryState ?? '')) fail('ORDER_REVIEW_IN_PROGRESS', '整单异议正在处理中，请先完成当前方案');
        for (const { line, source, quantity } of shortages) {
          if (!line.discrepancy || !['OPEN', 'REPLENISH_PENDING'].includes(line.discrepancy.status)) fail('SHORTAGE_ALREADY_HANDLED', '该少收差异已处理，请刷新后重试');
          const outstanding = unagreedShortages(order.items, order.shipments, order.deliveryState, review).find(item => item.orderItemId === source.orderItemId)?.quantity ?? '0';
          const pending = await tx.replenishmentGap.aggregate({ where: { orderItemId: source.orderItemId, status: { in: ['PENDING', 'PARTIAL_FILLED'] }, OR: [{ discrepancyId: null }, { discrepancyId: { not: line.discrepancy!.id } }] }, _sum: { remainingQuantity: true } });
          const inTransit = order.shipments.filter(batch => !batch.receipts.length).flatMap(batch => batch.items).filter(item => item.orderItemId === source.orderItemId).reduce((sum, item) => sum.plus(item.quantity), new Decimal(0));
          const planned = Decimal.min(quantity, Decimal.max(0, new Decimal(outstanding).minus(pending._sum.remainingQuantity ?? 0).minus(inTransit)));
          if (planned.lte(0)) fail('SHORTAGE_ALREADY_PLANNED', '该未收数量已有补发或在途计划，请先核对收货');
          const previous = await tx.replenishmentGap.findUnique({ where: { discrepancyId: line.discrepancy!.id }, include: { shipmentAllocations: true } });
          const sent = (previous?.shipmentAllocations ?? []).reduce((sum, allocation) => sum.plus(allocation.quantity), new Decimal(0));
          await tx.replenishmentGap.upsert({ where: { discrepancyId: line.discrepancy!.id }, create: { discrepancyId: line.discrepancy!.id, orderItemId: source.orderItemId, quantity: planned, remainingQuantity: planned }, update: { quantity: sent.plus(planned), remainingQuantity: planned, status: 'PENDING', version: { increment: 1 } } });
          await tx.discrepancy.update({ where: { id: line.discrepancy!.id }, data: { status: 'REPLENISH_PENDING', version: { increment: 1 } } });
        }
        data = { ...data, deliveryState: 'IN_PROGRESS', deliveryCompletedAt: null, status: 'PARTIAL_SHIPPED', fulfillmentStatus: 'PARTIAL_SHIPPED' };
      }
      if (changingPlan) {
        await tx.replenishmentGap.updateMany({ where: { discrepancy: { receiptItem: { receiptId: receipt!.id } }, status: { in: ['PENDING', 'PARTIAL_FILLED'] } }, data: { status: 'CANCELED', remainingQuantity: 0, version: { increment: 1 } } });
        const remaining = await tx.replenishmentGap.count({ where: { orderItem: { supplierOrderId: id }, status: { in: ['PENDING', 'PARTIAL_FILLED'] }, remainingQuantity: { gt: 0 } } });
        if (!remaining && order.deliveryState === 'IN_PROGRESS' && order.items.every(item => remainingNormalShipmentQuantity(item).eq(0))) data = { ...data, deliveryState: 'FINISHED', deliveryCompletedAt: now, status: 'SHIPPED', fulfillmentStatus: 'SHIPPED' };
      }
      if (!actorUserId) fail('EXCEPTION_ACTOR_REQUIRED', '缺少处理人信息');
      if (input.evidenceFileIds && (input.evidenceFileIds.length > 6 || new Set(input.evidenceFileIds).size !== input.evidenceFileIds.length)) fail('EXCEPTION_EVIDENCE_INVALID', '最多上传6张不同的处理凭证');
      const reply = await tx.receiptExceptionReply.create({ data: { receiptId: receipt!.id, actorUserId: actorUserId!, decision: input.decision!, note: input.reason!.trim() } });
      if (input.evidenceFileIds?.length) {
        const linked = await tx.fileObject.updateMany({ where: { id: { in: input.evidenceFileIds }, ownerId: actorUserId, purpose: 'RECEIPT_EXCEPTION_REPLY', status: 'READY', mimeType: { in: ['image/jpeg', 'image/png'] }, receiptExceptionReplyId: null, shipmentRevisionId: null, receiptId: null, paymentId: null, rechargeId: null, clearingId: null }, data: { receiptExceptionReplyId: reply.id } });
        if (linked.count !== input.evidenceFileIds.length) fail('EXCEPTION_EVIDENCE_INVALID', '处理凭证无效、未上传完成、已使用或不属于当前账号');
      }
      await tx.receipt.update({ where: { id: receipt!.id }, data: { exceptionStatus: 'RESPONDED', exceptionDecision: input.decision, exceptionResponse: input.reason!.trim() } });
    } else {
      if (receipt!.exceptionStatus !== 'RESPONDED') fail('EXCEPTION_NOT_CONFIRMABLE', '请等待供应商回复后再确认解决');
      if (receipt!.exceptionDecision === 'REPLENISH') {
        const source = order.shipments.find(batch => batch.receipts.some(row => row.id === receipt!.id))!;
        const itemIds = new Set(source.items.map(item => item.orderItemId));
        if (unagreedShortages(order.items, order.shipments, order.deliveryState, review).some(line => itemIds.has(line.orderItemId))) fail('REPLENISHMENT_NOT_RECEIVED', '补发尚未收齐或少收尚未协商，不能确认异常已解决');
      }
      await tx.receipt.update({ where: { id: receipt!.id }, data: { exceptionStatus: 'RESOLVED', exceptionResolution: input.reason!.trim() } });
    }
  } else if (action === 'finish-delivery') {
    if (!order.shipments.length || (order.deliveryState && !['IN_PROGRESS', 'REPLENISHING'].includes(order.deliveryState))) fail('DELIVERY_NOT_FINISHABLE', '没有可结束的发货，请刷新订单');
    const hasShortage = order.items.some(item => remainingNormalShipmentQuantity(item).gt(0) || item.replenishmentGaps.some(gap => ['PENDING', 'PARTIAL_FILLED'].includes(gap.status) && new Decimal(gap.remainingQuantity).gt(0)));
    if (hasShortage && !input.reason?.trim()) fail('DELIVERY_REASON_REQUIRED', '仍有未发数量，请说明不再发货的原因');
    if (hasShortage && !input.evidenceFileIds?.length) fail('SHIPMENT_SHORTAGE_EVIDENCE_REQUIRED', '异常发货必须填写备注并上传发货凭证');
    if (input.evidenceFileIds?.length) {
      if (!actorUserId || input.evidenceFileIds.length > 6 || new Set(input.evidenceFileIds).size !== input.evidenceFileIds.length) fail('SHIPMENT_EVIDENCE_INVALID', '发货凭证无效');
      const lastShipment = order.shipments[order.shipments.length - 1]!;
      const revision = await tx.shipmentRevision.findFirst({ where: { shipmentId: lastShipment.id }, orderBy: { revision: 'desc' } });
      if (!revision) fail('SHIPMENT_EVIDENCE_INVALID', '未找到发货记录，请刷新后重试');
      const attached = await tx.fileObject.updateMany({ where: { id: { in: input.evidenceFileIds }, ownerId: actorUserId, purpose: 'SHIPMENT_ADJUSTMENT', status: 'READY', shipmentRevisionId: null, receiptId: null, paymentId: null }, data: { shipmentRevisionId: revision!.id } });
      if (attached.count !== input.evidenceFileIds.length) fail('SHIPMENT_EVIDENCE_INVALID', '发货凭证无效、已使用或不属于当前账号');
    }
    data = { ...data, deliveryState: 'FINISHED', deliveryCompletedAt: now, deliveryNote: input.reason ?? null, status: 'SHIPPED', fulfillmentStatus: 'SHIPPED' };
  } else if (action === 'raise-objection') {
    if (order.shipments.some(batch => batch.receipts.some(receipt => receipt.exceptionStatus && receipt.exceptionStatus !== 'RESOLVED'))) fail('RECEIPT_EXCEPTION_OPEN', '请先处理已提交的收货异常，无需重复提交整单异议');
    if (!['FINISHED', 'DECLINED'].includes(order.deliveryState ?? '')) fail('DELIVERY_NOT_FINISHED', '供应商结束发货后才能提出整单异议');
    if (order.shipments.some(shipment => !shipment.receipts.length)) fail('RECEIPTS_REQUIRED', '请先核对所有发货批次的实收数量');
    if (!input.reason?.trim() || !input.items?.length) fail('OBJECTION_REQUIRED', '请选择有异议的商品并填写原因');
    const seen = new Set<string>();
    const items = input.items!.map(line => {
      const item = order.items.find(item => item.id === line.orderItemId);
      if (!item || seen.has(line.orderItemId)) return fail('INVALID_OBJECTION_ITEMS', '异议商品不存在或重复');
      seen.add(item.id);
      const quantity = new Decimal(line.quantity);
      if (quantity.lte(0) || quantity.gt(effectiveOrderItemQuantity(item).minus(item.receivedQuantity))) fail('INVALID_OBJECTION_QUANTITY', '异议数量不能超过尚未实收的数量');
      return { orderItemId: item.id, quantity: quantity.toString(), shippedBefore: item.shippedQuantity.toString() };
    });
    data = { ...data, deliveryState: 'DISPUTED', deliveryReview: { reason: input.reason!, requestedAt: now.toISOString(), items } };
  } else if (action === 'respond-objection') {
    if (order.deliveryState !== 'DISPUTED' || !review) fail('OBJECTION_NOT_PENDING', '当前没有待处理的门店异议');
    if (input.response === 'DECLINE' && !input.reason?.trim()) fail('DECLINE_REASON_REQUIRED', '请填写拒绝补发原因');
    if (!['REPLENISH', 'DECLINE'].includes(input.response ?? '')) fail('INVALID_RESPONSE', '请选择安排补发或拒绝补发');
    // Replacing an earlier plan cancels only its unconsumed gaps; shipped batches stay intact.
    await tx.replenishmentGap.updateMany({ where: { orderItem: { supplierOrderId: id }, status: { in: ['PENDING', 'PARTIAL_FILLED'] } }, data: { status: 'CANCELED', remainingQuantity: 0, version: { increment: 1 } } });
    if (input.response === 'REPLENISH') for (const line of review!.items) {
      const item = order.items.find(item => item.id === line.orderItemId)!;
      const replacement = Decimal.max(0, new Decimal(line.quantity).minus(remainingNormalShipmentQuantity(item)));
      if (replacement.gt(0)) await tx.replenishmentGap.create({ data: { orderItemId: item.id, quantity: replacement, remainingQuantity: replacement } });
    }
    data = { ...data, deliveryState: input.response === 'REPLENISH' ? 'REPLENISHING' : 'DECLINED',
      deliveryCompletedAt: input.response === 'REPLENISH' ? null : order.deliveryCompletedAt,
      deliveryReview: { ...review!, response: input.reason ?? (input.response === 'REPLENISH' ? '安排补发' : ''), respondedAt: now.toISOString() },
      status: input.response === 'REPLENISH' ? 'PARTIAL_SHIPPED' : 'SHIPPED',
      fulfillmentStatus: input.response === 'REPLENISH' ? 'PARTIAL_SHIPPED' : 'SHIPPED' };
  } else {
    if (order.shipments.some(shipment => shipment.receipts.some(receipt => receipt.exceptionStatus && receipt.exceptionStatus !== 'RESOLVED'))) fail('RECEIPT_EXCEPTION_OPEN', '存在未解决的收货异常，请先处理后再完成订单');
    if (!['FINISHED', 'DECLINED'].includes(order.deliveryState ?? '')) fail('DELIVERY_NOT_FINISHED', '供应商尚未结束发货或异议尚未处理');
    if (!order.shipments.length || order.shipments.some(shipment => !shipment.receipts.length)) fail('RECEIPTS_REQUIRED', '请先核对所有发货批次的实收数量');
    if (unagreedShortages(order.items, order.shipments, order.deliveryState, review).length) fail('SHORTAGE_NOT_AGREED', '存在未经双方确认的少收，不能直接按实收完成订单，请先提交供应商处理');
    if (order.firstShippedAt) await applyEffectiveOrderPrices(tx, id, order.firstShippedAt, { deferCreditShortfall: true });
    await tx.replenishmentGap.updateMany({ where: { orderItem: { supplierOrderId: id }, status: { in: ['PENDING', 'PARTIAL_FILLED'] } }, data: { status: 'CANCELED', remainingQuantity: 0, version: { increment: 1 } } });
    await tx.discrepancy.updateMany({ where: { orderItem: { supplierOrderId: id }, OR: [{ status: { in: ['OPEN', 'REPLENISH_PENDING'] } }, { status: 'RESOLVED', returnRecord: { isNot: null } }] }, data: { status: 'SUPERSEDED', version: { increment: 1 } } });
    const items = await tx.orderItem.findMany({ where: { supplierOrderId: id }, include: { shipmentItems: true, discrepancies: { include: { returnRecord: true } } } });
    let salesDelta = new Decimal(0), supplyDelta = new Decimal(0);
    const lines: Parameters<typeof createReductionDocuments>[1]['lines'] = [];
    for (const item of items) {
      const target = effectiveOrderItemQuantity(item);
      const quantity = new Decimal(item.receivedQuantity);
      if (quantity.gt(target)) fail('RECEIVED_QUANTITY_EXCEEDED', '累计实收超过订单有效数量，请核对后再确认');
      const sales = lineAmount(quantity, item.salesUnitPrice), supply = lineAmount(quantity, item.supplyUnitPrice);
      const salesChange = sales.minus(item.salesLineAmount), supplyChange = supply.minus(item.supplyLineAmount);
      salesDelta = salesDelta.plus(salesChange); supplyDelta = supplyDelta.plus(supplyChange);
      lines.push({ itemId: item.id, quantity: target.minus(quantity), salesChange, supplyChange, salesPrice: new Decimal(item.salesUnitPrice), supplyPrice: new Decimal(item.supplyUnitPrice) });
      await tx.orderItem.update({ where: { id: item.id }, data: { closedQuantity: { increment: target.minus(quantity) }, salesLineAmount: sales, supplyLineAmount: supply } });
    }
    await createReductionDocuments(tx, { order, shipmentId: order.shipments[order.shipments.length - 1]!.id, baseline: order.firstShippedAt!, lines });
    await tx.purchaseRequest.update({ where: { id: order.requestId }, data: { salesGoodsAmount: { increment: salesDelta }, supplyGoodsAmount: { increment: supplyDelta }, version: { increment: 1 } } });
    data = { ...data, deliveryState: 'COMPLETED', status: 'COMPLETED', fulfillmentStatus: 'COMPLETED', completedAt: now,
      salesGoodsAmount: { increment: salesDelta }, supplyGoodsAmount: { increment: supplyDelta } };
  }
  const result = await tx.supplierOrder.update({ where: { id }, data });
  if (action === 'confirm-receipt') await synchronizeRequestFunding(tx, order.requestId, { requireFull: true, sourceId: id, deferCreditShortfall: true });
  const supplierRecipient = action === 'raise-objection' || action === 'submit-receipt-exception' || action === 'confirm-receipt-exception';
  const recipients = await tx.user.findMany({ where: { status: 'ACTIVE', scopes: { some: supplierRecipient ? { scopeType: 'SUPPLIER', supplierId: order.supplierId } : { scopeType: 'STORE', storeId: order.storeId } } }, select: { id: true } });
  if (recipients.length) await tx.notification.createMany({ data: recipients.map(user => ({ recipientId: user.id, eventKey: `DELIVERY:${id}:${result.version}`, channel: 'IN_APP',
    title: action === 'raise-objection' || action === 'submit-receipt-exception' ? '门店订单异常待处理' : action === 'confirm-receipt' ? '订单已完成' : '订单履约进度更新',
    body: `订单 ${order.supplierOrderNo} 履约状态已更新，请查看订单详情。`, payload: { type: 'ORDER_DELIVERY', supplierOrderId: id } })), skipDuplicates: true });
  return { id, version: result.version, status: result.status, deliveryState: result.deliveryState };
}
