import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';
import { SupplierOrderStatus, UserScopeType, UserStatus } from '../dist/packages/backend/generated/prisma/enums.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

async function run() {
  const hours = Number(option('hours', process.env.OVERDUE_RECEIPT_HOURS ?? '24'));
  if (!Number.isFinite(hours) || hours <= 0) throw new Error('hours must be a positive number');
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const shipments = await prisma.shipment.findMany({
    where: {
      shippedAt: { lte: cutoff },
      receipts: { none: { isCurrent: true } },
      supplierOrder: { status: { not: SupplierOrderStatus.COMPLETED } },
    },
    include: {
      supplierOrder: { select: { id: true, supplierOrderNo: true, storeId: true } },
    },
    orderBy: [{ shippedAt: 'asc' }, { id: 'asc' }],
    take: 200,
  });

  let created = 0;
  for (const shipment of shipments) {
    const recipients = await prisma.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        scopes: { some: { scopeType: UserScopeType.STORE, storeId: shipment.supplierOrder.storeId } },
        roles: { some: { role: { code: { in: ['STORE', 'STORE_FINANCE'] } } } },
      },
      select: { id: true },
    });
    if (!recipients.length) continue;
    const result = await prisma.notification.createMany({
      data: recipients.map((recipient) => ({
        recipientId: recipient.id,
        eventKey: `OVERDUE_RECEIPT:${shipment.id}`,
        channel: 'IN_APP',
        title: '超时收货提醒',
        body: `供应商订单 ${shipment.supplierOrder.supplierOrderNo} 已发货超过 ${hours} 小时，请尽快复核收货。`,
        payload: {
          type: 'OVERDUE_RECEIPT',
          route: '/main-flow-demo.html',
          supplierOrderId: shipment.supplierOrder.id,
          shipmentId: shipment.id,
          shippedAt: shipment.shippedAt.toISOString(),
          thresholdHours: hours,
        },
      })),
      skipDuplicates: true,
    });
    created += result.count;
  }

  console.log('Overdue receipt reminder scan completed.');
  console.log(`  Threshold hours: ${hours}`);
  console.log(`  Shipments scanned: ${shipments.length}`);
  console.log(`  Notifications created: ${created}`);
}

try {
  await run();
} finally {
  await prisma.$disconnect();
}
