import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { assertLocalFixtureDatabase } from './local-fixture-guard.mjs';

for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
  test(`allows recognized local fixture DB on ${host}`, () => assert.doesNotThrow(() => assertLocalFixtureDatabase(`postgresql://test:test@${host}:5433/drill_restore`, 'test')));
}
for (const [name, url, environment] of [
  ['production', 'postgresql://test:test@127.0.0.1:5433/procurex', 'production'],
  ['remote', 'postgresql://test:test@db.example.com:5433/procurex', 'test'],
  ['wrong database', 'postgresql://test:test@127.0.0.1:5433/customer', 'test'],
  ['missing port', 'postgresql://test:test@localhost/procurex', 'test'],
  ['wrong protocol', 'https://localhost:5433/procurex', 'test'],
  ['malformed', 'not-a-url', 'test'],
]) test(`refuses ${name}`, () => assert.throws(() => assertLocalFixtureDatabase(url, environment), /LOCAL_FIXTURE_DATABASE_REQUIRED/));

for (const script of ['seed-main-flow-demo.mjs', 'seed-billing-acceptance.mjs', 'seed-reports-acceptance.mjs', 'seed-notifications-acceptance.mjs', 'capture-product-media-evidence.mjs', 'capture-native-profile-prices.mjs']) {
  for (const environment of ['production', 'test']) test(`${script} refuses unsafe configuration before connecting (${environment})`, () => {
    const result = spawnSync(process.execPath, [`scripts/${script}`], { encoding: 'utf8', timeout: 15000,
      env: { ...process.env, NODE_ENV: environment, DATABASE_URL: environment === 'production' ? 'postgresql://test:test@127.0.0.1:5433/procurex' : 'postgresql://test:test@db.example.com:5433/procurex' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /LOCAL_FIXTURE_DATABASE_REQUIRED/);
    assert.doesNotMatch(result.stderr, /ECONNREFUSED|PrismaClientInitializationError/);
  });
}
