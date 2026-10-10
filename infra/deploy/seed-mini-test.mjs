import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../dist/packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../dist/packages/domain/src/password.js';

const url = new URL(process.env.DATABASE_URL);
const local = process.env.CONFIRM_SERVER_TEST_DATA === 'procurex-mini-local-test' && url.hostname === '127.0.0.1' && url.port === '55438';
if ((!local && (process.env.CONFIRM_SERVER_TEST_DATA !== 'procurex-mini-test' || url.hostname !== 'postgres')) || url.pathname !== '/procurex') {
  throw new Error('Explicit server test database confirmation required');
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
try {
  const seed = await db.$transaction(async tx => {
    const store = await tx.store.create({ data: { code: 'MINITEST-STORE', name: '小程序流程测试门店' } });
    const supplier = await tx.supplier.create({ data: { code: 'MINITEST-SUP', name: '小程序流程测试供应商', deliveryMode: 'SELF', defaultSettlementMode: 'STORED_VALUE', defaultSettlementCycle: 'MONTHLY' } });
    const category = await tx.category.create({ data: { code: 'MINITEST-CAT', name: '小程序测试商品' } });
    const unit = await tx.unit.findFirst({ where: { name: '袋' } }) || await tx.unit.create({ data: { code: 'MINITEST-UNIT', name: '袋' } });
    const template = await tx.orderTemplate.create({ data: { code: 'MINITEST-TPL', name: '小程序流程测试模板', tag: '测试', remark: '仅用于测试，不是真实业务' } });
    const products = [];
    for (const [index, name, sales, supply] of [[1, '测试珍珠粉圆', '12', '9'], [2, '测试茉莉茶叶', '20', '15']]) {
      const product = await tx.product.create({ data: { sku: `MINITEST-SKU${index}`, name, categoryId: category.id, baseUnitId: unit.id, defaultSalesPrice: sales } });
      const item = await tx.templateItem.create({ data: { templateId: template.id, productId: product.id, initialSalesPrice: sales } });
      await tx.templateItemSupplier.create({ data: { templateItemId: item.id, supplierId: supplier.id, priority: 1 } });
      await tx.supplierProduct.create({ data: { supplierId: supplier.id, productId: product.id } });
      const scope = await tx.priceScope.create({ data: { productId: product.id, supplierId: supplier.id } });
      await tx.priceVersion.create({ data: { scopeId: scope.id, salesPrice: sales, supplyPrice: supply, effectiveAt: new Date(Date.now() - 60000), reason: '小程序测试价格' } });
      products.push({ id: product.id, name });
    }
    await tx.templateSupplierSetting.create({ data: { templateId: template.id, supplierId: supplier.id, settlementMode: 'STORED_VALUE', settlementCycle: 'MONTHLY' } });
    await tx.storeTemplateBinding.create({ data: { storeId: store.id, templateId: template.id } });
    await tx.storeAccount.create({ data: { storeId: store.id } });
    const collection = await tx.collectionAccount.create({ data: { name: '测试收款账户（非真实银行）', bankName: '测试银行', accountName: '测试账户', accountNo: 'TEST-NOT-A-BANK-ACCOUNT' } });
    const accounts = {};
    for (const [key, role, scope] of [['store', 'STORE', { scopeType: 'STORE', storeId: store.id }], ['supplier', 'SUPPLIER', { scopeType: 'SUPPLIER', supplierId: supplier.id }], ['purchaser', 'PURCHASER', { scopeType: 'COMPANY' }]]) {
      const row = await tx.role.findUniqueOrThrow({ where: { code: role } });
      const username = `mini_test_${key}`;
      const password = randomBytes(18).toString('base64url');
      await tx.user.create({ data: { username, passwordHash: await hashPassword(password), displayName: `小程序测试${key === 'store' ? '门店' : key === 'supplier' ? '供应商' : '采购'}`, roles: { create: { roleId: row.id } }, scopes: { create: scope } } });
      accounts[key] = { username, password };
    }
    return { storeId: store.id, supplierId: supplier.id, collectionAccountId: collection.id, products, accounts };
  }, { timeout: 30000 });
  await writeFile(process.env.TEST_MANIFEST || '/tmp/mini-test.json', JSON.stringify(seed, null, 2), { mode: 0o600, flag: 'wx' });
  console.log('Dedicated mini test data created; credentials saved privately.');
} finally { await db.$disconnect(); }
