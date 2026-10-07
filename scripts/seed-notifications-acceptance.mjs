import { PrismaPg } from '@prisma/adapter-pg';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';
import { FulfillmentStatus, PaymentStatus, PurchaseRequestStatus, SettlementMode, ShipmentKind, SupplierOrderStatus } from '../dist/packages/backend/generated/prisma/enums.js';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
assertLocalFixtureDatabase(connectionString);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function run() {
  const users = await prisma.user.findMany({ where: { username: { in: ['pxrpt_admin', 'pxrpt_store'] } }, select: { id: true, username: true } });
  const byUsername = Object.fromEntries(users.map((user) => [user.username, user]));
  if (!byUsername.pxrpt_admin || !byUsername.pxrpt_store) throw new Error('Run reports:seed-acceptance before notifications:seed-acceptance.');
  const [store, supplier, template, product] = await Promise.all([
    prisma.store.findUnique({ where: { code: 'PXRPT-STORE' } }),
    prisma.supplier.findUnique({ where: { code: 'PXRPT-SUP-COMPANY' } }),
    prisma.orderTemplate.findUnique({ where: { code: 'PXRPT-TPL' } }),
    prisma.product.findUnique({ where: { sku: 'PXRPT-SKU-RICE' } }),
  ]);
  if (!store || !supplier || !template || !product) throw new Error('Run reports:seed-acceptance before notifications:seed-acceptance.');
  const existingOrders = await prisma.supplierOrder.findMany({ where: { supplierOrderNo: 'PXRPT-SO-OVERDUE' }, select: { id: true, requestId: true } });
  const existingOrderIds = existingOrders.map((order) => order.id);
  await prisma.notification.deleteMany({ where: { recipientId: { in: users.map((user) => user.id) }, eventKey: { startsWith: 'OVERDUE_RECEIPT:' } } });
  await prisma.shipmentItem.deleteMany({ where: { shipment: { supplierOrderId: { in: existingOrderIds } } } });
  await prisma.shipment.deleteMany({ where: { supplierOrderId: { in: existingOrderIds } } });
  await prisma.orderItem.deleteMany({ where: { supplierOrderId: { in: existingOrderIds } } });
  await prisma.supplierOrder.deleteMany({ where: { id: { in: existingOrderIds } } });
  await prisma.requestItem.deleteMany({ where: { requestId: { in: existingOrders.map((order) => order.requestId) } } });
  await prisma.purchaseRequest.deleteMany({ where: { id: { in: existingOrders.map((order) => order.requestId) } } });
  await prisma.notification.deleteMany({ where: { recipientId: { in: users.map((user) => user.id) }, eventKey: { startsWith: 'PXNOTIFY' } } });
  await prisma.notification.create({
    data: {
      recipientId: byUsername.pxrpt_admin.id,
      eventKey: 'PXNOTIFY:ADMIN:RECONCILIATION',
      channel: 'IN_APP',
      title: '对账异常待核查',
      body: 'PXRPT 门店存在余额/流水和挂账占用差异，请进入运营与对账查看。',
      payload: { route: '/ops.html', type: 'RECONCILIATION_ISSUE', storeCode: 'PXRPT-STORE' },
    },
  });
  const request = await prisma.purchaseRequest.create({
    data: {
      requestNo: 'PXRPT-REQ-OVERDUE',
      storeId: store.id,
      templateId: template.id,
      status: PurchaseRequestStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PAID,
      salesGoodsAmount: '24.00',
      supplyGoodsAmount: '18.00',
      paidAmount: '24.00',
      confirmedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    },
  });
  const order = await prisma.supplierOrder.create({
    data: {
      supplierOrderNo: 'PXRPT-SO-OVERDUE',
      requestId: request.id,
      storeId: store.id,
      supplierId: supplier.id,
      settlementMode: SettlementMode.COMPANY_TERM,
      settlementCycleSnapshot: 'MONTHLY',
      status: SupplierOrderStatus.PARTIAL_SHIPPED,
      fulfillmentStatus: FulfillmentStatus.SHIPPED,
      firstShippedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      pushedAt: new Date(Date.now() - 49 * 60 * 60 * 1000),
      salesGoodsAmount: '24.00',
      supplyGoodsAmount: '18.00',
      items: {
        create: [{
          productId: product.id,
          quantity: '2.000000',
          shippedQuantity: '2.000000',
          receivedQuantity: '0.000000',
          salesUnitPrice: '12.000000',
          supplyUnitPrice: '9.000000',
          salesLineAmount: '24.00',
          supplyLineAmount: '18.00',
        }],
      },
    },
    include: { items: true },
  });
  await prisma.shipment.create({
    data: {
      shipmentNo: 'PXRPT-SHIP-OVERDUE',
      supplierOrderId: order.id,
      sequence: 1,
      kind: ShipmentKind.INITIAL,
      shippedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      freight: '0.00',
      items: {
        create: [{
          orderItemId: order.items[0].id,
          quantity: '2.000000',
          salesPriceSnapshot: '12.000000',
          supplyPriceSnapshot: '9.000000',
          salesLineAmount: '24.00',
          supplyLineAmount: '18.00',
        }],
      },
    },
  });
  console.log('Notifications acceptance seed ready.');
}

try {
  await run();
} finally {
  await prisma.$disconnect();
}
