import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync, fork } from 'node:child_process';
import { assertLoadIsolation, assertLoadApi, summarizeLoad } from './sustained-load.mjs';

const runId = '00000000-0000-0000-0000-000000000000';
const root = `/private/tmp/procurex-load-${runId}`;
const environment = () => ({ NODE_ENV: 'test', LOAD_RUN_ID: runId, LOAD_ROOT: root,
  DATABASE_URL: 'postgresql://local:local@127.0.0.1:5433/load_acceptance', PRIVATE_FILE_DIR: `${root}/files` });
test('accepts owned local load environment', () => assert.equal(assertLoadIsolation(environment()), environment().DATABASE_URL));
test('accepts only isolated loopback API targets', () => {
  assert.equal(assertLoadApi('http://127.0.0.1:49152/api/v1'), 'http://127.0.0.1:49152/api/v1');
  for (const base of ['http://127.0.0.1:3114/api/v1', 'http://127.0.0.1:3000/api/v1', 'https://127.0.0.1:49152/api/v1',
    'http://example.com:49152/api/v1', 'http://127.0.0.1/api/v1', 'http://127.0.0.1:49152/api/v1?x=1',
    'http://user:pass@127.0.0.1:49152/api/v1', 'http://127.0.0.1:49152/other']) assert.throws(() => assertLoadApi(base));
});
test('diagnostic counters record successful and failed operations without parameters and restore the client', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { observeLoadDatabase } from './scripts/order-load-diagnostics.mjs';
    let observer;
    const original = { $extends(extension) { observer = extension.query.$allOperations; return { instrumented: true }; } };
    const service = { client: original };
    const monitor = observeLoadDatabase(service);
    try {
      assert.equal(service.client.instrumented, true);
      const operation = { model: 'UserSession', operation: 'findUnique', args: { token: 'secret-test-token' } };
      assert.equal(await observer({ ...operation, query: async () => 42 }), 42);
      await assert.rejects(observer({ ...operation, query: async () => { throw new Error('test rejection'); } }), /test rejection/);
      const report = monitor.snapshot();
      assert.equal(report.queries[0].count, 2);
      assert.ok(report.queries[0].totalMs >= 0);
      assert.ok(!JSON.stringify(report).includes('secret-test-token'));
      assert.equal(monitor.snapshot().queries.length, 0);
    } finally { await monitor.close(); }
    assert.equal(service.client, original);
  `], { encoding: 'utf8', timeout: 5000, env: { ...process.env, ...environment() } });
  assert.equal(child.status, 0, child.stderr);
});
for (const [name, input] of [
  ['shared API', { base: 'http://127.0.0.1:3114/api/v1', stores: [], productId: runId }],
  ['incomplete store fixtures', { base: 'http://127.0.0.1:49152/api/v1', stores: [], productId: runId }],
]) test(`generator refuses ${name} over actual IPC before HTTP`, async () => {
  const child = fork(new URL('./order-load-generator.mjs', import.meta.url), [], {
    env: { ...process.env, ...environment() }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let failure;
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('message', message => { failure = message; });
      child.on('close', (code, signal) => {
        try { assert.equal(code, 1); assert.equal(signal, null); assert.equal(failure?.type, 'failure'); resolve(); }
        catch (error) { reject(error); }
      });
      child.send(input);
    });
  } finally { clearTimeout(timer); }
});
for (const [name, overrides] of [
  ['production', { NODE_ENV: 'production' }], ['shared port', { DATABASE_URL: 'postgresql://local:local@127.0.0.1:55438/load_acceptance' }],
  ['shared DB', { DATABASE_URL: 'postgresql://local:local@127.0.0.1:5433/procurex' }],
  ['remote', { DATABASE_URL: 'postgresql://local:local@db.example.com:5433/load_acceptance' }],
  ['no port', { DATABASE_URL: 'postgresql://local:local@127.0.0.1/load_acceptance' }],
  ['wrong protocol', { DATABASE_URL: 'https://127.0.0.1:5433/load_acceptance' }],
  ['unowned root', { LOAD_ROOT: '/private/tmp/other' }], ['shared files', { PRIVATE_FILE_DIR: 'var/private-files' }],
  ['invalid run ID', { LOAD_RUN_ID: '-'.repeat(36) }],
]) test(`refuses ${name} before application creation`, () => {
  assert.throws(() => assertLoadIsolation({ ...environment(), ...overrides }));
  const child = spawnSync(process.execPath, ['scripts/check-isolated-order-load.mjs'], { encoding: 'utf8', timeout: 15000,
    env: { ...process.env, ...environment(), ...overrides } });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /AssertionError/);
  assert.doesNotMatch(child.stderr, /ECONNREFUSED|PrismaClientInitializationError/);
  const generator = spawnSync(process.execPath, ['scripts/order-load-generator.mjs'], { encoding: 'utf8', timeout: 15000,
    env: { ...process.env, ...environment(), ...overrides } });
  assert.equal(generator.status, 1); assert.match(generator.stderr, /AssertionError/);
  const diagnostics = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { observeLoadDatabase } from './scripts/order-load-diagnostics.mjs'; observeLoadDatabase({});"], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, ...environment(), ...overrides },
  });
  assert.equal(diagnostics.status, 1); assert.match(diagnostics.stderr, /AssertionError/);
  assert.doesNotMatch(diagnostics.stderr, /ECONNREFUSED|TypeError/);
});
const samples = () => Array.from({ length: 300 }, (_, index) => ({ durationMs: 25, completedAtMs: index * 100 + 25 }));
const options = { rate: 10, durationMs: 30000, dropped: 0, maxInFlight: 2, elapsedMs: 30000 };
test('uses interior completion window, not offered requests, as sustained throughput', () => {
  const report = summarizeLoad(samples(), options);
  assert.equal(report.steadyWindow.qps, 10); assert.equal(report.p95Ms, 25); assert.equal(report.targetMet, true);
});
test('dropped arrivals cannot count as achieved capacity', () => assert.equal(summarizeLoad(samples().slice(1), { ...options, dropped: 1 }).targetMet, false));
test('HTTP failures cannot count as achieved capacity', () => {
  const values = samples(); values[50].error = 'HTTP_500';
  const report = summarizeLoad(values, options);
  assert.equal(report.errorsByCode.HTTP_500, 1); assert.equal(report.targetMet, false);
});
test('completion after arrival window cannot fake sustained capacity', () => {
  const values = samples().map(item => ({ ...item, completedAtMs: item.completedAtMs + 30000 }));
  const report = summarizeLoad(values, { ...options, elapsedMs: 60000 });
  assert.equal(report.steadyWindow.qps, 0); assert.equal(report.targetMet, false);
});
