import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { DeliveryMode, SettlementMode } from '../dist/packages/backend/generated/prisma/enums.js';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const prefix = 'PXFLOW';
const username = 'pxflow_user';
const storeUsername = 'pxflow_store';
const supplierUsername = 'pxflow_supplier';
const password = 'correct-password';

async function roles() {
  const entries = [
    ['ADMIN', 'Admin'],
    ['PURCHASER', 'Purchaser'],
    ['STORE', 'Store'],
    ['SUPPLIER', 'Supplier'],
    ['HQ_FINANCE', 'HQ Finance'],
  ];
  return Promise.all(entries.map(([code, name]) => prisma.role.upsert({ where: { code }, update: {}, create: { code, name } })));
}

async function cleanup() {
  const stores = await prisma.store.findMany({ where: { code: { startsWith: prefix } }, select: { id: true } });
  const suppliers = await prisma.supplier.findMany({ where: { code: { startsWith: prefix } }, select: { id: true } });
  const users = await prisma.user.findMany({ where: { username: { startsWith: prefix.toLowerCase() } }, select: { id: true } });
  const orders = await prisma.supplierOrder.findMany({
    where: { OR: [{ storeId: { in: stores.map((store) => store.id) } }, { supplierId: { in: suppliers.map((supplier) => supplier.id) } }] },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);

  await prisma.commandRecord.deleteMany({ where: { actorUserId: { in: users.map((user) => user.id) } } });
  await prisma.paymentAllocation.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.paymentRecord.deleteMany({ where: { OR: [{ storeId: { in: stores.map((store) => store.id) } }, { supplierId: { in: suppliers.map((supplier) => supplier.id) } }] } });
  await prisma.differenceDisposalItem.deleteMany({ where: { disposal: { OR: [{ storeId: { in: stores.map((store) => store.id) } }, { supplierId: { in: suppliers.map((supplier) => supplier.id) } }] } } });
  await prisma.differenceDisposal.deleteMany({ where: { OR: [{ storeId: { in: stores.map((store) => store.id) } }, { supplierId: { in: suppliers.map((supplier) => supplier.id) } }] } });
  await prisma.adjustmentDocumentItem.deleteMany({ where: { adjustment: { supplierOrderId: { in: orderIds } } } });
  await prisma.adjustmentDocument.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.settlementItemSnapshot.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.shipmentGapAllocation.deleteMany({ where: { shipmentItem: { shipment: { supplierOrderId: { in: orderIds } } } } });
  await prisma.replenishmentGap.deleteMany({ where: { orderItem: { supplierOrderId: { in: orderIds } } } });
  await prisma.discrepancyReturn.deleteMany({ where: { orderItem: { supplierOrderId: { in: orderIds } } } });
  await prisma.discrepancyAction.deleteMany({ where: { discrepancy: { orderItem: { supplierOrderId: { in: orderIds } } } } });
  await prisma.discrepancy.deleteMany({ where: { orderItem: { supplierOrderId: { in: orderIds } } } });
  await prisma.receiptItem.deleteMany({ where: { receipt: { shipment: { supplierOrderId: { in: orderIds } } } } });
  await prisma.receipt.deleteMany({ where: { shipment: { supplierOrderId: { in: orderIds } } } });
  await prisma.shipmentItem.deleteMany({ where: { shipment: { supplierOrderId: { in: orderIds } } } });
  await prisma.shipment.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.supplierOrder.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.requestItem.deleteMany({ where: { request: { storeId: { in: stores.map((store) => store.id) } } } });
  await prisma.purchaseRequest.deleteMany({ where: { storeId: { in: stores.map((store) => store.id) } } });
  await prisma.priceVersion.deleteMany({ where: { scope: { supplierId: { in: suppliers.map((supplier) => supplier.id) } } } });
  await prisma.priceScope.deleteMany({ where: { supplierId: { in: suppliers.map((supplier) => supplier.id) } } });
  await prisma.storeAccount.deleteMany({ where: { storeId: { in: stores.map((store) => store.id) } } });
  await prisma.storeTemplateBinding.deleteMany({ where: { storeId: { in: stores.map((store) => store.id) } } });
  await prisma.templateItemSupplier.deleteMany({ where: { supplierId: { in: suppliers.map((supplier) => supplier.id) } } });
  await prisma.templateItem.deleteMany({ where: { template: { code: { startsWith: prefix } } } });
  await prisma.orderTemplate.deleteMany({ where: { code: { startsWith: prefix } } });
  await prisma.supplierProduct.deleteMany({ where: { supplierId: { in: suppliers.map((supplier) => supplier.id) } } });
  await prisma.product.deleteMany({ where: { sku: { startsWith: prefix } } });
  await prisma.category.deleteMany({ where: { code: { startsWith: prefix } } });
  await prisma.unit.deleteMany({ where: { code: { startsWith: prefix } } });
  await prisma.userSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
  await prisma.userScope.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map((supplier) => supplier.id) } } });
  await prisma.store.deleteMany({ where: { id: { in: stores.map((store) => store.id) } } });
}

