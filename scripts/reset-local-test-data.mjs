import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';
import { hashPassword } from '../dist/packages/domain/src/password.js';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

const connectionString = process.env.DATABASE_URL;
assertLocalFixtureDatabase(connectionString);
const url = new URL(connectionString);
if (url.port !== '55438' || url.pathname !== '/procurex' || url.username !== 'procurex') throw new Error('Only the dedicated local procurex database may be reset');
if (!process.argv.includes('--reset-confirmed')) throw new Error('Explicit --reset-confirmed is required');
const password = process.env.LOCAL_TEST_PASSWORD;
if (!password || password.length < 12) throw new Error('LOCAL_TEST_PASSWORD must contain at least 12 characters');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const run = promisify(execFile);
const backupDirectory = resolve('var/private-files/database-backups');
const backup = resolve(backupDirectory, `procurex-before-reset-${Date.now()}.dump`);
const manifestPath = resolve(backupDirectory, 'test-data-manifest.json');
try {
  const administrators = await db.user.findMany({ where: { roles: { some: { role: { code: 'ADMIN' } } } }, select: { id: true, username: true, status: true } });
  if (!administrators.some(user => user.status === 'ACTIVE')) throw new Error('An active administrator must be preserved');
  const inspect = JSON.parse((await run('docker', ['inspect', 'procurex-local-postgres-1'])).stdout)[0];
  if (!inspect.NetworkSettings.Ports['5432/tcp']?.some(binding => binding.HostIp === '127.0.0.1' && binding.HostPort === '55438')) throw new Error('Backup container does not match local database');
  const dump = await run('docker', ['exec', 'procurex-local-postgres-1', 'pg_dump', '-U', 'procurex', '-d', 'procurex', '-Fc'], { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 });
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await writeFile(backup, dump.stdout, { mode: 0o600, flag: 'wx' });
  await run('docker', ['cp', backup, 'procurex-local-postgres-1:/tmp/procurex-reset-backup.dump']);
  await run('docker', ['exec', 'procurex-local-postgres-1', 'pg_restore', '--list', '/tmp/procurex-reset-backup.dump']);
  const passwordHash = await hashPassword(password);
  const manifest = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.catalog-registry'))`;
    const preserved = ['_prisma_migrations', 'User', 'UserRole', 'Role', 'Permission', 'RolePermission'];
    const tables = await tx.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    const targets = tables.filter(row => !preserved.includes(row.tablename));
    // Quote database-discovered identifiers; no CASCADE may reach preserved identity tables.
    const identifiers = targets.map(row => `"public"."${row.tablename.replaceAll('"', '""')}"`).join(', ');
    if (identifiers) await tx.$executeRawUnsafe(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY`);
    const adminIds = administrators.map(user => user.id);
    await tx.userRole.deleteMany({ where: { userId: { notIn: adminIds } } });
    await tx.user.deleteMany({ where: { id: { notIn: adminIds } } });
    for (const id of adminIds) await tx.userScope.create({ data: { userId: id, scopeType: 'COMPANY' } });
    const roleCodes = ['PURCHASER', 'STORE', 'STORE_FINANCE', 'SUPPLIER', 'HQ_FINANCE'];
    const roles = {};
    for (const code of roleCodes) roles[code] = await tx.role.findUniqueOrThrow({ where: { code } });
    const accounts = [];
    async function user(username, displayName, role, scope = { scopeType: 'COMPANY' }) {
      await tx.user.create({ data: { username, displayName, passwordHash, roles: { create: { roleId: roles[role].id } }, scopes: { create: scope } } });
      accounts.push({ username, displayName, role });
    }
    await user('test_purchase', '测试｜公司采购', 'PURCHASER');
    await user('test_hq_finance', '测试｜公司财务', 'HQ_FINANCE');
    const unitMap = {};
    for (const [i, name] of ['袋', '包', '瓶', '箱', '件'].entries()) unitMap[name] = await tx.unit.create({ data: { code: `TEST_UNIT_${i}`, name } });
    const root = await tx.category.create({ data: { code: 'TEST_CAT', name: '测试商品' } });
    const categories = {};
    for (const [i, name] of ['茶饮原料', '粮油调味', '包装耗材'].entries()) categories[name] = await tx.category.create({ data: { code: `TEST_CAT_${i}`, name, parentId: root.id, sortOrder: i } });
    const products = [];
    const productDefinitions = [
      ['茉莉茶叶｜常规订货', '茶饮原料', '袋', '25.00', 1, 1],
      ['珍珠粉圆｜多供应商比价', '茶饮原料', '袋', '18.00', 1, 1],
      ['红茶茶叶｜采购单位换算', '茶饮原料', '袋', '22.00', 1, 1],
      ['食用油｜最低订购5瓶', '粮油调味', '瓶', '45.00', 5, 1],
      ['大米｜按3袋倍数订货', '粮油调味', '袋', '68.00', 3, 3],
      ['打包杯｜常规耗材', '包装耗材', '包', '12.00', 1, 1],
      ['备用原料｜未绑定模板不可订', '茶饮原料', '袋', '30.00', 1, 1],
      ['停用原料｜不可订货', '茶饮原料', '袋', '20.00', 1, 1],
    ];
    for (const [i, [name, category, unit, price, min, multiple]] of productDefinitions.entries()) products.push(await tx.product.create({ data: {
      sku: `TEST_PRODUCT_${i}`, name, categoryId: categories[category].id, baseUnitId: unitMap[unit].id,
      defaultSalesPrice: price, minOrderQty: min, orderMultiple: multiple, isActive: i !== 7, specification: '测试规格', storageCondition: 'AMBIENT',
    } }));
    await tx.productUnitConversion.create({ data: { productId: products[2].id, fromUnitId: unitMap['箱'].id, toUnitId: unitMap['袋'].id, ratio: '10' } });
    const stores = []; const suppliers = []; const templates = [];
    const modes = [['stored', '储值', 'STORED_VALUE', 'IMMEDIATE'], ['credit', '挂账', 'CREDIT', 'IMMEDIATE'], ['company', '公司账期', 'COMPANY_TERM', 'MONTHLY'], ['supplier', '供应商账期', 'SUPPLIER_TERM', 'MONTHLY']];
    const effectiveAt = new Date(Date.now() - 60000);
    for (const [index, [key, label, mode, cycle]] of modes.entries()) {
      const group = await tx.storeGroup.create({ data: { name: `测试｜${label}场景` } });
      const store = await tx.store.create({ data: { code: `TEST_STORE_${key}`, name: `测试门店｜${label}流程`, groupName: group.name, storeType: 'DIRECT', contactName: '测试店长', contactPhone: '13800000000', address: '广东省深圳市南山区测试路1号' } });
      await tx.storeAccount.create({ data: { storeId: store.id, creditLimit: mode === 'CREDIT' ? '5000' : '0', creditCumulative: '0' } });
      const supplier = await tx.supplier.create({ data: { code: `TEST_SUPPLIER_${key}`, name: `测试供应商｜${label}·${index % 2 ? '物流' : '自配送'}`, deliveryMode: index % 2 ? 'LOGISTICS' : 'SELF', defaultSettlementMode: mode, defaultSettlementCycle: cycle, supplierType: mode === 'SUPPLIER_TERM' ? 'DIRECT' : 'HEADQUARTERS', contactName: '测试业务员', contactPhone: '13900000000', deliveryContactPhone: '13700000000', requiresFreight: false } });
      const template = await tx.orderTemplate.create({ data: { code: `TEST_TEMPLATE_${key}`, name: `测试模板｜${label}门店专用`, tag: `测试-${label}`, remark: '前6个商品可订，未绑定及停用商品用于权限验证' } });
      await tx.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id, effectiveAt } });
      for (const [i, product] of products.entries()) {
        await tx.supplierProduct.create({ data: { supplierId: supplier.id, productId: product.id } });
        const supplyPrice = mode === 'SUPPLIER_TERM' ? product.defaultSalesPrice : product.defaultSalesPrice.minus(2);
        await tx.priceScope.create({ data: { productId: product.id, supplierId: supplier.id, templateKey: '', versions: { create: { salesPrice: product.defaultSalesPrice, supplyPrice, effectiveAt, revision: 1, reason: '本地测试初始化' } } } });
        if (i < 6) await tx.templateItem.create({ data: { productId: product.id, templateId: template.id, sortOrder: i, initialSalesPrice: product.defaultSalesPrice, suppliers: { create: { supplierId: supplier.id, priority: 0 } } } });
      }
      await user(`test_chef_${key}`, `测试｜${label}门店厨政经理`, 'STORE', { scopeType: 'STORE', storeId: store.id });
      await user(`test_finance_${key}`, `测试｜${label}门店财务`, 'STORE_FINANCE', { scopeType: 'STORE', storeId: store.id });
      await user(`test_supplier_${key}`, `测试｜${label}供应商`, 'SUPPLIER', { scopeType: 'SUPPLIER', supplierId: supplier.id });
      stores.push({ id: store.id, name: store.name }); suppliers.push({ id: supplier.id, name: supplier.name }); templates.push({ id: template.id, name: template.name });
      if (mode === 'COMPANY_TERM') await tx.templateStoreSupplierCycle.create({ data: { templateId: template.id, storeId: store.id, supplierId: supplier.id, settlementCycle: 'WEEKLY' } });
    }
    const alternate = await tx.supplier.create({ data: { code: 'TEST_SUPPLIER_ALTERNATE', name: '测试供应商｜储值·备用低价', deliveryMode: 'SELF', defaultSettlementMode: 'STORED_VALUE', defaultSettlementCycle: 'IMMEDIATE', supplierType: 'HEADQUARTERS', deliveryContactPhone: '13600000000' } });
    const product = products[1];
    await tx.supplierProduct.create({ data: { supplierId: alternate.id, productId: product.id } });
    await tx.priceScope.create({ data: { supplierId: alternate.id, productId: product.id, templateKey: '', versions: { create: { salesPrice: '17.00', supplyPrice: '14.00', effectiveAt, revision: 1, reason: '多供应商不同价格测试' } } } });
    const item = await tx.templateItem.findUniqueOrThrow({ where: { templateId_productId: { templateId: templates[0].id, productId: product.id } } });
    await tx.templateItemSupplier.create({ data: { templateItemId: item.id, supplierId: alternate.id, priority: 1 } });
    await user('test_supplier_alternate', '测试｜备用低价供应商', 'SUPPLIER', { scopeType: 'SUPPLIER', supplierId: alternate.id });
    suppliers.push({ id: alternate.id, name: alternate.name });
    await tx.collectionAccount.create({ data: { name: '测试收款账户｜充值和销账', bankName: '测试银行（非真实账户）', accountName: '测试公司', accountNo: 'TEST-NOT-A-REAL-ACCOUNT' } });
    return { backup, preservedAdministrators: administrators.map(({ username, status }) => ({ username, status })), accounts, stores, suppliers, templates, products: products.map(({ id, name }) => ({ id, name })) };
  }, { timeout: 60000, maxWait: 10000 });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ backup, backupBytes: (await stat(backup)).size, manifestPath, counts: { stores: await db.store.count(), suppliers: await db.supplier.count(), products: await db.product.count(), templates: await db.orderTemplate.count(), users: await db.user.count(), orders: await db.supplierOrder.count(), recharges: await db.rechargeDocument.count() } }, null, 2));
} finally { await db.$disconnect(); }
