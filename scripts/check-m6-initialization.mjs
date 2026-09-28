import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const cutoffDate = process.env.M6_INITIALIZATION_CUTOFF ?? '2026-09-28';

function decimalToNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(value.toString());
}

function money(value) {
  return decimalToNumber(value).toFixed(2);
}

function check(name, passed, detail, severity = 'required') {
  return { name, status: passed ? 'PASS' : severity === 'required' ? 'FAIL' : 'WARN', severity, detail };
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] ?? 'UNKNOWN';
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

async function buildReport() {
  const [
    stores,
    suppliers,
    products,
    orderTemplates,
    templateItems,
    templateItemSuppliers,
    storeTemplateBindings,
    users,
    storeScopes,
    supplierScopes,
    accounts,
    accountTotals,
    negativeAccounts,
    fundingTotals,
    negativeAllocations,
    fundingByMethod,
    paymentRecords,
    paymentByStatus,
    paymentEvidenceFiles,
    settlementSnapshots,
  ] = await Promise.all([
    prisma.store.count(),
    prisma.supplier.count(),
    prisma.product.count({ where: { isActive: true } }),
    prisma.orderTemplate.count({ where: { isArchived: false } }),
    prisma.templateItem.count({ where: { isEnabled: true } }),
    prisma.templateItemSupplier.count(),
    prisma.storeTemplateBinding.count({ where: { expiredAt: null } }),
    prisma.user.findMany({
      where: { status: 'ACTIVE' },
      include: { roles: { include: { role: true } }, scopes: true },
    }),
    prisma.userScope.count({ where: { scopeType: 'STORE', storeId: { not: null } } }),
    prisma.userScope.count({ where: { scopeType: 'SUPPLIER', supplierId: { not: null } } }),
    prisma.storeAccount.count(),
    prisma.storeAccount.aggregate({
      _sum: { balance: true, creditLimit: true, creditUsed: true },
    }),
    prisma.storeAccount.count({
      where: {
        OR: [
          { balance: { lt: 0 } },
          { creditLimit: { lt: 0 } },
          { creditUsed: { lt: 0 } },
        ],
      },
    }),
    prisma.fundingAllocation.aggregate({
      where: { active: true },
      _count: { _all: true },
      _sum: { targetAmount: true, netPaid: true, creditOutstanding: true },
    }),
    prisma.fundingAllocation.count({
      where: {
        active: true,
        OR: [
          { targetAmount: { lt: 0 } },
          { netPaid: { lt: 0 } },
          { creditOutstanding: { lt: 0 } },
        ],
      },
    }),
    prisma.fundingAllocation.groupBy({
      by: ['method'],
      where: { active: true },
      _count: { _all: true },
      _sum: { targetAmount: true, netPaid: true, creditOutstanding: true },
    }),
    prisma.paymentRecord.findMany({
      select: { direction: true, status: true, amount: true },
    }),
    prisma.paymentRecord.groupBy({
      by: ['direction', 'status'],
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.fileObject.count({ where: { purpose: 'PAYMENT_EVIDENCE', status: 'READY' } }),
    prisma.settlementItemSnapshot.aggregate({
      _count: { _all: true },
      _sum: { goodsAmount: true, freightAmount: true, totalAmount: true },
    }),
  ]);

  const roleCounts = {};
  for (const user of users) {
    for (const userRole of user.roles) {
      roleCounts[userRole.role.code] = (roleCounts[userRole.role.code] ?? 0) + 1;
    }
  }

  const requiredRoles = ['ADMIN', 'HQ_FINANCE', 'PURCHASER', 'STORE', 'STORE_FINANCE', 'SUPPLIER'];
  const checks = [
    check(
      'Required role bindings',
      requiredRoles.every((role) => (roleCounts[role] ?? 0) > 0),
      `roles=${requiredRoles.map((role) => `${role}:${roleCounts[role] ?? 0}`).join(', ')}`,
    ),
    check('Store user scopes', storeScopes > 0, `storeScopes=${storeScopes}`),
    check('Supplier user scopes', supplierScopes > 0, `supplierScopes=${supplierScopes}`),
    check('Master data inventory', stores > 0 && suppliers > 0 && products > 0, `stores=${stores}, suppliers=${suppliers}, activeProducts=${products}`),
    check(
      'Template pricing inventory',
      orderTemplates > 0 && templateItems > 0 && templateItemSuppliers > 0 && storeTemplateBindings > 0,
      `templates=${orderTemplates}, items=${templateItems}, itemSuppliers=${templateItemSuppliers}, storeBindings=${storeTemplateBindings}`,
    ),
    check('Store account opening data', accounts > 0, `storeAccounts=${accounts}`),
    check('No negative store balances or credit figures', negativeAccounts === 0, `negativeAccounts=${negativeAccounts}`),
    check('No negative active funding allocations', negativeAllocations === 0, `negativeAllocations=${negativeAllocations}`),
    check(
      'Settlement/payable snapshots exist',
      settlementSnapshots._count._all > 0,
      `settlementSnapshots=${settlementSnapshots._count._all}`,
      'local-evidence',
    ),
    check(
      'Payment evidence inventory exists',
      paymentEvidenceFiles > 0,
      `readyPaymentEvidenceFiles=${paymentEvidenceFiles}`,
      'local-evidence',
    ),
  ];

  const blockers = checks.filter((item) => item.severity === 'required' && item.status !== 'PASS');
  const status = blockers.length === 0 ? 'LOCAL_READY' : 'BLOCKED';

  return {
    generatedAt: new Date().toISOString(),
    title: 'M6 Local Initialization And Finance Signoff Check',
    status,
    summary: status === 'LOCAL_READY'
      ? 'Required local initialization inventory and reconciliation checks passed; customer finance sign-off is still required before production READY.'
      : 'Required local initialization inventory or reconciliation checks failed.',
    cutoffDate,
    environment: {
      node: process.version,
      databaseUrl: connectionString.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@'),
      note: 'Local configured PostgreSQL database; this does not replace customer source files or final finance sign-off.',
    },
    productionFinalSignoff: {
      signed: false,
      financeApprover: null,
      customerSourceFiles: [],
      requiredBeforeReady: [
        'cutoff date confirmed by customer finance',
        'master-data import source files archived',
        'opening store balances and credit receivables reconciled',
        'uncleared supplier payables reconciled',
        'role bindings reviewed by operations owner',
      ],
    },
    inventory: {
      stores,
      suppliers,
      activeProducts: products,
      activeOrderTemplates: orderTemplates,
      activeTemplateItems: templateItems,
      templateItemSuppliers,
      activeStoreTemplateBindings: storeTemplateBindings,
      activeUsers: users.length,
      roleCounts,
      scopeCounts: { store: storeScopes, supplier: supplierScopes },
    },
    financeReconciliation: {
      storeAccounts: {
        count: accounts,
        totalBalance: money(accountTotals._sum.balance),
        totalCreditLimit: money(accountTotals._sum.creditLimit),
        totalCreditUsed: money(accountTotals._sum.creditUsed),
        negativeAccountRows: negativeAccounts,
      },
      activeFundingAllocations: {
        count: fundingTotals._count._all,
        totalTargetAmount: money(fundingTotals._sum.targetAmount),
        totalNetPaid: money(fundingTotals._sum.netPaid),
        totalCreditOutstanding: money(fundingTotals._sum.creditOutstanding),
        negativeAllocationRows: negativeAllocations,
        byMethod: fundingByMethod.map((item) => ({
          method: item.method,
          count: item._count._all,
          targetAmount: money(item._sum.targetAmount),
          netPaid: money(item._sum.netPaid),
          creditOutstanding: money(item._sum.creditOutstanding),
        })),
      },
      settlementSnapshots: {
        count: settlementSnapshots._count._all,
        goodsAmount: money(settlementSnapshots._sum.goodsAmount),
        freightAmount: money(settlementSnapshots._sum.freightAmount),
        totalAmount: money(settlementSnapshots._sum.totalAmount),
      },
      paymentRecords: {
        count: paymentRecords.length,
        byDirection: countBy(paymentRecords, 'direction'),
        byStatus: countBy(paymentRecords, 'status'),
        grouped: paymentByStatus.map((item) => ({
          direction: item.direction,
          status: item.status,
          count: item._count._all,
          amount: money(item._sum.amount),
        })),
        readyEvidenceFiles: paymentEvidenceFiles,
      },
    },
    checks,
    blockers: blockers.map((item) => item.name),
  };
}

try {
  const result = await buildReport();
  await mkdir('var', { recursive: true });
  await writeFile('var/m6-initialization-signoff.json', `${JSON.stringify(result, null, 2)}\n`);

  console.log('M6 local initialization check complete.');
  console.log(`  Status: ${result.status}`);
  console.log(`  Cutoff date: ${result.cutoffDate}`);
  for (const item of result.checks) {
    console.log(`  ${item.status.padEnd(4)} ${item.name}: ${item.detail}`);
  }
  console.log('  Wrote: var/m6-initialization-signoff.json');
  if (result.status !== 'LOCAL_READY') process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