async function run() {
  await cleanup();
  const roleRows = await roles();
  const roleByCode = Object.fromEntries(roleRows.map((role) => [role.code, role]));
  const [store, supplier, template, category, unit] = await Promise.all([
    prisma.store.create({ data: { code: `${prefix}-STORE`, name: 'PX Flow Demo Store' } }),
    prisma.supplier.create({ data: { code: `${prefix}-SUP`, name: 'PX Flow Demo Supplier', deliveryMode: DeliveryMode.SELF, defaultSettlementMode: SettlementMode.STORED_VALUE, defaultSettlementCycle: 'MONTHLY' } }),
    prisma.orderTemplate.create({ data: { code: `${prefix}-TPL`, name: 'PX Flow Demo Template' } }),
    prisma.category.create({ data: { code: `${prefix}-CAT`, name: 'PX Flow Demo Category' } }),
    prisma.unit.create({ data: { code: `${prefix}-UNIT`, name: 'piece' } }),
  ]);
  const product = await prisma.product.create({ data: { sku: `${prefix}-SKU`, name: 'PX Flow Demo Product', categoryId: category.id, baseUnitId: unit.id } });
  await prisma.user.create({
    data: {
      username,
      displayName: 'PX Flow Demo User',
      passwordHash: await hashPassword(password),
      roles: { create: roleRows.map((role) => ({ roleId: role.id })) },
    },
  });
  await prisma.user.create({
    data: {
      username: storeUsername,
      displayName: 'PX Flow Store User',
      passwordHash: await hashPassword(password),
      roles: { create: [{ roleId: roleByCode.STORE.id }] },
      scopes: { create: { scopeType: 'STORE', storeId: store.id } },
    },
  });
  await prisma.user.create({
    data: {
      username: supplierUsername,
      displayName: 'PX Flow Supplier User',
      passwordHash: await hashPassword(password),
      roles: { create: [{ roleId: roleByCode.SUPPLIER.id }] },
      scopes: { create: { scopeType: 'SUPPLIER', supplierId: supplier.id } },
    },
  });
  await prisma.storeAccount.create({ data: { storeId: store.id, balance: '1000.00' } });
  const templateItem = await prisma.templateItem.create({ data: { templateId: template.id, productId: product.id } });
  await prisma.templateItemSupplier.create({ data: { templateItemId: templateItem.id, supplierId: supplier.id, priority: 1 } });
  await prisma.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } });
  await prisma.supplierProduct.create({ data: { supplierId: supplier.id, productId: product.id } });
  const scope = await prisma.priceScope.create({ data: { productId: product.id, supplierId: supplier.id } });
  await prisma.priceVersion.create({
    data: {
      scopeId: scope.id,
      salesPrice: '12.000000',
      supplyPrice: '9.000000',
      effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      reason: 'PX flow demo baseline',
    },
  });

  const seed = {
    generatedAt: new Date().toISOString(),
    username,
    storeUsername,
    supplierUsername,
    password,
    storeId: store.id,
    supplierId: supplier.id,
    productId: product.id,
    quantity: '10.000000',
    expectedSalesAmount: '120.00',
    expectedSupplyAmount: '90.00',
    roleAccounts: [
      { role: 'Operator', username, scope: 'ADMIN/PURCHASER/HQ_FINANCE/STORE/SUPPLIER', surface: '下单、采购确认、发货、收货、账单和付款预览' },
      { role: 'Store', username: storeUsername, scope: 'STORE scoped to PXFLOW store', surface: '待收货与差异处理结果通知' },
      { role: 'Supplier', username: supplierUsername, scope: 'SUPPLIER scoped to PXFLOW supplier', surface: '收货差异通知与差异处理' },
      { role: 'Purchaser', username, scope: 'ADMIN/PURCHASER', surface: '供应商拒单通知与审计追踪' },
    ],
  };
  await writeFile(resolve(process.cwd(), 'apps/web/main-flow-demo-seed.json'), `${JSON.stringify(seed, null, 2)}\n`);
  console.log('Main flow demo seed ready.');
  console.log(`  User: ${username} / ${password}`);
  console.log('  Open: http://127.0.0.1:4173/main-flow-demo.html');
}

try {
  await run();
} finally {
  await prisma.$disconnect();
}
