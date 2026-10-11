import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

const connectionString = process.env.DATABASE_URL;
assertLocalFixtureDatabase(connectionString);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const groups = [
  ['粮油米面', ['大米杂粮', '面粉面条', '食用油'], ['东北大米', '小米', '高筋面粉', '挂面', '大豆油', '花生油'], '袋', 'AMBIENT'],
  ['新鲜蔬菜', ['叶菜类', '根茎类', '瓜果类'], ['上海青', '生菜', '土豆', '胡萝卜', '番茄', '黄瓜'], '斤', 'CHILLED'],
  ['肉禽蛋类', ['猪肉类', '禽肉类', '鲜蛋类'], ['猪里脊', '五花肉', '鸡胸肉', '鸭腿', '鸡蛋', '鸭蛋'], '斤', 'CHILLED'],
  ['水产海鲜', ['鲜鱼类', '虾贝类', '冷冻水产'], ['鲈鱼', '草鱼', '鲜虾', '蛤蜊', '冻带鱼', '冻鱿鱼'], '斤', 'FROZEN'],
  ['调味干货', ['酱料类', '香辛料', '菌菇干货'], ['生抽', '蚝油', '花椒', '八角', '干香菇', '木耳'], '包', 'AMBIENT'],
  ['冷冻食品', ['速冻面点', '火锅丸类', '半成品菜'], ['速冻馒头', '速冻水饺', '鱼丸', '牛肉丸', '香酥鸡排', '春卷'], '包', 'FROZEN'],
  ['饮品乳品', ['牛奶酸奶', '茶饮原料', '果汁饮料'], ['纯牛奶', '原味酸奶', '红茶', '茉莉花茶', '橙汁', '椰汁'], '瓶', 'CHILLED'],
  ['清洁耗材', ['清洁用品', '一次性用品', '厨房工具'], ['洗洁精', '厨房去油剂', '一次性手套', '保鲜袋', '不锈钢漏勺', '食品夹'], '个', 'AMBIENT'],
];

try {
  const users = await db.user.findMany({ where: { username: { in: ['store1', 'store2', 'test_chef_stored'] } }, include: { scopes: true } });
  const storeIds = [...new Set(users.flatMap(user => user.scopes.map(scope => scope.storeId).filter(Boolean)))];
  const bindings = await db.storeTemplateBinding.findMany({ where: { storeId: { in: storeIds }, effectiveAt: { lte: new Date() }, OR: [{ expiredAt: null }, { expiredAt: { gt: new Date() } }] }, include: { store: true, template: { include: { items: { include: { suppliers: { include: { supplier: true }, orderBy: [{ priority: 'asc' }, { supplierId: 'asc' }] } } } } } } });
  if (bindings.length !== 2) throw new Error('Expected two existing local test-store templates');
  const templates = bindings.map(binding => {
    const supplier = binding.template.items.flatMap(item => item.suppliers).find(link => link.supplier.status === 'ACTIVE' && !link.supplier.isArchived)?.supplier;
    if (!supplier) throw new Error(`No active supplier for ${binding.store.name}`);
    return { ...binding, supplier };
  });
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.catalog-registry'))`;
    for (const [g, [name, children, names, unitName, condition]] of groups.entries()) {
      const parentCode = `CATDEMO-${g}`;
      const parent = await tx.category.upsert({ where: { code: parentCode }, update: {}, create: { code: parentCode, name, sortOrder: 100 + g } });
      const unit = await tx.unit.findFirst({ where: { name: unitName } }) || await tx.unit.create({ data: { code: `CATDEMO-UNIT-${g}`, name: unitName } });
      for (const [c, childName] of children.entries()) {
        const code = `${parentCode}-${c}`;
        const category = await tx.category.upsert({ where: { code }, update: {}, create: { code, name: childName, parentId: parent.id, sortOrder: c } });
        for (let n = 0; n < 2; n++) {
          const index = g * 6 + c * 2 + n;
          const price = (5 + index * 1.25).toFixed(2);
          const supplyPrice = (Number(price) * 0.8).toFixed(2);
          const product = await tx.product.upsert({ where: { sku: `CATDEMO-${index + 1}` }, update: {}, create: {
            sku: `CATDEMO-${index + 1}`, name: names[c * 2 + n], categoryId: category.id, baseUnitId: unit.id,
            defaultSalesPrice: price, specification: n ? null : `标准装（${unitName}）`, brand: null,
            storageCondition: g === 7 ? null : condition, minOrderQty: index % 6 === 0 ? 2 : 1, orderMultiple: index % 6 === 0 ? 2 : 1,
          } });
          for (const { template, supplier } of templates) {
            await tx.supplierProduct.upsert({ where: { supplierId_productId: { supplierId: supplier.id, productId: product.id } }, update: {}, create: { supplierId: supplier.id, productId: product.id } });
            const item = await tx.templateItem.upsert({ where: { templateId_productId: { templateId: template.id, productId: product.id } }, update: {}, create: { templateId: template.id, productId: product.id, sortOrder: 100 + index } });
            await tx.templateItemSupplier.upsert({ where: { templateItemId_supplierId: { templateItemId: item.id, supplierId: supplier.id } }, update: {}, create: { templateItemId: item.id, supplierId: supplier.id, priority: 1 } });
            let source;
            for (const templateKey of ['', template.id]) {
              const scope = await tx.priceScope.upsert({ where: { productId_supplierId_templateKey: { productId: product.id, supplierId: supplier.id, templateKey } }, update: {}, create: { productId: product.id, supplierId: supplier.id, templateKey } });
              const existing = await tx.priceVersion.findFirst({ where: { scopeId: scope.id }, orderBy: { revision: 'desc' } });
              const version = existing || await tx.priceVersion.create({ data: { scopeId: scope.id, salesPrice: price, supplyPrice, effectiveAt: new Date('2026-01-01T00:00:00Z'), reason: '门店分类测试商品初始化', ...(templateKey ? { supplySourceVersionId: source.id } : {}) } });
              if (!templateKey) source = version;
            }
          }
        }
      }
    }
  }, { timeout: 60000 });
  const productCount = await db.product.count({ where: { sku: { startsWith: 'CATDEMO-' } } });
  if (productCount !== 48) throw new Error(`Unexpected fixture product count: ${productCount}`);
  for (const { store, template, supplier } of templates) {
    const count = await db.templateItem.count({ where: { templateId: template.id, product: { sku: { startsWith: 'CATDEMO-' } }, suppliers: { some: { supplierId: supplier.id } } } });
    if (count !== 48) throw new Error(`Incomplete template: ${template.name}`);
    console.log(`${store.name} / ${template.name} / ${supplier.name}: ${count} 件新增测试商品`);
  }
  console.log('8 个一级分类，24 个二级分类，48 件商品；已有订单及余额保持不变。');
} finally { await db.$disconnect(); }
