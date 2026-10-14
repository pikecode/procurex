import 'reflect-metadata';
import { DatabaseService } from '../dist/apps/api/src/database/database.service.js';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

assertLocalFixtureDatabase(process.env.DATABASE_URL);
const database = new DatabaseService();
try {
  const changes = await database.client.$transaction(async tx => {
    let count = 0;
    for (let n = 1; n <= 10; n++) {
      const result = await tx.store.updateMany({
        where: { code: `NUM_STORE_${n}`, address: `广东省深圳市南山区门店路${n}号` },
        data: { address: `广东省 / 深圳市 / 南山区 / 门店路${n}号` }
      });
      count += result.count;
    }
    return count;
  });
  console.log(`Updated ${changes} numbered local store addresses.`);
} finally {
  await database.client.$disconnect();
}
