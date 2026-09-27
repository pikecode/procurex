import { PrismaPg } from '@prisma/adapter-pg';
import {
  DeliveryMode,
  FulfillmentStatus,
  PaymentAllocationState,
  PaymentRecordDirection,
  PaymentRecordStatus,
  PaymentStatus,
  PriceChangeRunOrderStatus,
  PriceChangeRunStatus,
  PurchaseRequestStatus,
  SettlementMode,
  ShipmentKind,
  SupplierOrderStatus,
} from '../dist/packages/backend/generated/prisma/enums.js';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const prefix = 'PXACC';
const password = 'correct-password';

function sid(kind, supplierOrderId) {
  return Buffer.from(JSON.stringify({ kind, supplierOrderId })).toString('base64url');
}

async function roles() {
  const entries = [
    ['ADMIN', 'Admin'],
    ['HQ_FINANCE', 'HQ Finance'],
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
  const users = await prisma.user.findMany({ where: { username: { startsWith: prefix.toLowerCase() } }, select: { id: true, username: true } });
  const orders = await prisma.supplierOrder.findMany({
    where: { OR: [{ storeId: { in: stores.map((store) => store.id) } }, { supplierId: { in: suppliers.map((supplier) => supplier.id) } }] },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);
  const runOrders = await prisma.priceChangeRunOrder.findMany({
    where: { supplierOrderId: { in: orderIds } },
    select: { runId: true },
  });
  const runIds = [...new Set(runOrders.map((order) => order.runId))];

  await prisma.commandRecord.deleteMany({ where: { actorUserId: { in: users.map((user) => user.id) } } });
  await prisma.differenceDisposalItem.deleteMany({
    where: { OR: [{ adjustmentDocument: { supplierOrderId: { in: orderIds } } }, { disposal: { OR: [{ storeId: { in: stores.map((store) => store.id) } }, { supplierId: { in: suppliers.map((supplier) => supplier.id) } }] } }] },
  });
  await prisma.differenceDisposal.deleteMany({
    where: { OR: [{ storeId: { in: stores.map((store) => store.id) } }, { supplierId: { in: suppliers.map((supplier) => supplier.id) } }] },
  });
  await prisma.adjustmentDocumentItem.deleteMany({ where: { adjustment: { supplierOrderId: { in: orderIds } } } });
  await prisma.adjustmentDocument.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.priceChangeAdjustment.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.priceChangeRunOrder.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.priceChangeRun.deleteMany({ where: { id: { in: runIds } } });
  await prisma.paymentAllocation.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.paymentRecord.deleteMany({
    where: { OR: [{ storeId: { in: stores.map((store) => store.id) } }, { supplierId: { in: suppliers.map((supplier) => supplier.id) } }] },
  });
  await prisma.settlementItemSnapshot.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.shipmentItem.deleteMany({ where: { shipment: { supplierOrderId: { in: orderIds } } } });
  await prisma.receiptItem.deleteMany({ where: { receipt: { shipment: { supplierOrderId: { in: orderIds } } } } });
  await prisma.receipt.deleteMany({ where: { shipment: { supplierOrderId: { in: orderIds } } } });
  await prisma.shipment.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { supplierOrderId: { in: orderIds } } });
  await prisma.supplierOrder.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.requestItem.deleteMany({ where: { request: { storeId: { in: stores.map((store) => store.id) } } } });
  await prisma.purchaseRequest.deleteMany({ where: { storeId: { in: stores.map((store) => store.id) } } });
  await prisma.storeAccount.deleteMany({ where: { storeId: { in: stores.map((store) => store.id) } } });
  await prisma.storeTemplateBinding.deleteMany({ where: { storeId: { in: stores.map((store) => store.id) } } });
  await prisma.templateItemSupplier.deleteMany({ where: { supplierId: { in: suppliers.map((supplier) => supplier.id) } } });
  await prisma.templateItem.deleteMany({ where: { template: { code: { startsWith: prefix } } } });
  await prisma.orderTemplate.deleteMany({ where: { code: { startsWith: prefix } } });
  await prisma.supplierProduct.deleteMany({ where: { supplierId: { in: suppliers.map((supplier) => supplier.id) } } });
  await prisma.priceVersion.deleteMany({ where: { scope: { supplierId: { in: suppliers.map((supplier) => supplier.id) } } } });
  await prisma.priceScope.deleteMany({ where: { supplierId: { in: suppliers.map((supplier) => supplier.id) } } });
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

async function createOrder({ store, supplier, template, product, no, mode, cycle, shippedAt, sales, supply, freight, status = PaymentStatus.PAID }) {
  const request = await prisma.purchaseRequest.create({
    data: {
      requestNo: `${prefix}-REQ-${no}`,
      storeId: store.id,
      templateId: template.id,
      status: PurchaseRequestStatus.CONFIRMED,
      paymentStatus: status,
      salesGoodsAmount: sales,
      supplyGoodsAmount: supply,
      paidAmount: status === PaymentStatus.PAID ? sales : '0.00',
    },
  });
  const order = await prisma.supplierOrder.create({
    data: {
      supplierOrderNo: `${prefix}-SO-${no}`,
      requestId: request.id,
      storeId: store.id,
      supplierId: supplier.id,
      settlementMode: mode,
      settlementCycleSnapshot: cycle,
      status: SupplierOrderStatus.COMPLETED,
      fulfillmentStatus: FulfillmentStatus.COMPLETED,
      firstShippedAt: new Date(shippedAt),
      completedAt: new Date(shippedAt),
      pushedAt: new Date(shippedAt),
      salesGoodsAmount: sales,
      supplyGoodsAmount: supply,
      items: {
        create: [{
          productId: product.id,
          quantity: '10.000000',
          shippedQuantity: '10.000000',
          receivedQuantity: '10.000000',
          salesUnitPrice: (Number(sales) / 10).toFixed(6),
          supplyUnitPrice: (Number(supply) / 10).toFixed(6),
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
      shippedAt: new Date(shippedAt),
      freight,
      items: {
        create: [{
          orderItemId: order.items[0].id,
          quantity: '10.000000',
          salesPriceSnapshot: (Number(sales) / 10).toFixed(6),
          supplyPriceSnapshot: (Number(supply) / 10).toFixed(6),
          salesLineAmount: sales,
          supplyLineAmount: supply,
        }],
      },
    },
  });
  return order;
}

async function createSupplierPriceAdjustment({ order, amount, label }) {
  const item = await prisma.orderItem.findFirstOrThrow({ where: { supplierOrderId: order.id } });
  const quantity = Number(item.quantity);
  const previousSupply = Number(item.supplyUnitPrice);
  const newSupply = previousSupply + Number(amount) / quantity;
  const run = await prisma.priceChangeRun.create({
    data: {
      status: PriceChangeRunStatus.SUCCEEDED,
      affectedOrderCount: 1,
      salesDelta: '0.00',
      supplyDelta: amount,
    },
  });
  await prisma.priceChangeRunOrder.create({
    data: {
      runId: run.id,
      supplierOrderId: order.id,
      status: PriceChangeRunOrderStatus.SUCCEEDED,
      salesDelta: '0.00',
      supplyDelta: amount,
    },
  });
  const adjustment = await prisma.priceChangeAdjustment.create({
    data: {
      runId: run.id,
      supplierOrderId: order.id,
      orderItemId: item.id,
      previousSalesPrice: item.salesUnitPrice,
      newSalesPrice: item.salesUnitPrice,
      previousSupplyPrice: previousSupply.toFixed(6),
      newSupplyPrice: newSupply.toFixed(6),
      salesDelta: '0.00',
      supplyDelta: amount,
    },
  });
  const document = await prisma.adjustmentDocument.create({
    data: {
      sourcePriceChangeId: adjustment.id,
      supplierOrderId: order.id,
      storeId: order.storeId,
      supplierId: order.supplierId,
      side: 'SUPPLIER',
      amount,
      originalPeriodKey: 'MONTHLY:2026-09-01:2026-10-01',
      settlementPeriodKey: 'MONTHLY:2026-09-01:2026-10-01',
      sourceRevision: order.version,
      items: { create: [{ orderItemId: item.id, amount }] },
    },
  });
  return { run, adjustment, document, label };
}

async function run() {
  await cleanup();
  const role = await roles();
  const [store, template, category, unit] = await Promise.all([
    prisma.store.create({ data: { code: `${prefix}-STORE`, name: 'PX Acceptance Store' } }),
    prisma.orderTemplate.create({ data: { code: `${prefix}-TPL`, name: 'PX Acceptance Template' } }),
    prisma.category.create({ data: { code: `${prefix}-CAT`, name: 'PX Acceptance Category' } }),
    prisma.unit.create({ data: { code: `${prefix}-UNIT`, name: 'piece' } }),
  ]);
  const product = await prisma.product.create({
    data: { sku: `${prefix}-SKU`, name: 'PX Acceptance Product', categoryId: category.id, baseUnitId: unit.id },
  });
  const suppliers = {
    company: await prisma.supplier.create({ data: { code: `${prefix}-SUP-COMPANY`, name: 'PX Company Term Supplier', deliveryMode: DeliveryMode.SELF, defaultSettlementMode: SettlementMode.COMPANY_TERM, defaultSettlementCycle: 'MONTHLY' } }),
    stored: await prisma.supplier.create({ data: { code: `${prefix}-SUP-STORED`, name: 'PX Stored Value Supplier', deliveryMode: DeliveryMode.SELF, defaultSettlementMode: SettlementMode.STORED_VALUE, defaultSettlementCycle: 'MONTHLY' } }),
    credit: await prisma.supplier.create({ data: { code: `${prefix}-SUP-CREDIT`, name: 'PX Credit Supplier', deliveryMode: DeliveryMode.SELF, defaultSettlementMode: SettlementMode.CREDIT, defaultSettlementCycle: 'HALF_MONTHLY' } }),
    direct: await prisma.supplier.create({ data: { code: `${prefix}-SUP-DIRECT`, name: 'PX Direct Supplier', deliveryMode: DeliveryMode.SELF, defaultSettlementMode: SettlementMode.SUPPLIER_TERM, defaultSettlementCycle: 'MONTHLY' } }),
  };
  await prisma.storeAccount.create({ data: { storeId: store.id, balance: '1000.00', creditLimit: '800.00' } });
  const templateItem = await prisma.templateItem.create({ data: { templateId: template.id, productId: product.id } });
  await prisma.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } });
  await Promise.all(Object.values(suppliers).map((supplier, index) => prisma.templateItemSupplier.create({ data: { templateItemId: templateItem.id, supplierId: supplier.id, priority: index + 1 } })));
  await Promise.all(Object.values(suppliers).map((supplier) => prisma.supplierProduct.create({ data: { supplierId: supplier.id, productId: product.id } })));

  await createUser('pxacc_admin', 'PX Acceptance Admin', [role.ADMIN.id, role.HQ_FINANCE.id], null);
  await createUser('pxacc_store', 'PX Acceptance Store User', [role.STORE.id, role.STORE_FINANCE.id], { scopeType: 'STORE', storeId: store.id });
  await createUser('pxacc_supplier_company', 'PX Acceptance Company Supplier', [role.SUPPLIER.id], { scopeType: 'SUPPLIER', supplierId: suppliers.company.id });
  await createUser('pxacc_supplier_direct', 'PX Acceptance Direct Supplier', [role.SUPPLIER.id], { scopeType: 'SUPPLIER', supplierId: suppliers.direct.id });

  const companyOrder = await createOrder({ store, supplier: suppliers.company, template, product, no: 'COMPANY', mode: SettlementMode.COMPANY_TERM, cycle: 'MONTHLY', shippedAt: '2026-09-08T04:00:00.000Z', sales: '120.00', supply: '90.00', freight: '10.00' });
  const storedOrder = await createOrder({ store, supplier: suppliers.stored, template, product, no: 'STORED', mode: SettlementMode.STORED_VALUE, cycle: 'MONTHLY', shippedAt: '2026-09-09T04:00:00.000Z', sales: '80.00', supply: '64.00', freight: '5.00' });
  const storedAdjustmentCreditOrder = await createOrder({ store, supplier: suppliers.stored, template, product, no: 'STORED-ADJ-CREDIT', mode: SettlementMode.STORED_VALUE, cycle: 'MONTHLY', shippedAt: '2026-09-11T04:00:00.000Z', sales: '50.00', supply: '40.00', freight: '0.00' });
  const storedAdjustmentTargetOrder = await createOrder({ store, supplier: suppliers.stored, template, product, no: 'STORED-ADJ-TARGET', mode: SettlementMode.STORED_VALUE, cycle: 'MONTHLY', shippedAt: '2026-09-12T04:00:00.000Z', sales: '60.00', supply: '45.00', freight: '0.00' });
  await createOrder({ store, supplier: suppliers.credit, template, product, no: 'CREDIT', mode: SettlementMode.CREDIT, cycle: 'HALF_MONTHLY', shippedAt: '2026-09-16T04:00:00.000Z', sales: '200.00', supply: '170.00', freight: '15.00' });
  await createOrder({ store, supplier: suppliers.direct, template, product, no: 'DIRECT', mode: SettlementMode.SUPPLIER_TERM, cycle: 'MONTHLY', shippedAt: '2026-09-18T04:00:00.000Z', sales: '150.00', supply: '150.00', freight: '12.50' });
  await createSupplierPriceAdjustment({ order: storedAdjustmentCreditOrder, amount: '-4.00', label: 'supplier credit' });
  await createSupplierPriceAdjustment({ order: storedAdjustmentTargetOrder, amount: '10.00', label: 'supplier target' });

  const payment = await prisma.paymentRecord.create({
    data: {
      paymentNo: `${prefix}-PAY-SHARED`,
      direction: PaymentRecordDirection.COMPANY_TO_SUPPLIER,
      supplierId: suppliers.stored.id,
      amount: '69.00',
      businessDate: new Date('2026-09-27T00:00:00.000Z'),
      status: PaymentRecordStatus.PENDING,
      remark: 'Acceptance seed: reserved from supplier-store view',
      allocations: {
        create: [{
          settlementItemId: sid('SUPPLIER_PAYABLE', storedOrder.id),
          supplierOrderId: storedOrder.id,
          amount: '69.00',
          sourceVersion: storedOrder.version,
          state: PaymentAllocationState.RESERVED,
        }],
      },
    },
  });

  console.log('Billing acceptance seed ready.');
  console.log(`  Web: http://127.0.0.1:4173/billing.html`);
  console.log(`  Password for all accounts: ${password}`);
  console.log('  Accounts:');
  console.log('    pxacc_admin - ADMIN,HQ_FINANCE, sees all W09/S05/S08 tabs');
  console.log('    pxacc_store - STORE,STORE_FINANCE, sees store and direct tabs');
  console.log('    pxacc_supplier_company - SUPPLIER scoped to company-term supplier');
  console.log('    pxacc_supplier_direct - SUPPLIER scoped to direct supplier');
  console.log('  Seeded evidence:');
  console.log(`    Company-term order: ${companyOrder.supplierOrderNo}, supplier preview blocked until store receivable is paid`);
  console.log(`    Stored-value order: ${storedOrder.supplierOrderNo}, supplier payable reserved by ${payment.paymentNo}`);
  console.log('    W10 adjustments: PXACC-SO-STORED-ADJ-CREDIT -4.00 can offset PXACC-SO-STORED-ADJ-TARGET +10.00');
  console.log('    Credit order: PXACC-SO-CREDIT, half-month period starts 2026-09-16');
  console.log('    Direct order: PXACC-SO-DIRECT, preview channel should be DIRECT');
}

try {
  await run();
} finally {
  await prisma.$disconnect();
}
