import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../dist/packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../dist/packages/domain/src/password.js';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  if (await db.user.count()) throw new Error('Bootstrap only accepts an empty user table');
  const password = randomBytes(24).toString('base64url');
  await db.$transaction(async tx => {
    for (const [code, name] of [['ADMIN', '管理员'], ['PURCHASER', '采购员'], ['HQ_FINANCE', '总部财务'], ['STORE', '门店'], ['SUPPLIER', '供应商']]) {
      await tx.role.upsert({ where: { code }, update: {}, create: { code, name } });
    }
    const role = await tx.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    await tx.user.create({ data: {
      username: 'admin', displayName: '系统管理员', passwordHash: await hashPassword(password),
      roles: { create: { roleId: role.id } }, scopes: { create: { scopeType: 'COMPANY' } },
    } });
  });
  writeFileSync('/tmp/bootstrap-admin.json', JSON.stringify({ username: 'admin', password }), { mode: 0o600 });
  console.log('Administrator initialized; credentials written to /tmp/bootstrap-admin.json');
} finally {
  await db.$disconnect();
}
