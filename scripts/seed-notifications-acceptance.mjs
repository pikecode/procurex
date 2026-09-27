import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function run() {
  const users = await prisma.user.findMany({ where: { username: { in: ['pxrpt_admin', 'pxrpt_store'] } }, select: { id: true, username: true } });
  const byUsername = Object.fromEntries(users.map((user) => [user.username, user]));
  if (!byUsername.pxrpt_admin || !byUsername.pxrpt_store) throw new Error('Run reports:seed-acceptance before notifications:seed-acceptance.');
  await prisma.notification.deleteMany({ where: { recipientId: { in: users.map((user) => user.id) }, eventKey: { startsWith: 'PXNOTIFY' } } });
  await prisma.notification.createMany({
    data: [
      {
        recipientId: byUsername.pxrpt_admin.id,
        eventKey: 'PXNOTIFY:ADMIN:RECONCILIATION',
        channel: 'IN_APP',
        title: '对账异常待核查',
        body: 'PXRPT 门店存在余额/流水和挂账占用差异，请进入运营与对账查看。',
        payload: { route: '/ops.html', type: 'RECONCILIATION_ISSUE', storeCode: 'PXRPT-STORE' },
      },
      {
        recipientId: byUsername.pxrpt_store.id,
        eventKey: 'PXNOTIFY:STORE:RECEIPT_REMINDER',
        channel: 'IN_APP',
        title: '待收货提醒',
        body: '有一笔 PXRPT 演示订单等待门店复核收货。',
        payload: { route: '/main-flow-demo.html', type: 'RECEIPT_REMINDER' },
      },
    ],
  });
  console.log('Notifications acceptance seed ready.');
}

try {
  await run();
} finally {
  await prisma.$disconnect();
}
