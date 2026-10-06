import { PrismaPg } from '@prisma/adapter-pg';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';
import {
  DeliveryMode,
  FulfillmentStatus,
  FundingAllocationMethod,
  LedgerDirection,
  LedgerSourceType,
  PaymentStatus,
  PurchaseRequestStatus,
  SettlementMode,
  ShipmentKind,
  SupplierOrderStatus,
} from '../dist/packages/backend/generated/prisma/enums.js';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
assertLocalFixtureDatabase(connectionString);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const prefix = 'PXRPT';
const password = 'correct-password';

async function roles() {
  const entries = [
    ['ADMIN', 'Admin'],
    ['HQ_FINANCE', 'HQ Finance'],
    ['PURCHASER', 'Purchaser'],
    ['STORE', 'Store'],
    ['STORE_FINANCE', 'Store Finance'],
    ['SUPPLIER', 'Supplier'],
  ];
  return Object.fromEntries(
    await Promise.all(entries.map(async ([code, name]) => {
      const role = await prisma.role.upsert({ where: { code }, update: {}, create: { code, name } });
      return [code, role];
    })),
  );
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
  const accountIds = await prisma.storeAccount.findMany({ where: { storeId: { in: stores.map((store) => store.id) } }, select: { id: true } });

  await prisma.exportJob.deleteMany({ where: { requestedById: { in: users.map((user) => user.id) } } });
  await prisma.accountLedger.deleteMany({ where: { accountId: { in: accountIds.map((account) => account.id) } } });
  await prisma.fundingAllocation.deleteMany({ where: { storeId: { in: stores.map((store) => store.id) } } });
  await prisma.paymentAllocation.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.paymentRecord.deleteMany({ where: { OR: [{ storeId: { in: stores.map((store) => store.id) } }, { supplierId: { in: suppliers.map((supplier) => supplier.id) } }] } });
  await prisma.settlementItemSnapshot.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.shipmentItem.deleteMany({ where: { shipment: { supplierOrderId: { in: orderIds } } } });
  await prisma.receiptItem.deleteMany({ where: { receipt: { shipment: { supplierOrderId: { in: orderIds } } } } });
  await prisma.receipt.deleteMany({ where: { shipment: { supplierOrderId: { in: orderIds } } } });
  await prisma.shipment.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.supplierOrder.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.requestItem.deleteMany({ where: { request: { storeId: { in: stores.map((store) => store.id) } } } });
  await prisma.purchaseRequest.deleteMany({ where: { storeId: { in: stores.map((store) => store.id) } } });
  await prisma.storeTemplateBinding.deleteMany({ where: { storeId: { in: stores.map((store) => store.id) } } });
  await prisma.storeAccount.deleteMany({ where: { storeId: { in: stores.map((store) => store.id) } } });
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

async function createUser(username, displayName, roleIds, scope) {
  return prisma.user.create({
    data: {
      username,
      displayName,
      passwordHash: await hashPassword(password),
      roles: { create: roleIds.map((roleId) => ({ roleId })) },
      ...(scope ? { scopes: { create: scope } } : {}),
    },
  });
}

async function createOrder({ store, supplier, template, product, no, mode, completedAt, quantity, salesUnitPrice, supplyUnitPrice, freight }) {
  const sales = (quantity * salesUnitPrice).toFixed(2);
  const supply = (quantity * supplyUnitPrice).toFixed(2);
  const request = await prisma.purchaseRequest.create({
    data: {
      requestNo: `${prefix}-REQ-${no}`,
      storeId: store.id,
      templateId: template.id,
      status: PurchaseRequestStatus.COMPLETED,
      paymentStatus: PaymentStatus.PAID,
      salesGoodsAmount: sales,
      supplyGoodsAmount: supply,
      paidAmount: sales,
      confirmedAt: new Date(completedAt),
    },
  });
  const order = await prisma.supplierOrder.create({
    data: {
      supplierOrderNo: `${prefix}-SO-${no}`,
      requestId: request.id,
      storeId: store.id,
      supplierId: supplier.id,
      settlementMode: mode,
      settlementCycleSnapshot: 'MONTHLY',
      status: SupplierOrderStatus.COMPLETED,
      fulfillmentStatus: FulfillmentStatus.COMPLETED,
      firstShippedAt: new Date(completedAt),
      completedAt: new Date(completedAt),
      pushedAt: new Date(completedAt),
      salesGoodsAmount: sales,
      supplyGoodsAmount: supply,
      items: {
        create: [{
          productId: product.id,
          quantity: quantity.toFixed(6),
          shippedQuantity: quantity.toFixed(6),
          receivedQuantity: quantity.toFixed(6),
          salesUnitPrice: salesUnitPrice.toFixed(6),
          supplyUnitPrice: supplyUnitPrice.toFixed(6),
          salesLineAmount: sales,
          supplyLineAmount: supply,
        }],
      },
    },
    include: { items: true },
  });
  await prisma.shipment.create({
    data: {
      shipmentNo: `${prefix}-SHIP-${no}`,
      supplierOrderId: order.id,
      sequence: 1,
      kind: ShipmentKind.INITIAL,
      shippedAt: new Date(completedAt),
      freight,
      items: {
        create: [{
          orderItemId: order.items[0].id,
          quantity: quantity.toFixed(6),
          salesPriceSnapshot: salesUnitPrice.toFixed(6),
          supplyPriceSnapshot: supplyUnitPrice.toFixed(6),
          salesLineAmount: sales,
          supplyLineAmount: supply,
        }],
      },
    },
  });
  return order;
}

async function run() {
  await cleanup();
  const role = await roles();
  const [store, otherStore, template, category, unit] = await Promise.all([
    prisma.store.create({ data: { code: `${prefix}-STORE`, name: '报表验收门店' } }),
    prisma.store.create({ data: { code: `${prefix}-OTHER-STORE`, name: '报表对照门店' } }),
    prisma.orderTemplate.create({ data: { code: `${prefix}-TPL`, name: '报表验收模板' } }),
    prisma.category.create({ data: { code: `${prefix}-CAT`, name: '粮油分类' } }),
    prisma.unit.create({ data: { code: `${prefix}-UNIT`, name: '千克' } }),
  ]);
  const [product, otherProduct] = await Promise.all([
    prisma.product.create({ data: { sku: `${prefix}-SKU-RICE`, name: '验收大米', categoryId: category.id, baseUnitId: unit.id } }),
    prisma.product.create({ data: { sku: `${prefix}-SKU-OIL`, name: '验收食用油', categoryId: category.id, baseUnitId: unit.id } }),
  ]);
  const [companySupplier, directSupplier] = await Promise.all([
    prisma.supplier.create({ data: { code: `${prefix}-SUP-COMPANY`, name: '报表公司账期供应商', deliveryMode: DeliveryMode.SELF, defaultSettlementMode: SettlementMode.COMPANY_TERM, defaultSettlementCycle: 'MONTHLY' } }),
    prisma.supplier.create({ data: { code: `${prefix}-SUP-DIRECT`, name: '报表直结供应商', deliveryMode: DeliveryMode.SELF, defaultSettlementMode: SettlementMode.SUPPLIER_TERM, defaultSettlementCycle: 'MONTHLY' } }),
  ]);
  const item = await prisma.templateItem.create({ data: { templateId: template.id, productId: product.id } });
  const otherItem = await prisma.templateItem.create({ data: { templateId: template.id, productId: otherProduct.id } });
  await Promise.all([
    prisma.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } }),
    prisma.storeTemplateBinding.create({ data: { storeId: otherStore.id, templateId: template.id } }),
    prisma.templateItemSupplier.create({ data: { templateItemId: item.id, supplierId: companySupplier.id, priority: 1 } }),
    prisma.templateItemSupplier.create({ data: { templateItemId: otherItem.id, supplierId: directSupplier.id, priority: 2 } }),
    prisma.supplierProduct.create({ data: { supplierId: companySupplier.id, productId: product.id } }),
    prisma.supplierProduct.create({ data: { supplierId: directSupplier.id, productId: otherProduct.id } }),
  ]);

  await createUser('pxrpt_admin', '报表验收管理员', [role.ADMIN.id, role.HQ_FINANCE.id], null);
  await createUser('pxrpt_store', '报表验收门店用户', [role.STORE.id, role.STORE_FINANCE.id], { scopeType: 'STORE', storeId: store.id });
  await createUser('pxrpt_supplier', '报表验收供应商用户', [role.SUPPLIER.id], { scopeType: 'SUPPLIER', supplierId: companySupplier.id });

  await createOrder({ store, supplier: companySupplier, template, product, no: 'COMPANY-A', mode: SettlementMode.COMPANY_TERM, completedAt: '2026-09-05T04:00:00.000Z', quantity: 8, salesUnitPrice: 12, supplyUnitPrice: 9, freight: '5.00' });
  await createOrder({ store, supplier: companySupplier, template, product, no: 'COMPANY-B', mode: SettlementMode.STORED_VALUE, completedAt: '2026-09-21T04:00:00.000Z', quantity: 6, salesUnitPrice: 10, supplyUnitPrice: 7, freight: '3.00' });
  await createOrder({ store: otherStore, supplier: directSupplier, template, product: otherProduct, no: 'DIRECT', mode: SettlementMode.SUPPLIER_TERM, completedAt: '2026-09-22T04:00:00.000Z', quantity: 5, salesUnitPrice: 20, supplyUnitPrice: 20, freight: '2.00' });

  const account = await prisma.storeAccount.create({ data: { storeId: store.id, balance: '120.00', creditUsed: '80.00' } });
  await prisma.accountLedger.create({
    data: {
      accountId: account.id,
      direction: LedgerDirection.CREDIT,
      amount: '100.00',
      balanceAfter: '100.00',
      sourceType: LedgerSourceType.RECHARGE,
      sourceId: store.id,
      note: 'PXRPT reconciliation mismatch seed',
      occurredAt: new Date('2026-09-01T04:00:00.000Z'),
    },
  });
  await Promise.all([
    prisma.fundingAllocation.create({ data: { storeId: store.id, method: FundingAllocationMethod.CREDIT, targetAmount: '30.00', creditOutstanding: '30.00' } }),
    prisma.fundingAllocation.create({ data: { storeId: store.id, method: FundingAllocationMethod.CREDIT, targetAmount: '20.00', creditOutstanding: '20.00' } }),
  ]);

  const seed = {
    generatedAt: new Date().toISOString(),
    username: 'pxrpt_admin',
    password,
    storeId: store.id,
    supplierId: companySupplier.id,
    productId: product.id,
    reconciliationStoreId: store.id,
    expected: {
      orderAmountTotal: '166.00',
      scopedOrderAmountTotal: '164.00',
      productQuantity: '14.000000',
      profit: '42.00',
      freightAmount: '8.00',
    },
  };
  await prisma.$disconnect();
  console.log('Reports acceptance seed ready.');
  console.log(`  Admin: ${seed.username} / ${password}`);
  console.log(`  Store scoped account: pxrpt_store / ${password}`);
  console.log(`  Supplier scoped account: pxrpt_supplier / ${password}`);
  console.log(`  Expected company-term/non-direct profit: ${seed.expected.profit}`);
}

try {
  await run();
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
